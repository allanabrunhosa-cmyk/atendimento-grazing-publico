import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Pool} from 'pg';
import {RepositorioOperacaoPg,RepositorioEntradaPg,materializarEventoOperacao} from '../../src/lib/atendimento/operacao-repositorio-pg';
import {WorkerOperacao} from '../../src/lib/atendimento/operacao-envio';
import {extrairEventos} from '../../src/lib/atendimento/webhook';
import type {IdentidadeOperacao} from '../../src/lib/atendimento/operacao-tipos';
import {webpFicticio} from './fixtures-midia';
const url=process.env.OPERACAO_BANCO_TESTE,entradaUrl=process.env.ENTRADA_BANCO_TESTE;
if(!url||!entradaUrl)throw Error('ENSAIO_BANCOS_EXIGIDOS');
for(const [u,nome] of [[url,'donatella_ensaio_operacao'],[entradaUrl,'donatella_ensaio_entrada']]){const v=new URL(u);if(v.protocol!=='postgresql:'||decodeURIComponent(v.pathname.slice(1))!==nome||!['127.0.0.1','localhost','donatella-ensaio-operacao-v2','grazing-donatella-operacao-v2-banco'].includes(v.hostname))throw Error('ENSAIO_DESTINO_RECUSADO');}
const pool=new Pool({connectionString:url,max:4}),entradaPool=new Pool({connectionString:entradaUrl,max:2}),i:IdentidadeOperacao={id:'fixture-allan',nome:'Atendente fictício',perfilId:'fixture-atender',sessaoVersao:1,permissoes:['consultar','atender','configurar']};
let revogado=false,modo:'homologacao'|'operacao'='homologacao',assercoes=0;
const midiaDuravel=process.env.OPERACAO_MIDIA_TESTE;
if((process.argv.includes('--anexo-duravel')||process.argv.includes('--anexo-retomada'))&&midiaDuravel!=='/midia-ensaio')throw Error('ENSAIO_MIDIA_DESTINO_RECUSADO');
const repo=new RepositorioOperacaoPg(pool,async(ator,acao)=>!revogado&&ator.id===i.id&&ator.sessaoVersao===1&&ator.permissoes.includes(acao),()=>modo,midiaDuravel??await mkdtemp(join(tmpdir(),'donatella-operacao-')),undefined,undefined,'humano'),entrada=new RepositorioEntradaPg(entradaPool);
const verificar=(ok:unknown)=>{assert.ok(ok);assercoes++;};
const recusa=async(fn:()=>Promise<unknown>,codigo:string)=>{await assert.rejects(fn,new RegExp(codigo));assercoes++;};
try{
 if(process.argv.includes('--anexo-duravel')||process.argv.includes('--anexo-retomada')){
 const contato='cccccccc-0000-4000-a000-000000000001',conversa='cccccccc-0000-4000-a000-000000000002';
 const bytes=Buffer.from('%PDF-1.4\nAnexo fictício durável; nenhum dado real'),hash=createHash('sha256').update(bytes).digest('hex');
 if(process.argv.includes('--anexo-duravel')){
  await pool.query("INSERT INTO atendimento_operacao.contato(id,nome,telefone) VALUES($1,'Anexo fictício durável','5511999990044') ON CONFLICT(id) DO NOTHING",[contato]);
  await pool.query("INSERT INTO atendimento_operacao.conversa(id,contato_id,estado,ficticia,ultima_cliente_em) VALUES($1,$2,'humano',true,now()) ON CONFLICT(id) DO NOTHING",[conversa,contato]);
  const a=await repo.salvarAnexo(i,{conversaId:conversa,nome:'duravel-ficticio.pdf',mime:'application/pdf',base64:bytes.toString('base64'),idempotencia:'cccccccc-0000-4000-a000-000000000003'});
  verificar((await repo.obterAnexo(i,a.id)).bytes.equals(bytes));
 }
 const a=await pool.query('SELECT id,hash,tamanho FROM atendimento_operacao.anexo WHERE conversa_id=$1 AND hash=$2',[conversa,hash]);verificar(a.rowCount===1);
 const recuperado=await repo.obterAnexo(i,a.rows[0].id);verificar(recuperado.bytes.equals(bytes));verificar(createHash('sha256').update(recuperado.bytes).digest('hex')===hash);
 console.log(JSON.stringify({ensaio:process.argv.includes('--anexo-retomada')?'anexo-operacional-retomada':'anexo-operacional-duravel',assercoes,enviosExternos:0,bytes:bytes.length,conteudoVerificado:true}));
 }
 else if(process.argv.includes('--retomada')){const r=await pool.query("SELECT count(*)::integer n FROM atendimento_operacao.nota WHERE texto='Persistir nota fictícia'");verificar(r.rows[0].n===1);verificar((await pool.query("SELECT count(*)::integer n FROM atendimento_operacao.intencao WHERE estado='incerto'")).rows[0].n===1);verificar((await pool.query("SELECT count(*)::integer n FROM atendimento_operacao.auditoria")).rows[0].n>3);console.log(JSON.stringify({ensaio:'operacao-reinicio',assercoes,enviosExternos:0}));}
 else{
 await pool.query(await readFile('scripts/atendimento/sql/025-operacao-destino.sql','utf8'));
 await pool.query(await readFile('scripts/atendimento/sql/036-operacao-mensagem-sticker.sql','utf8'));
 await entradaPool.query(await readFile('scripts/atendimento/sql/026-entrada-duravel-destino.sql','utf8'));
 const contato=randomUUID(),conversa=randomUUID(),real=randomUUID();await pool.query('INSERT INTO atendimento_operacao.contato(id,nome,telefone) VALUES($1,\'Contato fictício\',\'5511999990000\')',[contato]);await pool.query("INSERT INTO atendimento_operacao.conversa(id,contato_id,estado,ficticia,ultima_cliente_em) VALUES($1,$3,'humano',true,now()),($2,$3,'humano',false,now())",[conversa,real,contato]);
 verificar((await repo.listar(i,{pagina:1})).registros.length===2);verificar((await repo.listar(i,{busca:'inexistente'})).registros.length===0);
 await recusa(()=>repo.agir(i,real,{acao:'encerrar',versao:1,idempotencia:randomUUID()}),'SOMENTE_LEITURA');revogado=true;await recusa(()=>repo.listar(i,{}),'ACESSO_NEGADO');revogado=false;
 const rascunho={texto:'Texto persistente fictício',versao:0,idempotencia:randomUUID()};const d=await repo.rascunho(i,conversa,rascunho);verificar(d.versao===1);verificar((await repo.rascunho(i,conversa,rascunho)).versao===1);await recusa(()=>repo.rascunho(i,conversa,{...rascunho,texto:'outra',idempotencia:rascunho.idempotencia}),'IDEMPOTENCIA_DIVERGENTE');await recusa(()=>repo.rascunho(i,conversa,{...rascunho,idempotencia:randomUUID()}),'CONFLITO');
 await repo.agir(i,conversa,{acao:'assumir',versao:1,idempotencia:randomUUID()});const concorrentes=await Promise.allSettled([repo.agir(i,conversa,{acao:'nota',texto:'Persistir nota fictícia',versao:2,idempotencia:randomUUID()}),repo.agir(i,conversa,{acao:'nota',texto:'Persistir nota fictícia',versao:2,idempotencia:randomUUID()})]);verificar(concorrentes.filter(v=>v.status==='fulfilled').length===1);verificar(concorrentes.filter(v=>v.status==='rejected').length===1);
 await repo.agir(i,conversa,{acao:'etiquetas',tags:['Teste','Teste'],versao:3,idempotencia:randomUUID()});verificar((await repo.historico(i,{conversaId:conversa})).conversa.tags instanceof Array);await recusa(()=>repo.agir(i,conversa,{acao:'transferir',responsavelId:'outro',versao:4,idempotencia:randomUUID()},async()=>false),'RESPONSAVEL_RECUSADO');await repo.agir(i,conversa,{acao:'transferir',responsavelId:i.id,equipeId:'fixture-equipe',versao:4,idempotencia:randomUUID()},async()=>true);
 const envio={conversaId:conversa,versao:5,idempotencia:randomUUID(),tipo:'text' as const,texto:'Resposta fictícia'};await repo.enfileirar(i,envio);await repo.enfileirar(i,envio);verificar((await pool.query('SELECT count(*)::integer n FROM atendimento_operacao.intencao')).rows[0].n===1);
 let chamadas=0;const worker=new WorkerOperacao(repo,entrada,async()=>i,{token:'fixture',numeroId:'123456789',versao:'v23.0',autoridade:'nenhuma',enviosHabilitados:false},async()=>{chamadas++;return {estado:'aceito_simulado',wamid:'wamid.fixture-'+randomUUID()};},async()=>{throw Error('ENVIO_EXTERNO_PROIBIDO');});await worker.enviarProximo();await worker.enviarProximo();verificar(chamadas===1);verificar((await repo.historico(i,{conversaId:conversa})).registros[0].estado==='aceito_simulado');
 await repo.enfileirar(i,{...envio,idempotencia:randomUUID(),texto:'Resultado incerto fictício'});const incerto=new WorkerOperacao(repo,entrada,async()=>i,{token:'fixture',numeroId:'123456789',versao:'v23.0',autoridade:'nenhuma',enviosHabilitados:false},async()=>({estado:'incerto',codigo:'META_RESULTADO_DESCONHECIDO'}));await incerto.enviarProximo();await incerto.enviarProximo();verificar((await pool.query("SELECT count(*)::integer n FROM atendimento_operacao.intencao WHERE estado='incerto'")).rows[0].n===1);
 const pdf=Buffer.from('%PDF-1.4\nFictício sem dados reais');const anexo=await repo.salvarAnexo(i,{conversaId:conversa,nome:'ficticio.pdf',mime:'application/pdf',base64:pdf.toString('base64'),idempotencia:randomUUID()});verificar((await repo.obterAnexo(i,anexo.id)).bytes.equals(pdf));await recusa(()=>repo.salvarAnexo(i,{conversaId:conversa,nome:'ativo.pdf',mime:'application/pdf',base64:Buffer.from('<script>alert(1)</script>').toString('base64'),idempotencia:randomUUID()}),'MIDIA_INVALIDA');
 // A CHECK do banco também precisa aceitar sticker: os testes só de transporte
 // não detectam a rejeição da gravação da mensagem antes de chegar ao worker.
 const figurinha=await repo.salvarAnexo(i,{conversaId:conversa,nome:'figurinha-ficticia.webp',mime:'image/webp',base64:webpFicticio.toString('base64'),idempotencia:randomUUID()});
 verificar((await repo.obterAnexo(i,figurinha.id)).bytes.equals(webpFicticio));
 const envioSticker={conversaId:conversa,versao:5,idempotencia:randomUUID(),tipo:'sticker' as const,anexoId:figurinha.id};
 const filaSticker=await repo.enfileirar(i,envioSticker);await repo.enfileirar(i,envioSticker);
 verificar((await pool.query('SELECT count(*)::integer n FROM atendimento_operacao.intencao WHERE id=$1',[envioSticker.idempotencia])).rows[0].n===1);
 verificar((await worker.enviarProximo()).estado==='aceito_simulado');await worker.enviarProximo();verificar(chamadas===2);
 const saidaSticker=(await pool.query('SELECT tipo,autor,anexo_id,estado FROM atendimento_operacao.mensagem WHERE id=$1',[filaSticker.mensagemId])).rows[0];
 verificar(saidaSticker.tipo==='sticker'&&saidaSticker.autor==='humano'&&saidaSticker.anexo_id===figurinha.id&&saidaSticker.estado==='aceito_simulado');
 await recusa(()=>pool.query("INSERT INTO atendimento_operacao.mensagem(id,conversa_id,autor,tipo) VALUES($1,$2,'cliente','tipo_inexistente')",[randomUUID(),conversa]),'mensagem_tipo_check');
 await repo.agir(i,conversa,{acao:'encerrar',versao:5,idempotencia:randomUUID()});await recusa(()=>repo.enfileirar(i,{...envio,versao:6,idempotencia:randomUUID()}),'CONTEXTO_ALTERADO');await repo.agir(i,conversa,{acao:'reabrir',versao:6,idempotencia:randomUUID()});
 const raw=Buffer.from(JSON.stringify({object:'whatsapp_business_account',entry:[{id:'fixture-waba',changes:[{field:'messages',value:{metadata:{phone_number_id:'fixture-numero'},contacts:[{wa_id:'5511999990011',profile:{name:'Webhook fictício'}}],messages:[{id:'wamid.fixture-inbox',from:'5511999990011',timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:'Mensagem recebida fictícia'}}]}}]}]}));const eventos=extrairEventos(raw,{wabas:['fixture-waba'],numeros:['fixture-numero']});const recibo={corpo:raw,hash:createHash('sha256').update(raw).digest('hex'),eventos};await entrada.persistir(recibo);await entrada.persistir(recibo);verificar((await entradaPool.query('SELECT count(*)::integer n FROM atendimento_entrada.recibo')).rows[0].n===1);modo='operacao';await worker.receberProximo();verificar((await pool.query("SELECT count(*)::integer n FROM atendimento_operacao.mensagem WHERE wamid='wamid.fixture-inbox'")).rows[0].n===1);await materializarEventoOperacao(repo,eventos[0]);verificar((await pool.query("SELECT count(*)::integer n FROM atendimento_operacao.mensagem WHERE wamid='wamid.fixture-inbox'")).rows[0].n===1);
 verificar((await entradaPool.query("SELECT count(*)::integer n FROM atendimento_entrada.evento WHERE estado='concluido'")).rows[0].n===1);
 const conversaRecebida=(await pool.query("SELECT c.estado,c.responsavel_id FROM atendimento_operacao.conversa c JOIN atendimento_operacao.mensagem m ON m.conversa_id=c.id WHERE m.wamid='wamid.fixture-inbox'")).rows[0];verificar(conversaRecebida.estado==='humano'&&conversaRecebida.responsavel_id===null);
 const rawSticker=Buffer.from(JSON.stringify({object:'whatsapp_business_account',entry:[{id:'fixture-waba',changes:[{field:'messages',value:{metadata:{phone_number_id:'fixture-numero'},messages:[{id:'wamid.fixture-inbox-sticker',from:'5511999990011',timestamp:String(Math.floor(Date.now()/1000)),type:'sticker',sticker:{id:'123456789012345',mime_type:'image/webp',animated:false}}]}}]}]}));
 const eventosSticker=extrairEventos(rawSticker,{wabas:['fixture-waba'],numeros:['fixture-numero']});
 const reciboSticker={corpo:rawSticker,hash:createHash('sha256').update(rawSticker).digest('hex'),eventos:eventosSticker};
 await entrada.persistir(reciboSticker);await entrada.persistir(reciboSticker);
 verificar((await worker.receberProximo()).estado==='concluido');await materializarEventoOperacao(repo,eventosSticker[0]);
 const stickerRecebido=await pool.query("SELECT tipo,autor,estado,metadados,conversa_id FROM atendimento_operacao.mensagem WHERE wamid='wamid.fixture-inbox-sticker'");
 verificar(stickerRecebido.rowCount===1);
 verificar(stickerRecebido.rows[0].tipo==='sticker'&&stickerRecebido.rows[0].autor==='cliente'&&stickerRecebido.rows[0].estado==='recebido');
 verificar(stickerRecebido.rows[0].metadados.mediaId==='123456789012345'&&stickerRecebido.rows[0].metadados.mime==='image/webp');
 verificar((await repo.historico(i,{conversaId:stickerRecebido.rows[0].conversa_id})).registros.some(m=>m.tipo==='sticker'));
 verificar((await entradaPool.query("SELECT count(*)::integer n FROM atendimento_entrada.evento WHERE estado='concluido'")).rows[0].n===2);
 await recusa(()=>repo.historico(i,{conversaId:conversa,antes:'invalido',id:randomUUID()}),'CURSOR_INVALIDO');
 console.log(JSON.stringify({ensaio:'operacao-integrada-postgresql',assercoes,enviosExternos:0,transporte:'fronteira-simulada',conversasFicticias:true}));
 }
}finally{await pool.end();await entradaPool.end();}
