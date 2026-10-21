-- Acesso explícito à homologação, sem herdar roles/privilégios da Donatella ou do HUB.
BEGIN;
DO $$ BEGIN IF current_database()<>'donatella_preparacao' THEN RAISE EXCEPTION 'Destino recusado'; END IF; END $$;
CREATE TABLE atendimento_identidades.acessos_homologacao (
 hub_usuario_id text PRIMARY KEY,
 somente_leitura boolean NOT NULL CHECK(somente_leitura),
 ativo boolean NOT NULL,
 versao integer NOT NULL CHECK(versao>0),
 revisado_em timestamptz NOT NULL,
 revisado_por text NOT NULL CHECK(length(revisado_por) BETWEEN 1 AND 100)
);
REVOKE ALL ON atendimento_identidades.acessos_homologacao FROM PUBLIC;
CREATE TRIGGER auditar_acesso_homologacao AFTER INSERT OR UPDATE OR DELETE ON atendimento_identidades.acessos_homologacao FOR EACH ROW EXECUTE FUNCTION atendimento_identidades.auditar();
GRANT USAGE ON SCHEMA atendimento_identidades TO donatella_consulta;
GRANT SELECT ON atendimento_identidades.acessos_homologacao TO donatella_consulta;
REVOKE SELECT ON donatella_public.contacts,donatella_public.conversations,donatella_public.messages,donatella_public.profiles,donatella_storage.objects FROM donatella_consulta;
GRANT SELECT(id,name,last_name,phone_number,email,last_activity) ON donatella_public.contacts TO donatella_consulta;
GRANT SELECT(id,contact_id,status,is_active,last_message_at,assigned_team,assigned_user_id) ON donatella_public.conversations TO donatella_consulta;
GRANT SELECT(id,user_id,full_name) ON donatella_public.profiles TO donatella_consulta;
GRANT SELECT(id,conversation_id,from_type,type,content,created_at,sent_at,status,media_url) ON donatella_public.messages TO donatella_consulta;
GRANT SELECT(id,bucket_id,name,metadata,archived_at,is_delete_marker) ON donatella_storage.objects TO donatella_consulta;
COMMIT;
