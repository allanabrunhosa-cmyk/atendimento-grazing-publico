-- SOMENTE APÓS AUTORIZAÇÃO. Remove a função privada e apenas seus triggers.
-- Preserva integralmente o outbox; os RPCs ficam bloqueados pela marca de interrupção.
-- Interromper captura cria uma lacuna e impede a virada até nova captura/cópia ensaiada.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
DO $$
DECLARE funcao oid := to_regprocedure('donatella_migracao.capturar()');
BEGIN
  UPDATE donatella_migracao.coletor SET interrompida_em=coalesce(interrompida_em,clock_timestamp()) WHERE id;
  IF funcao IS NULL THEN RETURN; END IF;
  -- Cloud permite TRIGGER em auth/storage, mas o editor não é proprietário dessas
  -- tabelas. Remover a função própria remove os triggers dependentes sem elevar
  -- privilégios. CASCADE só é permitido após validar cada dependência exata.
  IF EXISTS (
    SELECT 1 FROM pg_depend d
    LEFT JOIN pg_trigger t ON d.classid='pg_trigger'::regclass AND t.oid=d.objid
    LEFT JOIN pg_class c ON c.oid=t.tgrelid
    LEFT JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN donatella_migracao.tabela alvo ON alvo.schema_name=n.nspname AND alvo.table_name=c.relname
    WHERE d.refclassid='pg_proc'::regclass AND d.refobjid=funcao
      AND (t.oid IS NULL OR t.tgfoid<>funcao OR t.tgname<>'donatella_migracao_captura' OR alvo.table_name IS NULL)
  ) THEN RAISE EXCEPTION 'Dependência inesperada; parada cancelada'; END IF;
  DROP FUNCTION donatella_migracao.capturar() CASCADE;
END;
$$;
COMMIT;
