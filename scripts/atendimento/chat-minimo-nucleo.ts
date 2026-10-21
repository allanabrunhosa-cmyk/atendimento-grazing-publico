import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {ManifestoBackup} from './backup-r2';

export const ALVOS_CHAT_MINIMO=['public.contacts','public.conversations','public.messages','public.conversation_states','public.conversation_activities','public.profiles','public.send_queue','storage.buckets','storage.objects'] as const;
export type AlvoChat=typeof ALVOS_CHAT_MINIMO[number];
export const shaChat=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
export function serializarJsonChat(v:unknown):string{
 const j=JSON as unknown as {isRawJSON?:(v:unknown)=>boolean};if(j.isRawJSON?.(v))return JSON.stringify(v);
 if(Array.isArray(v))return '['+v.map(serializarJsonChat).join(',')+']';
 if(v!==null&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+serializarJsonChat((v as Record<string,unknown>)[k])).join(',')+'}';
 if(v===undefined||typeof v==='number'&&!Number.isFinite(v))throw Error('CHAT_MINIMO_JSON_RECUSADO');return JSON.stringify(v);
}
export function decodificarJsonChat(texto:string):unknown{
 const j=JSON as unknown as {rawJSON?:(s:string)=>unknown;parse:(s:string,r:(k:string,v:unknown,c:{source?:string})=>unknown)=>unknown};
 if(!j.rawJSON)throw Error('CHAT_MINIMO_NODE22_EXIGIDO');return j.parse(texto,(_k,v,c)=>typeof v==='number'?j.rawJSON!(c.source!):v);
}
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/,SHA=/^[a-f0-9]{64}$/;
const exigir=(v:unknown,c:string)=>{if(!v)throw Error('CHAT_MINIMO_'+c);};
const literal=(s:string)=>"'"+s.replaceAll("'","''")+"'";
const lista=ALVOS_CHAT_MINIMO.map(literal).join(',');
export type ResumoTabelaChat={alvo:AlvoChat;registros:number;hashConteudo:string};
export type SnapshotChat={versao:1;tipo:'snapshot-nucleo-chat-v1';janelaId:string;execucao:string;t0:string;tFim:string;isolamento:'repeatable read';entidades:ResumoTabelaChat[];enviosIncertos:number};
export type PaginaChat={alvo:AlvoChat;apos:string|null;proxima:string|null;fim:boolean;registros:{id:string;dados:Record<string,unknown>;sha256:string}[]};
export function validarSnapshotChat(s:SnapshotChat){
 exigir(s?.versao===1&&s.tipo==='snapshot-nucleo-chat-v1'&&UUID.test(s.janelaId)&&UUID.test(s.execucao)&&s.janelaId!==s.execucao&&s.isolamento==='repeatable read'&&Number.isFinite(Date.parse(s.t0))&&Number.isFinite(Date.parse(s.tFim))&&Date.parse(s.tFim)>=Date.parse(s.t0),'SNAPSHOT_RECUSADO');
 exigir(Array.isArray(s.entidades)&&s.entidades.length===ALVOS_CHAT_MINIMO.length&&new Set(s.entidades.map(e=>e.alvo)).size===ALVOS_CHAT_MINIMO.length&&ALVOS_CHAT_MINIMO.every(a=>s.entidades.some(e=>e.alvo===a))&&s.entidades.every(e=>Number.isSafeInteger(e.registros)&&e.registros>=0&&SHA.test(e.hashConteudo))&&Number.isSafeInteger(s.enviosIncertos)&&s.enviosIncertos>=0,'COBERTURA_RECUSADA');
}
export function schemaChat(execucao:string){exigir(UUID.test(execucao),'EXECUCAO_RECUSADA');return 'chat_minimo_'+execucao.replaceAll('-','');}
export function tabelaChat(alvo:AlvoChat){exigir(ALVOS_CHAT_MINIMO.includes(alvo),'ALVO_RECUSADO');return alvo.startsWith('storage.')?alvo.replace('.','_'):alvo.split('.')[1];}
export function marcaSchemaChat(janelaId:string,execucao:string){exigir(UUID.test(janelaId)&&UUID.test(execucao)&&janelaId!==execucao,'EXECUCAO_RECUSADA');return `chat-minimo-v1;janela=${janelaId};execucao=${execucao}`;}
/** Preparação manual do destino: não eleva o coletor no banco nem reutiliza schema. */
export function sqlPrepararSchemaChat(janelaId:string,execucao:string){
 const schema=schemaChat(execucao),marca=marcaSchemaChat(janelaId,execucao);
 return `-- Preparação do destino exclusivo; não aplicar no HUB nem na origem.
BEGIN;
SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='10s';
DO $destino$ BEGIN
 IF current_database() NOT IN ('donatella_preparacao','donatella_ensaio_origem') THEN RAISE EXCEPTION 'CHAT_MINIMO_BANCO_PREPARACAO_RECUSADO'; END IF;
 IF current_user='donatella_coletor' OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='donatella_coletor' AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole) THEN RAISE EXCEPTION 'CHAT_MINIMO_PROVISIONADOR_RECUSADO'; END IF;
END $destino$;
CREATE SCHEMA ${schema};
REVOKE ALL ON SCHEMA ${schema} FROM PUBLIC;
COMMENT ON SCHEMA ${schema} IS ${literal(marca)};
GRANT USAGE,CREATE ON SCHEMA ${schema} TO donatella_coletor;
COMMIT;
`;
}

