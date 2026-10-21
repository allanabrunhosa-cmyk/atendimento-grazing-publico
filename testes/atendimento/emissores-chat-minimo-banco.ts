// Executar exclusivamente em contêiner PG novo e isolado, sem rede externa.
import assert from 'node:assert/strict';
import {Pool,type QueryResult} from 'pg';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {CASOS_RETORNO_CHAT,HASH_GUARDA_CONFIG_CHAT,HASH_GUARDA_FILA_CHAT,hashEmissoresChat,prepararRetiradaEmissoresChat,prepararReposicaoEmissoresChat,sqlPreflightEmissoresChat,validarObservacaoEmissoresChat,type ContextoEmissoresChat,type PreflightEmissoresChat,type ObservacaoEmissoresChat,type PortasRetornoChat,type EnsaioEmissoresChat} from '../../scripts/atendimento/emissores-chat-minimo';
if(process.env.DONATELLA_ENSAIO_CHAT_MINIMO!=='1')throw Error('ENSAIO_EMISSORES_AMBIENTE_RECUSADO');
const pool=new Pool({host:'/socket',user:'donatella_receptor_ensaio_admin',database:'donatella_ensaio_origem',max:1});
const casos:EnsaioEmissoresChat['casos']={};let assercoes=0;
function ok(v:unknown){assert.ok(v);assercoes++;}
function caso(k:keyof typeof CASOS_RETORNO_CHAT,v:unknown){assert.equal(v,CASOS_RETORNO_CHAT[k]);assercoes++;casos[k]={verificacoes:1,esperado:CASOS_RETORNO_CHAT[k],observado:v};}
function valor(r:unknown,chave:string){const rs=(Array.isArray(r)?r:[r]) as QueryResult[];const item=rs.findLast(x=>x.rows?.[0]?.[chave]!==undefined);assert.ok(item);return item.rows[0][chave];}
const antigo='token_ficticio_antigo_123456789',novo='token_ficticio_novo_987654321',phone='648633368337527';
const ctx:ContextoEmissoresChat={janelaId:randomUUID(),runtimeSha256:'a'.repeat(64),manifestoSha256:'b'.repeat(64)};
try{
 const db=await pool.connect();try{
  ok((await db.query("SELECT current_database() b,to_regclass('public.nina_settings') t")).rows[0].b==='donatella_ensaio_origem');
  ok((await db.query("SELECT to_regclass('public.nina_settings') t")).rows[0].t===null);
  await db.query(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
   CREATE ROLE leitor_ensaio_emissores;
   CREATE TYPE public.queue_status AS ENUM('pending','processing','completed','failed');
   CREATE TABLE public.nina_settings(id uuid PRIMARY KEY,user_id uuid,whatsapp_phone_number_id text,whatsapp_access_token text,is_active boolean,auto_response_enabled boolean);
   CREATE TABLE public.send_queue(id uuid PRIMARY KEY,status public.queue_status NOT NULL,from_type text NOT NULL,content text,error_message text,priority integer NOT NULL DEFAULT 1,scheduled_at timestamptz,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp());
   CREATE FUNCTION public.claim_send_queue_batch(p_limit integer DEFAULT 20) RETURNS SETOF public.send_queue LANGUAGE plpgsql AS $fn$
   BEGIN RETURN QUERY WITH cte AS (
    SELECT id FROM public.send_queue WHERE status = 'pending' AND(scheduled_at IS NULL OR scheduled_at<=now())
    ORDER BY priority DESC,scheduled_at ASC NULLS FIRST,created_at ASC FOR UPDATE SKIP LOCKED LIMIT p_limit
   ) UPDATE public.send_queue s SET status = 'processing',updated_at=now() WHERE s.id IN(SELECT id FROM cte) RETURNING s.*;
   END $fn$;
   GRANT USAGE ON SCHEMA public TO leitor_ensaio_emissores;GRANT SELECT ON public.nina_settings,public.send_queue TO leitor_ensaio_emissores;`);
  await db.query('INSERT INTO public.nina_settings VALUES($1,$2,$3,$4,true,true)',[randomUUID(),randomUUID(),phone,antigo]);
  for(let i=0;i<4;i++)await db.query("INSERT INTO public.send_queue(id,status,from_type,content) VALUES($1,'processing','nina',$2)",[randomUUID(),'Incerteza fictícia '+i]);
  const pendente=randomUUID();await db.query("INSERT INTO public.send_queue(id,status,from_type,content,priority) VALUES($1,'pending','human','Histórico fictício',999)",[pendente]);
  const processingAntes=(await db.query("SELECT jsonb_agg(to_jsonb(s) ORDER BY id) d FROM public.send_queue s WHERE status='processing'")).rows[0].d;
  await db.query('SET ROLE leitor_ensaio_emissores');const limitado=valor(await db.query(sqlPreflightEmissoresChat()),'preflight') as PreflightEmissoresChat;await db.query('RESET ROLE');
  ok(!limitado.podeAtualizarConfiguracoes&&!limitado.podeGuardarFila);
  const pre=valor(await db.query(sqlPreflightEmissoresChat()),'preflight') as PreflightEmissoresChat;
  const retirada=prepararRetiradaEmissoresChat(ctx,pre);
  const obs=valor(await db.query(retirada.sql),'observacao') as ObservacaoEmissoresChat;validarObservacaoEmissoresChat(obs,ctx,pre);
  caso('retiradaToken',(await db.query("SELECT count(*)::int n FROM public.nina_settings WHERE whatsapp_access_token IS NOT NULL")).rows[0].n);
  caso('processingPreservados',(await db.query("SELECT count(*)::int n FROM public.send_queue WHERE status='processing'")).rows[0].n);
  assert.deepEqual((await db.query("SELECT jsonb_agg(to_jsonb(s) ORDER BY id) d FROM public.send_queue s WHERE status='processing'")).rows[0].d,processingAntes);assercoes++;
  ok(obs.quarentena.processingOriginais===4&&obs.quarentena.registros===5);
  ok((await db.query('SELECT status,error_message FROM public.send_queue WHERE id=$1',[pendente])).rows[0].status==='failed');
  ok((await db.query("SELECT dados->>'status' status FROM donatella_chat_saida_privado.quarentena WHERE id=$1",[pendente])).rows[0].status==='pending');
  caso('claimAntigoBloqueado',(await db.query('SELECT * FROM public.claim_send_queue_batch(1)')).rowCount);
  ok((await db.query("UPDATE public.send_queue SET status='pending' WHERE status='processing'")).rowCount===0);
  caso('deleteQuarentenaBloqueado',(await db.query('DELETE FROM public.send_queue WHERE id=$1',[pendente])).rowCount);
  const bloqueado=randomUUID();await db.query("INSERT INTO public.send_queue(id,status,from_type,content) VALUES($1,'pending','human','Humano antes do retorno')",[bloqueado]);
  ok((await db.query('SELECT status FROM public.send_queue WHERE id=$1',[bloqueado])).rows[0].status==='failed');
  const em=Date.now(),t=(n:number)=>new Date(em+n).toISOString(),h='c'.repeat(64),url='https://ficticio.supabase.co/functions/v1/whatsapp-webhook';
  const gates:PortasRetornoChat={desarme:{concluidoEm:t(-3000),saude:{modo:'receber',autoridade:'nenhuma',enviosReais:false,iaAutomatica:false},enviosEmProcessamento:0},backup:{tipo:'backup-entrada-chat-minimo-verificado-v1',...ctx,criadoEm:t(-2000),concluidoEm:t(-1000),bancoEntrada:'donatella_entrada',bancoOperacao:'donatella_operacao',r2:{releituraIntegral:true,pendencias:0,divergencias:0,artefatos:[{chave:'donatella-v2/ensaio/ficticio',sha256:h,sha256Lido:h,bytes:1,bytesLidos:1}]}},callback:{conferidaEm:t(0),http:200,desafioEnviadoSha256:h,desafioRecebidoSha256:h,url,urlAnteriorConferida:url},credenciais:{tipo:'conferencia-credenciais-chat-minimo-v1',verificadaEm:t(0),vpsAptaLeitura:true,credenciaisIndependentes:true,vps:{fingerprint:hashEmissoresChat(novo),validoNaConferencia:true}}};
  const reposicao=prepararReposicaoEmissoresChat(ctx,pre,obs,gates,novo);
  const volta=valor(await db.query(reposicao.sql),'observacao') as ObservacaoEmissoresChat;validarObservacaoEmissoresChat(volta,ctx,pre,'retorno_humano');
  ok(volta.tokensAtivos[0]===hashEmissoresChat(novo)&&volta.iaAtiva===0);
  let erro='';try{await db.query('UPDATE public.nina_settings SET whatsapp_access_token=$1',[antigo]);}catch(e){erro=(e as Error).message;}
  caso('tokenAntigoRecusado',erro);
  const auto=randomUUID();await db.query("INSERT INTO public.send_queue(id,status,from_type,content,priority) VALUES($1,'pending','nina','Automação fictícia',999)",[auto]);
  caso('claimAutomacaoBloqueado',(await db.query('SELECT * FROM public.claim_send_queue_batch(1)')).rowCount);
  ok((await db.query('SELECT status FROM public.send_queue WHERE id=$1',[auto])).rows[0].status==='failed');
  const humano=randomUUID();await db.query("INSERT INTO public.send_queue(id,status,from_type,content) VALUES($1,'pending','human','Único envio humano fictício')",[humano]);
  const claim=await db.query('SELECT * FROM public.claim_send_queue_batch(1)');caso('claimHumanoNovoPermitido',claim.rowCount);ok(claim.rows[0].id===humano);
  erro='';try{await db.query('UPDATE public.nina_settings SET auto_response_enabled=true');}catch(e){erro=(e as Error).message;}ok(erro==='EMISSORES_CHAT_IA_BLOQUEADA');
  ok((await db.query("SELECT count(*)::int n FROM public.send_queue WHERE status='processing' AND id<>$1",[humano])).rows[0].n===4);
  const prova:EnsaioEmissoresChat={tipo:'ensaio-emissores-chat-minimo-v1',concluidoEm:new Date().toISOString(),ambiente:'ficticio_isolado',banco:'donatella_ensaio_origem',enviosExternos:0,filaSha256:HASH_GUARDA_FILA_CHAT,configuracaoSha256:HASH_GUARDA_CONFIG_CHAT,casos};
  await writeFile('/prova/ensaio-emissores-chat-minimo.json',JSON.stringify({...prova,assercoes,limite:'Portas externas são fixtures; o ensaio comprova somente o SQL em PostgreSQL isolado.'},null,2),{mode:0o600});
  console.log(JSON.stringify({ensaioConcluido:true,assercoes,enviosExternos:0}));
 }finally{db.release();}
}finally{await pool.end();}
