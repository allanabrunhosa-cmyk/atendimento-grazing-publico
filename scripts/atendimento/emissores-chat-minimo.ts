import {createHash} from 'node:crypto';

const PHONE='648633368337527',SCHEMA='donatella_chat_saida_privado';
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/,SHA=/^[a-f0-9]{64}$/;
const q=(s:string)=>"'"+s.replaceAll("'","''")+"'";
export const hashEmissoresChat=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
function exigir(v:unknown,c:string):asserts v{if(!v)throw Error('EMISSORES_CHAT_'+c);}
export type ContextoEmissoresChat={janelaId:string;runtimeSha256:string;manifestoSha256:string};
export type PreflightEmissoresChat={tipo:'preflight-emissores-chat-minimo-v1';conferidaEm:string;banco:string;phoneId:string;configuracoes:{id:string;fingerprint:string}[];configuracoesSha256:string;claimSha256:string;claimCriterioCompativel:boolean;visibilidadeIntegral:boolean;podeAtualizarConfiguracoes:boolean;podeGuardarFila:boolean;podeCriarSchema:boolean;outrosNumerosConfigurados:number};
export type ObservacaoEmissoresChat={tipo:'observacao-emissores-chat-minimo-v1';janelaId:string;conferidaEm:string;fase:'bloqueada'|'retorno_humano';retiradaEm:string;retornoEm:string|null;phoneId:string;configuracoesOriginaisSha256:string;backupConfiguracaoSha256:string;tokensAtivos:string[];iaAtiva:number;quarentena:{registros:number;processingOriginais:number;conteudoSha256:string};guardas:{filaSha256:string;configuracaoSha256:string;triggerFilaAtivo:boolean;triggerConfiguracaoAtivo:boolean};claimSha256:string};
export type ReferenciaEmissoresChat={arquivo:string;sha256:string};
const instante=(s:string)=>{exigir(typeof s==='string'&&Number.isFinite(Date.parse(s)),'DATA_RECUSADA');return Date.parse(s);};
function contexto(c:ContextoEmissoresChat){exigir(UUID.test(c.janelaId)&&SHA.test(c.runtimeSha256)&&SHA.test(c.manifestoSha256),'CONTEXTO_RECUSADO');}
const configuracoesHash=`encode(sha256(convert_to(coalesce((SELECT jsonb_agg(to_jsonb(n) ORDER BY n.id)::text FROM public.nina_settings n WHERE n.whatsapp_phone_number_id='${PHONE}'),'[]'),'UTF8')),'hex')`;
const claimHash=`encode(sha256(convert_to(pg_get_functiondef('public.claim_send_queue_batch(integer)'::regprocedure),'UTF8')),'hex')`;
const visibilidade=`NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.rolname=current_user WHERE n.nspname='public' AND c.relname IN ('nina_settings','send_queue') AND c.relrowsecurity AND NOT(r.rolsuper OR r.rolbypassrls OR(c.relowner=r.oid AND NOT c.relforcerowsecurity)))`;
const podeGuardar=(t:string)=>`has_table_privilege(current_user,'public.${t}','SELECT') AND has_table_privilege(current_user,'public.${t}','UPDATE') AND has_table_privilege(current_user,'public.${t}','TRIGGER') AND EXISTS(SELECT 1 FROM pg_class c JOIN pg_roles r ON r.rolname=current_user WHERE c.oid='public.${t}'::regclass AND(r.rolsuper OR pg_has_role(current_user,c.relowner,'USAGE')))`;

