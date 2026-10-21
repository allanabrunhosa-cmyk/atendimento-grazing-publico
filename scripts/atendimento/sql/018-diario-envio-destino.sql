-- Somente destino operacional futuro ou banco ficticio de ensaio. Sem jobs/envios.
BEGIN;
DO $$ BEGIN IF current_database() NOT IN ('donatella_operacao','donatella_ensaio_envio') THEN RAISE EXCEPTION 'DESTINO_ENVIO_RECUSADO'; END IF; END $$;
CREATE SCHEMA atendimento_operacao;
CREATE TABLE atendimento_operacao.intencao_envio (
 id uuid PRIMARY KEY,
 hash_pedido text NOT NULL CHECK(hash_pedido ~ '^[a-f0-9]{64}$'),
 hub_usuario_id text NOT NULL CHECK(length(hub_usuario_id) BETWEEN 1 AND 100),
 origem_usuario_id uuid NOT NULL,
 conversa_id uuid NOT NULL,
 estado text NOT NULL DEFAULT 'iniciado' CHECK(estado IN ('iniciado','aceito','recusado','incerto')),
 wamid text CHECK(length(wamid) BETWEEN 7 AND 512),
 http smallint CHECK(http BETWEEN 400 AND 499),
 codigo bigint CHECK(codigo>0),
 criada_em timestamptz NOT NULL DEFAULT now(),
 concluida_em timestamptz,
 CHECK((estado='aceito')=(wamid IS NOT NULL)),
 CHECK((estado='recusado')=(http IS NOT NULL AND codigo IS NOT NULL)),
 CHECK((estado='iniciado')=(concluida_em IS NULL))
);
CREATE UNIQUE INDEX intencao_envio_wamid ON atendimento_operacao.intencao_envio(wamid) WHERE wamid IS NOT NULL;
CREATE INDEX intencao_envio_reconciliar ON atendimento_operacao.intencao_envio(criada_em,id) WHERE estado IN ('iniciado','incerto');
REVOKE ALL ON SCHEMA atendimento_operacao FROM PUBLIC;
REVOKE ALL ON atendimento_operacao.intencao_envio FROM PUBLIC;
-- Grants para o servico futuro dependem da revisao de identidade/autoridade.
COMMIT;
