-- Manual/aditiva. Aplicar após 025 e 019 somente no destino/ensaio dedicado.
-- Nenhuma tarefa é criada para histórico; nenhum fornecedor/job é ativado.
BEGIN;
DO $$ BEGIN IF current_database() NOT IN ('donatella_operacao','donatella_ensaio_operacao') THEN RAISE EXCEPTION 'DESTINO_AGENTE_RECUSADO'; END IF; END $$;
CREATE TABLE IF NOT EXISTS atendimento_operacao.agente_tarefa (
 id uuid PRIMARY KEY, empresa_id text NOT NULL, conversa_id uuid NOT NULL REFERENCES atendimento_operacao.conversa(id),
 mensagem_id uuid NOT NULL UNIQUE REFERENCES atendimento_operacao.mensagem(id), versao_conversa bigint NOT NULL CHECK(versao_conversa>0),
 tarefa jsonb NOT NULL CHECK(jsonb_typeof(tarefa)='object'), hash text NOT NULL CHECK(hash ~ '^[a-f0-9]{64}$'),
 lease uuid, lease_ate timestamptz, chamadas integer NOT NULL DEFAULT 0 CHECK(chamadas BETWEEN 0 AND 20),
 custo_reservado_centavos bigint NOT NULL DEFAULT 0 CHECK(custo_reservado_centavos>=0),
 decisao jsonb CHECK(decisao IS NULL OR jsonb_typeof(decisao)='object'),
 intencao_id uuid REFERENCES atendimento_operacao.intencao(id), emitida_em timestamptz,
 automatico_preparado boolean NOT NULL DEFAULT false,
 midia_estado text NOT NULL DEFAULT 'pendente' CHECK(midia_estado IN ('pendente','processando','concluida','indisponivel')),
 resposta_audio_estado text NOT NULL DEFAULT 'pendente' CHECK(resposta_audio_estado IN ('pendente','processando','concluida','indisponivel')),
 resposta_anexo_id uuid REFERENCES atendimento_operacao.anexo(id),
 criada_em timestamptz NOT NULL DEFAULT now(), atualizada_em timestamptz NOT NULL DEFAULT now(),
 CHECK((lease IS NULL)=(lease_ate IS NULL)),
 CHECK(tarefa->>'id'=id::text AND tarefa->>'empresaId'=empresa_id AND tarefa->>'conversaId'=conversa_id::text AND tarefa->>'mensagemOrigemId'=mensagem_id::text)
);
CREATE INDEX IF NOT EXISTS agente_pendente ON atendimento_operacao.agente_tarefa(criada_em,id) WHERE decisao IS NULL OR decisao->>'estado'='apoio_pendente';
CREATE TABLE IF NOT EXISTS atendimento_operacao.agente_orcamento (
 empresa_id text NOT NULL, dia date NOT NULL, reservado_centavos bigint NOT NULL DEFAULT 0 CHECK(reservado_centavos>=0),
 PRIMARY KEY(empresa_id,dia)
);
CREATE TABLE IF NOT EXISTS atendimento_operacao.agente_evento (
 id uuid PRIMARY KEY, tarefa_id uuid REFERENCES atendimento_operacao.agente_tarefa(id), codigo text NOT NULL CHECK(length(codigo) BETWEEN 1 AND 100),
 em timestamptz NOT NULL DEFAULT now()
);
INSERT INTO atendimento_operacao.configuracao(chave,conteudo) VALUES('agente','{"modo":"desligado","modelo":"","maxTokens":512,"equipeApoio":"apoio","limites":{"maxChamadas":3,"custoPorChamadaCentavos":0,"maxCustoCentavos":0,"maxDuracaoMs":45000,"timeoutChamadaMs":15000},"custoCentavosDia":0,"autoridadeAutomatica":false,"grupoExterno":"indisponivel"}'::jsonb) ON CONFLICT DO NOTHING;
REVOKE ALL ON atendimento_operacao.agente_tarefa,atendimento_operacao.agente_orcamento,atendimento_operacao.agente_evento FROM PUBLIC;
COMMIT;
