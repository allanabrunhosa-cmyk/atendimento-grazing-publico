import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {RepositorioOperacaoPg,materializarEventoOperacao} from '../../src/lib/atendimento/operacao-repositorio-pg';
import type {AcaoOperacao,IdentidadeOperacao} from '../../src/lib/atendimento/operacao-tipos';

const endereco=process.env.OPERACAO_BANCO_TESTE??'',url=new URL(endereco);
if(url.protocol!=='postgresql:'||url.pathname!=='/donatella_ensaio_operacao'||!['127.0.0.1','localhost'].includes(url.hostname)||url.searchParams.has('host')&&url.searchParams.get('host')!=='/socket')throw Error('ENSAIO_ISOLADO_EXIGIDO');
const pool=new Pool({connectionString:endereco,max:6}),numeroId='123456789',marcador='Conversa única fictícia '+randomUUID();
const permissoes=new Set<AcaoOperacao>(['consultar','atender','mensagens.visualizar','mensagens.adicionar','contatos.visualizar','notas.visualizar','etiquetas.visualizar']);
const ana:IdentidadeOperacao={id:'fixture-unica-ana',nome:'Ana Fictícia',perfilId:'fixture',sessaoVersao:1,permissoes:[]},bia={...ana,id:'fixture-unica-bia',nome:'Bia Fictícia'};
let assercoes=0,sequencia=Number((await pool.query('SELECT count(*)::int n FROM atendimento_operacao.contato')).rows[0].n)+1000,fetchs=0;
globalThis.fetch=async()=>{fetchs++;throw Error('ENSAIO_ENVIO_EXTERNO_PROIBIDO');};
const autorizar=async(i:IdentidadeOperacao,a:AcaoOperacao)=>[ana.id,bia.id].includes(i.id)&&permissoes.has(a);
const repo=new RepositorioOperacaoPg(pool,autorizar,()=> 'operacao','/tmp',undefined,undefined,'humano',{numeroId,ficticio:true});
const verificar=(real:unknown,esperado:unknown)=>{assert.deepEqual(real,esperado);assercoes++;};
const recusar=async(f:()=>Promise<unknown>,e:string)=>{await assert.rejects(f,new RegExp(e));assercoes++;};
const telefone=()=> '5511900'+String(++sequencia).padStart(6,'0');
const criar=()=>repo.criarContato(ana,{nome:marcador,telefone:'+'+telefone(),idempotencia:randomUUID()});
const ler=async(id:unknown)=>(await pool.query('SELECT * FROM atendimento_operacao.conversa WHERE id=$1',[id])).rows[0];
const contar=async(contato:unknown)=>(await pool.query('SELECT count(*)::int n FROM atendimento_operacao.conversa WHERE contato_id=$1',[contato])).rows[0].n;
const iniciar=(contato:{id:unknown;versao:number},ator=ana,idempotencia=randomUUID())=>repo.iniciarConversaContato(ator,{contatoId:String(contato.id),versaoContato:contato.versao,idempotencia});
const receber=(tel:string,id='wamid.fixture-unica-'+randomUUID())=>materializarEventoOperacao(repo,{chave:randomUUID(),tipo:'mensagem',waba:'fixture',numero:numeroId,conteudo:{item:{id,from:tel,timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:'Entrada fictícia preservada'}}}});
const fechar=async(id:string)=>repo.agir(ana,id,{acao:'encerrar',versao:Number((await ler(id)).versao),idempotencia:randomUUID()});
const auditorias=async(id:string,acao:string)=>(await pool.query('SELECT autor_id,autor_nome,versao FROM atendimento_operacao.auditoria WHERE entidade_id=$1 AND acao=$2 ORDER BY criada_em,id',[id,acao])).rows;

