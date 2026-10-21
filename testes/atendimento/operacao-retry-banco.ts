import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Pool} from 'pg';
import {RepositorioOperacaoPg,materializarEventoOperacao,hashOperacao} from '../../src/lib/atendimento/operacao-repositorio-pg';
import type {RepositorioEntradaPg} from '../../src/lib/atendimento/operacao-repositorio-pg';
import {WorkerOperacao} from '../../src/lib/atendimento/operacao-envio';
import {textoAssinadoOperacao} from '../../src/lib/atendimento/operacao-assinatura-humana';
import type {IdentidadeOperacao,PedidoEnvioOperacao,PedidoNovaTentativaOperacao} from '../../src/lib/atendimento/operacao-tipos';
import {pdfFicticio} from './fixtures-midia';
// Executar somente na base nova do ensaio. O teste nunca recebe URL produtiva.
const conexao=process.env.OPERACAO_BANCO_TESTE;
if(!conexao)throw Error('ENSAIO_BANCO_EXIGIDO');
const destino=new URL(conexao);
if(destino.protocol!=='postgresql:'||destino.pathname!=='/donatella_ensaio_operacao'||!['localhost','127.0.0.1'].includes(destino.hostname)||destino.searchParams.has('host')&&destino.searchParams.get('host')!=='/socket')throw Error('ENSAIO_DESTINO_RECUSADO');
const pool=new Pool({connectionString:conexao,max:6});
const permissoes=['consultar','atender','configurar','mensagens.visualizar','mensagens.adicionar','contatos.visualizar','modelos.visualizar','etiquetas.visualizar','notas.visualizar'];
const original:IdentidadeOperacao={id:'fixture-autora-original',nome:'Autora fictícia',perfilId:'fixture',sessaoVersao:1,permissoes};
const atual:IdentidadeOperacao={...original,id:'fixture-operador-atual',nome:'Operador fictício'};
let revogado=false,modo:'homologacao'|'operacao'='homologacao',assercoes=0,postSimulados=0,contadorFixtures=0;
const conferir=(v:unknown)=>{assert.ok(v);assercoes++;};
const rejeitar=async(f:()=>Promise<unknown>,codigo:string)=>{await assert.rejects(f,new RegExp(codigo));assercoes++;};
const repo=new RepositorioOperacaoPg(pool,async(i,a)=>!revogado&&[original.id,atual.id].includes(i.id)&&i.permissoes.includes(a),()=>modo,await mkdtemp(join(tmpdir(),'retry-ficticio-')),undefined,undefined,'humano');
const transporte={token:'fixture-sem-validade',numeroId:'123456789',versao:'v23.0',autoridade:'nenhuma' as const,enviosHabilitados:false};
const externasProibidas:typeof fetch=async()=>{throw Error('ENSAIO_ENVIO_EXTERNO_PROIBIDO');};
type Fixture={conversaId:string;citadaId:string;contatoId:string;telefone:string;envio:Awaited<ReturnType<RepositorioOperacaoPg['enfileirar']>>;pedido:PedidoEnvioOperacao};
async function fixture(p:Partial<PedidoEnvioOperacao>={},ficticia=true):Promise<Fixture>{
 const contatoId=randomUUID(),conversaId=randomUUID(),citadaId=randomUUID(),telefone=String(1111111100+contadorFixtures++);
 await pool.query("INSERT INTO atendimento_operacao.contato(id,nome,telefone,identidade_canal) VALUES($1,'Contato fictício de retry',$2,$3)",[contatoId,telefone,'whatsapp:123456789:'+telefone]);
 await pool.query("INSERT INTO atendimento_operacao.conversa(id,contato_id,estado,ficticia,ultima_cliente_em) VALUES($1,$2,'humano',$3,now())",[conversaId,contatoId,ficticia]);
 await pool.query("INSERT INTO atendimento_operacao.mensagem(id,conversa_id,wamid,autor,conteudo,tipo,estado,criada_em) VALUES($1,$2,$3,'cliente','Entrada fictícia','text','recebido',now()-interval '5 minutes')",[citadaId,conversaId,'wamid.fixture-citada-'+citadaId]);
 const pedido={conversaId,versao:1,idempotencia:randomUUID(),tipo:'text' as const,texto:'Resposta fictícia com emoji 💜',...p};
 const envio=await repo.enfileirar(original,pedido);const f={contatoId,conversaId,citadaId,telefone,envio,pedido};await falhar(f);return f;
}
async function falhar(f:Fixture,estado='recusado',intencaoId=f.envio.id,wamid:string|null=null,codigo='META_CODIGO_131047'){
 await pool.query('UPDATE atendimento_operacao.intencao SET estado=$2,codigo=$3,wamid=$4,lease=null,lease_ate=null WHERE id=$1',[intencaoId,estado,codigo,wamid]);
 await pool.query('UPDATE atendimento_operacao.mensagem SET estado=$2,wamid=$3 WHERE id=$1',[f.envio.mensagemId,estado,wamid]);
}
const solicitar=(f:Fixture,intencaoId=f.envio.id):PedidoNovaTentativaOperacao=>({conversaId:f.conversaId,mensagemId:f.envio.mensagemId,intencaoId,versao:1,idempotencia:randomUUID()});
const registro=async(id:string)=>(await pool.query('SELECT * FROM atendimento_operacao.mensagem WHERE id=$1',[id])).rows[0];
const intencao=async(id:string)=>(await pool.query('SELECT * FROM atendimento_operacao.intencao WHERE id=$1',[id])).rows[0];
const worker=(resultado:{estado:'aceito_simulado';wamid:string}|{estado:'recusado'|'incerto';codigo:string},validar?:(mensagemId:string)=>Promise<void>)=>new WorkerOperacao(repo,{} as RepositorioEntradaPg,async id=>id===original.id?original:id===atual.id?atual:null,transporte,async t=>{await validar?.(t.mensagem_id);return resultado;},externasProibidas);
try{
 // Uma bolha, duas tentativas. Replay e dois UUIDs concorrentes não duplicam.
 const f=await fixture(),antes=await registro(f.envio.mensagemId),fonte=await intencao(f.envio.id);
 conferir(hashOperacao(fonte.conteudo)!==fonte.hash); // JSONB não preserva a ordem usada por JSON.stringify.
 const a=solicitar(f),b=solicitar(f),dupla=await Promise.allSettled([repo.tentarNovamente(atual,a),repo.tentarNovamente(atual,b)]);
 conferir(dupla.filter(r=>r.status==='fulfilled').length===1);conferir(dupla.filter(r=>r.status==='rejected').length===1);
 const vencedor=dupla[0].status==='fulfilled'?a:b,recibo=await repo.tentarNovamente(atual,vencedor),depois=await registro(f.envio.mensagemId),nova=await intencao(recibo.id);
 conferir(recibo.mensagemId===f.envio.mensagemId&&depois.id===antes.id&&depois.conteudo===antes.conteudo&&depois.autor_id===antes.autor_id&&depois.metadados.autorNome===antes.metadados.autorNome);
 conferir(depois.criada_em.getTime()===antes.criada_em.getTime()&&depois.wamid===null&&depois.metadados.intencaoAtualId===recibo.id);
 conferir(nova.autor_id===atual.id&&nova.conteudo.autorContexto.id===atual.id&&nova.conteudo.assinaturaHumana===fonte.conteudo.assinaturaHumana&&textoAssinadoOperacao(nova.conteudo)===textoAssinadoOperacao(fonte.conteudo));
 conferir((await pool.query('SELECT count(*)::integer n FROM atendimento_operacao.intencao WHERE mensagem_id=$1',[f.envio.mensagemId])).rows[0].n===2);
 conferir((await pool.query("SELECT count(*)::integer n FROM atendimento_operacao.auditoria WHERE acao='mensagem_tentar_novamente' AND entidade_id=$1 AND autor_id=$2",[f.envio.mensagemId,atual.id])).rows[0].n===1);
 await rejeitar(()=>repo.tentarNovamente(atual,{...vencedor,intencaoId:randomUUID()}),'IDEMPOTENCIA_DIVERGENTE');
 await worker({estado:'recusado',codigo:'META_CODIGO_130429'}).enviarProximo();
 await rejeitar(()=>repo.tentarNovamente(atual,{...solicitar(f),idempotencia:randomUUID()}),'TENTATIVA_CONFLITO'); // A falha rápida da nova tentativa não torna válido o clique antigo.
 const estadoNovo=await repo.estadoMensagem(atual,{conversaId:f.conversaId,mensagemId:f.envio.mensagemId});conferir(estadoNovo.intencaoId===recibo.id&&estadoNovo.falhaCodigo==='META_CODIGO_130429'&&estadoNovo.podeTentarNovamente);
 const terceira=await repo.tentarNovamente(atual,solicitar(f,recibo.id));await worker({estado:'aceito_simulado',wamid:'wamid.fixture-sucesso'}).enviarProximo();
 conferir((await registro(f.envio.mensagemId)).estado==='aceito_simulado');conferir((await repo.tentarNovamente(atual,vencedor)).id===recibo.id);
 await rejeitar(()=>repo.tentarNovamente(atual,solicitar(f,terceira.id)),'CONFLITO');
 const fila=await repo.dados(atual,'status') as {fila:{estado:string;quantidade:number}[]};conferir(!fila.fila.some(e=>e.estado==='recusado'));
 const atividade=await repo.atividades(atual,{categoria:'conversas'});conferir(atividade.registros.some(v=>v.autorId===atual.id&&v.titulo==='Nova tentativa de envio solicitada'&&v.detalhe.toLocaleLowerCase('pt-BR')==='contato fictício de retry'));
 // Nem incerteza nem aceite/entrega/leitura permitem uma segunda mensagem.
 for(const estado of ['incerto','aceito','entregue','lido','aceito_simulado','pendente']){
  const bloqueada=await fixture();await falhar(bloqueada,estado);const p=solicitar(bloqueada);
  await rejeitar(()=>repo.tentarNovamente(atual,p),'TENTATIVA_CONFLITO');conferir(!(await repo.estadoMensagem(atual,{conversaId:bloqueada.conversaId,mensagemId:bloqueada.envio.mensagemId})).podeTentarNovamente);
  await falhar(bloqueada);
 }
 // A autorização é conferida antes de enfileirar e antes de repetir um recibo.
 revogado=true;await rejeitar(()=>repo.tentarNovamente(atual,vencedor),'ACESSO_NEGADO');await rejeitar(()=>repo.estadoMensagem(atual,{conversaId:f.conversaId,mensagemId:f.envio.mensagemId}),'ACESSO_NEGADO');revogado=false;
 const restrito={...atual,permissoes:permissoes.filter(p=>p!=='mensagens.adicionar')},segura=await fixture();await rejeitar(()=>repo.tentarNovamente(restrito,solicitar(segura)),'ACESSO_NEGADO');
 conferir(!(await repo.estadoMensagem(restrito,{conversaId:segura.conversaId,mensagemId:segura.envio.mensagemId})).podeTentarNovamente);
 await rejeitar(()=>repo.tentarNovamente({...atual,tipo:'ia'},solicitar(segura)),'AUTOR_RECUSADO');
 await rejeitar(()=>repo.tentarNovamente(atual,{...solicitar(segura),versao:0}),'CONTEXTO_ALTERADO');
 await pool.query("UPDATE atendimento_operacao.conversa SET estado='pausado' WHERE id=$1",[segura.conversaId]);await rejeitar(()=>repo.tentarNovamente(atual,solicitar(segura)),'ASSUMIR_OBRIGATORIO');
 await pool.query("UPDATE atendimento_operacao.conversa SET estado='encerrada' WHERE id=$1",[segura.conversaId]);await rejeitar(()=>repo.tentarNovamente(atual,solicitar(segura)),'CONTEXTO_ALTERADO');
 await pool.query("UPDATE atendimento_operacao.conversa SET estado='humano',ultima_cliente_em=now()-interval '25 hours' WHERE id=$1",[segura.conversaId]);await rejeitar(()=>repo.tentarNovamente(atual,solicitar(segura)),'JANELA_FECHADA');
 const outra=await fixture();await rejeitar(()=>repo.tentarNovamente(atual,{...solicitar(segura),conversaId:outra.conversaId}),'MENSAGEM_AUSENTE');await rejeitar(()=>repo.estadoMensagem(atual,{conversaId:outra.conversaId,mensagemId:segura.envio.mensagemId}),'MENSAGEM_AUSENTE');
 // Sem intenção durável não há conteúdo suficiente para um reenvio seguro.
 const legadoId=randomUUID();await pool.query("INSERT INTO atendimento_operacao.mensagem(id,conversa_id,autor,tipo,estado,conteudo) VALUES($1,$2,'humano','text','recusado','Importada fictícia')",[legadoId,outra.conversaId]);conferir(!(await repo.estadoMensagem(atual,{conversaId:outra.conversaId,mensagemId:legadoId})).podeTentarNovamente);
 // Mídia e citação preservadas; perda/vínculo inválido impede nova intenção.
 const comAnexo=await fixture();const anexo=await repo.salvarAnexo(original,{conversaId:comAnexo.conversaId,nome:'ficticio.pdf',mime:'application/pdf',base64:pdfFicticio.toString('base64'),idempotencia:randomUUID()});
 const enviada=await repo.enfileirar(original,{conversaId:comAnexo.conversaId,versao:1,idempotencia:randomUUID(),tipo:'document',texto:'Legenda fictícia',anexoId:anexo.id,citadaId:comAnexo.citadaId});
 const documento={...comAnexo,envio:enviada};await falhar(documento);const reenviada=await repo.tentarNovamente(atual,solicitar(documento)),documentoNovo=await registro(enviada.mensagemId),pedidoNovo=await intencao(reenviada.id);
 conferir(documentoNovo.anexo_id===anexo.id&&documentoNovo.citada_id===comAnexo.citadaId&&documentoNovo.conteudo==='Legenda fictícia'&&pedidoNovo.conteudo.anexoId===anexo.id&&pedidoNovo.conteudo.citadaId===comAnexo.citadaId);
 await falhar(documento,'recusado',reenviada.id);await pool.query('UPDATE atendimento_operacao.mensagem SET wamid=null WHERE id=$1',[comAnexo.citadaId]);await rejeitar(()=>repo.tentarNovamente(atual,solicitar(documento,reenviada.id)),'CITACAO_INDISPONIVEL');
 await pool.query('UPDATE atendimento_operacao.mensagem SET wamid=$2 WHERE id=$1',[comAnexo.citadaId,'wamid.fixture-citada-'+comAnexo.citadaId]);await pool.query('UPDATE atendimento_operacao.anexo SET conversa_id=$2 WHERE id=$1',[anexo.id,outra.conversaId]);await rejeitar(()=>repo.tentarNovamente(atual,solicitar(documento,reenviada.id)),'ANEXO_AUSENTE');
 // Template é revalidado sem trocar silenciosamente o texto exibido na bolha.
 const modeloId='fixture_retry_'+randomUUID(),componentes=[{type:'BODY',text:'Olá {{1}}, retomamos o atendimento?'}];await pool.query("INSERT INTO atendimento_operacao.modelo(id,nome,idioma,estado,componentes) VALUES($1,'retomar_fixture','pt_BR','APPROVED',$2)",[modeloId,JSON.stringify(componentes)]);
 const template=await fixture({tipo:'template',modeloId,variaveis:['Pessoa fictícia'],texto:undefined});await pool.query("UPDATE atendimento_operacao.conversa SET ultima_cliente_em=now()-interval '25 hours' WHERE id=$1",[template.conversaId]);
 const templateNova=await repo.tentarNovamente(atual,solicitar(template));conferir((await registro(template.envio.mensagemId)).conteudo==='Olá Pessoa fictícia, retomamos o atendimento?');conferir((await intencao(templateNova.id)).conteudo.modeloHash===(await intencao(template.envio.id)).conteudo.modeloHash);
 await falhar(template,'recusado',templateNova.id);await pool.query('UPDATE atendimento_operacao.modelo SET componentes=$2 WHERE id=$1',[modeloId,JSON.stringify([{type:'BODY',text:'Texto alterado {{1}}'}])]);await rejeitar(()=>repo.tentarNovamente(atual,solicitar(template,templateNova.id)),'MODELO_ALTERADO');
 await pool.query("UPDATE atendimento_operacao.modelo SET estado='DELETED' WHERE id=$1",[modeloId]);await rejeitar(()=>repo.tentarNovamente(atual,solicitar(template,templateNova.id)),'MODELO_NAO_APROVADO');
 // Callbacks antigos permanecem ligados à tentativa antiga, sem mudar a bolha.
 const callback=await fixture(),wamidAntigo='wamid.fixture-antigo-'+randomUUID();await falhar(callback,'recusado',callback.envio.id,wamidAntigo);
 const callbackNova=await repo.tentarNovamente(atual,solicitar(callback));
 const status=async(wamid:string,estado:string)=>materializarEventoOperacao(repo,{chave:randomUUID(),tipo:'status',waba:'fixture',numero:'123456789',conteudo:{item:{id:wamid,status:estado,timestamp:String(Math.floor(Date.now()/1000)),...(estado==='failed'?{errors:[{code:131047}]}:{})}}});
 await status(wamidAntigo,'read');conferir((await registro(callback.envio.mensagemId)).estado==='pendente'&&(await intencao(callback.envio.id)).estado==='lido');
 let chamadasAposLeitura=0;await worker({estado:'aceito_simulado',wamid:'wamid.fixture-nao-deve-enviar'},async()=>{chamadasAposLeitura++;}).enviarProximo();await status(wamidAntigo,'failed');conferir((await registro(callback.envio.mensagemId)).estado==='lido'&&chamadasAposLeitura===0);conferir((await intencao(callbackNova.id)).estado==='cancelado'&&(await intencao(callbackNova.id)).codigo==='TENTATIVA_ANTERIOR_CONFIRMADA');await rejeitar(()=>repo.tentarNovamente(atual,solicitar(callback,callback.envio.id)),'TENTATIVA_CONFLITO');conferir((await repo.estadoMensagem(atual,{conversaId:callback.conversaId,mensagemId:callback.envio.mensagemId})).intencaoId===callback.envio.id);
 // Um sent atrasado não apaga a recusa nem esconde a ação de tentar novamente.
 const atrasada=await fixture(),atrasadaNova=await repo.tentarNovamente(atual,solicitar(atrasada)),wamidAtrasado='wamid.fixture-status-atrasado-'+randomUUID();
 await worker({estado:'aceito_simulado',wamid:wamidAtrasado}).enviarProximo();await status(wamidAtrasado,'failed');await status(wamidAtrasado,'sent');
 const recusaPreservada=await repo.estadoMensagem(atual,{conversaId:atrasada.conversaId,mensagemId:atrasada.envio.mensagemId});conferir(recusaPreservada.estado==='recusado'&&recusaPreservada.podeTentarNovamente&&recusaPreservada.intencaoId===atrasadaNova.id);conferir((await intencao(atrasadaNova.id)).estado==='recusado');
 await status(wamidAtrasado,'delivered');await status(wamidAtrasado,'sent');conferir((await registro(atrasada.envio.mensagemId)).estado==='entregue');await status(wamidAtrasado,'read');conferir((await registro(atrasada.envio.mensagemId)).estado==='lido'&&!(await repo.estadoMensagem(atual,{conversaId:atrasada.conversaId,mensagemId:atrasada.envio.mensagemId})).podeTentarNovamente);
 // Lease expirado é visível como incerto. Nem o worker nem o botão o repetem.
 const expirada=await fixture();await pool.query("UPDATE atendimento_operacao.intencao SET estado='processando',lease=$2,lease_ate=now()-interval '1 minute' WHERE id=$1",[expirada.envio.id,randomUUID()]);await pool.query("UPDATE atendimento_operacao.mensagem SET estado='pendente' WHERE id=$1",[expirada.envio.mensagemId]);
 await worker({estado:'aceito_simulado',wamid:'wamid.fixture-nao-usado'}).enviarProximo();const incerta=await repo.estadoMensagem(atual,{conversaId:expirada.conversaId,mensagemId:expirada.envio.mensagemId});conferir(incerta.estado==='incerto'&&!incerta.podeTentarNovamente);await rejeitar(()=>repo.tentarNovamente(atual,solicitar(expirada)),'TENTATIVA_CONFLITO');
 // Uma intenção antiga pendente não ganha vida depois do ponteiro novo.
 const ativa=await fixture(),ativoNovo=await repo.tentarNovamente(atual,solicitar(ativa));await pool.query("UPDATE atendimento_operacao.intencao SET estado='pendente',proxima_tentativa=now()-interval '1 hour' WHERE id=$1",[ativa.envio.id]);
 await worker({estado:'aceito_simulado',wamid:'wamid.fixture-ativa'},async id=>conferir(id===ativa.envio.mensagemId)).enviarProximo();conferir((await intencao(ativoNovo.id)).estado==='aceito_simulado'&&(await intencao(ativa.envio.id)).estado==='pendente');
 // Cliente 1 -> recusa -> cliente 2 -> retry aceito reduz a pendência do contato.
 const pendencia=await fixture(),entrada2=randomUUID();await pool.query("UPDATE atendimento_operacao.mensagem SET criada_em=now()-interval '2 minutes' WHERE id=$1",[pendencia.envio.mensagemId]);await pool.query("INSERT INTO atendimento_operacao.mensagem(id,conversa_id,autor,tipo,conteudo,estado,criada_em) VALUES($1,$2,'cliente','text','Segunda entrada fictícia','recebido',now()-interval '1 minute')",[entrada2,pendencia.conversaId]);
 conferir((await repo.historico(atual,{conversaId:pendencia.conversaId})).conversa.pendentesResposta===2);await repo.tentarNovamente(atual,solicitar(pendencia));await worker({estado:'aceito_simulado',wamid:'wamid.fixture-pendencia'}).enviarProximo();conferir((await repo.historico(atual,{conversaId:pendencia.conversaId})).conversa.pendentesResposta===0);
 // Estado focado funciona mesmo quando a bolha não está na página dos últimos 50.
 await pool.query("INSERT INTO atendimento_operacao.mensagem(id,conversa_id,autor,tipo,conteudo,estado) SELECT gen_random_uuid(),$1,'cliente','text','Entrada paginada fictícia','recebido' FROM generate_series(1,55)",[pendencia.conversaId]);
 conferir(!(await repo.historico(atual,{conversaId:pendencia.conversaId})).registros.some(m=>m.id===pendencia.envio.mensagemId));const foco=await repo.estadoMensagem(atual,{conversaId:pendencia.conversaId,mensagemId:pendencia.envio.mensagemId});conferir(foco.estado==='aceito_simulado'&&!('conteudo' in foco));
 // Status novo antes do recibo do POST é conciliado após o aceite. Só fetch falso.
 modo='operacao';const realFicticio=await fixture({},false);await repo.tentarNovamente(atual,solicitar(realFicticio));const wamidNovo='wamid.fixture-antes-ack-'+randomUUID();
 const envAnterior=process.env.ATENDIMENTO_ENVIO_HABILITADO,autoridadeAnterior=process.env.ATENDIMENTO_AUTORIDADE_ENVIO;process.env.ATENDIMENTO_ENVIO_HABILITADO='true';process.env.ATENDIMENTO_AUTORIDADE_ENVIO='vps';
 try{
  const fetchFalso:typeof fetch=async(url,p)=>{assert.equal(String(url),'https://graph.facebook.com/v23.0/123456789/messages');assert.equal(p?.method,'POST');assert.equal(JSON.parse(String(p?.body)).to,realFicticio.telefone);postSimulados++;await status(wamidNovo,'read');return Response.json({messaging_product:'whatsapp',messages:[{id:wamidNovo}]});};
  const w=new WorkerOperacao(repo,{} as RepositorioEntradaPg,async()=>atual,{...transporte,autoridade:'vps',enviosHabilitados:true},undefined,fetchFalso);await w.enviarProximo();conferir((await registro(realFicticio.envio.mensagemId)).estado==='lido'&&postSimulados===1);
 }finally{if(envAnterior===undefined)delete process.env.ATENDIMENTO_ENVIO_HABILITADO;else process.env.ATENDIMENTO_ENVIO_HABILITADO=envAnterior;if(autoridadeAnterior===undefined)delete process.env.ATENDIMENTO_AUTORIDADE_ENVIO;else process.env.ATENDIMENTO_AUTORIDADE_ENVIO=autoridadeAnterior;}
 console.log(JSON.stringify({ensaio:'retry-mesma-mensagem',aprovado:true,assercoes,postSimulados,enviosExternos:0}));
}finally{await pool.end();}
