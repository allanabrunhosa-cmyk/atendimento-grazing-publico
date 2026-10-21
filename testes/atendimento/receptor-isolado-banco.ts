// Ensaio de banco exclusivo, sem rede, credenciais reais, worker ou inferência.
import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {readFile,open} from 'node:fs/promises';
import {Readable} from 'node:stream';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {Pool} from 'pg';
import {criarHandlerOperacao} from '../../scripts/atendimento/operacao-servidor';
import {RepositorioEntradaPg,RepositorioOperacaoPg,materializarEventoOperacao} from '../../src/lib/atendimento/operacao-repositorio-pg';
import {extrairEventos} from '../../src/lib/atendimento/webhook';

const fase=process.argv[2];
if(process.argv.length!==3||!['--preparar','--retomada'].includes(fase)||process.env.DONATELLA_PROVA_RECEPTOR_ISOLADA!=='1')throw Error('PROVA_RECEPTOR_ARGUMENTO_RECUSADO');
const sha=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const manifest=JSON.parse(await readFile('/release/release.json','utf8'));
const runtimeSha256=sha(await readFile('/release/operacao.mjs'));
assert.equal(runtimeSha256,manifest.runtimeSha256);
assert.equal(sha(await readFile('/release/provas/receptor-isolado.mjs')),manifest.executaveisSha256['provas/receptor-isolado.mjs']);
const conexao={host:'/socket',user:'donatella_receptor_ensaio_admin',max:3,connectionTimeoutMillis:3000,statement_timeout:5000};
const entradaPool=new Pool({...conexao,database:'donatella_ensaio_entrada'});
const operacaoPool=new Pool({...conexao,database:'donatella_ensaio_operacao'});
const readonlyPool=new Pool({...conexao,user:'donatella_receptor_sem_escrita',database:'donatella_ensaio_entrada'});
const entrada=new RepositorioEntradaPg(entradaPool);
const repo=new RepositorioOperacaoPg(operacaoPool,async()=>false,()=> 'homologacao','/midia-inexistente');
const origem='https://receptor-isolado.invalid';
const webhook={appSecret:'segredo-exclusivamente-ficticio',verifyToken:'verificador-ficticio',wabas:['waba-ficticia'],numeros:['numero-ficticio']};
const corpo=Buffer.from(JSON.stringify({object:'whatsapp_business_account',entry:[{id:'waba-ficticia',changes:[{field:'messages',value:{metadata:{phone_number_id:'numero-ficticio'},contacts:[{wa_id:'5511999990088',profile:{name:'Pessoa fictícia do ensaio'}}],messages:[{id:'wamid.receptor-ficticio-texto',from:'5511999990088',timestamp:'1791792000',type:'text',text:{body:'Mensagem fictícia preservada antes do ACK'}},{id:'wamid.receptor-ficticio-audio',from:'5511999990088',timestamp:'1791792001',type:'audio',audio:{id:'123456789',mime_type:'audio/ogg',sha256:'hash-exclusivamente-ficticio'}}]}}]}]}));
const assinatura='sha256='+createHmac('sha256',webhook.appSecret).update(corpo).digest('hex');
let assercoes=0,persistidoAntesAck=false;
const verificar=(valor:unknown)=>{assert.ok(valor,'PROVA_RECEPTOR_ASSERCAO_'+String(assercoes+1));assercoes++;};
function handler(r:RepositorioEntradaPg){return criarHandlerOperacao({repo,entrada:r,webhook,origem,autenticar:async()=>null,conferirCsrf:async()=>false,listarEquipe:async()=>({usuarios:[],equipes:[]})});}
async function requisitar(executar:ReturnType<typeof handler>,assinada=assinatura){
 const req=Readable.from([corpo]) as IncomingMessage;
 req.url='/api/atendimento/webhook';req.method='POST';req.headers={host:'receptor-isolado.invalid','x-hub-signature-256':assinada,'content-length':String(corpo.length)};
 let status=0,encerrou=false;
 const res={setHeader(){},writeHead(s:number){status=s;},end(){encerrou=true;if(status===200)verificar(persistidoAntesAck);}} as unknown as ServerResponse;
 verificar(await executar(req,res));verificar(encerrou);return status;
}
async function estado(){
 const recibos=(await entradaPool.query("SELECT count(*)::int quantidade,md5(string_agg(hash||':'||encode(corpo,'hex'),',' ORDER BY hash)) hash FROM atendimento_entrada.recibo")).rows[0];
 const eventos=(await entradaPool.query("SELECT count(*)::int quantidade,md5(string_agg(chave||':'||conteudo::text,',' ORDER BY chave)) hash FROM atendimento_entrada.evento")).rows[0];
 const mensagens=(await operacaoPool.query("SELECT count(*)::int quantidade,md5(string_agg(wamid||':'||autor||':'||conteudo||':'||tipo||':'||metadados::text,',' ORDER BY wamid)) hash FROM atendimento_operacao.mensagem")).rows[0];
 const intencoes=Number((await operacaoPool.query('SELECT count(*) n FROM atendimento_operacao.intencao')).rows[0].n);
 verificar(intencoes===0);return {recibos,eventos,mensagens,intencoes};
}
async function salvar(nome:string,dados:unknown){const f=await open('/prova/'+nome,'wx',0o600);try{await f.writeFile(JSON.stringify(dados));await f.sync();}finally{await f.close();}}
try{
 for(const [p,n] of [[entradaPool,'donatella_ensaio_entrada'],[operacaoPool,'donatella_ensaio_operacao']] as const)verificar((await p.query('SELECT current_database() nome')).rows[0].nome===n);
 if(fase==='--preparar'){
  for(const [p,nome] of [[operacaoPool,'025-operacao-destino.sql'],[entradaPool,'026-entrada-duravel-destino.sql']] as const){
   const sql=await readFile('/release/sql/'+nome);verificar(sha(sql)===manifest.sqlSha256[nome]);
   verificar(Number((await p.query("SELECT count(*) n FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')")).rows[0].n)===0);
   await p.query(sql.toString());
  }
  await entradaPool.query('CREATE ROLE donatella_receptor_sem_escrita LOGIN; GRANT USAGE ON SCHEMA atendimento_entrada TO donatella_receptor_sem_escrita; GRANT SELECT ON ALL TABLES IN SCHEMA atendimento_entrada TO donatella_receptor_sem_escrita');
  const receptor=handler(entrada);
  verificar(await requisitar(receptor,'sha256='+'0'.repeat(64))===401);
  verificar(Number((await entradaPool.query('SELECT count(*) n FROM atendimento_entrada.recibo')).rows[0].n)===0);
  const persistir=entrada.persistir.bind(entrada);
  entrada.persistir=async recebimento=>{
   await persistir(recebimento);
   // Outra sessão enxerga os bytes/eventos antes de o handler emitir HTTP200.
   const externo=new Pool({...conexao,database:'donatella_ensaio_entrada',max:1});
   try{const r=(await externo.query('SELECT corpo FROM atendimento_entrada.recibo WHERE hash=$1',[sha(corpo)])).rows;
    verificar(r.length===1&&Buffer.from(r[0].corpo).equals(corpo));
    verificar(Number((await externo.query('SELECT count(*) n FROM atendimento_entrada.evento')).rows[0].n)===2);
    persistidoAntesAck=true;
   }finally{await externo.end();}
  };
  verificar(await requisitar(receptor)===200);
  for(const status of await Promise.all([requisitar(receptor),requisitar(receptor),requisitar(receptor)]))verificar(status===200);
  // Falha real de INSERT no banco não produz ACK de sucesso.
  verificar(await requisitar(handler(new RepositorioEntradaPg(readonlyPool)))===503);
  for(const e of extrairEventos(corpo,webhook)){await materializarEventoOperacao(repo,e);await materializarEventoOperacao(repo,e);}
  const dados=await estado();verificar(dados.recibos.quantidade===1&&dados.eventos.quantidade===2&&dados.mensagens.quantidade===2);
  await salvar('antes.json',{runtimeSha256,dados,assercoes,resultados:{assinaturaInvalidaRecusada:true,persistidoAntesAck,repeticaoIdempotente:true,falhaPersistenciaSemAck:true,enviosExternos:0}});
  console.log(JSON.stringify({fase:'antes_reinicio',assercoes,enviosExternos:0}));
 }else{
  const anterior=JSON.parse(await readFile('/prova/antes.json','utf8'));verificar(anterior.runtimeSha256===runtimeSha256);
  assert.deepEqual(await estado(),anterior.dados);assercoes++;
  persistidoAntesAck=true;verificar(await requisitar(handler(entrada))===200);
  for(const e of extrairEventos(corpo,webhook))verificar((await materializarEventoOperacao(repo,e)).duplicada===true);
  assert.deepEqual(await estado(),anterior.dados);assercoes++;
  const prova={versao:1,tipo:'ensaio-receptor-isolado-v1',runtimeSha256,concluidoEm:new Date().toISOString(),banco:'donatella_ensaio_operacao',bancoEntrada:'donatella_ensaio_entrada',resultados:{...anterior.resultados,retomadaAposReinicio:true},assercoes:anterior.assercoes+assercoes,dados:'exclusivamente_ficticios',transporte:'handler_http_local_sem_rede',receptorBundleSha256:manifest.executaveisSha256['provas/receptor-isolado.mjs']};
  await salvar('depois.json',prova);console.log(JSON.stringify(prova));
 }
}finally{await Promise.all([entradaPool.end(),operacaoPool.end(),readonlyPool.end()]);}
