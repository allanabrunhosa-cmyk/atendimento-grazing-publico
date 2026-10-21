import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {ALVOS_CHAT_MINIMO,conferirCoberturaChat,conferirPaginaChat,materializarChatMinimo,shaChat,sqlSnapshotChatMinimo,sqlPrepararSchemaChat,type SnapshotChat,type PaginaChat} from '../../scripts/atendimento/chat-minimo-nucleo';
import {importarOperacao} from '../../scripts/atendimento/importar-operacao';
import {publicarMidiaChat} from '../../scripts/atendimento/chat-minimo-arquivos';
import {RepositorioOperacaoPg} from '../../src/lib/atendimento/operacao-repositorio-pg';
const fase=process.argv[2];if(process.env.DONATELLA_ENSAIO_CHAT_MINIMO!=='1'||!['--preparar','--retomada'].includes(fase))throw Error('ENSAIO_CHAT_AMBIENTE_RECUSADO');
const s=new Pool({host:'/socket',user:'donatella_receptor_ensaio_admin',database:'donatella_ensaio_origem',max:1}),t=new Pool({host:'/socket',user:'donatella_receptor_ensaio_admin',database:'donatella_ensaio_operacao',max:1});
let assercoes=0;const ok=(v:unknown)=>{assert.ok(v);assercoes++;};
try{
 const c=await s.connect();try{
  if(fase==='--preparar'){
   const ids={janela:randomUUID(),copia:randomUUID(),contato:randomUUID(),conversa:randomUUID(),mensagem:randomUUID(),resposta:randomUUID(),fila:randomUUID(),perfil:randomUUID(),objeto:randomUUID()};
   await c.query(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA storage;CREATE SCHEMA donatella_migracao;CREATE SCHEMA donatella_public;CREATE SCHEMA donatella_storage;CREATE SCHEMA atendimento_migracao;
    CREATE FUNCTION donatella_migracao.coletor_autorizado() RETURNS boolean LANGUAGE sql AS 'SELECT true';CREATE TABLE donatella_migracao.coletor(fingerprint text);INSERT INTO donatella_migracao.coletor VALUES('fixture');
    CREATE TABLE public.contacts(id uuid PRIMARY KEY,name text,last_name text,phone_number text,whatsapp_id text,email text,tags text[],notes text,client_memory jsonb,created_at timestamptz,updated_at timestamptz);
    CREATE TABLE public.conversations(id uuid PRIMARY KEY,contact_id uuid,status text,is_active boolean,assigned_user_id text,assigned_team text,tags text[],queue text,created_at timestamptz,started_at timestamptz,last_message_at timestamptz);
    CREATE TABLE public.messages(id uuid PRIMARY KEY,conversation_id uuid,reply_to_id uuid,whatsapp_message_id text,from_type text,type text,content text,status text,metadata jsonb,created_at timestamptz,sent_at timestamptz,delivered_at timestamptz,read_at timestamptz,media_url text,media_type text);
    CREATE TABLE public.conversation_states(id uuid PRIMARY KEY,conversation_id uuid,state jsonb);CREATE TABLE public.conversation_activities(id uuid PRIMARY KEY,conversation_id uuid,activity jsonb);
    CREATE TABLE public.profiles(id uuid PRIMARY KEY,user_id uuid,full_name text);CREATE TABLE public.send_queue(id uuid PRIMARY KEY,message_id uuid,status text);
    CREATE TABLE storage.buckets(id text PRIMARY KEY);CREATE TABLE storage.objects(id uuid PRIMARY KEY,bucket_id text,name text,metadata jsonb,updated_at timestamptz,version text);
    CREATE TABLE atendimento_migracao.arquivo_versao(objeto_id uuid,bucket text,nome text,etag text,arquivo text,sha256 text,bytes bigint);`);
   const em='2026-10-12T12:20:00.123456Z',bytes=Buffer.from('arquivo fictício, sem cliente'),hash=shaChat(bytes),etag='"'+'a'.repeat(32)+'"';
   await c.query("INSERT INTO public.contacts VALUES($1,'Contato fictício',NULL,'5511999990000','5511999990000',NULL,'{}','fictício','{}',$2,$2)",[ids.contato,em]);
   await c.query("INSERT INTO public.conversations VALUES($1,$2,'human',true,$3,NULL,'{}','novos',$4,$4,$4)",[ids.conversa,ids.contato,ids.perfil,em]);
   await c.query("INSERT INTO public.profiles VALUES($1,$1,'Autor fictício')",[ids.perfil]);
   await c.query("INSERT INTO public.messages(id,conversation_id,from_type,type,content,status,metadata,created_at,sent_at,media_url,media_type,whatsapp_message_id) VALUES($1,$2,'user','document','Pergunta fictícia','sent','{}',$3,$3,'https://fixture.invalid/storage/v1/object/public/whatsapp-media/fixture.txt','text/plain','wamid-fixture-1')",[ids.mensagem,ids.conversa,em]);
   await c.query("INSERT INTO public.messages(id,conversation_id,reply_to_id,from_type,type,content,status,metadata,created_at,sent_at,whatsapp_message_id) VALUES($1,$2,$3,'human','text','Resposta fictícia 😀','read',$4,$5,$5,'wamid-fixture-2')",[ids.resposta,ids.conversa,ids.mensagem,JSON.stringify({sender_id:ids.perfil}),em]);
   await c.query("INSERT INTO public.send_queue VALUES($1,$2,'processing')",[ids.fila,ids.resposta]);
   await c.query("INSERT INTO public.conversation_states VALUES($1,$2,'{\"pendente\":true}')",[randomUUID(),ids.conversa]);
   await c.query("INSERT INTO storage.buckets VALUES('whatsapp-media'),('backup-excluido')");await c.query("INSERT INTO storage.objects VALUES($1,'whatsapp-media','fixture.txt',$2,$3,NULL)",[ids.objeto,JSON.stringify({eTag:etag,size:bytes.length,mimetype:'text/plain'}),em]);
   for(const alvo of ALVOS_CHAT_MINIMO){const [sc,ta]=alvo.split('.');await c.query(`CREATE TABLE donatella_${sc}.${ta}(LIKE ${alvo})`);}
   await c.query(sqlSnapshotChatMinimo(ids.janela,ids.copia));
   const snap=(await c.query('SELECT public.donatella_chat_minimo_snapshot($1,$2) d',[ids.janela,ids.copia])).rows[0].d as SnapshotChat;
   ok(snap.isolamento==='repeatable read'&&snap.enviosIncertos===1&&snap.entidades.length===9);
   // Escrita posterior fictícia não modifica a fotografia. Não congela emissor ou regra.
   await c.query("UPDATE public.messages SET content='Alteração fictícia posterior' WHERE id=$1",[ids.mensagem]);
   const paginas:PaginaChat[]=[];for(const alvo of ALVOS_CHAT_MINIMO){const p=(await c.query('SELECT public.donatella_chat_minimo_snapshot($1,$2,$3) d',[ids.janela,ids.copia,alvo])).rows[0].d as PaginaChat;await conferirPaginaChat(p,c);paginas.push(p);}
   ok(paginas.find(p=>p.alvo==='public.messages')!.registros.find(r=>r.id===ids.mensagem)!.dados.content==='Pergunta fictícia');
   ok(paginas.find(p=>p.alvo==='storage.buckets')!.registros.length===1);
   ok(conferirCoberturaChat(snap,paginas).length===9);
   await c.query('CREATE ROLE donatella_coletor NOSUPERUSER NOCREATEDB NOCREATEROLE; GRANT USAGE ON SCHEMA donatella_public,donatella_storage,atendimento_migracao TO donatella_coletor; GRANT SELECT ON ALL TABLES IN SCHEMA donatella_public,donatella_storage,atendimento_migracao TO donatella_coletor');
   await c.query(sqlPrepararSchemaChat(ids.janela,ids.copia));await c.query('SET ROLE donatella_coletor');
   ok((await c.query("SELECT has_database_privilege(current_user,current_database(),'CREATE') permitida")).rows[0].permitida===false);
   const material=await materializarChatMinimo(snap,paginas,c);ok(material.filasHistoricasReprocessadas===0);
   // Retomada relê conteúdo, sem DROP/DELETE/recriação nem duplicar linhas.
   await materializarChatMinimo(snap,paginas,c);
   await c.query('RESET ROLE');
   await t.query(await readFile('/release/sql/025-operacao-destino.sql','utf8'));await t.query(await readFile('/release/sql/029-proveniencia-importacao-operacao.sql','utf8'));
   await mkdir('/prova/midia');await mkdir('/prova/cas');await publicarMidiaChat('/prova/cas',hash,bytes);await writeFile('/prova/midia/'+hash+'.bin',bytes);await writeFile('/prova/indice.json',JSON.stringify({'whatsapp-media/fixture.txt':[{arquivo:hash+'.bin',sha256:hash,bytes:bytes.length,metadata:{eTag:etag}}]}));
   const config={origemDatabaseUrl:'',destinoDatabaseUrl:'',origemStorageURL:'https://fixture.invalid',phoneNumberId:'123456789',usuariosRevisados:{},equipesRevisadas:{},manifestoInicial:'/prova/indice.json',midiaLegadaRaiz:'/prova/midia',midiaIncrementalRaiz:'/prova/midia',marcador:snap.t0,idImportacao:'chat-fixture-'+ids.copia,nucleoChat:{schema:material.schema}};
   c.release();const r=await importarOperacao(config,{origem:s,destino:t});
   ok(r.enviosExternos===0&&r.entidades.mensagem.verificados===2&&r.arquivos.conteudosVerificados===1&&Object.keys(r.entidades).sort().join(',')==='anexo,contato,conversa,mensagem');
   const anexo=(await t.query('SELECT id FROM atendimento_operacao.anexo')).rows[0];
   const repo=new RepositorioOperacaoPg(t,async()=>true,()=> 'homologacao','/prova/cas',undefined,async()=>{throw Error('LEGADO_NAO_DEVE_SER_NECESSARIO');});
   ok((await repo.obterAnexo({id:'ficticio',nome:'Fictício',perfilId:'teste',sessaoVersao:1,permissoes:['consultar']},anexo.id)).bytes.equals(bytes));
   const msg=(await t.query('SELECT * FROM atendimento_operacao.mensagem WHERE id=$1',[ids.resposta])).rows[0];ok(msg.autor_id==='origem:'+ids.perfil&&msg.metadados.origemAutorNome==='Autor fictício'&&msg.citada_id===ids.mensagem&&msg.estado==='lido');
   await t.query("UPDATE atendimento_operacao.mensagem SET conteudo='Alteração humana fictícia posterior',importada=false WHERE id=$1",[ids.mensagem]);
   const segundo=await importarOperacao({...config,idImportacao:config.idImportacao+'-retomada'},{origem:s,destino:t});ok(segundo.entidades.mensagem.preservados===1);
   ok((await t.query('SELECT count(*)::int n FROM atendimento_operacao.intencao')).rows[0].n===0);ok((await t.query('SELECT count(*)::int n FROM atendimento_operacao.timer')).rows[0].n===0);
   await writeFile('/prova/antes.json',JSON.stringify({ids,config,anexoId:anexo.id,hashMidia:hash,assercoes,conteudoReal:false,enviosExternos:0}));
  }else{
   const antes=JSON.parse(await readFile('/prova/antes.json','utf8'));c.release();
   const r=await importarOperacao({...antes.config,idImportacao:antes.config.idImportacao+'-reinicio'},{origem:s,destino:t});
   ok(r.entidades.mensagem.preservados===1&&r.enviosExternos===0);
   const q=await t.query('SELECT conteudo FROM atendimento_operacao.mensagem WHERE id=$1',[antes.ids.mensagem]);ok(q.rows[0].conteudo==='Alteração humana fictícia posterior');
   ok((await t.query('SELECT count(*)::int n FROM atendimento_operacao.mensagem')).rows[0].n===2);ok((await t.query('SELECT count(*)::int n FROM atendimento_operacao.intencao')).rows[0].n===0);
   const repo=new RepositorioOperacaoPg(t,async()=>true,()=> 'homologacao','/prova/cas',undefined,async()=>{throw Error('LEGADO_NAO_DEVE_SER_NECESSARIO');});
   ok(shaChat((await repo.obterAnexo({id:'ficticio',nome:'Fictício',perfilId:'teste',sessaoVersao:1,permissoes:['consultar']},antes.anexoId)).bytes)===antes.hashMidia);
   await writeFile('/prova/depois.json',JSON.stringify({tipo:'ensaio-chat-minimo-nucleo-v1',concluidoEm:new Date().toISOString(),assercoes:assercoes+antes.assercoes,conteudoReal:false,enviosExternos:0,snapshotConsistente:true,escopoNoveEntidades:true,conteudoTipadoConferido:true,retomadaAposReinicio:true,novasEscritasPreservadas:true,filasHistoricasReprocessadas:0,schemaRestritoSemCreateBanco:true,anexoImportadoCasAposReinicio:true}));
  }
 }catch(e){try{c.release();}catch{}throw e;}
 console.log(JSON.stringify({fase,assercoes,enviosExternos:0}));
}finally{await s.end();await t.end();}
