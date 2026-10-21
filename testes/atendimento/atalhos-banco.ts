import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {RepositorioOperacaoPg} from '../../src/lib/atendimento/operacao-repositorio-pg';
import {ServicoAtalhosOperacao,type AtalhoTextoOperacao} from '../../src/lib/atendimento/operacao-atalhos';
import type {AcaoOperacao,IdentidadeOperacao,ModoOperacao} from '../../src/lib/atendimento/operacao-tipos';

const url=new URL(process.env.OPERACAO_BANCO_TESTE??'');
if(url.protocol!=='postgresql:'||url.pathname!=='/donatella_ensaio_operacao'||!['127.0.0.1','localhost'].includes(url.hostname)||url.searchParams.has('host')&&url.searchParams.get('host')!=='/socket')throw Error('ENSAIO_ISOLADO_EXIGIDO');
const pool=new Pool({connectionString:url.href,max:7}),direitos=new Set<AcaoOperacao>(['consultar','atalhos.visualizar','atalhos.adicionar','atalhos.editar','atalhos.excluir','atividades.visualizar']);
const ana:IdentidadeOperacao={id:'fixture-atalhos-ana',nome:'Ana Fictícia',perfilId:'fixture',sessaoVersao:1,permissoes:[],tipo:'usuario'},bia={...ana,id:'fixture-atalhos-bia',nome:'Bia Fictícia'};
let assercoes=0,enviosExternos=0,modo:ModoOperacao='homologacao';
globalThis.fetch=async()=>{enviosExternos++;throw Error('ENVIO_EXTERNO_PROIBIDO');};
const repo=new RepositorioOperacaoPg(pool,async(i,a)=>[ana.id,bia.id].includes(i.id)&&direitos.has(a),()=>modo,'/tmp/atalhos-ficticios'),atalhos=new ServicoAtalhosOperacao(repo);
const igual=(a:unknown,b:unknown)=>{assert.deepEqual(a,b);assercoes++;},conferir=(v:unknown)=>{assert.ok(v);assercoes++;},recusar=async(f:()=>Promise<unknown>,codigo:string)=>{await assert.rejects(f,new RegExp(codigo));assercoes++;};
const novo=(nome:string,versao:number)=>({nome,texto:'Olá!\nComo posso ajudar?',versao,idempotencia:randomUUID()});
const contagens=async()=>(await pool.query("SELECT (SELECT count(*) FROM atendimento_operacao.comando)::int AS comandos,(SELECT count(*) FROM atendimento_operacao.auditoria WHERE acao LIKE 'atalho_%')::int AS auditorias")).rows[0];
const efeitos=async()=>(await pool.query("SELECT (SELECT count(*) FROM atendimento_operacao.intencao)::int AS intencoes,(SELECT count(*) FROM atendimento_operacao.mensagem)::int AS mensagens,(SELECT count(*) FROM atendimento_operacao.timer)::int AS timers,(SELECT md5(coalesce(jsonb_agg(to_jsonb(c) ORDER BY chave)::text,'')) FROM atendimento_operacao.configuracao c WHERE chave<>'atalhos_texto') AS outras_configuracoes")).rows[0];
const registroComando=async(id:string)=>(await pool.query('SELECT count(*)::int n FROM atendimento_operacao.comando WHERE id=$1',[id])).rows[0].n;
try{
 // Exige uma base sintética sem atalhos anteriores. Nunca limpa nem substitui fixtures de outra execução.
 igual(await atalhos.listar(ana),{versao:0,registros:[]});const efeitosAntes=await efeitos(),contagensAntes=await contagens();
 // Duas gravações na chave ainda ausente são serializadas pela trava da configuração.
 const p1=novo('Saudação inicial',0),p2=novo('Retirada',0),criacao=await Promise.allSettled([atalhos.salvar(ana,p1),atalhos.salvar(bia,p2)]);
 igual(criacao.filter(v=>v.status==='fulfilled').length,1);conferir(criacao.some(v=>v.status==='rejected'&&String(v.reason).includes('OPERACAO_CONFLITO')));
 const venceu=criacao[0].status==='fulfilled'?{pedido:p1,ator:ana,resultado:criacao[0].value}:{pedido:p2,ator:bia,resultado:(criacao[1] as PromiseFulfilledResult<Awaited<ReturnType<ServicoAtalhosOperacao['salvar']>>>).value};
 let lista=await atalhos.listar(ana);igual(lista.versao,1);igual(lista.registros.length,1);igual(lista.registros[0].id,venceu.resultado.atalho.id);igual((await contagens()).auditorias,contagensAntes.auditorias+1);
 const semRepeticao=await contagens();igual(await atalhos.salvar(venceu.ator,venceu.pedido),venceu.resultado);igual(await contagens(),semRepeticao);
 await recusar(()=>atalhos.salvar(venceu.ator,{...venceu.pedido,texto:'Outro texto'}),'IDEMPOTENCIA_DIVERGENTE');igual(await contagens(),semRepeticao);
 // Concorrência com a mesma idempotência devolve um UUID e uma auditoria.
 const p3=novo('Pagamento',lista.versao),simultaneas=await Promise.all([atalhos.salvar(ana,p3),atalhos.salvar(ana,p3)]);igual(simultaneas[0],simultaneas[1]);igual(simultaneas[0].versao,2);igual((await contagens()).auditorias,semRepeticao.auditorias+1);
 const antesReplay=await contagens();igual(await atalhos.salvar(venceu.ator,venceu.pedido),venceu.resultado);igual(await contagens(),antesReplay);igual((await atalhos.listar(ana)).versao,2);
 // Duas edições na mesma versão preservam somente uma alteração completa.
 const id=venceu.resultado.atalho.id,editarA={...novo('Confirmação',2),id},editarB={...novo('Recepção',2),id},edicoes=await Promise.allSettled([atalhos.salvar(ana,editarA),atalhos.salvar(bia,editarB)]);
 igual(edicoes.filter(v=>v.status==='fulfilled').length,1);conferir(edicoes.some(v=>v.status==='rejected'&&String(v.reason).includes('OPERACAO_CONFLITO')));lista=await atalhos.listar(ana);igual(lista.versao,3);igual(lista.registros.length,2);
 const entrada=lista.registros.find(v=>v.id===id)!;conferir(['confirmacao','recepcao'].includes(entrada.nome));
 const duplicado=novo(entrada.nome.toUpperCase(),3),antesRecusa=await contagens();await recusar(()=>atalhos.salvar(ana,duplicado),'ATALHO_NOME_CONFLITO');igual(await registroComando(duplicado.idempotencia),0);igual(await contagens(),antesRecusa);igual((await atalhos.listar(ana)).versao,3);
 direitos.delete('atalhos.adicionar');await recusar(()=>atalhos.salvar(ana,p3),'ACESSO_NEGADO');igual(await contagens(),antesRecusa);direitos.add('atalhos.adicionar');
 for(const tipo of ['ia','automacao'] as const){await recusar(()=>atalhos.listar({...ana,tipo}),'AUTOR_RECUSADO');await recusar(()=>atalhos.salvar({...ana,tipo},novo('Automação',3)),'AUTOR_RECUSADO');}
 modo='receber';await recusar(()=>atalhos.salvar(ana,novo('Bloqueado',3)),'SOMENTE_LEITURA');modo='homologacao';igual(await contagens(),antesRecusa);
 for(const extra of [{nome:'a'.repeat(51)},{texto:'a'.repeat(4097)},{texto:'a\u007fb'},{texto:'a\ud800b'}])await recusar(()=>atalhos.salvar(ana,{...novo('Inválido',3),...extra}),'INVALID');igual(await contagens(),antesRecusa);
 // Exclusão e replay preservam as demais entradas e nunca fazem outra exclusão.
 const excluir={id:simultaneas[0].atalho.id,versao:3,idempotencia:randomUUID()},removido=await atalhos.excluir(ana,excluir),antesReplayExclusao=await contagens();igual(removido.versao,4);igual(await atalhos.excluir(ana,excluir),removido);igual(await contagens(),antesReplayExclusao);lista=await atalhos.listar(ana);igual(lista.registros.length,1);igual(lista.registros[0].id,id);
 // Fixture adiciona registros fictícios até o teto. Preserva todos os atalhos anteriores.
 const preenchidos:AtalhoTextoOperacao[]=[...lista.registros];for(let n=preenchidos.length;n<200;n++)preenchidos.push({id:randomUUID(),nome:'ficticio-'+n,texto:'Resposta fictícia para conferir o limite.'});
 await pool.query("UPDATE atendimento_operacao.configuracao SET conteudo=$1::jsonb,versao=versao+1 WHERE chave='atalhos_texto' AND versao=$2",[JSON.stringify({registros:preenchidos}),lista.versao]);lista=await atalhos.listar(ana);igual(lista.registros.length,200);igual(lista.versao,5);
 const teto=novo('Limite',5),antesTeto=await contagens();await recusar(()=>atalhos.salvar(ana,teto),'ATALHOS_LIMITE_INVALIDO');igual(await registroComando(teto.idempotencia),0);igual(await contagens(),antesTeto);
 const maximo={...novo('a'.repeat(50),5),id,texto:'a'.repeat(4096)},maximoSalvo=await atalhos.salvar(ana,maximo);igual(maximoSalvo.atalho.texto.length,4096);igual(maximoSalvo.atalho.nome.length,50);igual((await atalhos.listar(ana)).registros.length,200);
 const auditorias=(await pool.query("SELECT acao,autor_nome,entidade_id FROM atendimento_operacao.auditoria WHERE acao LIKE 'atalho_%' ORDER BY criada_em,id")).rows;conferir(auditorias.every(v=>['atalho_criar','atalho_editar','atalho_excluir'].includes(v.acao)&&[ana.nome,bia.nome].includes(v.autor_nome)));
 const extrato=await repo.atividades(ana,{categoria:'organizacao'});conferir(extrato.registros.some(v=>v.titulo==='Atalho de texto criado'));conferir(extrato.registros.some(v=>v.titulo==='Atalho de texto alterado'));conferir(extrato.registros.some(v=>v.titulo==='Atalho de texto excluído'));
 igual(await efeitos(),efeitosAntes);igual(enviosExternos,0);
 console.log(JSON.stringify({ensaio:'atalhos-texto-humanos',assercoes,enviosExternos,concorrencia:'conferida',replay:'sem_duplicacao',limites:'conferidos',efeitosEmMensagens:'nenhum',relatorio:'somente_fixtures'}));
}finally{await pool.end();}
