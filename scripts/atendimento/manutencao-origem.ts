import {createHash} from 'node:crypto';
import {ALVOS} from './sincronizacao';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const literal=(s:string)=>"'"+s.replaceAll("'","''")+"'";
const lista=ALVOS.map(literal).join(',');
// SELECT/UPDATE isolados não provam que a sessão vê todas as linhas sob RLS.
// A manutenção exige leitura completa da origem e de todos os jobs deste banco.
const leituraCompleta=`NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_roles r ON r.rolname=current_user WHERE (n.nspname||'.'||c.relname IN (${lista}) OR c.oid='cron.job'::regclass) AND c.relrowsecurity AND NOT(r.rolsuper OR r.rolbypassrls OR (c.relowner=r.oid AND NOT c.relforcerowsecurity)))`;
const assinaturaAlterJob='cron.alter_job(bigint,text,text,text,text,boolean)';
const alterarCron=`CASE WHEN to_regprocedure('${assinaturaAlterJob}') IS NOT NULL THEN has_function_privilege(current_user,to_regprocedure('${assinaturaAlterJob}'),'EXECUTE') AND ((SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=current_user) OR NOT EXISTS(SELECT 1 FROM cron.job j WHERE j.database=current_database() AND to_jsonb(j)->>'username' IS DISTINCT FROM current_user)) ELSE false END`;
const resumoCron=`SELECT jsonb_build_object('cronJobs',count(*),'cronHash',md5(coalesce(string_agg(jobid::text||':'||md5(to_jsonb(j)::text),'|' ORDER BY jobid),'')),'podeAlterarCron',has_table_privilege(current_user,'cron.job','UPDATE') OR (${alterarCron}),'cronMecanismo',CASE WHEN (${alterarCron}) THEN 'alter_job' ELSE 'tabela' END) FROM cron.job j WHERE database=current_database()`;
export type PreflightManutencao={versao:1; banco:string; catalogoHash:string; tabelas:number; cronDisponivel:boolean; cronJobs:number; cronHash:string; configuracoes:number;coletorLeituraExistente:boolean;permissoesSuficientes:boolean;podeAlterarCron:boolean;cronMecanismo?:'tabela'|'alter_job'};
export type ObservacaoManutencao={tipo:'manutencao-origem-v2';execucao:string;t0:string;verificadaEm:string;origemSuspensa:boolean;emissoresSuspensos:false;escritoresConferidos:string[];guardas:number;credenciaisDesarmadas:boolean;iaDesarmada:boolean;regrasDesarmadas:boolean;quantidadeRegrasAtivasOriginais:number;regrasAtivasOriginaisHash:string;cronSuspenso:boolean;enviosProcessing:number;enviosProcessingT0:number;sqlFingerprint?:string};

// Hash de drift, sem devolver corpos SQL, defaults, chaves ou registros comerciais.
const catalogo=`WITH alvos AS (SELECT c.oid,n.nspname,c.relname,c.relowner,c.relrowsecurity,c.relforcerowsecurity FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname||'.'||c.relname IN (${lista})), itens AS (
 SELECT nspname||'.'||relname nome,md5(jsonb_build_array(pg_catalog.pg_get_userbyid(relowner),relrowsecurity,relforcerowsecurity,(SELECT jsonb_agg(jsonb_build_array(a.attnum,a.attname,pg_catalog.format_type(a.atttypid,a.atttypmod),a.attnotnull) ORDER BY a.attnum) FROM pg_catalog.pg_attribute a WHERE a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped))::text) hash FROM alvos t
 UNION ALL SELECT n.nspname||'.'||p.proname||'('||pg_catalog.pg_get_function_identity_arguments(p.oid)||')',md5(pg_catalog.pg_get_functiondef(p.oid)) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('claim_send_queue_batch','claim_nina_processing_batch','claim_message_processing_batch')) SELECT md5(string_agg(nome||':'||hash,'|' ORDER BY nome)),(SELECT count(*) FROM alvos) FROM itens`;

