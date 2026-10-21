-- Camada privada de preparação. Não alimenta tabelas operacionais nem dispara jobs.
BEGIN;
SET LOCAL lock_timeout = '3s';
CREATE SCHEMA IF NOT EXISTS atendimento_migracao;
REVOKE ALL ON SCHEMA atendimento_migracao FROM PUBLIC;
CREATE TABLE atendimento_migracao.carga_documento (
  execucao uuid NOT NULL, id uuid NOT NULL, tipo text NOT NULL CHECK(tipo IN ('snapshot','transacao')),
  hash text NOT NULL CHECK(hash ~ '^[a-f0-9]{64}$'), cifrado text NOT NULL,
  recebido_em timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(execucao,id)
);
CREATE TABLE atendimento_migracao.carga_registro (
  execucao uuid NOT NULL, schema_name text NOT NULL, table_name text NOT NULL,
  chave_hash text NOT NULL CHECK(chave_hash ~ '^[a-f0-9]{64}$'), sequencia bigint NOT NULL CHECK(sequencia>=0),
  excluido boolean NOT NULL, documento_id uuid NOT NULL, indice integer NOT NULL CHECK(indice>=0),
  PRIMARY KEY(execucao,schema_name,table_name,chave_hash),
  FOREIGN KEY(execucao,documento_id) REFERENCES atendimento_migracao.carga_documento(execucao,id)
);
REVOKE ALL ON ALL TABLES IN SCHEMA atendimento_migracao FROM PUBLIC;
COMMIT;