/** Não escreve nem executa o claim. Retorna hashes e permissões do papel da sessão. */
export function sqlPreflightEmissoresChat(){return `BEGIN READ ONLY;
SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='1s'; SET LOCAL search_path=pg_catalog;
SELECT jsonb_build_object('tipo','preflight-emissores-chat-minimo-v1','conferidaEm',clock_timestamp(),'banco',current_database(),'phoneId','${PHONE}',
 'configuracoes',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'fingerprint',encode(sha256(convert_to(whatsapp_access_token,'UTF8')),'hex')) ORDER BY id),'[]') FROM public.nina_settings WHERE whatsapp_phone_number_id='${PHONE}' AND nullif(whatsapp_access_token,'') IS NOT NULL),
 'configuracoesSha256',${configuracoesHash},'claimSha256',${claimHash},
 'claimCriterioCompativel',regexp_replace(pg_get_functiondef('public.claim_send_queue_batch(integer)'::regprocedure),'\\s+',' ','g') LIKE '%WHERE status = ''pending''%' AND regexp_replace(pg_get_functiondef('public.claim_send_queue_batch(integer)'::regprocedure),'\\s+',' ','g') LIKE '%SET status = ''processing''%' AND pg_get_functiondef('public.claim_send_queue_batch(integer)'::regprocedure) LIKE '%RETURNING s.*%',
 'visibilidadeIntegral',${visibilidade},'podeAtualizarConfiguracoes',${podeGuardar('nina_settings')},
 'podeGuardarFila',${podeGuardar('send_queue')},'podeCriarSchema',has_database_privilege(current_user,current_database(),'CREATE'),
 'outrosNumerosConfigurados',(SELECT count(*) FROM public.nina_settings WHERE nullif(whatsapp_access_token,'') IS NOT NULL AND whatsapp_phone_number_id IS DISTINCT FROM '${PHONE}')) AS preflight;
ROLLBACK;
`;}
export function validarPreflightEmissoresChat(p:PreflightEmissoresChat){
 exigir(p?.tipo==='preflight-emissores-chat-minimo-v1'&&p.phoneId===PHONE&&/^[A-Za-z0-9_]{1,63}$/.test(p.banco),'PREFLIGHT_ESCOPO');instante(p.conferidaEm);
 exigir([p.claimSha256,p.configuracoesSha256].every(s=>SHA.test(s))&&p.claimCriterioCompativel&&p.visibilidadeIntegral&&p.podeAtualizarConfiguracoes&&p.podeGuardarFila&&p.podeCriarSchema&&p.outrosNumerosConfigurados===0,'PREFLIGHT_PERMISSOES_OU_CRITERIO');
 exigir(Array.isArray(p.configuracoes)&&p.configuracoes.length>0&&p.configuracoes.length<=50&&new Set(p.configuracoes.map(c=>c.id)).size===p.configuracoes.length&&p.configuracoes.every(c=>UUID.test(c.id)&&SHA.test(c.fingerprint)),'PREFLIGHT_CONFIGURACOES');
}