export function sqlPreflightManutencao(){return `-- Diagnóstico novo, somente leitura. Não instala manutenção nem chama emissores.
BEGIN READ ONLY; SET LOCAL statement_timeout='10s'; SET LOCAL lock_timeout='1s';
DO $diagnostico$ BEGIN
 IF to_regclass('public.nina_settings') IS NULL OR to_regclass('public.send_queue') IS NULL THEN RAISE EXCEPTION 'MANUTENCAO_ORIGEM_RECUSADA'; END IF;
 IF to_regclass('cron.job') IS NULL THEN RAISE EXCEPTION 'MANUTENCAO_CRON_INDISPONIVEL'; END IF;
END $diagnostico$;
WITH resumo AS (${catalogo}) SELECT jsonb_build_object('versao',1,'banco',current_database(),'catalogoHash',resumo.md5,'tabelas',resumo.count,'cronDisponivel',true,'configuracoes',(SELECT count(*) FROM public.nina_settings),'permissoesSuficientes',has_table_privilege(current_user,'public.nina_settings','UPDATE') AND has_table_privilege(current_user,'public.automation_rules','UPDATE') AND ${leituraCompleta} AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY[${lista}]) alvo WHERE NOT has_table_privilege(current_user,alvo,'SELECT') OR NOT has_table_privilege(current_user,alvo,'TRIGGER')),'coletorLeituraExistente',to_regprocedure('donatella_migracao.coletor_autorizado()') IS NOT NULL AND to_regprocedure('donatella_migracao.chave(jsonb,text[])') IS NOT NULL AND to_regprocedure('donatella_migracao.projetar(text,jsonb)') IS NOT NULL)||(${resumoCron}) AS preflight FROM resumo;
ROLLBACK;
`;}

export function validarPreflightManutencao(p:PreflightManutencao){
 if(p?.versao!==1||typeof p.banco!=='string'||!/^[a-zA-Z0-9_-]{1,63}$/.test(p.banco)||p.tabelas!==37||! /^[a-f0-9]{32}$/.test(p.catalogoHash)||p.cronDisponivel!==true||p.coletorLeituraExistente!==true||p.permissoesSuficientes!==true||p.podeAlterarCron!==true||(p.cronMecanismo!==undefined&&!['tabela','alter_job'].includes(p.cronMecanismo))||!Number.isSafeInteger(p.cronJobs)||p.cronJobs<0||! /^[a-f0-9]{32}$/.test(p.cronHash)||!Number.isSafeInteger(p.configuracoes)||p.configuracoes<1)throw Error('MANUTENCAO_PREFLIGHT_INCOMPLETO');
}
export function sqlPreflightCronManutencao(){return `BEGIN READ ONLY; SET LOCAL statement_timeout='10s'; SELECT (${resumoCron}) AS cron; ROLLBACK;`;}

