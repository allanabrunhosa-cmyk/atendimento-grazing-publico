-- Manual/aditiva. Não ativa tarefa, agente, envio ou automação importada.
BEGIN;
DO $$ BEGIN IF current_database() NOT IN ('donatella_operacao','donatella_ensaio_operacao') THEN RAISE EXCEPTION 'DESTINO_FOLLOWUP_RECUSADO'; END IF; END $$;
ALTER TABLE atendimento_operacao.timer ADD COLUMN IF NOT EXISTS origem_mensagem_id uuid REFERENCES atendimento_operacao.mensagem(id);
ALTER TABLE atendimento_operacao.timer ADD COLUMN IF NOT EXISTS origem_intencao_id uuid REFERENCES atendimento_operacao.intencao(id);
ALTER TABLE atendimento_operacao.timer ADD COLUMN IF NOT EXISTS intencao_id uuid REFERENCES atendimento_operacao.intencao(id);
ALTER TABLE atendimento_operacao.timer ADD COLUMN IF NOT EXISTS conteudo jsonb NOT NULL DEFAULT '{}';
ALTER TABLE atendimento_operacao.timer ADD COLUMN IF NOT EXISTS codigo text;
CREATE UNIQUE INDEX IF NOT EXISTS operacao_welcome_followup_unico ON atendimento_operacao.timer(conversa_id) WHERE tipo='welcome_followup';
CREATE INDEX IF NOT EXISTS operacao_timer_pendente ON atendimento_operacao.timer(executar_em,id) WHERE estado='pendente';
COMMIT;