// O JSON original é preservado. Pendências protegidas ficam fora do claim original
// para não consumir seu LIMIT antes de novas mensagens humanas. processing não é
// retomado: a revogação integral na Meta encerra a autoridade do token já carregado.
export const CORPO_GUARDA_FILA_CHAT=`DECLARE e record; d jsonb; proteger boolean; BEGIN
 SELECT * INTO STRICT e FROM ${SCHEMA}.execucao;
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM ${SCHEMA}.quarentena WHERE id=OLD.id) THEN RETURN NULL; END IF;
  RETURN OLD;
 END IF;
 proteger:=e.fase='bloqueada' OR EXISTS(SELECT 1 FROM ${SCHEMA}.quarentena WHERE id=NEW.id) OR NEW.from_type IS DISTINCT FROM 'human' OR NEW.created_at<e.retorno_em;
 IF proteger THEN
  d:=CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  INSERT INTO ${SCHEMA}.quarentena(id,dados,motivo) VALUES(NEW.id,d,CASE WHEN e.fase='bloqueada' THEN 'CORTE_BLOQUEADO' ELSE 'HISTORICO_OU_AUTOMACAO' END) ON CONFLICT(id) DO NOTHING;
  IF TG_OP='UPDATE' AND NEW.status::text IN ('pending','processing') THEN RETURN NULL; END IF;
  IF TG_OP='INSERT' AND NEW.status::text IN ('pending','processing') THEN NEW.status:='failed'; NEW.error_message:='QUARENTENA_CHAT_MINIMO_SEM_REENVIO'; END IF;
 END IF;
 RETURN NEW;
END;`;
export const CORPO_GUARDA_CONFIG_CHAT=`DECLARE e record; BEGIN
 SELECT * INTO STRICT e FROM ${SCHEMA}.execucao;
 IF NEW.whatsapp_phone_number_id IS DISTINCT FROM e.phone_id AND NOT EXISTS(SELECT 1 FROM ${SCHEMA}.configuracoes WHERE id=NEW.id) THEN RETURN NEW; END IF;
 IF NEW.is_active OR NEW.auto_response_enabled THEN RAISE EXCEPTION 'EMISSORES_CHAT_IA_BLOQUEADA'; END IF;
 IF e.fase='bloqueada' AND nullif(NEW.whatsapp_access_token,'') IS NOT NULL THEN RAISE EXCEPTION 'EMISSORES_CHAT_CREDENCIAL_BLOQUEADA'; END IF;
 IF e.fase='retorno_humano' AND(nullif(NEW.whatsapp_access_token,'') IS NULL OR encode(sha256(convert_to(NEW.whatsapp_access_token,'UTF8')),'hex') IS DISTINCT FROM e.retorno_token_sha) THEN RAISE EXCEPTION 'EMISSORES_CHAT_CREDENCIAL_RETORNO_DIVERGENTE'; END IF;
 RETURN NEW;
END;`;
export const HASH_GUARDA_FILA_CHAT=hashEmissoresChat(CORPO_GUARDA_FILA_CHAT),HASH_GUARDA_CONFIG_CHAT=hashEmissoresChat(CORPO_GUARDA_CONFIG_CHAT);

export function sqlConferenciaEmissoresChat(janelaId:string){exigir(UUID.test(janelaId),'JANELA_RECUSADA');return `BEGIN READ ONLY; SET LOCAL statement_timeout='5s'; SET LOCAL search_path=pg_catalog;
SELECT jsonb_build_object('tipo','observacao-emissores-chat-minimo-v1','janelaId',e.janela_id,'conferidaEm',clock_timestamp(),'fase',e.fase,'retiradaEm',e.retirada_em,'retornoEm',e.retorno_em,'phoneId',e.phone_id,
 'configuracoesOriginaisSha256',e.configuracoes_sha,'backupConfiguracaoSha256',(SELECT encode(sha256(convert_to(jsonb_agg(dados ORDER BY id)::text,'UTF8')),'hex') FROM ${SCHEMA}.configuracoes),
 'tokensAtivos',(SELECT coalesce(jsonb_agg(DISTINCT encode(sha256(convert_to(n.whatsapp_access_token,'UTF8')),'hex')),'[]') FROM public.nina_settings n WHERE n.whatsapp_phone_number_id=e.phone_id AND nullif(n.whatsapp_access_token,'') IS NOT NULL),
 'iaAtiva',(SELECT count(*) FROM public.nina_settings WHERE whatsapp_phone_number_id=e.phone_id AND(is_active OR auto_response_enabled)),
 'quarentena',(SELECT jsonb_build_object('registros',count(*),'processingOriginais',count(*) FILTER(WHERE dados->>'status'='processing'),'conteudoSha256',encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(dados::text,'UTF8')),'hex'),'|' ORDER BY id),''),'UTF8')),'hex')) FROM ${SCHEMA}.quarentena),
 'guardas',jsonb_build_object('filaSha256',(SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='${SCHEMA}.guardar_fila()'::regprocedure),'configuracaoSha256',(SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='${SCHEMA}.guardar_configuracao()'::regprocedure),
 'triggerFilaAtivo',EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.send_queue'::regclass AND tgname='donatella_chat_minimo_guardar_fila' AND tgenabled='A' AND tgtype=31 AND tgfoid='${SCHEMA}.guardar_fila()'::regprocedure),
 'triggerConfiguracaoAtivo',EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.nina_settings'::regclass AND tgname='donatella_chat_minimo_guardar_configuracao' AND tgenabled='A' AND tgtype=23 AND tgfoid='${SCHEMA}.guardar_configuracao()'::regprocedure)),
 'claimSha256',${claimHash}) AS observacao FROM ${SCHEMA}.execucao e WHERE e.janela_id=${q(janelaId)}::uuid;
ROLLBACK;
`;}