try{
 // A reabertura manual conserva o ID e a janela real, sem renovar o relógio.
 const c=await criar(),inicial=await iniciar(c.contato),id=String(inicial.conversa.id);
 await pool.query("UPDATE atendimento_operacao.conversa SET ultima_cliente_em=now()-interval '26 hours',ultima_mensagem_em=now()-interval '26 hours' WHERE id=$1",[id]);
 await fechar(id);const encerrada=await ler(id),comando=randomUUID(),manual=await iniciar(c.contato,bia,comando);
 verificar(manual.conversa.id,id);verificar(manual.reutilizada,true);verificar(manual.requerTemplate,true);verificar(manual.conversa.responsavelId,bia.id);
 verificar(manual.conversa.versao,Number(encerrada.versao)+1);verificar((await ler(id)).ultima_cliente_em,encerrada.ultima_cliente_em);verificar((await ler(id)).ultima_mensagem_em,encerrada.ultima_mensagem_em);
 verificar((await iniciar(c.contato,bia,comando)).conversa.id,id);verificar(await contar(c.contato.id),1);
 const manualAuditoria=await auditorias(id,'reabrir');verificar(manualAuditoria.length,1);verificar(manualAuditoria[0].autor_id,bia.id);verificar(manualAuditoria[0].autor_nome,bia.nome);
 // Conversa aberta não toma o responsável nem muda o estado.
 await pool.query("UPDATE atendimento_operacao.conversa SET estado='pausado' WHERE id=$1",[id]);
 verificar((await iniciar(c.contato)).conversa.estado,'pausado');verificar((await ler(id)).responsavel_id,bia.id);

 // Entrada após encerramento reabre o mesmo ID uma vez, mesmo no replay.
 await fechar(id);const antesEntrada=await ler(id),wamid='wamid.fixture-reabertura-'+randomUUID(),entrada=await receber(String(c.contato.telefone),wamid);
 if(!('conversaId' in entrada))throw Error('ENTRADA_FICTICIA_AUSENTE');
 verificar(entrada.conversaId,id);verificar(await contar(c.contato.id),1);verificar(Number((await ler(id)).versao),Number(antesEntrada.versao)+2);
 verificar((await ler(id)).estado,'humano');verificar((await ler(id)).responsavel_id,bia.id);
 verificar(await receber(String(c.contato.telefone),wamid),{duplicada:true});
 const recebidas=await auditorias(id,'reabrir');verificar(recebidas.length,2);verificar(recebidas[1].autor_nome,'Sistema — WhatsApp');
 verificar((await iniciar(c.contato)).requerTemplate,false);
 // Webhook e início manual concorrem sob a trava da mesma identidade.
 await fechar(id);const numeroAntes=(await auditorias(id,'reabrir')).length;
 const concorrentes=await Promise.all([iniciar(c.contato),receber(String(c.contato.telefone))]);
 verificar(concorrentes.every(v=>'conversa' in v?v.conversa.id===id:'conversaId' in v&&v.conversaId===id),true);
 verificar(await contar(c.contato.id),1);verificar((await auditorias(id,'reabrir')).length,numeroAntes+1);

 // Sessões históricas existentes continuam consultáveis, mas não duplicam a lista.
 const legada=randomUUID(),mensagemLegada=randomUUID();
 await pool.query("INSERT INTO atendimento_operacao.conversa(id,contato_id,estado,ficticia,ultima_mensagem_em,criada_em) VALUES($1,$2,'encerrada',true,now()+interval '1 day',now()+interval '1 day')",[legada,c.contato.id]);
 await pool.query("INSERT INTO atendimento_operacao.mensagem(id,conversa_id,autor,conteudo,tipo) VALUES($1,$2,'cliente','Histórico legado fictício','text')",[mensagemLegada,legada]);
 const listada=await repo.listar(ana,{busca:marcador}),fechadas=await repo.listar(ana,{busca:marcador,estado:'encerrada'});
 verificar(listada.registros.map(v=>v.id),[id]);verificar(listada.contagens?.total,1);verificar(listada.contagens?.encerrada,0);verificar(fechadas.registros.length,0);
 verificar((await repo.historico(ana,{conversaId:id})).registros.some(m=>m.id===mensagemLegada),true);
 verificar((await repo.historico(ana,{conversaId:legada})).registros.some(m=>m.id===entrada.mensagemId),true);
 await fechar(id);const escolhida=(await repo.listar(ana,{busca:marcador,estado:'encerrada'})).registros;
 verificar(escolhida.map(v=>v.id),[legada]);
 const reabertaLegada=await iniciar(c.contato);verificar(reabertaLegada.conversa.id,legada);verificar(await contar(c.contato.id),2);
 verificar((await repo.listar(ana,{busca:marcador,estado:'encerrada'})).registros.length,0);

 // Reuso e consulta de histórico não atravessam o ambiente da conversa.
 const real=randomUUID(),mensagemReal=randomUUID();
 await pool.query("INSERT INTO atendimento_operacao.conversa(id,contato_id,estado,ficticia) VALUES($1,$2,'encerrada',false)",[real,c.contato.id]);
 await pool.query("INSERT INTO atendimento_operacao.mensagem(id,conversa_id,autor,conteudo,tipo) VALUES($1,$2,'cliente','Outro ambiente fictício para prova','text')",[mensagemReal,real]);
 await fechar(legada);const mesma=await receber(String(c.contato.telefone));
 verificar('conversaId' in mesma&&mesma.conversaId===legada,true);verificar((await ler(real)).estado,'encerrada');
 verificar((await repo.historico(ana,{conversaId:legada})).registros.some(m=>m.id===mensagemReal),false);
 const repoReal=new RepositorioOperacaoPg(pool,autorizar,()=> 'operacao','/tmp',undefined,undefined,'humano',{numeroId,ficticio:false});
 const listaFicticia=await repo.listar(ana,{busca:marcador}),listaReal=await repoReal.listar(ana,{busca:marcador,estado:'encerrada'});
 verificar(listaFicticia.registros.map(v=>v.id),[legada]);verificar(listaFicticia.contagens?.humano,1);verificar(listaFicticia.contagens?.encerrada,0);
 verificar(listaReal.registros.map(v=>v.id),[real]);verificar(listaReal.contagens?.humano,0);verificar(listaReal.contagens?.encerrada,1);
 verificar((await repoReal.listar(ana,{busca:marcador})).registros.length,0);
 const outroNumero='987654321',outroRepositorio=new RepositorioOperacaoPg(pool,autorizar,()=> 'operacao','/tmp',undefined,undefined,'humano',{numeroId:outroNumero,ficticio:true});
 await recusar(()=>outroRepositorio.iniciarConversaContato(ana,{contatoId:String(c.contato.id),versaoContato:c.contato.versao,idempotencia:randomUUID()}),'CANAL_RECUSADO');
 permissoes.delete('atender');await recusar(()=>iniciar(c.contato),'ACESSO_NEGADO');permissoes.add('atender');

 // Cadastro repetido converge pela identidade; legado sem canal exige escolha explícita.
 const novamente=await repo.criarContato(ana,{nome:'Nome que não deve substituir',telefone:'+'+c.contato.telefone,idempotencia:randomUUID()});
 verificar(novamente.contato.id,c.contato.id);verificar(novamente.reutilizado,true);
 const semCanal=randomUUID(),telLegado=telefone();await pool.query('INSERT INTO atendimento_operacao.contato(id,nome,telefone) VALUES($1,$2,$3)',[semCanal,marcador+' sem canal','+'+telLegado]);
 await recusar(()=>repo.criarContato(ana,{nome:marcador,telefone:'+'+telLegado,idempotencia:randomUUID()}),'IDENTIDADE_CONFLITO');
 verificar((await pool.query('SELECT identidade_canal FROM atendimento_operacao.contato WHERE id=$1',[semCanal])).rows[0].identidade_canal,null);
 const antigaSemCanal=randomUUID(),mensagemSemCanal=randomUUID();
 await pool.query("INSERT INTO atendimento_operacao.conversa(id,contato_id,estado,ficticia) VALUES($1,$2,'encerrada',true)",[antigaSemCanal,semCanal]);
 await pool.query("INSERT INTO atendimento_operacao.mensagem(id,conversa_id,autor,conteudo,tipo) VALUES($1,$2,'cliente','Histórico anterior ao vínculo','text')",[mensagemSemCanal,antigaSemCanal]);
 const vinculada=await receber(telLegado);verificar('conversaId' in vinculada&&vinculada.conversaId===antigaSemCanal,true);verificar(await contar(semCanal),1);
 const legadoVinculado=(await pool.query('SELECT telefone,identidade_canal,nome FROM atendimento_operacao.contato WHERE id=$1',[semCanal])).rows[0];
 verificar(legadoVinculado,{telefone:'+'+telLegado,identidade_canal:`whatsapp:${numeroId}:${telLegado}`,nome:marcador+' sem canal'});
 verificar((await repo.historico(ana,{conversaId:antigaSemCanal})).registros.some(m=>m.id===mensagemSemCanal),true);
 verificar((await auditorias(semCanal,'vincular_contato_whatsapp'))[0].autor_nome,'Sistema — WhatsApp');
 // Outra identidade com dígitos exatos é um conflito, nunca um merge silencioso.
 const conflito=randomUUID(),telConflito=telefone(),identidadeConflito=`whatsapp:${outroNumero}:${telConflito}`,wamidConflito='wamid.fixture-conflito-'+randomUUID();
 await pool.query('INSERT INTO atendimento_operacao.contato(id,nome,telefone,identidade_canal) VALUES($1,$2,$3,$4)',[conflito,marcador+' outro canal',telConflito,identidadeConflito]);
 await recusar(()=>repo.criarContato(ana,{nome:marcador,telefone:'+'+telConflito,idempotencia:randomUUID()}),'IDENTIDADE_CONFLITO');
 await recusar(()=>receber(telConflito,wamidConflito),'IDENTIDADE_CONFLITO');
 await recusar(()=>receber(telConflito,wamidConflito),'IDENTIDADE_CONFLITO');
 verificar((await pool.query('SELECT identidade_canal FROM atendimento_operacao.contato WHERE id=$1',[conflito])).rows[0].identidade_canal,identidadeConflito);
 verificar(await contar(conflito),0);verificar((await pool.query('SELECT count(*)::int n FROM atendimento_operacao.mensagem WHERE wamid=$1',[wamidConflito])).rows[0].n,0);
 // Duas identidades concorrentes não conseguem criar dois cadastros por telefone.
 const telConcorrente=telefone(),cadastros=await Promise.allSettled([repo.criarContato(ana,{nome:marcador,telefone:'+'+telConcorrente,idempotencia:randomUUID()}),outroRepositorio.criarContato(ana,{nome:marcador,telefone:'+'+telConcorrente,idempotencia:randomUUID()})]);
 verificar(cadastros.filter(v=>v.status==='fulfilled').length,1);verificar(cadastros.filter(v=>v.status==='rejected'&&String(v.reason).includes('IDENTIDADE_CONFLITO')).length,1);
 verificar((await pool.query("SELECT count(*)::int n FROM atendimento_operacao.contato WHERE regexp_replace(telefone,'[^0-9]','','g')=$1",[telConcorrente])).rows[0].n,1);

 // Trinta contatos por página, mesmo com duas sessões antigas por contato.
 const lote=marcador+' lote',idsContato:string[]=[];
 for(let n=0;n<33;n++){
  const contato=randomUUID(),primeira=randomUUID(),ultima=randomUUID();idsContato.push(contato);
  await pool.query('INSERT INTO atendimento_operacao.contato(id,nome,telefone) VALUES($1,$2,$3)',[contato,lote,telefone()]);
  await pool.query("INSERT INTO atendimento_operacao.conversa(id,contato_id,estado,ficticia,ultima_mensagem_em) VALUES($1,$3,'encerrada',true,'2026-01-01T12:00:00Z'),($2,$3,'encerrada',true,'2026-01-02T12:00:00Z')",[primeira,ultima,contato]);
 }
 const primeira=await repo.listar(ana,{busca:lote,estado:'encerrada'}),segunda=await repo.listar(ana,{busca:lote,estado:'encerrada',pagina:2});
 verificar(primeira.registros.length,30);verificar(primeira.mais,true);verificar(segunda.registros.length,3);verificar(segunda.mais,false);verificar(primeira.contagens?.encerrada,33);verificar(segunda.contagens?.encerrada,33);
 verificar(new Set([...primeira.registros,...segunda.registros].map(v=>'contatoId' in v?v.contatoId:null)).size,33);verificar(idsContato.length,33);verificar(fetchs,0);
 console.log(JSON.stringify({ensaio:'conversa-unica',aprovado:true,assercoes,enviosExternos:fetchs}));
}finally{await pool.end();}