/** Artefato manual para uma NOVA janela. Somente SELECT no negócio: a fotografia
 * privada usa um único snapshot MVCC e não instala guardas, não modifica filas,
 * cron, regras, tokens ou webhooks. Não comprova exclusividade de emissores.
 */
export function sqlSnapshotChatMinimo(janelaId:string,execucao:string){
 exigir(UUID.test(janelaId)&&UUID.test(execucao)&&janelaId!==execucao,'EXECUCAO_RECUSADA');
 return `-- CORTE MÍNIMO DO CHAT: executar somente na nova janela autorizada.
-- A fotografia é consistente. Mensagens posteriores ao T0 continuam na origem;
-- o intervalo até o callback deve ser registrado e reconciliado depois.
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='2s'; SET LOCAL timezone='UTC';
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('donatella-chat-minimo-snapshot',0));
DO $visibilidade$ BEGIN
 IF to_regprocedure('donatella_migracao.coletor_autorizado()') IS NULL THEN RAISE EXCEPTION 'CHAT_MINIMO_ACESSO_AUSENTE'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(ARRAY[${lista}]) alvo WHERE NOT has_table_privilege(current_user,alvo,'SELECT')) OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_roles r ON r.rolname=current_user WHERE n.nspname||'.'||c.relname IN (${lista}) AND c.relrowsecurity AND NOT(r.rolsuper OR r.rolbypassrls OR(c.relowner=r.oid AND NOT c.relforcerowsecurity))) THEN RAISE EXCEPTION 'CHAT_MINIMO_VISIBILIDADE_INCOMPLETA'; END IF;
END $visibilidade$;
CREATE SCHEMA IF NOT EXISTS donatella_chat_minimo_privado;
REVOKE ALL ON SCHEMA donatella_chat_minimo_privado FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE IF NOT EXISTS donatella_chat_minimo_privado.snapshot(execucao uuid PRIMARY KEY,janela_id uuid NOT NULL,t0 timestamptz NOT NULL,manifesto jsonb);
CREATE TABLE IF NOT EXISTS donatella_chat_minimo_privado.linha(execucao uuid NOT NULL REFERENCES donatella_chat_minimo_privado.snapshot(execucao),alvo text NOT NULL,id text COLLATE "C" NOT NULL,dados jsonb NOT NULL,PRIMARY KEY(execucao,alvo,id));
REVOKE ALL ON ALL TABLES IN SCHEMA donatella_chat_minimo_privado FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO donatella_chat_minimo_privado.snapshot(execucao,janela_id,t0) VALUES(${literal(execucao)}::uuid,${literal(janelaId)}::uuid,transaction_timestamp());
DO $fotografia$ DECLARE alvo text; filtro text; BEGIN
 FOREACH alvo IN ARRAY ARRAY[${lista}] LOOP
  filtro:=CASE WHEN alvo='storage.objects' THEN ' WHERE bucket_id IN (''whatsapp-media'',''audio-messages'')' WHEN alvo='storage.buckets' THEN ' WHERE id IN (''whatsapp-media'',''audio-messages'')' ELSE '' END;
  EXECUTE format('INSERT INTO donatella_chat_minimo_privado.linha(execucao,alvo,id,dados) SELECT $1,$2,id::text,to_jsonb(t) FROM %s t%s',alvo,filtro) USING ${literal(execucao)}::uuid,alvo;
 END LOOP;
END $fotografia$;
UPDATE donatella_chat_minimo_privado.snapshot s SET manifesto=jsonb_build_object('versao',1,'tipo','snapshot-nucleo-chat-v1','janelaId',s.janela_id,'execucao',s.execucao,'t0',s.t0,'tFim',clock_timestamp(),'isolamento',current_setting('transaction_isolation'),'entidades',(SELECT jsonb_agg(jsonb_build_object('alvo',a.alvo,'registros',(SELECT count(*) FROM donatella_chat_minimo_privado.linha l WHERE l.execucao=s.execucao AND l.alvo=a.alvo),'hashConteudo',(SELECT encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(l.dados::text,'UTF8')),'hex'),'|' ORDER BY l.id COLLATE "C"),''),'UTF8')),'hex') FROM donatella_chat_minimo_privado.linha l WHERE l.execucao=s.execucao AND l.alvo=a.alvo)) ORDER BY a.alvo) FROM unnest(ARRAY[${lista}]) a(alvo)),'enviosIncertos',(SELECT count(*) FROM donatella_chat_minimo_privado.linha l WHERE l.execucao=s.execucao AND l.alvo='public.send_queue' AND l.dados->>'status'='processing')) WHERE s.execucao=${literal(execucao)}::uuid;
CREATE OR REPLACE FUNCTION public.donatella_chat_minimo_snapshot(janela uuid,copia uuid,alvo text DEFAULT NULL,apos text DEFAULT NULL,limite integer DEFAULT 250) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $rpc$
DECLARE resultado jsonb; quantidade integer;
BEGIN
 IF NOT donatella_migracao.coletor_autorizado() THEN RAISE EXCEPTION 'COLETOR_NAO_AUTORIZADO' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM donatella_chat_minimo_privado.snapshot s WHERE s.execucao=copia AND s.janela_id=janela AND s.manifesto IS NOT NULL) THEN RAISE EXCEPTION 'CHAT_MINIMO_SNAPSHOT_AUSENTE'; END IF;
 IF alvo IS NULL THEN RETURN(SELECT manifesto FROM donatella_chat_minimo_privado.snapshot WHERE execucao=copia); END IF;
 IF alvo NOT IN (${lista}) OR limite IS NULL OR limite NOT BETWEEN 1 AND 250 OR length(apos)>200 THEN RAISE EXCEPTION 'CHAT_MINIMO_PAGINA_RECUSADA'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'dados',r.dados,'sha256',encode(sha256(convert_to(r.dados::text,'UTF8')),'hex')) ORDER BY r.id COLLATE "C"),'[]'::jsonb) INTO resultado FROM(SELECT l.id,l.dados FROM donatella_chat_minimo_privado.linha l WHERE l.execucao=copia AND l.alvo=donatella_chat_minimo_snapshot.alvo AND(apos IS NULL OR l.id>apos COLLATE "C") ORDER BY l.id COLLATE "C" LIMIT limite) r;
 quantidade:=jsonb_array_length(resultado);
 RETURN jsonb_build_object('alvo',alvo,'apos',apos,'proxima',CASE WHEN quantidade>0 THEN resultado->(quantidade-1)->>'id' ELSE apos END,'fim',quantidade<limite,'registros',resultado);
END $rpc$;
REVOKE ALL ON FUNCTION public.donatella_chat_minimo_snapshot(uuid,uuid,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.donatella_chat_minimo_snapshot(uuid,uuid,text,text,integer) TO service_role;
DO $acesso$ BEGIN IF EXISTS(SELECT 1 FROM donatella_migracao.coletor WHERE fingerprint IS NOT NULL) THEN GRANT EXECUTE ON FUNCTION public.donatella_chat_minimo_snapshot(uuid,uuid,text,text,integer) TO anon; END IF; END $acesso$;
NOTIFY pgrst,'reload schema';
COMMIT;
SELECT manifesto AS snapshot FROM donatella_chat_minimo_privado.snapshot WHERE execucao=${literal(execucao)}::uuid;
`;
}