export function prepararRetiradaEmissoresChat(c:ContextoEmissoresChat,p:PreflightEmissoresChat){
 contexto(c);validarPreflightEmissoresChat(p);
 const ids=p.configuracoes.map(v=>q(v.id)+'::uuid').join(',');
 const sql=`-- SOMENTE NA NOVA JANELA EXPRESSAMENTE AUTORIZADA. Não revoga Meta nem troca callback.
BEGIN; SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='2s'; SET LOCAL search_path=pg_catalog;
SELECT pg_advisory_xact_lock(hashtextextended('donatella-chat-minimo-emissores',0));
LOCK TABLE public.nina_settings,public.send_queue IN SHARE ROW EXCLUSIVE MODE;
DO $preflight$ BEGIN
 IF current_database()<>${q(p.banco)} OR NOT(${visibilidade}) OR ${claimHash}<>${q(p.claimSha256)} OR ${configuracoesHash}<>${q(p.configuracoesSha256)} THEN RAISE EXCEPTION 'EMISSORES_CHAT_ORIGEM_ALTERADA'; END IF;
 IF to_regnamespace('${SCHEMA}') IS NOT NULL THEN RAISE EXCEPTION 'EMISSORES_CHAT_EXECUCAO_EXISTENTE_CONFERIR'; END IF;
 IF (SELECT count(*) FROM public.nina_settings WHERE whatsapp_phone_number_id='${PHONE}')<>${p.configuracoes.length} OR EXISTS(SELECT 1 FROM public.nina_settings WHERE whatsapp_phone_number_id='${PHONE}' AND id NOT IN (${ids})) THEN RAISE EXCEPTION 'EMISSORES_CHAT_IDS_DIVERGENTES'; END IF;
 IF EXISTS(SELECT 1 FROM public.nina_settings WHERE nullif(whatsapp_access_token,'') IS NOT NULL AND whatsapp_phone_number_id IS DISTINCT FROM '${PHONE}') THEN RAISE EXCEPTION 'EMISSORES_CHAT_OUTRO_NUMERO'; END IF;
END $preflight$;
CREATE SCHEMA ${SCHEMA}; REVOKE ALL ON SCHEMA ${SCHEMA} FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE ${SCHEMA}.execucao(janela_id uuid PRIMARY KEY,phone_id text NOT NULL,fase text NOT NULL CHECK(fase IN('bloqueada','retorno_humano')),retirada_em timestamptz NOT NULL,retorno_em timestamptz,retorno_token_sha text,configuracoes_sha text NOT NULL);
CREATE TABLE ${SCHEMA}.configuracoes(id uuid PRIMARY KEY,dados jsonb NOT NULL);
CREATE TABLE ${SCHEMA}.quarentena(id uuid PRIMARY KEY,dados jsonb NOT NULL,motivo text NOT NULL);
INSERT INTO ${SCHEMA}.configuracoes SELECT id,to_jsonb(n) FROM public.nina_settings n WHERE id IN (${ids});
INSERT INTO ${SCHEMA}.quarentena SELECT id,to_jsonb(s),'HISTORICO_ANTERIOR' FROM public.send_queue s WHERE status::text IN('pending','processing');
INSERT INTO ${SCHEMA}.execucao VALUES(${q(c.janelaId)}::uuid,'${PHONE}','bloqueada',clock_timestamp(),NULL,NULL,${q(p.configuracoesSha256)});
REVOKE ALL ON ALL TABLES IN SCHEMA ${SCHEMA} FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION ${SCHEMA}.guardar_fila() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $guarda$${CORPO_GUARDA_FILA_CHAT}$guarda$;
CREATE FUNCTION ${SCHEMA}.guardar_configuracao() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $guarda$${CORPO_GUARDA_CONFIG_CHAT}$guarda$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ${SCHEMA} FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER donatella_chat_minimo_guardar_fila BEFORE INSERT OR UPDATE OR DELETE ON public.send_queue FOR EACH ROW EXECUTE FUNCTION ${SCHEMA}.guardar_fila();
ALTER TABLE public.send_queue ENABLE ALWAYS TRIGGER donatella_chat_minimo_guardar_fila;
CREATE TRIGGER donatella_chat_minimo_guardar_configuracao BEFORE INSERT OR UPDATE ON public.nina_settings FOR EACH ROW EXECUTE FUNCTION ${SCHEMA}.guardar_configuracao();
ALTER TABLE public.nina_settings ENABLE ALWAYS TRIGGER donatella_chat_minimo_guardar_configuracao;
UPDATE public.send_queue SET status='failed',error_message='QUARENTENA_CHAT_MINIMO_SEM_REENVIO' WHERE status::text='pending';
UPDATE public.nina_settings SET whatsapp_access_token=NULL,is_active=false,auto_response_enabled=false WHERE id IN (${ids});
COMMIT;
${sqlConferenciaEmissoresChat(c.janelaId)}`;
 return {versao:1,tipo:'procedimento-emissores-chat-minimo-v1' as const,...c,phoneId:PHONE,sql,sqlSha256:hashEmissoresChat(sql),filaSha256:HASH_GUARDA_FILA_CHAT,configuracaoSha256:HASH_GUARDA_CONFIG_CHAT,preflightSha256:hashEmissoresChat(JSON.stringify(p)),origemAlterada:false};
}
export function validarObservacaoEmissoresChat(o:ObservacaoEmissoresChat,c:ContextoEmissoresChat,p:PreflightEmissoresChat,fase:'bloqueada'|'retorno_humano'='bloqueada'){
 contexto(c);validarPreflightEmissoresChat(p);
 exigir(o?.tipo==='observacao-emissores-chat-minimo-v1'&&o.janelaId===c.janelaId&&o.phoneId===PHONE&&o.fase===fase&&o.claimSha256===p.claimSha256&&o.configuracoesOriginaisSha256===p.configuracoesSha256&&o.backupConfiguracaoSha256===p.configuracoesSha256,'OBSERVACAO_ESCOPO_DIVERGENTE');
 exigir(instante(o.conferidaEm)>=instante(o.retiradaEm)&&o.iaAtiva===0&&o.guardas.filaSha256===HASH_GUARDA_FILA_CHAT&&o.guardas.configuracaoSha256===HASH_GUARDA_CONFIG_CHAT&&o.guardas.triggerFilaAtivo&&o.guardas.triggerConfiguracaoAtivo,'GUARDAS_OU_IA_NAO_COMPROVADAS');
 exigir(Number.isSafeInteger(o.quarentena.registros)&&o.quarentena.registros>=0&&Number.isSafeInteger(o.quarentena.processingOriginais)&&o.quarentena.processingOriginais>=0&&o.quarentena.processingOriginais<=o.quarentena.registros&&SHA.test(o.quarentena.conteudoSha256),'QUARENTENA_NAO_COMPROVADA');
 exigir(Array.isArray(o.tokensAtivos)&&(fase==='bloqueada'?o.tokensAtivos.length===0&&o.retornoEm===null:o.tokensAtivos.length===1&&SHA.test(o.tokensAtivos[0])&&instante(o.retornoEm!)>=instante(o.retiradaEm)),'CREDENCIAL_ORIGEM_DIVERGENTE');
 return {backupConfiguracaoSha256:o.backupConfiguracaoSha256,quarentena:o.quarentena,guardas:o.guardas};
}

