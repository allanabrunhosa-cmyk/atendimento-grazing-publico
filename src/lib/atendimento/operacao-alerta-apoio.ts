import 'server-only';
import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {RepositorioOperacaoPg} from './operacao-repositorio-pg';
import type {IdentidadeOperacao} from './operacao-tipos';
import type {IntencaoOperacao} from './operacao-envio';
import type {TarefaIA} from './ia-orquestrador';
import type {CasoDuvida} from './duvidas-aprendizagem';
import {hashTarefaAgente} from './repositorio-agente-pg';
import {modeloTextoSuportadoOperacao,variaveisModeloOperacao} from './operacao-modelos';

export type ConfiguracaoAlertaApoio={habilitado:boolean;telefone:string;modeloNome:string};
function canonico(v:unknown):unknown{if(Array.isArray(v))return v.map(canonico);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonico((v as Record<string,unknown>)[k])]));return v;}
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(canonico(v))).digest('hex');
function id(s:string){const h=hash(s);return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;}
export function parametrosAlertaApoio(componentes:unknown,p:{cliente:string;pedido:string;motivo:string;resumo:string}):string[]|null{
 if(!modeloTextoSuportadoOperacao(componentes))return null;
 const n=variaveisModeloOperacao(componentes).length;
 // O template vigente é estático (zero parâmetros). Não acrescentar dados que
 // a Meta não aprovou. O formato legado de três parâmetros continua suportado.
 return n===0?[]:n===3?[p.cliente.slice(0,200),p.pedido.slice(0,100),`${p.motivo} — ${p.resumo}`.slice(0,300)]:null;
}
export async function configuracaoAlertaApoioTx(tx:PoolClient):Promise<ConfiguracaoAlertaApoio>{
 const c=(await tx.query("SELECT conteudo FROM atendimento_operacao.configuracao WHERE chave='agente_legado' FOR SHARE")).rows[0]?.conteudo.alertaApoio;
 return {habilitado:c?.habilitado===true,telefone:typeof c?.telefone==='string'?c.telefone:'',modeloNome:typeof c?.modeloNome==='string'?c.modeloNome:''};
}
export async function observarAlertaApoioTx(tx:PoolClient,empresaId:string){
 const c=await configuracaoAlertaApoioTx(tx),m=c.modeloNome?await modeloTx(tx,c):null;
 const temTabela=(await tx.query("SELECT to_regclass('atendimento_operacao.alerta_apoio') IS NOT NULL existe")).rows[0].existe;
 const estados=temTabela?(await tx.query("SELECT estado,codigo,count(*)::int quantidade,min(criada_em) mais_antigo,max(atualizada_em) ultima_atividade FROM atendimento_operacao.alerta_apoio WHERE empresa_id=$1 GROUP BY estado,codigo ORDER BY estado,codigo",[empresaId])).rows:[];
 return {habilitado:c.habilitado,telefoneConfigurado:/^\d{8,15}$/.test(c.telefone),modeloConfigurado:!!c.modeloNome,modeloAprovado:!!m,modeloCompativel:!!m&&parametrosAlertaApoio(m.componentes,{cliente:'',pedido:'',motivo:'',resumo:''})!==null,cooldownMinutos:10,estados};
}
function configValida(c:ConfiguracaoAlertaApoio){return c.habilitado&&/^\d{8,15}$/.test(c.telefone)&&/^[a-z0-9_]{1,180}$/.test(c.modeloNome);}
export async function registrarAlertaApoioTx(tx:PoolClient,t:TarefaIA,casoId:string){
 // Chamado somente pelo processamento de uma mensagem nova, com autoridade
 // automática. Importadores e listagem de casos não são disparadores.
 await tx.query("INSERT INTO atendimento_operacao.alerta_apoio(id,empresa_id,caso_id,tarefa_id,conversa_origem_id,versao_origem) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(empresa_id,caso_id) DO NOTHING",[id('alerta-apoio:'+t.empresaId+':'+casoId),t.empresaId,casoId,t.id,t.conversaId,t.versao]);
}
type Alerta={id:string;empresa_id:string;caso_id:string;tarefa_id:string;conversa_origem_id:string;versao_origem:string;estado:string;intencao_id:string|null;config_hash:string|null;modelo_hash:string|null;variaveis:string[]|null};
async function contextoTx(tx:PoolClient,a:Alerta,permitirDecisaoPendente=false){
 const r=(await tx.query<{tarefa:TarefaIA;hash:string;decisao:{estado:string;casoId:string};ficticia:boolean;estado:string;versao:string;nome:string;memoria:Record<string,unknown>;caso:CasoDuvida}>(`SELECT t.tarefa,t.hash,t.decisao,v.ficticia,v.estado,v.versao,c.nome,c.memoria,k.conteudo caso FROM atendimento_operacao.agente_tarefa t JOIN atendimento_operacao.conversa v ON v.id=t.conversa_id JOIN atendimento_operacao.contato c ON c.id=v.contato_id JOIN atendimento_apoio.casos k ON k.empresa_id=t.empresa_id AND k.id=$2 WHERE t.id=$1 AND t.empresa_id=$3 FOR SHARE OF t,v,k`,[a.tarefa_id,a.caso_id,a.empresa_id])).rows[0];
 if(!r||r.hash!==hashTarefaAgente(r.tarefa)||r.tarefa.conversaId!==a.conversa_origem_id||r.tarefa.versao!==Number(a.versao_origem)||r.estado!=='ia'||Number(r.versao)!==Number(a.versao_origem)||!['aguardando','esclarecimento'].includes(r.caso.estado)||Date.parse(r.caso.expiraEm)<=Date.now())return null;
 if(r.decisao?.estado!=='aguardando_apoio'||r.decisao.casoId!==a.caso_id){if(!permitirDecisaoPendente||r.decisao?.estado!=='apoio_pendente')return null;}
 return r;
}
async function modeloTx(tx:PoolClient,c:ConfiguracaoAlertaApoio){
 const r=await tx.query<{id:string;nome:string;idioma:string;estado:string;componentes:unknown}>("SELECT id,nome,idioma,estado,componentes FROM atendimento_operacao.modelo WHERE nome=$1 AND estado='APPROVED'",[c.modeloNome]);
 return r.rows.length===1?r.rows[0]:null;
}
export async function processarAlertaApoio(repo:RepositorioOperacaoPg,i:IdentidadeOperacao,empresaId:string){
 return repo.transacao(async tx=>{
  // Ausência do campo no pacote antigo não consulta a tabela nova; nenhuma
  // pendência de histórico é fabricada durante a atualização do serviço.
  const cfg=await configuracaoAlertaApoioTx(tx);if(!cfg.habilitado)return {estado:'alerta_desarmado'} as const;
  const a=(await tx.query<Alerta>("SELECT * FROM atendimento_operacao.alerta_apoio WHERE empresa_id=$1 AND estado='pendente' AND proxima_tentativa<=now() ORDER BY criada_em,id LIMIT 1 FOR UPDATE SKIP LOCKED",[empresaId])).rows[0];if(!a)return {estado:'sem_alerta'} as const;
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['alerta-apoio:'+empresaId+':'+a.conversa_origem_id]);
  const cancelar=async(codigo:string)=>{await tx.query("UPDATE atendimento_operacao.alerta_apoio SET estado='cancelado',codigo=$2,atualizada_em=now() WHERE id=$1",[a.id,codigo]);await repo.auditar(tx,i,a.id,'alerta_apoio_cancelar',Number(a.versao_origem));return {estado:'alerta_cancelado',codigo} as const;};
  const esperar=async(codigo:string)=>{await tx.query("UPDATE atendimento_operacao.alerta_apoio SET codigo=$2,proxima_tentativa=now()+interval '1 minute',atualizada_em=now() WHERE id=$1",[a.id,codigo]);return {estado:'alerta_bloqueado',codigo} as const;};
  const agente=(await tx.query("SELECT conteudo FROM atendimento_operacao.configuracao WHERE chave='agente' FOR SHARE")).rows[0]?.conteudo;
  if(!agente||agente.modo!=='automatico'||!agente.autoridadeAutomatica||!await repo.autorizar(i,'atender',tx))return {estado:'alerta_desarmado'} as const;
  const contexto=await contextoTx(tx,a,true);if(!contexto)return cancelar('CONTEXTO_ALTERADO');
  // O caso/outbox pode sobreviver a um crash anterior ao commit da decisão.
  // Aguardar sua confirmação; cancelá-lo aqui perderia o aviso na retomada.
  if(contexto.decisao.estado==='apoio_pendente')return esperar('DECISAO_EM_CONFIRMACAO');
  if(repo.modo()!=='operacao'&&!contexto.ficticia)return {estado:'alerta_desarmado'} as const;
  if(!configValida(cfg))return esperar('CONFIGURACAO_PLANTAO_AUSENTE');
  const modelo=await modeloTx(tx,cfg);if(!modelo)return esperar('MODELO_PLANTAO_NAO_APROVADO');
  const variaveis=parametrosAlertaApoio(modelo.componentes,{cliente:contexto.nome,pedido:contexto.memoria.wooVinculoConfirmado===true&&Number.isSafeInteger(contexto.memoria.wooPedidoId)?String(contexto.memoria.wooPedidoId):'—',motivo:contexto.caso.motivo,resumo:contexto.caso.pergunta});if(!variaveis)return esperar('MODELO_PLANTAO_INCOMPATIVEL');
  const recente=await tx.query("SELECT 1 FROM atendimento_operacao.alerta_apoio WHERE empresa_id=$1 AND conversa_origem_id=$2 AND estado='enfileirado' AND enfileirada_em>now()-interval '10 minutes'",[empresaId,a.conversa_origem_id]);if(recente.rowCount)return cancelar('COOLDOWN_10_MINUTOS');
  const chave=hash([empresaId,cfg.telefone,contexto.ficticia]),contato=id('contato-plantao:'+chave),conversa=id('conversa-plantao:'+chave);
  await tx.query("INSERT INTO atendimento_operacao.contato(id,nome,telefone,identidade_canal,tags,notas,memoria) VALUES($1,'Plantão Suporte',$2,$3,ARRAY['interno','plantao'],'Contato interno dedicado aos avisos de apoio.',$4::jsonb) ON CONFLICT(id) DO NOTHING",[contato,cfg.telefone,'interno:plantao:'+chave,JSON.stringify({destinatarioInterno:'alerta_apoio',empresaId})]);
  await tx.query("INSERT INTO atendimento_operacao.conversa(id,contato_id,estado,fila,ficticia) VALUES($1,$2,'ia','apoio_interno',$3) ON CONFLICT(id) DO NOTHING",[conversa,contato,contexto.ficticia]);
  const interno=(await tx.query('SELECT v.estado,v.versao,v.ficticia,c.telefone,c.memoria FROM atendimento_operacao.conversa v JOIN atendimento_operacao.contato c ON c.id=v.contato_id WHERE v.id=$1 FOR UPDATE OF v',[conversa])).rows[0];
  if(!interno||interno.estado!=='ia'||interno.ficticia!==contexto.ficticia||interno.telefone!==cfg.telefone||interno.memoria.destinatarioInterno!=='alerta_apoio'||interno.memoria.empresaId!==empresaId)return esperar('DESTINATARIO_INTERNO_ALTERADO');
  const envio=await repo.enfileirarTx(tx,i,{conversaId:conversa,versao:Number(interno.versao),idempotencia:id('envio-plantao:'+a.id),tipo:'template',modeloId:modelo.id,variaveis},'ia');
  await tx.query("UPDATE atendimento_operacao.alerta_apoio SET estado='enfileirado',intencao_id=$2,config_hash=$3,modelo_hash=$4,variaveis=$5::jsonb,enfileirada_em=now(),atualizada_em=now(),codigo='ENFILEIRADO' WHERE id=$1",[a.id,envio.id,hash(cfg),hash(modelo),JSON.stringify(variaveis)]);
  await repo.auditar(tx,i,a.id,'alerta_apoio_enfileirar',Number(a.versao_origem));return {estado:'alerta_enfileirado',intencaoId:envio.id} as const;
 });
}
export async function validarEnvioAlertaApoioTx(tx:PoolClient,p:IntencaoOperacao,empresaId:string):Promise<boolean|null>{
 const a=(await tx.query<Alerta>('SELECT * FROM atendimento_operacao.alerta_apoio WHERE intencao_id=$1 AND empresa_id=$2',[p.id,empresaId])).rows[0];if(!a)return null;
 const cfg=await configuracaoAlertaApoioTx(tx);if(!configValida(cfg)||hash(cfg)!==a.config_hash||p.conteudo.tipo!=='template'||p.conteudo.telefone!==cfg.telefone||hash(p.conteudo.variaveis)!==hash(a.variaveis)||!await contextoTx(tx,a))return false;
 const m=await modeloTx(tx,cfg);if(!m||m.id!==p.conteudo.modeloId||hash(m)!==a.modelo_hash)return false;
 const c=(await tx.query('SELECT c.telefone,c.memoria,v.ficticia FROM atendimento_operacao.conversa v JOIN atendimento_operacao.contato c ON c.id=v.contato_id WHERE v.id=$1',[p.conversa_id])).rows[0];
 return !!c&&c.telefone===cfg.telefone&&c.memoria.destinatarioInterno==='alerta_apoio'&&c.memoria.empresaId===empresaId&&c.ficticia===p.conteudo.ficticia;
}
