-- MANUAL ADITIVO: somente destino dedicado futuro ou ensaio FICTICIO.
-- Nao executar no banco HUB, na origem Lovable ou como efeito de importar historia.
-- Sem jobs, triggers de envio, contas, membros/grupos ou grants automaticos.
BEGIN;
DO $$ BEGIN
  IF current_database() NOT IN ('donatella_operacao','donatella_ensaio_duvidas') THEN
    RAISE EXCEPTION 'DESTINO_DUVIDAS_RECUSADO';
  END IF;
END $$;
CREATE SCHEMA atendimento_apoio;
CREATE TABLE atendimento_apoio.casos (
  empresa_id text NOT NULL CHECK(length(empresa_id) BETWEEN 1 AND 128),
  id uuid NOT NULL,
  revisao bigint NOT NULL CHECK(revisao > 0),
  conteudo jsonb NOT NULL CHECK(jsonb_typeof(conteudo)='object' AND conteudo->>'id'=id::text AND conteudo->>'empresaId'=empresa_id),
  atualizada_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(empresa_id,id),
  CHECK(conteudo->>'codigo' ~ '^#DNT-[A-Z2-9]{6}$'),
  CHECK(conteudo->>'dedupe' ~ '^[a-f0-9]{64}$')
);
CREATE UNIQUE INDEX apoio_codigo_exclusivo ON atendimento_apoio.casos((conteudo->>'codigo'));
-- dedupe inclui empresa/conversa/versaoConversa/revisaoRegras/pergunta normalizada.
-- Indice NAO exclusivo: historico encerrado/vencido e novas versoes coexistem;
-- a transacao do servico reutiliza apenas um caso vigente do mesmo contexto.
CREATE INDEX apoio_caso_dedupe ON atendimento_apoio.casos(empresa_id,(conteudo->>'dedupe'),atualizada_em DESC);
CREATE INDEX apoio_caso_espera ON atendimento_apoio.casos(empresa_id,(conteudo->>'estado'),(conteudo->>'expiraEm'));
CREATE TABLE atendimento_apoio.respostas (
  empresa_id text NOT NULL,
  id uuid NOT NULL,
  revisao bigint NOT NULL CHECK(revisao > 0),
  conteudo jsonb NOT NULL CHECK(jsonb_typeof(conteudo)='object' AND conteudo->>'id'=id::text AND conteudo->>'empresaId'=empresa_id),
  atualizada_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(empresa_id,id),
  CHECK(conteudo->>'dedupe' ~ '^[a-f0-9]{64}$')
);
CREATE UNIQUE INDEX apoio_resposta_dedupe ON atendimento_apoio.respostas(empresa_id,(conteudo->>'dedupe'));
CREATE TABLE atendimento_apoio.candidatos (
  empresa_id text NOT NULL,
  id uuid NOT NULL,
  revisao bigint NOT NULL CHECK(revisao > 0),
  conteudo jsonb NOT NULL CHECK(jsonb_typeof(conteudo)='object' AND conteudo->>'id'=id::text AND conteudo->>'empresaId'=empresa_id),
  atualizada_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(empresa_id,id),
  CHECK(conteudo->>'fingerprint' ~ '^[a-f0-9]{64}$'),
  CHECK(jsonb_typeof(conteudo->'versoes')='array' AND jsonb_array_length(conteudo->'versoes') > 0)
);
CREATE UNIQUE INDEX apoio_candidato_dedupe ON atendimento_apoio.candidatos(empresa_id,(conteudo->>'fingerprint'));
CREATE TABLE atendimento_apoio.revisoes (
  empresa_id text NOT NULL,
  colecao text NOT NULL CHECK(colecao IN ('casos','respostas','candidatos')),
  entidade_id uuid NOT NULL,
  revisao bigint NOT NULL CHECK(revisao > 0),
  conteudo jsonb NOT NULL,
  criada_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(empresa_id,colecao,entidade_id,revisao)
);
CREATE TABLE atendimento_apoio.auditoria (
  empresa_id text NOT NULL,
  id uuid NOT NULL,
  ator_id text NOT NULL,
  entidade_id uuid NOT NULL,
  acao text NOT NULL CHECK(length(acao) BETWEEN 1 AND 80),
  revisao bigint NOT NULL CHECK(revisao > 0),
  em timestamptz NOT NULL,
  motivo text CHECK(length(motivo) <= 1000),
  PRIMARY KEY(empresa_id,id)
);
CREATE TABLE atendimento_apoio.catalogo (
  empresa_id text PRIMARY KEY,
  epoca bigint NOT NULL DEFAULT 0 CHECK(epoca >= 0)
);
REVOKE ALL ON SCHEMA atendimento_apoio FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA atendimento_apoio FROM PUBLIC;
-- Revisao de grants do servico restrito deve permitir somente SELECT/INSERT
-- nas revisoes/auditoria; UPDATE/DELETE nunca sao necessarios nessas trilhas.
-- Retencao/correcao/exclusao depende da politica aprovada; nao ha purge automatico.
COMMIT;
