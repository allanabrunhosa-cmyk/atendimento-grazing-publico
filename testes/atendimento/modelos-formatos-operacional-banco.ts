import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {Pool,type PoolClient} from 'pg';
import {importarBibliotecaMeta} from '../../src/lib/atendimento/operacao-modelos-meta';
import {RepositorioOperacaoPg,hashOperacao,materializarEventoOperacao} from '../../src/lib/atendimento/operacao-repositorio-pg';
import {transportarOperacao,type IntencaoOperacao} from '../../src/lib/atendimento/operacao-envio';
import {contratoModeloOperacao} from '../../src/lib/atendimento/operacao-modelos';
import type {IdentidadeOperacao} from '../../src/lib/atendimento/operacao-tipos';

const endereco=process.env.OPERACAO_BANCO_TESTE;
if(!endereco||process.env.DONATELLA_ENSAIO_OPERACAO!=='1'||!process.argv.includes('--ensaio'))throw Error('ENSAIO_FORMATOS_MODELOS_EXIGIDO');
const u=new URL(endereco);if(u.protocol!=='postgresql:'||u.pathname!=='/donatella_ensaio_operacao'||!['grazing-donatella-operacao-v2-banco','donatella-ensaio-operacao-v2'].includes(u.hostname)||u.search||u.hash)throw Error('ENSAIO_FORMATOS_MODELOS_DESTINO_RECUSADO');
const pool=new Pool({connectionString:endereco,max:1,statement_timeout:10000}),tx=await pool.connect();
let provas=0,savepoint=0,transportesSimulados=0;
const conferir=(v:unknown)=>{assert.ok(v,'ENSAIO_FORMATOS_MODELOS_FALHOU');provas++;};
const recusar=async(f:()=>Promise<unknown>,codigo:string)=>{await assert.rejects(f,new RegExp(codigo));provas++;};
const isolado={connect:async()=>{const nome='ensaio_modelos_'+(++savepoint);return new Proxy(tx,{get(alvo,p){if(p==='release')return()=>undefined;if(p==='query')return async(sql:string,valores?:unknown[])=>{if(sql==='BEGIN')return alvo.query('SAVEPOINT '+nome);if(sql==='COMMIT')return alvo.query('RELEASE SAVEPOINT '+nome);if(sql==='ROLLBACK')return alvo.query('ROLLBACK TO SAVEPOINT '+nome);return alvo.query(sql,valores);};return Reflect.get(alvo,p);}}) as PoolClient;},query:(sql:string,valores?:unknown[])=>tx.query(sql,valores)} as unknown as Pool;
const identidade:IdentidadeOperacao={id:'fixture-formatos-'+randomUUID(),nome:'Atendente fictício',perfilId:'fixture-formatos',sessaoVersao:1,permissoes:['consultar','atender']};
const repo=new RepositorioOperacaoPg(isolado,async(i,a)=>i.id===identidade.id&&i.sessaoVersao===1&&i.permissoes.includes(a),()=> 'operacao','/midia-ensaio');
const modeloId=()=>BigInt('0x'+randomBytes(8).toString('hex')).toString().padStart(20,'1');
const contato=randomUUID(),conversa=randomUUID(),ids=[modeloId(),modeloId(),modeloId(),modeloId()];
const base={name:'fixture_formato',language:'pt_BR',status:'APPROVED',parameter_format:'POSITIONAL'};
const modelos=[
 {...base,id:ids[0],name:'fixture_header_independente',components:[{type:'HEADER',format:'TEXT',text:'Cabeçalho {{1}}'},{type:'BODY',text:'Corpo {{1}}'}]},
 {...base,id:ids[1],name:'fixture_url_estatico',components:[{type:'BODY',text:'Corpo {{1}}'},{type:'BUTTONS',buttons:[{type:'URL',text:'Abrir',url:'https://exemplo.invalid/consulta'}]}]},
 {...base,id:ids[2],name:'fixture_retorno_definido',components:[{type:'BODY',text:'Corpo estático'},{type:'BUTTONS',buttons:[{type:'QUICK_REPLY',text:'Retorno oficial',payload:'retorno-ficticio'},{type:'QUICK_REPLY',text:'Não'}]}]},
 {...base,id:ids[3],name:'fixture_formato_named_bloqueado',parameter_format:'NAMED',components:[{type:'BODY',text:'Corpo {{nome}}'}]},
];
const biblioteca={data:modelos,paging:{next:'https://graph.facebook.com/pagina-ficticia-nao-consultada'}};
const linha=async(id:string)=>(await tx.query('SELECT id,nome,idioma,estado,componentes FROM atendimento_operacao.modelo WHERE id=$1',[id])).rows[0];
const canonico=(v:unknown):unknown=>Array.isArray(v)?v.map(canonico):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonico((v as Record<string,unknown>)[k])])):v;
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(canonico(v))).digest('hex');
const enviar=async(id:string,variaveis:string[])=>{const p={conversaId:conversa,versao:1,idempotencia:randomUUID(),tipo:'template' as const,modeloId:id,variaveis};await repo.enfileirar(identidade,p);return (await tx.query('SELECT * FROM atendimento_operacao.intencao WHERE id=$1',[p.idempotencia])).rows[0] as IntencaoOperacao;};
const postagens:Record<string,unknown>[]=[];
const fronteira:typeof fetch=async(url,opcoes)=>{conferir(String(url)==='https://graph.facebook.com/v23.0/123456789/messages'&&opcoes?.method==='POST');const body=JSON.parse(String(opcoes?.body));conferir(body.to==='5511999990077');postagens.push(body);transportesSimulados++;return new Response(JSON.stringify({messages:[{id:'wamid.fixture-formato'}]}),{status:200,headers:{'content-type':'application/json'}});};
const transporte={token:'token-ficticio-nao-real',numeroId:'123456789',versao:'v23.0',autoridade:'vps' as const,enviosHabilitados:true};
const transportar=(t:IntencaoOperacao,revalidar=async()=>true)=>transportarOperacao(repo,{...t,conteudo:{...t.conteudo,ficticia:false}},transporte,identidade,revalidar,fronteira);
try{
 await tx.query('BEGIN');conferir((await tx.query('SELECT current_database() db')).rows[0].db==='donatella_ensaio_operacao');
 await tx.query("INSERT INTO atendimento_operacao.contato(id,nome,telefone) VALUES($1,'Contato fictício de formatos','5511999990077')",[contato]);
 await tx.query("INSERT INTO atendimento_operacao.conversa(id,contato_id,estado,ficticia,ultima_cliente_em) VALUES($1,$2,'humano',true,'1900-01-01T00:00:00Z')",[conversa,contato]);
 const primeiro=await importarBibliotecaMeta(isolado,biblioteca);conferir(primeiro.inseridos===4&&primeiro.indisponiveis===1&&!primeiro.paginacaoCompleta);
 for(const id of ids.slice(0,3))conferir((await linha(id)).estado==='APPROVED');conferir((await linha(ids[3])).estado==='FORMATO_INDISPONIVEL');
 // Simula somente nas novas fixtures a procedência gerida da política anterior.
 const config=(await tx.query("SELECT conteudo FROM atendimento_operacao.configuracao WHERE chave='modelos_meta_proveniencia'")).rows[0].conteudo;
 for(const id of ids.slice(0,3)){await tx.query("UPDATE atendimento_operacao.modelo SET estado='FORMATO_INDISPONIVEL' WHERE id=$1",[id]);config.modelos[id].hashGerido=hash(await linha(id));}
 await tx.query("UPDATE atendimento_operacao.configuracao SET conteudo=$1::jsonb WHERE chave='modelos_meta_proveniencia'",[JSON.stringify(config)]);
 const promovido=await importarBibliotecaMeta(isolado,biblioteca);conferir(promovido.atualizados===3&&promovido.conflitos===0);conferir(!(await importarBibliotecaMeta(isolado,biblioteca)).mudou);
 const dto=await repo.dados(identidade,'modelos') as {registros:{id:string;variaveis:string[];suportado:boolean}[]};
 conferir(JSON.stringify(dto.registros.find(m=>m.id===ids[0])?.variaveis)==='["header:1","1"]');conferir(dto.registros.find(m=>m.id===ids[1])?.suportado&&dto.registros.find(m=>m.id===ids[2])?.suportado);
 await recusar(()=>repo.enfileirar(identidade,{conversaId:conversa,versao:1,idempotencia:randomUUID(),tipo:'template',modeloId:ids[0],variaveis:['Somente corpo']}),'OPERACAO_MODELO_INVALIDO');
 await recusar(()=>repo.enfileirar(identidade,{conversaId:conversa,versao:1,idempotencia:randomUUID(),tipo:'template',modeloId:ids[3],variaveis:['Corpo']}),'OPERACAO_MODELO_NAO_APROVADO');
 const h=await enviar(ids[0],['Nome de cabeçalho','Valor de corpo']);conferir(h.conteudo.modeloHash===hashOperacao(contratoModeloOperacao(await linha(ids[0]))));
 await repo.enfileirar(identidade,{conversaId:conversa,versao:1,idempotencia:h.id,tipo:'template',modeloId:ids[0],variaveis:['Nome de cabeçalho','Valor de corpo']});conferir((await tx.query('SELECT count(*)::int n FROM atendimento_operacao.intencao WHERE id=$1',[h.id])).rows[0].n===1);
 process.env.ATENDIMENTO_ENVIO_HABILITADO='true';process.env.ATENDIMENTO_AUTORIDADE_ENVIO='vps';
 conferir((await transportar(h)).estado==='aceito');const hComponentes=(postagens.at(-1)!.template as {components:{type:string;parameters:{text:string}[]}[]}).components;conferir(hComponentes[0].type==='header'&&hComponentes[0].parameters[0].text==='Nome de cabeçalho'&&hComponentes[1].parameters[0].text==='Valor de corpo');
 const url=await enviar(ids[1],['Valor fictício']);conferir((await transportar(url)).estado==='aceito');const urlComponentes=(postagens.at(-1)!.template as {components:{type:string}[]}).components;conferir(urlComponentes.length===1&&urlComponentes[0].type==='body'&&!JSON.stringify(postagens.at(-1)).includes('exemplo.invalid'));
 const quick=await enviar(ids[2],[]);conferir((await transportar(quick)).estado==='aceito');const botoes=(postagens.at(-1)!.template as {components:{index:string;parameters:{payload:string}[]}[]}).components;conferir(botoes[0].index==='0'&&botoes[0].parameters[0].payload==='retorno-ficticio'&&botoes[1].parameters[0].payload==='Não');
 await tx.query("UPDATE atendimento_operacao.modelo SET componentes=jsonb_set(componentes,'{1,text}','\"Corpo alterado {{1}}\"') WHERE id=$1",[ids[0]]);const n=postagens.length;conferir((await transportar(h)).estado==='recusado'&&postagens.length===n);
 let validacoes=0;conferir((await transportar(url,async()=>++validacoes===1)).estado==='recusado'&&postagens.length===n);
 conferir((await importarBibliotecaMeta(isolado,biblioteca)).conflitos===1);conferir((await linha(ids[0])).estado==='META_DIVERGENCIA_REVISAR');
 const natural:string[]=[];const repoEntrada=new RepositorioOperacaoPg(isolado,repo.autorizar,()=> 'operacao','/midia-ensaio',async(_tx,p)=>{conferir(p.tipo==='text');natural.push(p.conteudo);});
 await tx.query("UPDATE atendimento_operacao.contato SET identidade_canal='whatsapp:123456789:5511999990077' WHERE id=$1",[contato]);
 await tx.query("UPDATE atendimento_operacao.conversa SET estado='ia',versao=versao+1 WHERE id=$1",[conversa]);
 const wamid='wamid.fixture-botao-'+randomUUID();const evento={chave:hashOperacao(wamid),tipo:'mensagem' as const,waba:'987654321',numero:'123456789',conteudo:{item:{id:wamid,from:'5511999990077',timestamp:String(Math.floor(Date.now()/1000)),type:'button',button:{text:'Retorno oficial',payload:'encerrar'}}}};
 const recebido=await materializarEventoOperacao(repoEntrada,evento);conferir('mensagemId' in recebido);
 const recebidoLinha=(await tx.query('SELECT autor,tipo,conteudo,metadados FROM atendimento_operacao.mensagem WHERE wamid=$1',[wamid])).rows[0];conferir(recebidoLinha.autor==='cliente'&&recebidoLinha.tipo==='text'&&recebidoLinha.conteudo==='Retorno oficial'&&recebidoLinha.metadados.payloadBotao==='encerrar');
 conferir((await materializarEventoOperacao(repoEntrada,evento)).duplicada&&natural.length===1);conferir((await repo.conversa(tx,conversa)).estado==='ia');
 const wamidInteractive='wamid.fixture-interactive-'+randomUUID();await materializarEventoOperacao(repoEntrada,{...evento,chave:hashOperacao(wamidInteractive),conteudo:{item:{...evento.conteudo.item,id:wamidInteractive,type:'interactive',interactive:{type:'button_reply',button_reply:{id:'transferir',title:'Quero conversar'}}}}});
 conferir(natural.length===2&&natural[1]==='Quero conversar');conferir((await tx.query("SELECT count(*)::int n FROM atendimento_operacao.intencao WHERE conversa_id=$1",[conversa])).rows[0].n===3);

 console.log(JSON.stringify({fase:'formatos_modelos_integrados',provas,cabecalhoCorpoSeparados:true,urlEstaticaSemParametro:true,quickReplyPreservado:true,respostaBotaoNatural:true,botaoDuplicadoIdempotente:true,contratoAlteradoRecusado:true,transportesSimulados,enviosExternos:0,rollbackIsolado:true}));
}finally{await tx.query('ROLLBACK').catch(()=>undefined);tx.release();await pool.end();}
