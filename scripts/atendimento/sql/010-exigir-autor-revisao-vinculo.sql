-- Correção aditiva da 009 já aplicada somente na preparação privada.
-- CHECK deve recusar NULL explicitamente: condição desconhecida não reprova um CHECK.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='10s';
DO $$ BEGIN IF current_database()<>'donatella_preparacao' THEN RAISE EXCEPTION 'Exige preparação privada'; END IF; END $$;
ALTER TABLE atendimento_identidades.vinculos ADD CONSTRAINT revisao_exige_autor
 CHECK ((revisado_em IS NULL AND revisado_por IS NULL) OR
   (revisado_em IS NOT NULL AND revisado_por IS NOT NULL AND length(revisado_por) BETWEEN 1 AND 100));
COMMIT;
