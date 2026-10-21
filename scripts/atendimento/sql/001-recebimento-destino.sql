-- SOMENTE DESTINO. Manual/aditiva. Não aplicada à VPS ou ao Cloud.
BEGIN;
CREATE SCHEMA IF NOT EXISTS atendimento_migracao;
REVOKE ALL ON SCHEMA atendimento_migracao FROM PUBLIC;
CREATE TABLE atendimento_migracao.recibo (
  id uuid PRIMARY KEY, hash text NOT NULL UNIQUE CHECK (hash ~ '^[a-f0-9]{64}$'),
  corpo bytea NOT NULL, recebido_em timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE atendimento_migracao.evento (
  id uuid PRIMARY KEY, recibo_id uuid NOT NULL REFERENCES atendimento_migracao.recibo(id),
  chave text NOT NULL UNIQUE CHECK (chave ~ '^[a-f0-9]{64}$'),
  tipo text NOT NULL CHECK (tipo IN ('mensagem','status','alteracao')),
  waba text NOT NULL, numero text, conteudo jsonb NOT NULL,
  estado text NOT NULL DEFAULT 'pendente' CHECK (estado IN ('pendente','processando','concluido','falho')),
  tentativas integer NOT NULL DEFAULT 0 CHECK (tentativas BETWEEN 0 AND 8),
  proxima_tentativa timestamptz NOT NULL DEFAULT now(), lease uuid, lease_ate timestamptz,
  ultimo_erro text, recebido_em timestamptz NOT NULL DEFAULT now(), concluido_em timestamptz,
  CHECK ((estado = 'processando') = (lease IS NOT NULL AND lease_ate IS NOT NULL))
);
CREATE INDEX evento_pendente ON atendimento_migracao.evento (proxima_tentativa, recebido_em) WHERE estado IN ('pendente','processando');
REVOKE ALL ON ALL TABLES IN SCHEMA atendimento_migracao FROM PUBLIC;
COMMIT;
-- Papel de aplicação: somente SELECT/INSERT/UPDATE nas duas tabelas.
-- Processador de domínio ainda pendente; receber não habilita envio/IA.
