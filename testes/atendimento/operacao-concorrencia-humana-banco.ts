import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool,type PoolClient} from 'pg';
import {RepositorioOperacaoPg,RepositorioEntradaPg} from '../../src/lib/atendimento/operacao-repositorio-pg';
import {WorkerOperacao} from '../../src/lib/atendimento/operacao-envio';
import type {IdentidadeOperacao} from '../../src/lib/atendimento/operacao-tipos';

const endereco=process.env.OPERACAO_BANCO_TESTE;
if(!endereco||process.env.DONATELLA_ENSAIO_OPERACAO!=='1'||!process.argv.includes('--ensaio'))throw Error('ENSAIO_CONCORRENCIA_EXIGIDO');
const url=new URL(endereco);
if(url.protocol!=='postgresql:'||url.pathname!=='/donatella_ensaio_operacao'||!['grazing-donatella-operacao-v2-banco','donatella-ensaio-operacao-v2','127.0.0.1','localhost'].includes(url.hostname)||url.search||url.hash)throw Error('ENSAIO_CONCORRENCIA_DESTINO_RECUSADO');
const pool=new Pool({connectionString:endereco,max:1,statement_timeout:10000});
const tx=await pool.connect();
let provas=0,savepoint=0,simulados=0;
const conferir=(p:unknown)=>{assert.ok(p,'ENSAIO_CONCORRENCIA_FALHOU');provas++;};
const recusar=async(f:()=>Promise<unknown>,codigo:string)=>{await assert.rejects(f,new RegExp(codigo));provas++;};
const humano:IdentidadeOperacao={id:'fixture-concorrencia-humana',nome:'Atendente fictício concorrente',perfilId:'fixture-concorrencia',sessaoVersao:1,permissoes:['consultar','atender','configurar']};
const ia:IdentidadeOperacao={id:'service:donatella-ia',nome:'Agente fictícia',perfilId:'servico-donatella',sessaoVersao:1,permissoes:['consultar','atender'],tipo:'ia'};
const contato=randomUUID(),conversa=randomUUID(),revisada=randomUUID(),revertida=randomUUID(),pausada=randomUUID();
const ids:string[]=[conversa,revisada,revertida,pausada];
// A transação externa torna os UUIDs invisíveis ao worker publicado e desfaz
// somente este ensaio. Cada método real mantém sua fronteira por SAVEPOINT.
const poolIsolado={connect:async()=>{
 const nome='ensaio_concorrencia_'+(++savepoint);
 return new Proxy(tx,{get(alvo,p){if(p==='release')return()=>undefined;if(p==='query')return async(sql:string,valores?:unknown[])=>{
  if(sql==='BEGIN')return alvo.query('SAVEPOINT '+nome);
  if(sql==='COMMIT')return alvo.query('RELEASE SAVEPOINT '+nome);
  if(sql==='ROLLBACK')return alvo.query('ROLLBACK TO SAVEPOINT '+nome);
  return alvo.query(sql,valores);
 };return Reflect.get(alvo,p);}}) as PoolClient;
},query:(sql:string,valores?:unknown[])=>tx.query(sql,valores)} as unknown as Pool;
const repo=new RepositorioOperacaoPg(poolIsolado,async(i,a)=>[humano.id,ia.id].includes(i.id)&&i.sessaoVersao===1&&i.permissoes.includes(a),()=> 'homologacao','/midia-ensaio');
const c=async(id:string)=>(await tx.query('SELECT estado,versao,responsavel_id FROM atendimento_operacao.conversa WHERE id=$1',[id])).rows[0];
const n=async(tabela:string,id:string)=>(await tx.query(`SELECT count(*)::integer n FROM atendimento_operacao.${tabela} WHERE conversa_id=$1`,[id])).rows[0].n as number;
const proxima=async(id:string)=>{
 await tx.query("UPDATE atendimento_operacao.intencao SET criada_em='1900-01-01T00:00:00Z',proxima_tentativa='1900-01-01T00:00:00Z' WHERE id=$1",[id]);
 const r=await tx.query("SELECT id FROM atendimento_operacao.intencao WHERE estado='pendente' AND conteudo->>'ficticia'='true' AND proxima_tentativa<=now() ORDER BY criada_em,id LIMIT 1");
 conferir(r.rows[0]?.id===id);
};
try{
 await tx.query('BEGIN');
 conferir((await tx.query('SELECT current_database() db')).rows[0].db==='donatella_ensaio_operacao');
 await tx.query("INSERT INTO atendimento_operacao.contato(id,nome,telefone) VALUES($1,'Concorrência fictícia','5511999990055')",[contato]);
 for(const id of ids)await tx.query('INSERT INTO atendimento_operacao.conversa(id,contato_id,estado,ficticia,ultima_cliente_em) VALUES($1,$2,$3,true,now())',[id,contato,id===pausada?'pausado':'ia']);
 const antiga={conversaId:conversa,versao:1,idempotencia:randomUUID(),tipo:'text' as const,texto:'Resposta IA fictícia antiga'};
 const a=await repo.enfileirar(ia,antiga,'ia');
 const timer=randomUUID();await tx.query("INSERT INTO atendimento_operacao.timer(id,conversa_id,tipo,executar_em,versao_conversa) VALUES($1,$2,'fixture',now()+interval '1 hour',1)",[timer,conversa]);
 const direto={...antiga,idempotencia:randomUUID(),texto:'Humano fictício sem assumir'};
 await recusar(()=>repo.enfileirar(humano,direto),'OPERACAO_ASSUMIR_OBRIGATORIO');
 conferir(await n('mensagem',conversa)===1&&await n('intencao',conversa)===1);
 conferir((await tx.query('SELECT 1 FROM atendimento_operacao.comando WHERE id=$1',[direto.idempotencia])).rowCount===0);
 conferir((await c(conversa)).estado==='ia'&&Number((await c(conversa)).versao)===1);
 await recusar(()=>repo.enfileirar(humano,{...direto,conversaId:pausada,idempotencia:randomUUID()}),'OPERACAO_ASSUMIR_OBRIGATORIO');
 conferir(await n('mensagem',pausada)===0&&await n('intencao',pausada)===0);
 await repo.agir(humano,conversa,{acao:'assumir',versao:1,idempotencia:randomUUID()});
 const assumida=await c(conversa);conferir(assumida.estado==='humano'&&Number(assumida.versao)===2&&assumida.responsavel_id===humano.id);
 conferir((await tx.query('SELECT estado FROM atendimento_operacao.intencao WHERE id=$1',[a.id])).rows[0].estado==='cancelado');
 conferir((await tx.query('SELECT estado FROM atendimento_operacao.mensagem WHERE id=$1',[a.mensagemId])).rows[0].estado==='cancelado');
 conferir((await tx.query('SELECT estado FROM atendimento_operacao.timer WHERE id=$1',[timer])).rows[0].estado==='cancelado');
 await recusar(()=>repo.enfileirar(ia,{...antiga,idempotencia:randomUUID()},'ia'),'OPERACAO_CONTEXTO_ALTERADO');
 await recusar(()=>repo.enfileirar(ia,{...antiga,versao:2,idempotencia:randomUUID()},'ia'),'OPERACAO_CONTEXTO_ALTERADO');
 await recusar(()=>repo.enfileirar(humano,{...direto,idempotencia:randomUUID()}),'OPERACAO_CONTEXTO_ALTERADO');
 const resposta={...direto,versao:2,idempotencia:randomUUID()};const enviada=await repo.enfileirar(humano,resposta);
 conferir((await repo.enfileirar(humano,resposta)).id===enviada.id&&await n('intencao',conversa)===2);
 const worker=new WorkerOperacao(repo,new RepositorioEntradaPg(poolIsolado),async id=>id===humano.id?humano:id===ia.id?ia:null,{token:'fixture',numeroId:'123456789',versao:'v23.0',autoridade:'nenhuma',enviosHabilitados:false},async t=>{assert.ok(ids.includes(t.conversa_id),'ENSAIO_INTENCAO_ALHEIA_RECUSADA');simulados++;return {estado:'aceito_simulado',wamid:'wamid.fixture-concorrencia-'+randomUUID()};},async()=>{throw Error('ENSAIO_ENVIO_EXTERNO_PROIBIDO');});
 await proxima(enviada.id);conferir((await worker.enviarProximo()).estado==='aceito_simulado'&&simulados===1);
 await repo.agir(humano,conversa,{acao:'encerrar',versao:2,idempotencia:randomUUID()});
 conferir((await repo.enfileirar(humano,resposta)).id===enviada.id&&await n('intencao',conversa)===2);
 // Resposta revisada: tomada e intenção compartilham a transação do caso.
 const anteriorRevisada=await repo.enfileirar(ia,{...antiga,conversaId:revisada,idempotencia:randomUUID()},'ia');
 const r=await repo.transacao(async t=>{const versao=await repo.assumirRespostaRevisadaTx(t,humano,revisada,1);return repo.enfileirarTx(t,humano,{...resposta,conversaId:revisada,versao,idempotencia:randomUUID()});});
 conferir((await c(revisada)).estado==='humano'&&Number((await c(revisada)).versao)===2);
 conferir((await tx.query('SELECT estado FROM atendimento_operacao.intencao WHERE id=$1',[anteriorRevisada.id])).rows[0].estado==='cancelado');
 conferir((await tx.query('SELECT autor_id,versao_conversa FROM atendimento_operacao.intencao WHERE id=$1',[r.id])).rows[0].autor_id===humano.id);
 await recusar(()=>repo.transacao(t=>repo.assumirRespostaRevisadaTx(t,ia,revertida,1)),'OPERACAO_AUTOR_RECUSADO');
 await recusar(()=>repo.transacao(async t=>{await repo.assumirRespostaRevisadaTx(t,humano,revertida,1);throw Error('ENSAIO_REVERTER_TOMADA');}),'ENSAIO_REVERTER_TOMADA');
 conferir((await c(revertida)).estado==='ia'&&Number((await c(revertida)).versao)===1&&await n('intencao',revertida)===0);
 // Intenção legada humana incompatível também é recusada pelo worker.
 await tx.query("UPDATE atendimento_operacao.conversa SET estado='pausado' WHERE id=$1",[revisada]);
 await proxima(r.id);conferir((await worker.enviarProximo()).estado==='vazio'&&simulados===1);
 conferir((await tx.query('SELECT estado FROM atendimento_operacao.intencao WHERE id=$1',[r.id])).rows[0].estado==='cancelado');
 await tx.query('ROLLBACK');
 conferir((await tx.query('SELECT 1 FROM atendimento_operacao.conversa WHERE id=ANY($1::uuid[])',[ids])).rowCount===0);
 console.log(JSON.stringify({ensaio:'concorrencia-humana-ia-postgresql',provas,simulados,enviosExternos:0,fixtureIsoladaPorTransacao:true,replayIdempotente:true}));
}catch(e){await tx.query('ROLLBACK').catch(()=>undefined);console.error(e instanceof Error&&/^ENSAIO_[A-Z0-9_]+$/.test(e.message)?e.message:'ENSAIO_CONCORRENCIA_FALHOU');process.exitCode=1;}finally{tx.release();await pool.end();}
