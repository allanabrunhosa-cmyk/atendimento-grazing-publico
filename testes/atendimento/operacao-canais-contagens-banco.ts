import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool,type PoolClient} from 'pg';
import {RepositorioOperacaoPg} from '../../src/lib/atendimento/operacao-repositorio-pg';
import type {CanalConversaOperacao,ContagensConversaOperacao,IdentidadeOperacao} from '../../src/lib/atendimento/operacao-tipos';

/** Opt-in exclusivamente fictício. Todos os seeds são revertidos pela transação
 * externa; a conexão do repositório usa savepoints nela, sem tocar outros dados. */
const url=process.env.CANAIS_BANCO_TESTE;
if(!url||process.env.CANAIS_FICTICIOS_AUTORIZADOS!=='somente-dados-ficticios')throw Error('ENSAIO_CANAIS_AUTORIZACAO_EXIGIDA');
const destino=new URL(url);
if(destino.protocol!=='postgresql:'||decodeURIComponent(destino.pathname.slice(1))!=='donatella_ensaio_operacao'||!['localhost','127.0.0.1','grazing-donatella-prova-ia-v2-banco','grazing-donatella-operacao-v2-banco'].includes(destino.hostname))throw Error('ENSAIO_CANAIS_DESTINO_RECUSADO');
const pool=new Pool({connectionString:url,max:1,application_name:'ensaio-canais-contagens-ficticio'}),tx=await pool.connect();
const marcador='Ensaio canais '+randomUUID(),ator:IdentidadeOperacao={id:'fixture-canais',nome:'Atendente fictício',perfilId:'fixture',sessaoVersao:1,permissoes:['consultar']};
const estados=['ia','humano','pausado','encerrada'] as const;
type Estado=typeof estados[number];
const fixtures:{id:string;estado:Estado;canal:CanalConversaOperacao;fila:string;nome:string;identidade:string|null}[]=[];
let assercoes=0,recusar=false,savepoint=0;
const verificar=(real:unknown,esperado:unknown)=>{assert.deepEqual(real,esperado);assercoes++;};
const poolLeitura={connect:async()=>({
 query:async(sql:string,parametros?:unknown[])=>{
  if(sql==='BEGIN')return tx.query('SAVEPOINT leitura_canais_'+(++savepoint));
  if(sql==='COMMIT')return tx.query('RELEASE SAVEPOINT leitura_canais_'+savepoint);
  if(sql==='ROLLBACK')return tx.query('ROLLBACK TO SAVEPOINT leitura_canais_'+savepoint);
  return tx.query(sql,parametros);
 },release:()=>undefined,
} as unknown as PoolClient)} as unknown as Pool;
const repo=new RepositorioOperacaoPg(poolLeitura,async(i,a)=>!recusar&&[ator.id,'fixture-outro'].includes(i.id)&&['consultar','atender'].includes(a),()=> 'operacao','fixture');
const esperado=(rows:typeof fixtures)=>({total:rows.filter(v=>v.estado!=='encerrada').length,ia:rows.filter(v=>v.estado==='ia').length,humano:rows.filter(v=>v.estado==='humano').length,pausado:rows.filter(v=>v.estado==='pausado').length,encerrada:rows.filter(v=>v.estado==='encerrada').length,pendentesResposta:0,conversasPendentes:0});
try{
 await tx.query('BEGIN');
 verificar((await tx.query('SELECT current_database() nome')).rows[0].nome,'donatella_ensaio_operacao');
 const grupos:{canal:CanalConversaOperacao;porEstado:number[];identidade?:(n:number)=>string|null}[]=[
  {canal:'whatsapp',porEstado:[33,4,2,1],identidade:n=>`whatsapp:123456789:${5511000010000+n}`},
  {canal:'instagram',porEstado:[3,4,0,1],identidade:n=>`instagram:123456789:${990000+n}`},
  {canal:'facebook',porEstado:[2,2,2,1],identidade:n=>`facebook:123456789:${880000+n}`},
  {canal:'nao_identificado',porEstado:[3,7,1,1],identidade:n=>n%2?null:`whatsapp:123456789:nao-confirmado-${n}`},
 ];
 for(const grupo of grupos)for(const [indice,quantidade] of grupo.porEstado.entries())for(let n=0;n<quantidade;n++){
  const ordinal=fixtures.length,contato=randomUUID(),id=randomUUID(),nome=marcador+(ordinal%2?' Alfa':' Beta'),fila=ordinal%3?'novos':'retorno',identidade=grupo.identidade?.(ordinal)??null;
  await tx.query('INSERT INTO atendimento_operacao.contato(id,nome,telefone,identidade_canal) VALUES($1,$2,$3,$4)',[contato,nome,String(5511000020000+ordinal),identidade]);
  await tx.query("INSERT INTO atendimento_operacao.conversa(id,contato_id,estado,fila,ficticia,ultima_mensagem_em) VALUES($1,$2,$3,$4,true,'2026-10-10T12:00:00Z'::timestamptz+($5::integer*interval '1 second'))",[id,contato,estados[indice],fila,ordinal]);
  fixtures.push({id,estado:estados[indice],canal:grupo.canal,fila,nome,identidade});
 }
 const primeira=await repo.listar(ator,{busca:marcador}),segunda=await repo.listar(ator,{busca:marcador,pagina:2}),terceira=await repo.listar(ator,{busca:marcador,pagina:3});
 verificar(primeira.contagens,esperado(fixtures));verificar(primeira.registros.length,30);verificar(primeira.mais,true);verificar(segunda.registros.length,30);verificar(segunda.contagens,primeira.contagens);verificar(terceira.registros.length,3);verificar(terceira.mais,false);verificar(terceira.contagens,primeira.contagens);
 verificar(new Set([...primeira.registros,...segunda.registros,...terceira.registros].map(v=>v.id)).size,63);
 verificar(Number.isFinite(Date.parse(primeira.contagensConferidasEm??'')),true);
 for(const canal of ['whatsapp','instagram','facebook','nao_identificado'] as const){
  const escopo=fixtures.filter(v=>v.canal===canal),r=await repo.listar(ator,{busca:marcador,canal});
  verificar(r.contagens,esperado(escopo));verificar(r.registros.every(v=>'canal' in v&&v.canal===canal),true);
  const humano=await repo.listar(ator,{busca:marcador,canal,estado:'humano'});verificar(humano.contagens,r.contagens);verificar(humano.registros.length,escopo.filter(v=>v.estado==='humano').length);
 }
 const combinado=fixtures.filter(v=>v.canal==='whatsapp'&&v.fila==='novos'&&v.nome.endsWith(' Alfa'));
 const buscaFilaCanal=await repo.listar(ator,{busca:marcador+' Alfa',canal:'whatsapp',fila:'novos',estado:'humano'});
 verificar(buscaFilaCanal.contagens,esperado(combinado));verificar(buscaFilaCanal.registros.length,combinado.filter(v=>v.estado==='humano').length);
 const vazia=await repo.listar(ator,{busca:marcador+' inexistente'});verificar(vazia.registros,[]);verificar(vazia.contagens,esperado([]));verificar(vazia.mais,false);
 const paginaVazia=await repo.listar(ator,{busca:marcador,pagina:4});verificar(paginaVazia.registros,[]);verificar(paginaVazia.contagens,esperado(fixtures));
 for(const f of [fixtures.find(v=>v.canal==='whatsapp')!,fixtures.find(v=>v.canal==='instagram')!,fixtures.find(v=>v.canal==='facebook')!,fixtures.find(v=>v.canal==='nao_identificado')!]){
  const h=await repo.historico(ator,{conversaId:f.id});verificar(h.conversa.canal,f.canal);verificar('identidade_canal' in h.conversa,false);
 }
 // Um envio ainda em fila/recusado/incerto e uma notificação comercial não
 // respondem às mensagens do cliente. A consulta também não apaga a pendência.
 const atendimento=fixtures.find(f=>f.estado==='humano')!;
 const enviar=async(autor:string,estado:string,segundo:number)=>{const id=randomUUID();await tx.query('INSERT INTO atendimento_operacao.mensagem(id,conversa_id,autor,conteudo,tipo,estado,criada_em) VALUES($1,$2,$3,$4,$5,$6,$7::timestamptz)',[id,atendimento.id,autor,'Texto fictício','text',estado,`2026-10-11T12:00:${String(segundo).padStart(2,'0')}Z`]);return id;};
 const vistas=[await enviar('cliente','recebido',1),await enviar('cliente','recebido',2),await enviar('cliente','recebido',5)];
 verificar((await repo.historico(ator,{conversaId:atendimento.id})).conversa.naoLidas,3);
 verificar(await repo.registrarLeitura(ator,atendimento.id,vistas),{naoLidas:0,pendentesResposta:3});
 verificar(await repo.registrarLeitura(ator,atendimento.id,vistas),{naoLidas:0,pendentesResposta:3});
 const outraSessao=new RepositorioOperacaoPg(poolLeitura,repo.autorizar,()=> 'operacao','fixture');
 verificar((await outraSessao.historico(ator,{conversaId:atendimento.id})).conversa.naoLidas,0);
 verificar((await repo.historico({...ator,id:'fixture-outro'},{conversaId:atendimento.id})).conversa.naoLidas,3);
 // Chegada atrasada com horário anterior: não se perde em um watermark.
 const atrasada=await enviar('cliente','recebido',0);
 verificar(await repo.registrarLeitura(ator,atendimento.id,vistas),{naoLidas:1,pendentesResposta:4});
 await repo.registrarLeitura(ator,atendimento.id,[atrasada]);
 await assert.rejects(()=>repo.registrarLeitura(ator,fixtures.find(f=>f.id!==atendimento.id)!.id,vistas),/OPERACAO_LEITURA_RECUSADA/);assercoes++;
 await assert.rejects(()=>repo.registrarLeitura(ator,atendimento.id,[]),/OPERACAO_LEITURA_INVALIDA/);assercoes++;

 const resposta=await enviar('humano','pendente',3);await enviar('automacao','aceito',4);
 for(const estado of ['pendente','recusado','incerto']){
  await tx.query('UPDATE atendimento_operacao.mensagem SET estado=$2 WHERE id=$1',[resposta,estado]);
  const r=await repo.listar(ator,{busca:marcador});verificar(r.registros[0].id,atendimento.id);verificar((r.registros[0] as Record<string,unknown>).pendentesResposta,4);
  verificar((r.contagens as Record<string,unknown>).pendentesResposta,4);verificar((r.contagens as Record<string,unknown>).conversasPendentes,1);
  verificar((await repo.historico(ator,{conversaId:atendimento.id})).conversa.pendentesResposta,4);
 }
 await tx.query("UPDATE atendimento_operacao.mensagem SET estado='aceito' WHERE id=$1",[resposta]);
 verificar((await repo.historico(ator,{conversaId:atendimento.id})).conversa.pendentesResposta,1);
 await enviar('humano','entregue',6);verificar((await repo.historico(ator,{conversaId:atendimento.id})).conversa.pendentesResposta,0);
 await tx.query('UPDATE atendimento_operacao.conversa SET ultima_cliente_em=now() WHERE id=$1',[atendimento.id]);
 const pedido={conversaId:atendimento.id,versao:1,idempotencia:randomUUID(),tipo:'text' as const,texto:'Resposta fictícia 🙂'};
 const intencao=await repo.enfileirar(ator,pedido);
 verificar(await repo.enfileirar({...ator,nome:'Nome alterado depois'},pedido),intencao);
 const gravada=(await tx.query('SELECT conteudo FROM atendimento_operacao.intencao WHERE id=$1',[intencao.id])).rows[0].conteudo;
 verificar(gravada.assinaturaHumana,ator.nome);verificar(gravada.texto,pedido.texto);verificar(gravada.ficticia,true);
 verificar(Number((await tx.query('SELECT count(*) n FROM atendimento_operacao.intencao WHERE id=$1',[intencao.id])).rows[0].n),1);
 const encerrada=await repo.agir(ator,atendimento.id,{acao:'encerrar',versao:1,idempotencia:randomUUID()});
 verificar(encerrada.conversa.estado,'encerrada');
 verificar((await repo.listar(ator,{busca:marcador})).registros.some(v=>v.id===atendimento.id),false);
 verificar((await repo.listar(ator,{busca:marcador,estado:'encerrada'})).registros.some(v=>v.id===atendimento.id),true);
 recusar=true;await assert.rejects(()=>repo.listar(ator,{busca:marcador,canal:'whatsapp'}),/OPERACAO_ACESSO_NEGADO/);assercoes++;recusar=false;
 await assert.rejects(()=>repo.listar(ator,{busca:marcador,canal:'todos'}),/OPERACAO_CANAL_INVALIDO/);assercoes++;
 const contatos=await repo.listar(ator,{busca:marcador},true);verificar('contagens' in contatos,false);verificar(contatos.registros.every(v=>!('canal' in v)),true);
 await tx.query('ROLLBACK');
 verificar(Number((await tx.query('SELECT count(*) n FROM atendimento_operacao.contato WHERE nome LIKE $1',[marcador+'%'])).rows[0].n),0);
 console.log(JSON.stringify({ensaio:'canais-contagens-postgresql-ficticio',assercoes,seedsRevertidos:true,conversas:67,enviosExternos:0,alteracoesPersistidas:0}));
}finally{await tx.query('ROLLBACK').catch(()=>undefined);tx.release();await pool.end();}
