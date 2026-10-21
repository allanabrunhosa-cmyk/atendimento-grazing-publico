-- Manual e aditiva. Não altera nomes, mensagens, templates nem identidades.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
DO $$ BEGIN
 IF current_database() NOT IN ('donatella_operacao','donatella_ensaio_operacao') THEN RAISE EXCEPTION 'OPERACAO_ATIVIDADES_BANCO_RECUSADO'; END IF;
END $$;
ALTER TABLE atendimento_operacao.contato ADD COLUMN IF NOT EXISTS nome_manual boolean NOT NULL DEFAULT false;
-- A auditoria anterior não distingue qual campo foi editado. Preservar todos
-- os contatos já editados evita corrigir um nome escolhido por uma pessoa.
UPDATE atendimento_operacao.contato c SET nome_manual=true
 WHERE NOT nome_manual AND EXISTS(SELECT 1 FROM atendimento_operacao.auditoria a WHERE a.entidade_id=c.id::text AND a.acao='editar_contato');
ALTER TABLE atendimento_operacao.auditoria ADD COLUMN IF NOT EXISTS autor_nome varchar(200);
CREATE INDEX IF NOT EXISTS auditoria_extrato_em ON atendimento_operacao.auditoria(criada_em DESC,id DESC);
CREATE INDEX IF NOT EXISTS auditoria_extrato_autor ON atendimento_operacao.auditoria(autor_id,criada_em DESC,id DESC);
CREATE INDEX IF NOT EXISTS auditoria_abertura ON atendimento_operacao.auditoria(autor_id,entidade_id,criada_em DESC) WHERE acao='abrir_conversa';
COMMIT;
