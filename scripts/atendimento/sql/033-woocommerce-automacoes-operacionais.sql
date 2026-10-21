-- Manual/aditiva, somente destino dedicado ou ensaio fictício.
-- Preserva regras/estado; não importa filas, não instala callback e não envia.
BEGIN;
DO $$ BEGIN IF current_database() NOT IN ('donatella_operacao','donatella_ensaio_operacao') THEN RAISE EXCEPTION 'DESTINO_WOO_AUTOMACOES_RECUSADO'; END IF; END $$;
ALTER TABLE atendimento_operacao.mensagem DROP CONSTRAINT IF EXISTS mensagem_autor_check;
ALTER TABLE atendimento_operacao.mensagem ADD CONSTRAINT mensagem_autor_check CHECK(autor IN ('cliente','humano','ia','automacao'));
CREATE TABLE IF NOT EXISTS atendimento_operacao.woo_regra(
 empresa_id text NOT NULL,id uuid NOT NULL,modelo_id text NOT NULL REFERENCES atendimento_operacao.modelo(id),
 conteudo jsonb NOT NULL,origem jsonb NOT NULL,hash text NOT NULL CHECK(hash ~ '^[a-f0-9]{64}$'),origem_hash text NOT NULL CHECK(origem_hash ~ '^[a-f0-9]{64}$'),
 versao bigint NOT NULL DEFAULT 1 CHECK(versao>0),importada_em timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(empresa_id,id)
);
CREATE TABLE IF NOT EXISTS atendimento_operacao.woo_pedido(
 empresa_id text NOT NULL,external_id text NOT NULL CHECK(external_id ~ '^[0-9]{1,20}$'),status text NOT NULL,ultimo_status_processado text,
 conteudo jsonb NOT NULL,modificado_em timestamptz,versao bigint NOT NULL DEFAULT 1 CHECK(versao>0),importado boolean NOT NULL DEFAULT true,
 ultimo_evento_id uuid,atualizado_em timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(empresa_id,external_id)
);
CREATE TABLE IF NOT EXISTS atendimento_operacao.woo_evento(
 id uuid PRIMARY KEY,empresa_id text NOT NULL,webhook_id text NOT NULL,delivery_id text NOT NULL,topic text NOT NULL CHECK(topic IN ('order.created','order.updated')),
 external_id text NOT NULL,payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),raw bytea NOT NULL CHECK(octet_length(raw)<=1048576),
 estado text NOT NULL CHECK(estado IN ('processado','antigo')),status_anterior text,recebido_em timestamptz NOT NULL DEFAULT now(),
 UNIQUE(empresa_id,webhook_id,delivery_id),UNIQUE(empresa_id,topic,external_id,payload_hash)
);
CREATE TABLE IF NOT EXISTS atendimento_operacao.woo_execucao(
 id uuid PRIMARY KEY,empresa_id text NOT NULL,regra_id uuid NOT NULL,external_id text NOT NULL,event_id uuid NOT NULL REFERENCES atendimento_operacao.woo_evento(id),
 target_signature text NOT NULL,regra_hash text NOT NULL CHECK(regra_hash ~ '^[a-f0-9]{64}$'),payload jsonb NOT NULL,status_agendado text NOT NULL,
 executar_em timestamptz NOT NULL,proxima_tentativa timestamptz NOT NULL DEFAULT now(),estado text NOT NULL DEFAULT 'pendente' CHECK(estado IN ('pendente','enfileirada','cancelada')),
 codigo text,intencao_id uuid UNIQUE REFERENCES atendimento_operacao.intencao(id),modelo_hash text,config_hash text,variaveis jsonb,telefone text,
 criada_em timestamptz NOT NULL DEFAULT now(),atualizada_em timestamptz NOT NULL DEFAULT now(),enfileirada_em timestamptz,
 FOREIGN KEY(empresa_id,regra_id) REFERENCES atendimento_operacao.woo_regra(empresa_id,id),FOREIGN KEY(empresa_id,external_id) REFERENCES atendimento_operacao.woo_pedido(empresa_id,external_id),
 UNIQUE(empresa_id,regra_id,external_id,target_signature)
);
CREATE INDEX IF NOT EXISTS woo_execucao_pendente ON atendimento_operacao.woo_execucao(empresa_id,executar_em,proxima_tentativa) WHERE estado='pendente';
CREATE INDEX IF NOT EXISTS woo_execucao_pedido ON atendimento_operacao.woo_execucao(empresa_id,external_id);
REVOKE ALL ON atendimento_operacao.woo_regra,atendimento_operacao.woo_pedido,atendimento_operacao.woo_evento,atendimento_operacao.woo_execucao FROM PUBLIC;
-- Serviço existente recebe somente SELECT/INSERT/UPDATE; importador não despacha.
COMMIT;