export function sqlConferenciaManutencao(execucao:string){
 if(!uuid.test(execucao))throw Error('MANUTENCAO_EXECUCAO_RECUSADA');
 return `-- Somente leitura. Exportar apenas este resumo; o estado anterior permanece privado.
BEGIN READ ONLY; SET LOCAL statement_timeout='10s';
WITH guardas AS (SELECT count(*) quantidade FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE t.tgname='donatella_corte_bloquear_escrita' AND t.tgenabled IN ('O','A') AND t.tgfoid=to_regprocedure('donatella_corte_privado.bloquear_escrita()') AND t.tgtype=62 AND t.tgqual IS NULL AND n.nspname||'.'||c.relname IN (${lista})),regras_originais AS (SELECT count(*) quantidade,md5(coalesce(string_agg(id::text||':true',',' ORDER BY id),'')) hash FROM donatella_corte_privado.regras WHERE active)
SELECT jsonb_build_object('tipo','manutencao-origem-v2','execucao',e.execucao,'t0',e.t0,'verificadaEm',clock_timestamp(),'origemSuspensa',e.ativa AND guardas.quantidade=37,'emissoresSuspensos',false,'guardas',guardas.quantidade,'credenciaisDesarmadas',NOT EXISTS(SELECT 1 FROM public.nina_settings WHERE nullif(whatsapp_access_token,'') IS NOT NULL),'iaDesarmada',NOT EXISTS(SELECT 1 FROM public.nina_settings WHERE is_active OR auto_response_enabled),'regrasDesarmadas',NOT EXISTS(SELECT 1 FROM public.automation_rules WHERE active),'quantidadeRegrasAtivasOriginais',regras_originais.quantidade,'regrasAtivasOriginaisHash',regras_originais.hash,'cronSuspenso',NOT EXISTS(SELECT 1 FROM cron.job WHERE database=current_database() AND active),'enviosProcessing',(SELECT count(*) FROM public.send_queue WHERE status::text='processing'),'enviosProcessingT0',(SELECT count(*) FROM donatella_corte_privado.envios_em_curso WHERE execucao=e.execucao),'escritoresConferidos',to_jsonb(ARRAY[${lista},'cron.job','nina_settings.whatsapp_access_token','automation_rules.active'])) AS manutencao
FROM donatella_corte_privado.execucao e CROSS JOIN guardas CROSS JOIN regras_originais WHERE e.execucao=${literal(execucao)}::uuid;
ROLLBACK;`;
}

