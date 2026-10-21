-- Somente na preparacao isolada. Nao cria rotinas de negocio ou chama a origem.
BEGIN;
DO $$ BEGIN IF current_database()<>'donatella_preparacao' THEN RAISE EXCEPTION 'Destino recusado'; END IF; END $$;
CREATE TABLE atendimento_migracao.arquivo_versao (
 execucao uuid NOT NULL,
 identidade text NOT NULL CHECK(identidade ~ '^[a-f0-9]{64}$'),
 objeto_id uuid NOT NULL,
 bucket text NOT NULL CHECK(bucket IN ('whatsapp-media','audio-messages')),
 nome text NOT NULL CHECK(length(nome) BETWEEN 1 AND 2048),
 etag text NOT NULL CHECK(length(etag) BETWEEN 34 AND 40),
 versao_origem text,
 atualizado_origem timestamptz NOT NULL,
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 bytes bigint NOT NULL CHECK(bytes BETWEEN 0 AND 67108864),
 arquivo text NOT NULL CHECK(arquivo=sha256||'.bin'),
 pacote uuid NOT NULL,
 manifesto_sha256 text NOT NULL CHECK(manifesto_sha256 ~ '^[a-f0-9]{64}$'),
 preservado_em timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(execucao,identidade)
);
CREATE INDEX arquivo_versao_leitura ON atendimento_migracao.arquivo_versao(objeto_id,etag,bytes);
REVOKE ALL ON atendimento_migracao.arquivo_versao FROM PUBLIC;
GRANT SELECT,INSERT ON atendimento_migracao.arquivo_versao TO donatella_coletor;
GRANT SELECT(objeto_id,bucket,nome,etag,sha256,bytes,arquivo,preservado_em) ON atendimento_migracao.arquivo_versao TO donatella_consulta;
COMMIT;
