-- Somente após autorização: encerra o acesso temporário, sem apagar outbox.
-- Não muda credenciais já utilizadas pela Donatella nem o service_role.
BEGIN;
REVOKE EXECUTE ON FUNCTION public.donatella_migracao_ler_lote(integer) FROM anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.donatella_migracao_confirmar(uuid[]) FROM anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.donatella_migracao_snapshot(text,text,jsonb,integer) FROM anon,authenticated;
COMMIT;
