import 'server-only';
import {createHash} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import type {PedidoEnvioTexto,ResultadoEnvio,DiarioEnvio} from './envio-whatsapp';
type Autor={hubUsuarioId:string;origemUsuarioId:string;conversaId:string};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const hash=(p:PedidoEnvioTexto,a:Autor)=>createHash('sha256').update(JSON.stringify([p.id,a.hubUsuarioId,a.origemUsuarioId,a.conversaId,p.destinatario,p.texto,p.respostaA??null])).digest('hex');
/** Pool exclusivo do destino. Revalidacao de identidade/permissao/autoridade
 * dentro da transacao. Sem operar as filas legadas pelo simples import.
 */
export function criarDiarioEnvio(pool:Pool,autor:Autor,revalidar:(tx:PoolClient,autor:Autor)=>Promise<boolean>):DiarioEnvio{
 if(!/^[A-Za-z0-9_-]{1,100}$/.test(autor.hubUsuarioId)||!uuid.test(autor.origemUsuarioId)||!uuid.test(autor.conversaId))throw Error('ENVIO_AUTOR_INVALIDO');
 const iniciados=new Map<string,string>();
 async function transacao<T>(executar:(tx:PoolClient)=>Promise<T>,verificarAutor=true){
  const tx=await pool.connect();try{
   await tx.query('BEGIN');await tx.query("SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='5s'");
   const banco=await tx.query<{current_database:string}>('SELECT current_database()');if(!['donatella_operacao','donatella_ensaio_envio'].includes(banco.rows[0]?.current_database))throw Error('DESTINO_ENVIO_RECUSADO');
   if(verificarAutor&&!await revalidar(tx,autor))throw Error('ENVIO_ACESSO_REVOGADO');
   const r=await executar(tx);await tx.query('COMMIT');return r;
  }catch(e){await tx.query('ROLLBACK').catch(()=>undefined);throw e;}finally{tx.release();}
 }
 return {
  async iniciar(p){
   if(!uuid.test(p.id)||!/^\d{8,15}$/.test(p.destinatario)||!p.texto.trim()||p.texto.length>4096)throw Error('ENVIO_ENTRADA_INVALIDA');
   const fingerprint=hash(p,autor);
   const r=await transacao(async tx=>{
    const i=await tx.query(`INSERT INTO atendimento_operacao.intencao_envio(id,hash_pedido,hub_usuario_id,origem_usuario_id,conversa_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING RETURNING id`,[p.id,fingerprint,autor.hubUsuarioId,autor.origemUsuarioId,autor.conversaId]);
    if(i.rowCount===1)return 'nova' as const;
    const anterior=await tx.query('SELECT hash_pedido FROM atendimento_operacao.intencao_envio WHERE id=$1',[p.id]);
    if(anterior.rowCount!==1||anterior.rows[0].hash_pedido!==fingerprint)throw Error('ENVIO_ID_REUTILIZADO');
    return 'ja_registrada' as const;
   });
   if(r==='nova')iniciados.set(p.id,fingerprint);return r;
  },
  async concluir(id,r:ResultadoEnvio){
   const fingerprint=iniciados.get(id);if(!fingerprint)throw Error('ENVIO_INTENCAO_AUSENTE');
   const estado=r.estado,wamid=r.estado==='aceito'?r.wamid:null,http=r.estado==='recusado'?r.http:null,codigo=r.estado==='recusado'?r.codigo:null;
   // O recibo de uma chamada ja autorizada deve sobreviver a uma revogacao
   // posterior. Isso registra a realidade externa, sem autorizar novo envio.
   await transacao(async tx=>{
    const x=await tx.query(`UPDATE atendimento_operacao.intencao_envio SET estado=$3,wamid=$4,http=$5,codigo=$6,concluida_em=now() WHERE id=$1 AND hash_pedido=$2 AND estado='iniciado'`,[id,fingerprint,estado,wamid,http,codigo]);
    if(x.rowCount!==1)throw Error('ENVIO_CONCLUSAO_RECUSADA');
   },false);iniciados.delete(id);
  }
 };
}
