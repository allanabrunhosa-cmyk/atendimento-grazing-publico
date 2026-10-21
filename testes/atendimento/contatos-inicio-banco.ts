import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {RepositorioOperacaoPg,materializarEventoOperacao} from '../../src/lib/atendimento/operacao-repositorio-pg';
import type {AcaoOperacao,IdentidadeOperacao} from '../../src/lib/atendimento/operacao-tipos';
const url=process.env.OPERACAO_BANCO_TESTE;
if(!url)throw Error('ENSAIO_BANCO_EXIGIDO');
const destino=new URL(url);
if(destino.protocol!=='postgresql:'||destino.pathname!=='/donatella_ensaio_operacao'||!['localhost','127.0.0.1'].includes(destino.hostname)||destino.searchParams.has('host')&&destino.searchParams.get('host')!=='/socket')throw Error('ENSAIO_DESTINO_RECUSADO');
const pool=new Pool({connectionString:url,max:6}),numeroId='123456789';
const permissoes=new Set<AcaoOperacao>(['consultar','atender','configurar','contatos.visualizar','contatos.adicionar','contatos.editar','conversas.visualizar','conversas.adicionar','atividades.visualizar','mensagens.visualizar','mensagens.adicionar','notas.visualizar','etiquetas.visualizar','modelos.visualizar']);
const i:IdentidadeOperacao={id:'fixture-atendente-contatos',nome:'Atendente fictício',perfilId:'fixture',sessaoVersao:1,permissoes:[]};
let revogado=false,assercoes=0,sequencia=0,fetchs=0,modo:'operacao'|'receber'|'homologacao'='operacao';
const conferir=(v:unknown)=>{assert.ok(v);assercoes++;};
const recusar=async(f:()=>Promise<unknown>,e:string)=>{await assert.rejects(f,new RegExp(e));assercoes++;};
globalThis.fetch=async()=>{fetchs++;throw Error('ENSAIO_ENVIO_EXTERNO_PROIBIDO');};
const repo=new RepositorioOperacaoPg(pool,async(ator,acao)=>!revogado&&ator.id===i.id&&ator.sessaoVersao===i.sessaoVersao&&permissoes.has(acao),()=>modo,'/tmp',undefined,undefined,'humano',{numeroId,ficticio:true});
const telefone=()=>'+551190000'+String(++sequencia).padStart(4,'0');
const criar=(tel=telefone())=>({nome:'Contato fictício '+sequencia,telefone:tel,email:'ficticio@example.com',descricao:'Empresa fictícia',idempotencia:randomUUID()});
const iniciar=(contato:{id:unknown;versao:number})=>({contatoId:String(contato.id),versaoContato:contato.versao,idempotencia:randomUUID()});
const linha=async(id:unknown)=>(await pool.query('SELECT * FROM atendimento_operacao.contato WHERE id=$1',[id])).rows[0];
const conversa=async(id:unknown)=>(await pool.query('SELECT * FROM atendimento_operacao.conversa WHERE id=$1',[id])).rows[0];
async function receber(tel:string,em=Date.now(),id='wamid.fixture-entrada-'+randomUUID()){
 return materializarEventoOperacao(repo,{chave:randomUUID(),tipo:'mensagem',waba:'fixture',numero:numeroId,conteudo:{contacts:[{wa_id:tel,profile:{name:'Cliente fictício do webhook'}}],item:{id,from:tel,timestamp:String(Math.floor(em/1000)),type:'text',text:{body:'Entrada fictícia sem cliente real'}}}});
}
try{
 const pedido=criar(),c=await repo.criarContato(i,pedido);conferir(!c.reutilizado&&c.contato.telefone===pedido.telefone.slice(1)&&c.contato.classificacao==='lead'&&c.contato.nome===pedido.nome&&c.contato.canal==='whatsapp');
 conferir(c.contato.conversaId===null&&(await pool.query('SELECT count(*)::integer n FROM atendimento_operacao.conversa WHERE contato_id=$1',[c.contato.id])).rows[0].n===0);
 conferir((await pool.query('SELECT count(*)::integer n FROM atendimento_operacao.intencao')).rows[0].n===0);
 conferir((await repo.criarContato(i,pedido)).contato.id===c.contato.id);await recusar(()=>repo.criarContato(i,{...pedido,nome:'Outro nome'}),'IDEMPOTENCIA_DIVERGENTE');
 const duplicado=await repo.criarContato(i,{...pedido,idempotencia:randomUUID(),nome:'Não substituir o nome'});conferir(duplicado.reutilizado&&duplicado.contato.id===c.contato.id&&duplicado.contato.nome===pedido.nome);
 const corpoInicio=iniciar(c.contato),aberta=await repo.iniciarConversaContato(i,corpoInicio);conferir(!aberta.reutilizada&&aberta.requerTemplate&&aberta.conversa.estado==='humano'&&aberta.conversa.responsavelId===i.id&&aberta.conversa.ultimaClienteEm===null&&!aberta.conversa.janelaRespostaAberta);
 conferir((await conversa(aberta.conversa.id)).ultima_cliente_em===null&&aberta.contato.conversaId===aberta.conversa.id);conferir((await repo.iniciarConversaContato(i,corpoInicio)).conversa.id===aberta.conversa.id);
 await recusar(()=>repo.iniciarConversaContato(i,{...iniciar(c.contato),versaoContato:0}),'CONTEXTO_ALTERADO');
 await recusar(()=>repo.enfileirar(i,{conversaId:String(aberta.conversa.id),versao:aberta.conversa.versao,idempotencia:randomUUID(),tipo:'text',texto:'Não sair sem janela real'}),'JANELA_FECHADA');
 const modeloId='fixture_primeiro_'+randomUUID();await pool.query("INSERT INTO atendimento_operacao.modelo(id,nome,idioma,estado,componentes) VALUES($1,'primeiro_fixture','pt_BR','APPROVED',$2)",[modeloId,JSON.stringify([{type:'BODY',text:'Primeiro template fictício'}])]);
 const template=await repo.enfileirar(i,{conversaId:String(aberta.conversa.id),versao:aberta.conversa.versao,idempotencia:randomUUID(),tipo:'template',modeloId,variaveis:[]});conferir(template.mensagemId&&(await conversa(aberta.conversa.id)).ultima_cliente_em===null);
 await pool.query("UPDATE atendimento_operacao.mensagem SET estado='aceito' WHERE id=$1",[template.mensagemId]);await recusar(()=>repo.enfileirar(i,{conversaId:String(aberta.conversa.id),versao:aberta.conversa.versao,idempotencia:randomUUID(),tipo:'text',texto:'Template não abre janela'}),'JANELA_FECHADA');
 await receber(String(c.contato.telefone));const janela=await repo.iniciarConversaContato(i,iniciar(c.contato));conferir(janela.reutilizada&&!janela.requerTemplate&&janela.conversa.janelaRespostaAberta&&janela.conversa.id===aberta.conversa.id);
 const texto=await repo.enfileirar(i,{conversaId:String(janela.conversa.id),versao:janela.conversa.versao,idempotencia:randomUUID(),tipo:'text',texto:'Texto fictício permitido após entrada'});conferir(!!texto.mensagemId);
 // Abrir uma conversa existente não toma o responsável nem altera o estado.
 for(const estado of ['humano','ia','pausado']){await pool.query('UPDATE atendimento_operacao.conversa SET estado=$2,responsavel_id=$3 WHERE id=$1',[aberta.conversa.id,estado,'outro-atendente-ficticio']);const atual=await repo.iniciarConversaContato(i,iniciar(c.contato));conferir(atual.reutilizada&&atual.conversa.estado===estado&&atual.conversa.responsavelId==='outro-atendente-ficticio');}
 // Cadastro e replay respeitam a revogação e as permissões granulares atuais.
 revogado=true;await recusar(()=>repo.criarContato(i,pedido),'ACESSO_NEGADO');await recusar(()=>repo.iniciarConversaContato(i,corpoInicio),'ACESSO_NEGADO');revogado=false;
 for(const falta of ['consultar','contatos.visualizar','conversas.visualizar','conversas.adicionar','mensagens.visualizar','mensagens.adicionar'] as const){permissoes.delete(falta);await recusar(()=>repo.iniciarConversaContato(i,iniciar(c.contato)),'ACESSO_NEGADO');permissoes.add(falta);}
 permissoes.delete('contatos.adicionar');await recusar(()=>repo.criarContato(i,criar()),'ACESSO_NEGADO');permissoes.add('contatos.adicionar');
 await pool.query("UPDATE atendimento_operacao.contato SET notas='Nota privada fictícia',tags=ARRAY['Etiqueta privada'],hub_cliente_id='cliente-central-ficticio',classificacao='cliente' WHERE id=$1",[c.contato.id]);
 permissoes.delete('notas.visualizar');permissoes.delete('etiquetas.visualizar');const filtrado=await repo.criarContato(i,pedido);conferir(filtrado.contato.notas===''&&filtrado.contato.tags.length===0&&filtrado.contato.classificacao==='cliente');const filtradoInicio=await repo.iniciarConversaContato(i,corpoInicio);conferir(filtradoInicio.contato.notas===''&&filtradoInicio.contato.tags.length===0&&Array.isArray(filtradoInicio.conversa.tags)&&filtradoInicio.conversa.tags.length===0);permissoes.add('notas.visualizar');permissoes.add('etiquetas.visualizar');
 await recusar(()=>repo.criarContato({...i,tipo:'ia'},criar()),'AUTOR_RECUSADO');await recusar(()=>repo.iniciarConversaContato({...i,tipo:'automacao'},iniciar(c.contato)),'AUTOR_RECUSADO');
 // UUIDs diferentes para o mesmo destino convergem para um contato/conversa.
 const telConcorrente=telefone(),cadastros=await Promise.all([repo.criarContato(i,criar(telConcorrente)),repo.criarContato(i,criar(telConcorrente))]);conferir(cadastros[0].contato.id===cadastros[1].contato.id&&cadastros.filter(v=>!v.reutilizado).length===1);
 const inicios=await Promise.all([repo.iniciarConversaContato(i,iniciar(cadastros[0].contato)),repo.iniciarConversaContato(i,iniciar(cadastros[0].contato))]);conferir(inicios[0].conversa.id===inicios[1].conversa.id&&inicios.filter(v=>!v.reutilizada).length===1);
 // Webhook e operação manual usam a mesma trava exata da identidade.
 const telWebhook=telefone(),raceCadastro=await Promise.all([repo.criarContato(i,criar(telWebhook)),receber(telWebhook.slice(1))]);conferir((await pool.query('SELECT count(*)::integer n FROM atendimento_operacao.contato WHERE identidade_canal=$1',['whatsapp:'+numeroId+':'+telWebhook.slice(1)])).rows[0].n===1);conferir(raceCadastro[0].contato.id);
 const contatoWebhook=await repo.criarContato(i,criar()),raceInicio=await Promise.all([repo.iniciarConversaContato(i,iniciar(contatoWebhook.contato)),receber(String(contatoWebhook.contato.telefone))]);conferir((await pool.query("SELECT count(*)::integer n FROM atendimento_operacao.conversa WHERE contato_id=$1 AND estado<>'encerrada'",[contatoWebhook.contato.id])).rows[0].n===1);conferir(raceInicio[0].conversa.id);
 // Reabrir antiga e iniciar nova concorrentemente não gera duas abertas.
 const reabertura=await repo.criarContato(i,criar()),antiga=await repo.iniciarConversaContato(i,iniciar(reabertura.contato));await pool.query("UPDATE atendimento_operacao.conversa SET estado='encerrada' WHERE id=$1",[antiga.conversa.id]);
 const raceReabrir=await Promise.allSettled([repo.iniciarConversaContato(i,iniciar(reabertura.contato)),repo.agir(i,String(antiga.conversa.id),{acao:'reabrir',versao:1,idempotencia:randomUUID()})]);conferir(raceReabrir.some(v=>v.status==='fulfilled'));conferir((await pool.query("SELECT count(*)::integer n FROM atendimento_operacao.conversa WHERE contato_id=$1 AND estado<>'encerrada'",[reabertura.contato.id])).rows[0].n===1);
 // Reabrir preserva o mesmo ID e a janela da última entrada real.
 for(const horas of [1,26]){const fechado=await repo.criarContato(i,criar()),antes=await repo.iniciarConversaContato(i,iniciar(fechado.contato));await receber(String(fechado.contato.telefone),Date.now()-horas*3600000);await pool.query("UPDATE atendimento_operacao.conversa SET estado='encerrada' WHERE id=$1",[antes.conversa.id]);const nova=await repo.iniciarConversaContato(i,iniciar(fechado.contato));conferir(nova.reutilizada&&nova.conversa.id===antes.conversa.id&&nova.requerTemplate===(horas>24));conferir((await conversa(nova.conversa.id)).estado==='humano'&&(await conversa(nova.conversa.id)).ultima_cliente_em instanceof Date);}
 // A identidade Meta é prioritária e não recebe correção automática do nono dígito.
 const idLegado=randomUUID(),waLegado='551198765432';await pool.query("INSERT INTO atendimento_operacao.contato(id,nome,telefone,identidade_canal,importado) VALUES($1,'Legado fictício','Telefone de exibição legado',$2,true)",[idLegado,'whatsapp:'+numeroId+':'+waLegado]);const legado=await repo.iniciarConversaContato(i,{contatoId:idLegado,versaoContato:1,idempotencia:randomUUID()});conferir(legado.conversa.contatoId===idLegado&&(await linha(idLegado)).telefone==='Telefone de exibição legado'&&(await linha(idLegado)).identidade_canal.endsWith(waLegado));await recusar(()=>repo.criarContato(i,criar('+5511998765432')),'CONTATO_LEGADO_CONFLITO');
 // Telefone idêntico sem identidade não autoriza redirecionar para outro contato.
 const semCanal=randomUUID();await pool.query("INSERT INTO atendimento_operacao.contato(id,nome,telefone) VALUES($1,'Sem canal fictício',$2)",[semCanal,c.contato.telefone]);await recusar(()=>repo.iniciarConversaContato(i,{contatoId:semCanal,versaoContato:1,idempotencia:randomUUID()}),'IDENTIDADE_CONFLITO');conferir((await linha(semCanal)).identidade_canal===null);
 const naoWhatsApp=randomUUID();await pool.query("INSERT INTO atendimento_operacao.contato(id,nome,telefone,identidade_canal) VALUES($1,'Instagram fictício','11900000001','instagram:111111:222222')",[naoWhatsApp]);await recusar(()=>repo.iniciarConversaContato(i,{contatoId:naoWhatsApp,versaoContato:1,idempotencia:randomUUID()}),'CANAL_RECUSADO');
 const outroRemetente=randomUUID();await pool.query("INSERT INTO atendimento_operacao.contato(id,nome,telefone,identidade_canal) VALUES($1,'Outro canal fictício','11900000001','whatsapp:999999:5511900000001')",[outroRemetente]);await recusar(()=>repo.iniciarConversaContato(i,{contatoId:outroRemetente,versaoContato:1,idempotencia:randomUUID()}),'CANAL_RECUSADO');
 // Vincular um contato sem canal não altera seu telefone salvo nem mescla pessoas.
 const novoSemCanal=randomUUID(),telefoneSalvo=telefone();await pool.query("INSERT INTO atendimento_operacao.contato(id,nome,telefone) VALUES($1,'Contato salvo fictício',$2)",[novoSemCanal,telefoneSalvo]);const vinculado=await repo.iniciarConversaContato(i,{contatoId:novoSemCanal,versaoContato:1,idempotencia:randomUUID()});conferir(vinculado.contato.id===novoSemCanal&&vinculado.contato.versao===2&&(await linha(novoSemCanal)).telefone===telefoneSalvo&&(await linha(novoSemCanal)).identidade_canal==='whatsapp:'+numeroId+':'+telefoneSalvo.slice(1));
 modo='receber';await recusar(()=>repo.criarContato(i,criar()),'SOMENTE_LEITURA');await recusar(()=>repo.iniciarConversaContato(i,iniciar(c.contato)),'SOMENTE_LEITURA');modo='operacao';
 const historico=await repo.atividades(i,{});conferir(historico.registros.some(v=>v.titulo==='Contato criado')&&historico.registros.some(v=>v.titulo==='Conversa iniciada')&&historico.registros.some(v=>v.titulo==='Contato vinculado ao WhatsApp'));
 conferir(fetchs===0);console.log(JSON.stringify({ensaio:'contatos-inicio',aprovado:true,assercoes,fetchs,enviosExternos:0}));
}finally{await pool.end();}