/** Só gera um artefato manual. Nenhuma conexão, pausa, chamada Meta ou execução SQL. */
export function prepararManutencaoOrigem(p:PreflightManutencao,execucao:string){
 validarPreflightManutencao(p);if(!uuid.test(execucao))throw Error('MANUTENCAO_EXECUCAO_RECUSADA');
 const porApi=p.cronMecanismo==='alter_job';
 const suspenderCron=porApi?`DO $cron$ DECLARE j record; BEGIN FOR j IN SELECT jobid FROM cron.job WHERE database=current_database() AND active LOOP PERFORM cron.alter_job(j.jobid,active:=false); END LOOP; IF EXISTS(SELECT 1 FROM cron.job WHERE database=current_database() AND active) THEN RAISE EXCEPTION 'MANUTENCAO_CRON_NAO_SUSPENSO'; END IF; END $cron$;`:'UPDATE cron.job SET active=false WHERE database=current_database() AND active;';
 const restaurarCron=porApi?`DO $cron$ DECLARE j record; BEGIN FOR j IN SELECT atual.jobid,c.active FROM cron.job atual JOIN donatella_corte_privado.cron c ON c.jobid=atual.jobid WHERE atual.database=current_database() AND to_jsonb(atual)-'active'=c.definicao-'active' LOOP PERFORM cron.alter_job(j.jobid,active:=j.active); END LOOP; END $cron$;`:"UPDATE cron.job j SET active=c.active FROM donatella_corte_privado.cron c WHERE j.jobid=c.jobid AND j.database=current_database() AND to_jsonb(j)-'active'=c.definicao-'active';";
 const sql=`-- PREPARADO PARA O SEGUNDO COMANDO. Não executar na preparação.
-- O bloco é transacional, mantém os dados e não desliga o banco.
-- Token é retirado SOMENTE da configuração da origem, sem revogar o token Meta.
-- Invocações que já carregaram o token precisam ser conferidas após esta etapa.
BEGIN; SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='3s';
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('donatella-corte-programado',0));
DO $preflight$ DECLARE h text; quantidade bigint; cron_h text; BEGIN
 IF current_database()<>${literal(p.banco)} THEN RAISE EXCEPTION 'MANUTENCAO_BANCO_RECUSADO'; END IF;
 IF NOT (${leituraCompleta}) THEN RAISE EXCEPTION 'MANUTENCAO_VISIBILIDADE_INCOMPLETA'; END IF;
 IF NOT (${porApi?alterarCron:"has_table_privilege(current_user,'cron.job','UPDATE')"}) THEN RAISE EXCEPTION 'MANUTENCAO_CRON_PERMISSAO_RECUSADA'; END IF;
 ${catalogo} INTO h,quantidade;
 IF h<>${literal(p.catalogoHash)} OR quantidade<>37 THEN RAISE EXCEPTION 'MANUTENCAO_CATALOGO_ALTERADO'; END IF;
 SELECT md5(coalesce(string_agg(jobid::text||':'||md5(to_jsonb(j)::text),'|' ORDER BY jobid),'')) INTO cron_h FROM cron.job j WHERE database=current_database();
 IF cron_h<>${literal(p.cronHash)} THEN RAISE EXCEPTION 'MANUTENCAO_CRON_ALTERADO'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname='donatella_corte_privado') THEN RAISE EXCEPTION 'MANUTENCAO_EXISTENTE_CONFERIR_ANTES_DE_REPETIR'; END IF;
END $preflight$;
CREATE SCHEMA donatella_corte_privado; REVOKE ALL ON SCHEMA donatella_corte_privado FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE donatella_corte_privado.execucao(execucao uuid PRIMARY KEY,t0 timestamptz NOT NULL,ativa boolean NOT NULL DEFAULT true,catalogo_hash text NOT NULL);
INSERT INTO donatella_corte_privado.execucao(execucao,t0,ativa,catalogo_hash) VALUES(${literal(execucao)}::uuid,clock_timestamp(),false,${literal(p.catalogoHash)});
CREATE FUNCTION donatella_corte_privado.bloquear_escrita() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $guarda$ BEGIN IF EXISTS(SELECT 1 FROM donatella_corte_privado.execucao WHERE ativa) THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='DONATELLA_ORIGEM_EM_MANUTENCAO'; END IF; RETURN NULL; END $guarda$;
REVOKE ALL ON FUNCTION donatella_corte_privado.bloquear_escrita() FROM PUBLIC,anon,authenticated,service_role;
-- CREATE TRIGGER adquire as travas de DDL até COMMIT, aguardando os escritores
-- anteriores. Não requer assumir propriedade de auth/storage ou alterar RLS.
DO $guardas$ DECLARE alvo text; BEGIN FOREACH alvo IN ARRAY ARRAY[${lista}] LOOP
 EXECUTE format('CREATE TRIGGER donatella_corte_bloquear_escrita BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON %s FOR EACH STATEMENT EXECUTE FUNCTION donatella_corte_privado.bloquear_escrita()',alvo);
END LOOP; END $guardas$;
CREATE TABLE donatella_corte_privado.configuracoes AS SELECT id,whatsapp_access_token,is_active,auto_response_enabled FROM public.nina_settings;
CREATE TABLE donatella_corte_privado.regras AS SELECT id,active FROM public.automation_rules;
CREATE TABLE donatella_corte_privado.cron AS SELECT jobid,active,to_jsonb(j) definicao FROM cron.job j WHERE database=current_database();
CREATE TABLE donatella_corte_privado.envios_em_curso AS SELECT ${literal(execucao)}::uuid execucao,id,message_id,status::text status,created_at,updated_at FROM public.send_queue WHERE status::text='processing';
REVOKE ALL ON ALL TABLES IN SCHEMA donatella_corte_privado FROM PUBLIC,anon,authenticated,service_role;
${suspenderCron}
UPDATE public.nina_settings SET whatsapp_access_token=NULL,is_active=false,auto_response_enabled=false;
UPDATE public.automation_rules SET active=false WHERE active;
UPDATE donatella_corte_privado.execucao SET t0=clock_timestamp(),ativa=true WHERE execucao=${literal(execucao)}::uuid;
CREATE FUNCTION public.donatella_migracao_copia_final(corte uuid,esquema text,tabela text,apos jsonb DEFAULT NULL,limite integer DEFAULT 500) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,donatella_migracao AS $copia$
DECLARE colunas text[];ordenacao text;cursor_tipado text;registros jsonb;proxima jsonb;quantidade integer;
BEGIN
 IF NOT donatella_migracao.coletor_autorizado() THEN RAISE EXCEPTION 'COLETOR_NAO_AUTORIZADO' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM donatella_corte_privado.execucao e WHERE e.execucao=corte AND e.ativa) OR (SELECT count(*) FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE t.tgname='donatella_corte_bloquear_escrita' AND t.tgenabled IN ('O','A') AND t.tgfoid=to_regprocedure('donatella_corte_privado.bloquear_escrita()') AND t.tgtype=62 AND t.tgqual IS NULL AND n.nspname||'.'||c.relname IN (${lista}))<>37 THEN RAISE EXCEPTION 'COPIA_FINAL_ORIGEM_NAO_CONGELADA' USING ERRCODE='55000'; END IF;
 IF limite IS NULL OR limite NOT BETWEEN 1 AND 500 OR esquema||'.'||tabela NOT IN (${lista}) THEN RAISE EXCEPTION 'COPIA_FINAL_ALVO_RECUSADO'; END IF;
 colunas:=CASE WHEN esquema='public' AND tabela='contact_cooldowns' THEN ARRAY['contact_phone','rule_id'] ELSE ARRAY['id'] END;
 IF apos IS NOT NULL AND (jsonb_typeof(apos)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(apos))<>cardinality(colunas) OR EXISTS(SELECT 1 FROM unnest(colunas) c WHERE NOT apos?c OR apos->c='null'::jsonb)) THEN RAISE EXCEPTION 'COPIA_FINAL_CURSOR_RECUSADO'; END IF;
 SELECT string_agg(format('t.%I',c),',' ORDER BY ord),string_agg(format('(jsonb_populate_record(NULL::%I.%I,$1)).%I',esquema,tabela,c),',' ORDER BY ord) INTO ordenacao,cursor_tipado FROM unnest(colunas) WITH ORDINALITY u(c,ord);
 EXECUTE format('SELECT coalesce(jsonb_agg(jsonb_build_object(''chave'',donatella_migracao.chave(to_jsonb(p),$3),''dados'',donatella_migracao.projetar($4,to_jsonb(p))) ORDER BY %s),''[]''::jsonb) FROM (SELECT t.* FROM %I.%I t WHERE $1 IS NULL OR ROW(%s)>ROW(%s) ORDER BY %s LIMIT $2) p',replace(ordenacao,'t.','p.'),esquema,tabela,ordenacao,cursor_tipado,ordenacao) INTO registros USING apos,limite,colunas,esquema;
 quantidade:=jsonb_array_length(registros);proxima:=CASE WHEN quantidade>0 THEN registros->(quantidade-1)->'chave' ELSE apos END;
 RETURN jsonb_build_object('schema',esquema,'tabela',tabela,'registros',registros,'proxima',proxima,'fim',quantidade<limite);
END $copia$;
REVOKE ALL ON FUNCTION public.donatella_migracao_copia_final(uuid,text,text,jsonb,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.donatella_migracao_copia_final(uuid,text,text,jsonb,integer) TO service_role;
DO $acesso$ BEGIN IF EXISTS(SELECT 1 FROM donatella_migracao.coletor WHERE fingerprint IS NOT NULL) THEN GRANT EXECUTE ON FUNCTION public.donatella_migracao_copia_final(uuid,text,text,jsonb,integer) TO anon; END IF; END $acesso$;
NOTIFY pgrst, 'reload schema'; -- Publica apenas o contrato RPC final no cache da API.
COMMIT;
${sqlConferenciaManutencao(execucao)}`;
 const sqlFingerprint=createHash('sha256').update(sql).digest('hex');
 const retorno=`-- RETORNO: executar SOMENTE após desarmar a VPS e reconferir callback/itens incertos.
BEGIN; SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='3s';
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('donatella-corte-programado',0));
DO $escopo$ BEGIN IF current_database()<>${literal(p.banco)} OR NOT EXISTS(SELECT 1 FROM donatella_corte_privado.execucao WHERE execucao=${literal(execucao)}::uuid AND ativa) THEN RAISE EXCEPTION 'MANUTENCAO_RETORNO_ESCOPO_RECUSADO'; END IF; END $escopo$;
DO $guardas$ DECLARE funcao oid:=to_regprocedure('donatella_corte_privado.bloquear_escrita()'); BEGIN
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_depend d LEFT JOIN pg_catalog.pg_trigger t ON d.classid='pg_catalog.pg_trigger'::regclass AND t.oid=d.objid LEFT JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid LEFT JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE d.refclassid='pg_catalog.pg_proc'::regclass AND d.refobjid=funcao AND (t.oid IS NULL OR t.tgfoid<>funcao OR t.tgname<>'donatella_corte_bloquear_escrita' OR n.nspname||'.'||c.relname NOT IN (${lista}))) THEN RAISE EXCEPTION 'MANUTENCAO_RETORNO_DEPENDENCIA_INESPERADA'; END IF;
 DROP FUNCTION donatella_corte_privado.bloquear_escrita() CASCADE;
END $guardas$;
DROP FUNCTION public.donatella_migracao_copia_final(uuid,text,text,jsonb,integer);
UPDATE public.nina_settings n SET whatsapp_access_token=c.whatsapp_access_token,is_active=c.is_active,auto_response_enabled=c.auto_response_enabled FROM donatella_corte_privado.configuracoes c WHERE n.id=c.id;
UPDATE public.automation_rules a SET active=r.active FROM donatella_corte_privado.regras r WHERE a.id=r.id;
${restaurarCron}
UPDATE donatella_corte_privado.execucao SET ativa=false WHERE execucao=${literal(execucao)}::uuid;
NOTIFY pgrst, 'reload schema';
COMMIT; -- Não elimina cópias, filas ou registros privados da manutenção.
`;
 return {sql,retorno,conferencia:sqlConferenciaManutencao(execucao),sqlFingerprint,execucao,aplicada:false as const,emissoresSuspensos:false as const};
}

