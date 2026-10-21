-- Manual/aditiva. Preparação do painel; nunca liga a IA nem altera o canal.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
DO $$ BEGIN
 IF current_database() NOT IN ('donatella_operacao','donatella_ensaio_operacao') THEN
  RAISE EXCEPTION 'AGENTE_PAINEL_BANCO_RECUSADO';
 END IF;
END $$;
CREATE TABLE atendimento_operacao.agente_controle (
 empresa_id text PRIMARY KEY,
 ativada_em timestamptz,
 alterada_em timestamptz NOT NULL DEFAULT now(),
 autor_id text NOT NULL,
 configuracao_versao bigint NOT NULL CHECK(configuracao_versao>0)
);
CREATE TABLE atendimento_operacao.agente_teste (
 id uuid PRIMARY KEY,
 empresa_id text NOT NULL,
 autor_id text NOT NULL,
 hash text NOT NULL CHECK(hash ~ '^[a-f0-9]{64}$'),
 configuracao_versao bigint NOT NULL CHECK(configuracao_versao>0),
 estado text NOT NULL CHECK(estado IN ('processando','concluido','apoio','falha','incerto')),
 provedor text NOT NULL CHECK(provedor IN ('anthropic','google','openai')),
 modelo text NOT NULL CHECK(length(modelo) BETWEEN 1 AND 90),
 reserva_centavos bigint NOT NULL CHECK(reserva_centavos>=0),
 resultado jsonb CHECK(resultado IS NULL OR jsonb_typeof(resultado)='object'),
 consumo jsonb CHECK(consumo IS NULL OR jsonb_typeof(consumo)='object'),
 criada_em timestamptz NOT NULL DEFAULT now(),
 concluida_em timestamptz
);
CREATE INDEX agente_teste_empresa ON atendimento_operacao.agente_teste(empresa_id,criada_em);
REVOKE ALL ON atendimento_operacao.agente_controle,atendimento_operacao.agente_teste FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON atendimento_operacao.agente_controle,atendimento_operacao.agente_teste TO donatella_operacao_app;
GRANT SELECT ON atendimento_operacao.agente_controle,atendimento_operacao.agente_teste TO donatella_operacao_backup;
-- O modo persistido existente é preservado. A preparação de produção deve
-- conferir OFF explicitamente antes de liberar a capacidade administrativa.
COMMIT;
