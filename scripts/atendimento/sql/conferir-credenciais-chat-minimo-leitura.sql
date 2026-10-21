-- SOMENTE LEITURA. Não revela token, telefone de cliente, conteúdo ou IDs pessoais.
-- Inventário do banco é uma parte da prova: não cobre segredos Edge nem token em memória.
BEGIN READ ONLY;
SET LOCAL statement_timeout='5s';
SET LOCAL lock_timeout='1s';
SET LOCAL search_path=pg_catalog;
WITH visibilidade AS (
 SELECT bool_and(r.rolsuper OR r.rolbypassrls OR (c.relowner=r.oid AND NOT c.relforcerowsecurity)
                 OR NOT c.relrowsecurity) AS integral
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 CROSS JOIN pg_roles r
 WHERE n.nspname='public' AND c.relname IN ('nina_settings','send_queue') AND r.rolname=current_user
), tokens AS (
 SELECT encode(sha256(convert_to(whatsapp_access_token,'UTF8')),'hex') AS fingerprint,
        count(*) AS configuracoes,
        bool_and(whatsapp_phone_number_id='648633368337527') AS mesmo_numero
 FROM public.nina_settings
 WHERE nullif(whatsapp_access_token,'') IS NOT NULL
 GROUP BY whatsapp_access_token
)
SELECT jsonb_build_object(
 'tipo','inventario-credenciais-banco-chat-minimo-v1',
 'conferidaEm',clock_timestamp(),
 'visibilidadeIntegral',(SELECT integral FROM visibilidade),
 'configuracoes',(SELECT count(*) FROM public.nina_settings),
 'tokens',(SELECT coalesce(jsonb_agg(jsonb_build_object('fingerprint',fingerprint,
   'configuracoes',configuracoes,'mesmoNumero',mesmo_numero) ORDER BY fingerprint),'[]'::jsonb) FROM tokens),
 'iaAtiva',(SELECT EXISTS(SELECT 1 FROM public.nina_settings WHERE is_active OR auto_response_enabled)),
 'enviosResultadoIncerto',(SELECT count(*) FROM public.send_queue WHERE status::text='processing'),
 'emissoresSuspensos',false,
 'somenteLeitura',true
) AS conferencia;
ROLLBACK;
