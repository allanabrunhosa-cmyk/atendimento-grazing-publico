import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {RepositorioOperacaoPg} from '../../src/lib/atendimento/operacao-repositorio-pg';
import {ServicoAtalhosOperacao} from '../../src/lib/atendimento/operacao-atalhos';
import {ServicoTemplatesOperacao} from '../../src/lib/atendimento/operacao-templates';
import type {AcaoOperacao,IdentidadeOperacao} from '../../src/lib/atendimento/operacao-tipos';

const url=new URL(process.env.OPERACAO_BANCO_TESTE??'');
if(url.protocol!=='postgresql:'||url.pathname!=='/donatella_ensaio_operacao'||!['127.0.0.1','localhost'].includes(url.hostname)||url.searchParams.has('host')&&url.searchParams.get('host')!=='/socket')throw Error('ENSAIO_ISOLADO_EXIGIDO');
const pool=new Pool({connectionString:url.href,max:4}),tag=randomUUID().replaceAll('-',''),nome='Hierarquia fictícia '+tag,numeroId='123456789';
const ana:IdentidadeOperacao={id:'fixture-hierarquia-'+tag,nome:'Ana Fictícia',perfilId:'fixture',sessaoVersao:1,permissoes:[],tipo:'usuario'},bia={...ana,id:'fixture-hierarquia-outra-'+tag,nome:'Bia Fictícia'};
let direitos=new Set<AcaoOperacao>(),assercoes=0,enviosExternos=0,chamadasMetaSimuladas=0,revogarAntesMeta=false;
const definir=(...acoes:AcaoOperacao[])=>{direitos=new Set(['consultar',...acoes]);};
const autorizado=async(_i:IdentidadeOperacao,a:AcaoOperacao)=>direitos.has(a);
const repo=new RepositorioOperacaoPg(pool,autorizado,()=> 'operacao','/tmp/hierarquia-ficticia',undefined,undefined,'humano',{numeroId,ficticio:true});
const igual=(a:unknown,b:unknown)=>{assert.deepEqual(a,b);assercoes++;},conferir=(v:unknown)=>{assert.ok(v);assercoes++;};
const recusar=async(f:()=>Promise<unknown>,codigo='ACESSO_NEGADO')=>{await assert.rejects(f,new RegExp(codigo));assercoes++;};
globalThis.fetch=async()=>{enviosExternos++;throw Error('ENVIO_EXTERNO_PROIBIDO');};
const efeitos=async()=>(await pool.query("SELECT (SELECT count(*) FROM atendimento_operacao.mensagem)::int mensagens,(SELECT count(*) FROM atendimento_operacao.intencao)::int intencoes,(SELECT count(*) FROM atendimento_operacao.timer)::int timers,(SELECT md5(coalesce(jsonb_agg(to_jsonb(c) ORDER BY chave)::text,'')) FROM atendimento_operacao.configuracao c WHERE chave<>'atalhos_texto') configuracoes")).rows[0];
const comandos=async()=>(await pool.query('SELECT count(*)::int n FROM atendimento_operacao.comando WHERE autor_id=$1',[ana.id])).rows[0].n;
const futuro=async()=>new Date(new Date((await pool.query('SELECT clock_timestamp() agora')).rows[0].agora).getTime()+3600000).toISOString();
const lembreteDaLista=(v:Awaited<ReturnType<RepositorioOperacaoPg['listar']>>,id:string)=>{const r=v.registros.find(r=>r.id===id);return r&&'lembrete' in r?r.lembrete:null;};
let sequencia=0;
const telefone=async()=>{const atual=(await pool.query("SELECT coalesce(max(right(telefone,8)::int),0)::int n FROM atendimento_operacao.contato WHERE telefone ~ '^55119[0-9]{8}$'")).rows[0].n;return '+55119'+String(atual+100+ ++sequencia).padStart(8,'0');};
try{
 const efeitosAntes=await efeitos();
 // Contatos: as ações próprias funcionam sem gerir conversas ou configurações.
 definir('contatos.visualizar','contatos.adicionar');const cadastro={nome,telefone:await telefone(),idempotencia:randomUUID()},criado=await repo.criarContato(ana,cadastro);conferir(!!criado.contato.id);igual((await repo.criarContato(ana,cadastro)).contato.id,criado.contato.id);
 definir('atender','configurar','contatos.visualizar');const antesRecusa=await comandos();await recusar(()=>repo.criarContato(ana,cadastro));igual(await comandos(),antesRecusa);
 const editar={id:criado.contato.id,nome,email:'ficticio@example.invalid',descricao:'Empresa fictícia',classificacao:'lead',tags:[],notas:'',versao:1,idempotencia:randomUUID()};
 await recusar(()=>repo.editarContato(ana,editar));definir('contatos.visualizar','contatos.editar');const editado=await repo.editarContato(ana,editar);igual(editado.contato.versao,2);igual((await repo.editarContato(ana,editar)).contato.versao,2);
 definir('contatos.visualizar','contatos.adicionar');await recusar(()=>repo.editarContato(ana,editar));
 // Início por contato tem sua própria ação. Não concede alterar estados existentes.
 const inicio={contatoId:String(criado.contato.id),versaoContato:2,idempotencia:randomUUID()},permissoesInicio:AcaoOperacao[]=['contatos.visualizar','conversas.visualizar','conversas.adicionar','mensagens.visualizar','mensagens.adicionar'];
 definir(...permissoesInicio);const conversa=await repo.iniciarConversaContato(ana,inicio);igual(conversa.conversa.estado,'humano');igual((await repo.iniciarConversaContato(ana,inicio)).conversa.id,conversa.conversa.id);
 for(const falta of permissoesInicio){definir(...permissoesInicio.filter(p=>p!==falta),'atender','configurar');await recusar(()=>repo.iniciarConversaContato(ana,inicio));}
 definir(...permissoesInicio);await recusar(()=>repo.agir(ana,String(conversa.conversa.id),{acao:'encerrar',versao:conversa.conversa.versao,idempotencia:randomUUID()}));
 // Adicionar conversa não permite reabrir atendimento encerrado. O replay conserva essa exigência.
 definir(...permissoesInicio,'atender');await repo.agir(ana,String(conversa.conversa.id),{acao:'encerrar',versao:conversa.conversa.versao,idempotencia:randomUUID()});
 const reabrir={...inicio,idempotencia:randomUUID()},antesReabrir=await comandos();definir(...permissoesInicio);await recusar(()=>repo.iniciarConversaContato(ana,reabrir));igual(await comandos(),antesReabrir);igual((await pool.query('SELECT estado FROM atendimento_operacao.conversa WHERE id=$1',[conversa.conversa.id])).rows[0].estado,'encerrada');
 definir(...permissoesInicio,'atender');const reaberta=await repo.iniciarConversaContato(ana,reabrir);igual(reaberta.conversa.estado,'humano');igual(reaberta.conversa.id,conversa.conversa.id);const aposReabrir=await comandos();definir(...permissoesInicio);await recusar(()=>repo.iniciarConversaContato(ana,reabrir));igual(await comandos(),aposReabrir);igual((await pool.query("SELECT count(*)::int n FROM atendimento_operacao.auditoria WHERE entidade_id=$1 AND acao='reabrir'",[conversa.conversa.id])).rows[0].n,1);
 // Um novo pedido para a conversa já aberta continua permitido sem Editar conversas.
 igual((await repo.iniciarConversaContato(ana,{...inicio,idempotencia:randomUUID()})).conversa.id,conversa.conversa.id);
 // Lembretes: cada mutação tem a própria capacidade, inclusive replay e cancelamento lógico.
 const conversaId=String(conversa.conversa.id),agendamento={acao:'agendar',versao:0,idempotencia:randomUUID(),agendadoPara:await futuro(),descricao:'Confirmar orçamento fictício'};
 definir('lembretes.visualizar','lembretes.adicionar');let lembrete=(await repo.alterarLembreteConversa(ana,conversaId,agendamento)).lembrete!;conferir(!!lembrete);igual(lembrete.descricao,agendamento.descricao);
 definir('lembretes.visualizar','atender','configurar');await recusar(()=>repo.alterarLembreteConversa(ana,conversaId,agendamento));
 definir('lembretes.visualizar','lembretes.editar');const atualizacao={acao:'atualizar',versao:lembrete.versao,lembreteId:lembrete.id,idempotencia:randomUUID(),descricao:'Retomar proposta fictícia'};lembrete=(await repo.alterarLembreteConversa(ana,conversaId,atualizacao)).lembrete!;igual(lembrete.descricao,atualizacao.descricao);igual(lembrete.agendadoPara,agendamento.agendadoPara);
 definir('lembretes.visualizar','lembretes.adicionar','atender','configurar');await recusar(()=>repo.alterarLembreteConversa(ana,conversaId,atualizacao));
 // Negar leitura retira descrição, horário, vencimento e influência na ordenação.
 definir('contatos.visualizar');const oculto=await repo.listar(ana,{busca:nome});igual(lembreteDaLista(oculto,conversaId),null);igual(oculto.proximoLembreteEm,null);igual((await repo.historico(ana,{conversaId})).conversa.lembrete,null);
 definir('lembretes.visualizar');const visivel=await repo.listar(ana,{busca:nome});igual(lembreteDaLista(visivel,conversaId)?.descricao,atualizacao.descricao);igual(visivel.proximoLembreteEm,agendamento.agendadoPara);
 const cancelamento={acao:'cancelar',versao:lembrete.versao,lembreteId:lembrete.id,idempotencia:randomUUID()};definir('lembretes.visualizar','lembretes.editar','atender','configurar');await recusar(()=>repo.alterarLembreteConversa(ana,conversaId,cancelamento));
 definir('lembretes.visualizar','lembretes.excluir');igual((await repo.alterarLembreteConversa(ana,conversaId,cancelamento)).lembrete,null);igual((await pool.query('SELECT estado,descricao FROM atendimento_operacao.lembrete_conversa WHERE id=$1',[lembrete.id])).rows[0],{estado:'cancelado',descricao:atualizacao.descricao});igual((await repo.alterarLembreteConversa(ana,conversaId,cancelamento)).lembrete,null);
 // Atalhos: preserva entradas anteriores e altera somente a fixture desta execução.
 const atalhos=new ServicoAtalhosOperacao(repo);definir('atalhos.visualizar','atalhos.adicionar');const listaAntes=await atalhos.listar(ana),pedidoAtalho={nome:'ficticio_'+tag,texto:'Olá, texto fictício.',versao:listaAntes.versao,idempotencia:randomUUID()},atalho=await atalhos.salvar(ana,pedidoAtalho);igual((await atalhos.salvar(ana,pedidoAtalho)).atalho.id,atalho.atalho.id);
 definir('atalhos.visualizar','atender','configurar');await recusar(()=>atalhos.salvar(ana,pedidoAtalho));definir('atalhos.visualizar','atalhos.editar');const pedidoEdicao={...pedidoAtalho,id:atalho.atalho.id,versao:atalho.versao,texto:'Texto fictício revisado.',idempotencia:randomUUID()},atalhoEditado=await atalhos.salvar(ana,pedidoEdicao);igual(atalhoEditado.atalho.texto,pedidoEdicao.texto);
 definir('atalhos.visualizar','atalhos.adicionar','atender','configurar');await recusar(()=>atalhos.salvar(ana,pedidoEdicao));const pedidoExclusao={id:atalho.atalho.id,versao:atalhoEditado.versao,idempotencia:randomUUID()};await recusar(()=>atalhos.excluir(ana,pedidoExclusao));definir('atalhos.visualizar','atalhos.excluir');await atalhos.excluir(ana,pedidoExclusao);igual((await atalhos.listar(ana)).registros,listaAntes.registros);
 definir('atalhos.adicionar','atalhos.editar','atalhos.excluir','atender','configurar');await recusar(()=>atalhos.listar(ana));
 // Templates: os dados externos são respostas locais falsas; nenhuma chamada de rede ocorre.
 const modeloId=String(8000000000000+Math.floor(Math.random()*1000000000000)),componentes=[{type:'BODY',text:'Mensagem fictícia'}],nomeTemplate='ficticio_'+tag;
 const buscar:typeof fetch=async(_url,opcoes)=>{chamadasMetaSimuladas++;if(revogarAntesMeta)throw Error('META_SIMULADA_NAO_DEVERIA_SER_CHAMADA');return Response.json(opcoes?.method==='POST'?{id:modeloId,success:true,status:'PENDING'}:opcoes?.method==='DELETE'?{success:true}:{data:[]});};
 const templates=new ServicoTemplatesOperacao(repo,{token:'fixture-sem-validade',wabaId:'123456789',versao:'v23.0',ensaio:false},buscar),pedidoTemplate={nome:nomeTemplate,idioma:'pt_BR',categoria:'UTILITY',componentes,versao:0,idempotencia:randomUUID()};
 definir('modelos.visualizar','modelos.adicionar');const modelo=await templates.alterar(ana,pedidoTemplate);igual(modelo.id,modeloId);igual(chamadasMetaSimuladas,1);await templates.alterar(ana,pedidoTemplate);igual(chamadasMetaSimuladas,1);
 definir('modelos.visualizar','configurar','atender');await recusar(()=>templates.alterar(ana,pedidoTemplate));igual(chamadasMetaSimuladas,1);
 await pool.query("UPDATE atendimento_operacao.modelo SET estado='APPROVED' WHERE id=$1",[modeloId]);definir('modelos.visualizar','modelos.editar');const editarTemplate={...pedidoTemplate,id:modeloId,versao:1,idempotencia:randomUUID()};await templates.alterar(ana,editarTemplate);igual(chamadasMetaSimuladas,2);
 definir('modelos.visualizar','modelos.adicionar','configurar');await recusar(()=>templates.alterar(ana,editarTemplate));igual(chamadasMetaSimuladas,2);
 const excluirTemplate={id:modeloId,versao:2,escopo:'biblioteca',idempotencia:randomUUID()};await recusar(()=>templates.alterar(ana,excluirTemplate,true));definir('modelos.visualizar','modelos.excluir');await templates.alterar(ana,excluirTemplate,true);igual(chamadasMetaSimuladas,2);igual((await pool.query('SELECT estado FROM atendimento_operacao.modelo WHERE id=$1',[modeloId])).rows[0].estado,'DELETED');
 definir('modelos.visualizar','modelos.sincronizacao.visualizar','modelos.sincronizar');igual((await templates.sincronizar(ana)).sincronizados,0);igual(chamadasMetaSimuladas,3);
 for(const falta of ['modelos.visualizar','modelos.sincronizacao.visualizar','modelos.sincronizar'] as const){definir(...(['modelos.visualizar','modelos.sincronizacao.visualizar','modelos.sincronizar'] as const).filter(a=>a!==falta),'configurar');await recusar(()=>templates.sincronizar(ana));igual(chamadasMetaSimuladas,3);}
 // Revogação após reservar, mas antes de Meta, não envia nem repete a operação.
 definir('modelos.visualizar','modelos.adicionar');const auditarOriginal=repo.auditar.bind(repo);repo.auditar=async(tx,i,id,acao,versao)=>{await auditarOriginal(tx,i,id,acao,versao);if(acao==='template_criar_solicitado'){direitos.delete('modelos.adicionar');revogarAntesMeta=true;}};
 const revogado={...pedidoTemplate,nome:'revogado_'+tag,idempotencia:randomUUID()};await recusar(()=>templates.alterar(ana,revogado),'META_INVALIDO');igual(chamadasMetaSimuladas,3);repo.auditar=auditarOriginal;revogarAntesMeta=false;
 // O extrato distingue leitura pessoal e da equipe. Configurar não concede essas leituras.
 definir('configurar','atender');await recusar(()=>repo.atividades(ana,{}));definir('atividades.visualizar');igual((await repo.atividades(ana,{})).todos,false);await recusar(()=>repo.atividades(ana,{usuario:bia.id}));
 definir('atividades.equipe.visualizar');igual((await repo.atividades(ana,{})).todos,true);conferir((await repo.atividades(ana,{usuario:bia.id})).registros.every(v=>v.autorId===bia.id));
 igual(await efeitos(),efeitosAntes);igual(enviosExternos,0);
 console.log(JSON.stringify({ensaio:'permissoes-hierarquia-operacoes',assercoes,enviosExternos,chamadasMetaSimuladas,guardas:'acoes_proprias',replay:'autorizacao_revalidada',historico:'preservado',dados:'somente_ficticios'}));
}finally{await pool.end();}
