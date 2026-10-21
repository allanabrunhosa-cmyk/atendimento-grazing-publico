-- Manual/aditiva. Amplia somente os tipos aceitos para figurinhas oficiais.
-- Aplicar uma vez no destino dedicado; não executar no HUB nem na origem.
-- A troca da CHECK é atômica e preserva todos os tipos e registros anteriores.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $$ BEGIN
 IF current_database() NOT IN ('donatella_operacao','donatella_ensaio_operacao') THEN
  RAISE EXCEPTION 'OPERACAO_STICKER_BANCO_RECUSADO';
 END IF;
END $$;
ALTER TABLE atendimento_operacao.mensagem
 DROP CONSTRAINT mensagem_tipo_check,
 ADD CONSTRAINT mensagem_tipo_check
 CHECK(tipo IN ('text','image','audio','document','video','sticker','template','unsupported'));
COMMIT;