export function validarPaginaChat(p:PaginaChat,alvo:AlvoChat,apos:string|null){
 exigir(p?.alvo===alvo&&p.apos===apos&&Array.isArray(p.registros)&&p.registros.length<=250&&typeof p.fim==='boolean'&&(p.fim||p.registros.length===250),'PAGINA_RECUSADA');
 let anterior=apos;
 for(const r of p.registros){exigir(typeof r.id==='string'&&r.id.length<=200&&(!anterior||r.id>anterior)&&String(r.dados?.id)===r.id&&SHA.test(r.sha256),'PAGINA_ORDEM_OU_CONTEUDO');anterior=r.id;}
 exigir(p.proxima===anterior,'CURSOR_DIVERGENTE');
}

/** Releitura independente: os hashes das linhas vêm do JSONB efetivamente
 * recebido, e não dos campos sha256 recebidos no mesmo documento. */
export async function conferirPaginaChat(p:PaginaChat,db:PoolClient){
 const dados=serializarJsonChat(p.registros.map(r=>r.dados));
 const r=await db.query<{id:string;sha256:string}>(`SELECT d->>'id' id,encode(sha256(convert_to(d::text,'UTF8')),'hex') sha256 FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY a(d,n) ORDER BY n`,[dados]);
 exigir(r.rows.length===p.registros.length&&r.rows.every((v,i)=>v.id===p.registros[i].id&&v.sha256===p.registros[i].sha256),'CONTEUDO_JSONB_DIVERGENTE');
}

