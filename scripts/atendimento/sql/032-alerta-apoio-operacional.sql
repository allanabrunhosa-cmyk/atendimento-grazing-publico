-- Manual/aditiva, somente destino operacional dedicado ou ensaio fictício.
-- Não habilita IA, transporte, jobs ou notificações. Sem alterações na origem.
BEGIN;
DO $$ BEGIN IF current_database() NOT IN ('donatella_operacao','donatella_ensaio_operacao') THEN RAISE EXCEPTION 'DESTINO_ALERTA_APOIO_RECUSADO'; END IF; END $$;
CREATE TABLE IF NOT EXISTS atendimento_operacao.alerta_apoio(
 id uuid PRIMARY KEY, empresa_id text NOT NULL, caso_id uuid NOT NULL,
 tarefa_id uuid NOT NULL REFERENCES atendimento_operacao.agente_tarefa(id),
 conversa_origem_id uuid NOT NULL REFERENCES atendimento_operacao.conversa(id), versao_origem bigint NOT NULL CHECK(versao_origem>0),
 estado text NOT NULL DEFAULT 'pendente' CHECK(estado IN ('pendente','enfileirado','cancelado')),
 intencao_id uuid UNIQUE REFERENCES atendimento_operacao.intencao(id), config_hash text CHECK(config_hash ~ '^[a-f0-9]{64}$'), modelo_hash text CHECK(modelo_hash ~ '^[a-f0-9]{64}$'), variaveis jsonb,
 codigo text, proxima_tentativa timestamptz NOT NULL DEFAULT now(), criada_em timestamptz NOT NULL DEFAULT now(), atualizada_em timestamptz NOT NULL DEFAULT now(), enfileirada_em timestamptz,
 UNIQUE(empresa_id,caso_id), FOREIGN KEY(empresa_id,caso_id) REFERENCES atendimento_apoio.casos(empresa_id,id),
 CHECK((estado='enfileirado')=(intencao_id IS NOT NULL AND enfileirada_em IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS alerta_apoio_pendente ON atendimento_operacao.alerta_apoio(empresa_id,proxima_tentativa,criada_em) WHERE estado='pendente';
CREATE INDEX IF NOT EXISTS alerta_apoio_cooldown ON atendimento_operacao.alerta_apoio(empresa_id,conversa_origem_id,enfileirada_em DESC) WHERE estado='enfileirado';
REVOKE ALL ON atendimento_operacao.alerta_apoio FROM PUBLIC;
-- Conceder somente SELECT/INSERT/UPDATE ao serviço operacional existente.
COMMIT;
