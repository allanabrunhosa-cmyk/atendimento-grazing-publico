-- Manual/aditiva. Preserva identidades, telefones, mensagens e intenções existentes.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
DO $$ BEGIN
 IF current_database() NOT IN ('donatella_operacao','donatella_ensaio_operacao') THEN RAISE EXCEPTION 'OPERACAO_CONTATOS_BANCO_RECUSADO'; END IF;
END $$;
ALTER TABLE atendimento_operacao.contato ADD COLUMN IF NOT EXISTS descricao varchar(200) NOT NULL DEFAULT '';
ALTER TABLE atendimento_operacao.contato ADD COLUMN IF NOT EXISTS classificacao text NOT NULL DEFAULT 'lead' CHECK(classificacao IN ('cliente','lead'));
ALTER TABLE atendimento_operacao.contato ADD COLUMN IF NOT EXISTS versao bigint NOT NULL DEFAULT 1 CHECK(versao>0);
CREATE INDEX IF NOT EXISTS woo_pedido_cliente_confirmado ON atendimento_operacao.woo_pedido(contato_id) WHERE contato_id IS NOT NULL AND status IN ('processing','completed');
ALTER TABLE atendimento_operacao.modelo ADD COLUMN IF NOT EXISTS categoria text;
ALTER TABLE atendimento_operacao.modelo ADD COLUMN IF NOT EXISTS versao bigint NOT NULL DEFAULT 1 CHECK(versao>0);
CREATE TABLE IF NOT EXISTS atendimento_operacao.template_comando (
 id uuid PRIMARY KEY, autor_id text NOT NULL, hash text NOT NULL CHECK(hash ~ '^[a-f0-9]{64}$'),
 alvo text NOT NULL, acao text NOT NULL CHECK(acao IN ('criar','editar','excluir')),
 pedido jsonb NOT NULL, anterior jsonb, estado text NOT NULL CHECK(estado IN ('processando','concluido','recusado','incerto')),
 resultado jsonb, criada_em timestamptz NOT NULL DEFAULT now(), atualizada_em timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS template_comando_em_curso ON atendimento_operacao.template_comando(alvo) WHERE estado IN ('processando','incerto');
REVOKE ALL ON atendimento_operacao.template_comando FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON atendimento_operacao.template_comando TO donatella_operacao_app;
GRANT SELECT ON atendimento_operacao.template_comando TO donatella_operacao_backup;
COMMIT;