export type PortasRetornoChat={desarme:{concluidoEm:string;saude:{modo:string;autoridade:string;enviosReais:boolean;iaAutomatica:boolean};enviosEmProcessamento:number};backup:{tipo:string;janelaId:string;runtimeSha256:string;manifestoSha256:string;criadoEm:string;concluidoEm:string;bancoEntrada:string;bancoOperacao:string;r2:{releituraIntegral:boolean;pendencias:number;divergencias:number;artefatos:{chave:string;sha256:string;sha256Lido:string;bytes:number;bytesLidos:number}[]}};callback:{conferidaEm:string;http:number;desafioEnviadoSha256:string;desafioRecebidoSha256:string;url:string;urlAnteriorConferida:string};credenciais:{tipo:string;verificadaEm:string;vpsAptaLeitura:boolean;credenciaisIndependentes:boolean;vps:{fingerprint:string;validoNaConferencia:boolean}}};
export function validarPortasRetornoChat(c:ContextoEmissoresChat,g:PortasRetornoChat){
 contexto(c);exigir(g.desarme.saude.modo==='receber'&&g.desarme.saude.autoridade==='nenhuma'&&g.desarme.saude.enviosReais===false&&g.desarme.saude.iaAutomatica===false&&g.desarme.enviosEmProcessamento===0,'VPS_NAO_DESARMADA');
 const b=g.backup;exigir(b.tipo==='backup-entrada-chat-minimo-verificado-v1'&&b.janelaId===c.janelaId&&b.runtimeSha256===c.runtimeSha256&&b.manifestoSha256===c.manifestoSha256&&b.bancoEntrada==='donatella_entrada'&&b.bancoOperacao==='donatella_operacao'&&instante(b.criadoEm)>=instante(g.desarme.concluidoEm)&&instante(b.concluidoEm)>=instante(b.criadoEm),'BACKUP_POSTERIOR_AUSENTE');
 exigir(b.r2.releituraIntegral&&b.r2.pendencias===0&&b.r2.divergencias===0&&b.r2.artefatos.length>0&&b.r2.artefatos.every(a=>a.chave.startsWith('donatella-v2/')&&SHA.test(a.sha256)&&a.sha256===a.sha256Lido&&Number.isSafeInteger(a.bytes)&&a.bytes>0&&a.bytes===a.bytesLidos),'BACKUP_CONTEUDO_NAO_COMPROVADO');
 const u=new URL(g.callback.url);exigir(g.callback.url===g.callback.urlAnteriorConferida&&u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&u.hostname.endsWith('.supabase.co')&&u.pathname==='/functions/v1/whatsapp-webhook'&&g.callback.http===200&&SHA.test(g.callback.desafioEnviadoSha256)&&g.callback.desafioRecebidoSha256===g.callback.desafioEnviadoSha256&&instante(g.callback.conferidaEm)>=instante(g.desarme.concluidoEm),'CALLBACK_RETORNO_NAO_PRONTO');
 exigir(g.credenciais.tipo==='conferencia-credenciais-chat-minimo-v1'&&g.credenciais.vpsAptaLeitura&&g.credenciais.credenciaisIndependentes&&g.credenciais.vps.validoNaConferencia&&SHA.test(g.credenciais.vps.fingerprint)&&instante(g.credenciais.verificadaEm)>=instante(g.desarme.concluidoEm),'CREDENCIAL_RETORNO_NAO_CONFERIDA');
}
/** Artefato PRIVADO: contém a credencial nova. Nunca imprimir ou versionar o SQL. */
export function prepararReposicaoEmissoresChat(c:ContextoEmissoresChat,p:PreflightEmissoresChat,o:ObservacaoEmissoresChat,g:PortasRetornoChat,tokenNovo:string){
 validarObservacaoEmissoresChat(o,c,p);validarPortasRetornoChat(c,g);
 exigir(typeof tokenNovo==='string'&&/^[A-Za-z0-9_-]{20,4096}$/.test(tokenNovo),'CREDENCIAL_RETORNO_RECUSADA');const fingerprint=hashEmissoresChat(tokenNovo);exigir(!p.configuracoes.some(v=>v.fingerprint===fingerprint),'TOKEN_ANTIGO_NAO_RESTAURAVEL');exigir(g.credenciais.vps.fingerprint===fingerprint,'CREDENCIAL_RETORNO_NAO_CONFERIDA');
 const ids=p.configuracoes.map(v=>q(v.id)+'::uuid').join(',');
 const sql=`-- PRIVADO: somente retorno autorizado, VPS já desarmada e backup posterior conferido.
BEGIN; SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='2s'; SET LOCAL search_path=pg_catalog;
SELECT pg_advisory_xact_lock(hashtextextended('donatella-chat-minimo-emissores',0));
LOCK TABLE public.nina_settings,public.send_queue IN SHARE ROW EXCLUSIVE MODE;
DO $preflight$ BEGIN
 IF current_database()<>${q(p.banco)} OR NOT EXISTS(SELECT 1 FROM ${SCHEMA}.execucao WHERE janela_id=${q(c.janelaId)}::uuid AND fase='bloqueada') OR ${claimHash}<>${q(p.claimSha256)} THEN RAISE EXCEPTION 'EMISSORES_CHAT_RETORNO_ESCOPO_DIVERGENTE'; END IF;
 IF EXISTS(SELECT 1 FROM public.nina_settings WHERE whatsapp_phone_number_id='${PHONE}' AND nullif(whatsapp_access_token,'') IS NOT NULL) THEN RAISE EXCEPTION 'EMISSORES_CHAT_ORIGEM_NAO_BLOQUEADA'; END IF;
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='${SCHEMA}.guardar_fila()'::regprocedure) IS DISTINCT FROM '${HASH_GUARDA_FILA_CHAT}' OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='${SCHEMA}.guardar_configuracao()'::regprocedure) IS DISTINCT FROM '${HASH_GUARDA_CONFIG_CHAT}' OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.send_queue'::regclass AND tgname='donatella_chat_minimo_guardar_fila' AND tgenabled='A' AND tgtype=31 AND tgfoid='${SCHEMA}.guardar_fila()'::regprocedure) OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.nina_settings'::regclass AND tgname='donatella_chat_minimo_guardar_configuracao' AND tgenabled='A' AND tgtype=23 AND tgfoid='${SCHEMA}.guardar_configuracao()'::regprocedure) THEN RAISE EXCEPTION 'EMISSORES_CHAT_GUARDAS_ALTERADAS'; END IF;
 IF (SELECT count(*) FROM public.nina_settings WHERE id IN (${ids}) AND whatsapp_phone_number_id='${PHONE}')<>${p.configuracoes.length} OR (SELECT encode(sha256(convert_to(jsonb_agg(dados ORDER BY id)::text,'UTF8')),'hex') FROM ${SCHEMA}.configuracoes) IS DISTINCT FROM ${q(p.configuracoesSha256)} THEN RAISE EXCEPTION 'EMISSORES_CHAT_BACKUP_CONFIGURACAO_DIVERGENTE'; END IF;
END $preflight$;
INSERT INTO ${SCHEMA}.quarentena SELECT id,to_jsonb(s),'ANTERIOR_AO_RETORNO' FROM public.send_queue s WHERE status::text IN('pending','processing') ON CONFLICT(id) DO NOTHING;
UPDATE public.send_queue SET status='failed',error_message='QUARENTENA_CHAT_MINIMO_SEM_REENVIO' WHERE status::text='pending';
UPDATE ${SCHEMA}.execucao SET fase='retorno_humano',retorno_em=clock_timestamp(),retorno_token_sha=${q(fingerprint)} WHERE janela_id=${q(c.janelaId)}::uuid;
UPDATE public.nina_settings n SET whatsapp_access_token=${q(tokenNovo)},is_active=false,auto_response_enabled=false FROM ${SCHEMA}.configuracoes b WHERE n.id=b.id;
COMMIT;
${sqlConferenciaEmissoresChat(c.janelaId)}`;
 return {sql,sqlSha256:hashEmissoresChat(sql),credencialRetornoFingerprint:fingerprint,contemSegredo:true,origemAlterada:false};
}