export function conferirCoberturaChat(s:SnapshotChat,paginas:PaginaChat[]){
 validarSnapshotChat(s);
 return ALVOS_CHAT_MINIMO.map(alvo=>{let apos:string|null=null,fim=false,registros=0;const hashes:string[]=[];
  for(const p of paginas.filter(p=>p.alvo===alvo)){exigir(!fim,'PAGINA_APOS_FIM');validarPaginaChat(p,alvo,apos);apos=p.proxima;fim=p.fim;registros+=p.registros.length;hashes.push(...p.registros.map(r=>r.sha256));}
  const hashConteudo=shaChat(hashes.join('|')),e=s.entidades.find(e=>e.alvo===alvo)!;
  exigir(fim&&registros===e.registros&&hashConteudo===e.hashConteudo,'FOTOGRAFIA_INCOMPLETA_OU_DIVERGENTE');return{alvo,registros,hashConteudo};
 });
}

export type ReferenciaChat={arquivo:string;sha256:string};
export function artefatosR2Chat(manifesto:ManifestoBackup,prefixo:string,leituras:Map<string,{sha256:string;bytes:number}>){
 return manifesto.arquivos.flatMap(a=>a.partes.map(p=>{const l=leituras.get(p.chave);exigir(l?.sha256===p.sha256&&l.bytes===p.bytes,'R2_RELEITURA_INCOMPLETA');return{chave:prefixo+'/'+p.chave,sha256:p.sha256,bytes:p.bytes,sha256Lido:l!.sha256,bytesLidos:l!.bytes};}));
}

/** Schema de preparação exclusivo: sem triggers/FKs/jobs herdados e sem tocar
 * no receptor ou no banco operacional. A conclusão depende de conteúdo tipado. */
export async function materializarChatMinimo(s:SnapshotChat,paginas:PaginaChat[],db:PoolClient){
 conferirCoberturaChat(s,paginas);const schema=schemaChat(s.execucao);
 await db.query('BEGIN');try{
  await db.query("SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='60s'; SET LOCAL timezone='UTC'");
  const n=(await db.query("SELECT obj_description(oid,'pg_namespace') marca,has_schema_privilege(current_user,oid,'USAGE') uso,has_schema_privilege(current_user,oid,'CREATE') criar FROM pg_namespace WHERE nspname=$1",[schema])).rows[0];
  exigir(n?.marca===marcaSchemaChat(s.janelaId,s.execucao)&&n.uso===true,'SCHEMA_PREPARADO_EXIGIDO');
  const existentes=(await db.query('SELECT c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 ORDER BY c.relname',[schema])).rows;
  const esperadas=new Set(ALVOS_CHAT_MINIMO.map(tabelaChat));
  exigir(existentes.length===0||existentes.length===esperadas.size&&existentes.every(r=>r.relkind==='r'&&esperadas.has(r.relname)),'SCHEMA_PARCIAL_OU_DIVERGENTE');
  if(!existentes.length){exigir(n.criar===true,'SCHEMA_CRIACAO_NAO_AUTORIZADA');
  for(const alvo of ALVOS_CHAT_MINIMO){const [origem,tabela]=alvo.split('.'),destino=schema+'.'+tabelaChat(alvo);await db.query(`CREATE TABLE ${destino} (LIKE donatella_${origem}.${tabela})`);}
  for(const p of paginas){await conferirPaginaChat(p,db);if(!p.registros.length)continue;const tabela=schema+'.'+tabelaChat(p.alvo),dados=serializarJsonChat(p.registros.map(r=>r.dados));
   // jsonb_populate_record pode ignorar colunas novas; a igualdade impede que isso passe.
   const r=await db.query(`WITH fonte AS(SELECT d FROM jsonb_array_elements($1::jsonb) a(d)) SELECT count(*)::int n FROM fonte WHERE to_jsonb(jsonb_populate_record(NULL::${tabela},d)) IS DISTINCT FROM d`,[dados]);
   exigir(r.rows[0].n===0,'SCHEMA_TIPADO_DIVERGENTE');
   await db.query(`INSERT INTO ${tabela} SELECT * FROM jsonb_populate_recordset(NULL::${tabela},$1::jsonb)`,[dados]);
  }}
  for(const e of s.entidades){const r=await db.query(`SELECT count(*)::int registros,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'|' ORDER BY id::text COLLATE "C"),''),'UTF8')),'hex') hash FROM ${schema}.${tabelaChat(e.alvo)} t`);exigir(r.rows[0].registros===e.registros&&r.rows[0].hash===e.hashConteudo,'MATERIALIZACAO_DIVERGENTE');}
  await db.query('COMMIT');return{schema,entidades:s.entidades,filasHistoricasReprocessadas:0};
 }catch(e){await db.query('ROLLBACK');throw e;}
}
