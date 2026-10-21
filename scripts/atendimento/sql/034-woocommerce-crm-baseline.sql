-- Aditiva: quatro ações CRM em uso e configuração original anterior ao freeze.
-- Não importa filas nem executa automações. Aplicar depois de 033.
BEGIN;
DO $$ BEGIN
 IF current_database() NOT IN ('donatella_operacao','donatella_ensaio_operacao') THEN
  RAISE EXCEPTION 'WOO_CRM_BANCO_RECUSADO';
 END IF;
END $$;
ALTER TABLE atendimento_operacao.woo_pedido ADD COLUMN contato_origem_id uuid;
ALTER TABLE atendimento_operacao.woo_pedido ADD COLUMN contato_id uuid REFERENCES atendimento_operacao.contato(id);
CREATE TABLE atendimento_operacao.woo_baseline (
 empresa_id text PRIMARY KEY, id uuid NOT NULL UNIQUE, conteudo jsonb NOT NULL,
 hash text NOT NULL CHECK(hash ~ '^[a-f0-9]{64}$'),
 ativas_hash text NOT NULL CHECK(ativas_hash ~ '^[a-f0-9]{32}$'),
 quantidade_ativas integer NOT NULL CHECK(quantidade_ativas>=0), capturada_em timestamptz NOT NULL
);
CREATE TABLE atendimento_operacao.woo_crm_regra (
 empresa_id text NOT NULL, id uuid NOT NULL, etapa_id uuid NOT NULL REFERENCES atendimento_operacao.etapa(id),
 conteudo jsonb NOT NULL, origem jsonb NOT NULL, hash text NOT NULL CHECK(hash ~ '^[a-f0-9]{64}$'),
 origem_hash text NOT NULL CHECK(origem_hash ~ '^[a-f0-9]{64}$'), versao bigint NOT NULL DEFAULT 1,
 importada_em timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(empresa_id,id)
);
CREATE TABLE atendimento_operacao.woo_crm_execucao (
 id uuid PRIMARY KEY, empresa_id text NOT NULL, regra_id uuid NOT NULL, external_id text NOT NULL,
 event_id uuid NOT NULL REFERENCES atendimento_operacao.woo_evento(id), target_signature text NOT NULL,
 regra_hash text NOT NULL CHECK(regra_hash ~ '^[a-f0-9]{64}$'), payload jsonb NOT NULL, executar_em timestamptz NOT NULL,
 estado text NOT NULL DEFAULT 'pendente' CHECK(estado IN ('pendente','aplicada','cancelada','ignorada')),
 codigo text, negocio_id uuid REFERENCES atendimento_operacao.negocio(id), etapa_id uuid REFERENCES atendimento_operacao.etapa(id),
 aplicada_em timestamptz, atualizada_em timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(empresa_id,regra_id) REFERENCES atendimento_operacao.woo_crm_regra(empresa_id,id),
 FOREIGN KEY(empresa_id,external_id) REFERENCES atendimento_operacao.woo_pedido(empresa_id,external_id),
 UNIQUE(empresa_id,regra_id,external_id,target_signature)
);
CREATE INDEX woo_crm_execucao_pendente_idx ON atendimento_operacao.woo_crm_execucao(empresa_id,executar_em,id) WHERE estado='pendente';
REVOKE ALL ON atendimento_operacao.woo_baseline,atendimento_operacao.woo_crm_regra,atendimento_operacao.woo_crm_execucao FROM PUBLIC;
COMMIT;