export function validarObservacaoManutencao(o:ObservacaoManutencao){
 if(o?.tipo!=='manutencao-origem-v2'||!uuid.test(o.execucao)||!Number.isFinite(Date.parse(o.t0))||!Number.isFinite(Date.parse(o.verificadaEm))||Date.parse(o.verificadaEm)<Date.parse(o.t0)||o.origemSuspensa!==true||o.guardas!==37||o.credenciaisDesarmadas!==true||o.iaDesarmada!==true||o.regrasDesarmadas!==true||o.cronSuspenso!==true||!Number.isSafeInteger(o.enviosProcessing)||o.enviosProcessing<0||!Number.isSafeInteger(o.enviosProcessingT0)||o.enviosProcessingT0<0||!Array.isArray(o.escritoresConferidos)||ALVOS.some(a=>!o.escritoresConferidos.includes(a)))throw Error('MANUTENCAO_ORIGEM_NAO_CONFERIDA');
 if(!Number.isSafeInteger(o.quantidadeRegrasAtivasOriginais)||o.quantidadeRegrasAtivasOriginais<0||typeof o.regrasAtivasOriginaisHash!=='string'||!/^[a-f0-9]{32}$/.test(o.regrasAtivasOriginaisHash))throw Error('MANUTENCAO_REGRAS_ORIGINAIS_NAO_CONFERIDAS');
 // O resumo SQL não observa rede/processos Edge. Não é prova de fim de envio.
 return {congelamentoBancoConferido:true,emissoresSuspensos:false,enviosIncerto:o.enviosProcessingT0};
}