export type EnsaioEmissoresChat={tipo:'ensaio-emissores-chat-minimo-v1';concluidoEm:string;ambiente:'ficticio_isolado';banco:string;enviosExternos:0;filaSha256:string;configuracaoSha256:string;casos:Record<string,{verificacoes:number;esperado:unknown;observado:unknown}>};
export const CASOS_RETORNO_CHAT={retiradaToken:0,processingPreservados:4,claimAntigoBloqueado:0,claimAutomacaoBloqueado:0,claimHumanoNovoPermitido:1,tokenAntigoRecusado:'EMISSORES_CHAT_CREDENCIAL_RETORNO_DIVERGENTE',deleteQuarentenaBloqueado:0} as const;
export function produzirRetornoPreparadoChat(c:ContextoEmissoresChat,p:PreflightEmissoresChat,o:ObservacaoEmissoresChat,ensaio:EnsaioEmissoresChat,credenciais:{tipo:string;vpsAptaLeitura:boolean;credenciaisIndependentes:boolean;vps:{fingerprint:string;validoNaConferencia:boolean}},refs:{procedimento:ReferenciaEmissoresChat;preflight:ReferenciaEmissoresChat;observacaoRetirada:ReferenciaEmissoresChat;ensaio:ReferenciaEmissoresChat;conferenciaCredenciais:ReferenciaEmissoresChat}){
 validarObservacaoEmissoresChat(o,c,p);exigir(ensaio.tipo==='ensaio-emissores-chat-minimo-v1'&&ensaio.ambiente==='ficticio_isolado'&&ensaio.banco==='donatella_ensaio_origem'&&ensaio.enviosExternos===0&&ensaio.filaSha256===HASH_GUARDA_FILA_CHAT&&ensaio.configuracaoSha256===HASH_GUARDA_CONFIG_CHAT&&Object.entries(CASOS_RETORNO_CHAT).every(([k,v])=>Number.isSafeInteger(ensaio.casos[k]?.verificacoes)&&ensaio.casos[k].verificacoes>0&&ensaio.casos[k].esperado===v&&ensaio.casos[k].observado===v),'ENSAIO_RETORNO_INCOMPLETO');instante(ensaio.concluidoEm);
 exigir(credenciais.tipo==='conferencia-credenciais-chat-minimo-v1'&&credenciais.vpsAptaLeitura&&credenciais.credenciaisIndependentes&&credenciais.vps.validoNaConferencia&&SHA.test(credenciais.vps.fingerprint)&&!p.configuracoes.some(v=>v.fingerprint===credenciais.vps.fingerprint),'CREDENCIAL_INDEPENDENTE_NAO_CONFERIDA');
 exigir(Object.values(refs).every(r=>/^[a-zA-Z0-9._-]{1,160}$/.test(r.arquivo)&&SHA.test(r.sha256)),'REFERENCIAS_RECUSADAS');
 return {versao:1,tipo:'retorno-emissores-chat-minimo-preparado-v1',...c,concluidoEm:new Date().toISOString(),referencias:refs,backupConfiguracaoSha256:o.backupConfiguracaoSha256,credencialRetornoFingerprint:credenciais.vps.fingerprint,guardas:o.guardas,quarentena:o.quarentena,origemContinuaBloqueada:o.tokensAtivos.length===0&&o.fase==='bloqueada',acessoEscritaConfiguracaoOrigemConferido:p.podeAtualizarConfiguracoes&&p.visibilidadeIntegral,exigeDesarmeBackupECallback:true,filasAntigasNuncaReativadas:true};
}
