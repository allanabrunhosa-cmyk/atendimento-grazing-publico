-- Aditiva, destino isolado. Não habilita inferência, IA automática ou envios.
-- Aplicar uma vez depois de 034; não executar no HUB nem no Cloud da origem.
BEGIN;
DO $$ BEGIN
 IF current_database() NOT IN ('donatella_operacao','donatella_ensaio_operacao') THEN
  RAISE EXCEPTION 'AGENTE_CONFIGURACAO_BANCO_RECUSADO';
 END IF;
END $$;
ALTER TABLE atendimento_operacao.agente_tarefa
 ADD COLUMN configuracao_versao bigint NOT NULL DEFAULT 0 CHECK(configuracao_versao>=0),
 ADD COLUMN decisao_invalidada jsonb CHECK(decisao_invalidada IS NULL OR jsonb_typeof(decisao_invalidada)='object');
-- Zero identifica tarefas anteriores sem prova da configuração usada. O worker
-- as invalida; não atribuir-lhes a configuração atual por herança.
CREATE INDEX agente_configuracao_versao ON atendimento_operacao.agente_tarefa(empresa_id,configuracao_versao);
CREATE TABLE atendimento_operacao.agente_consumo (
 id uuid PRIMARY KEY, tarefa_id uuid NOT NULL REFERENCES atendimento_operacao.agente_tarefa(id),
 empresa_id text NOT NULL, configuracao_versao bigint NOT NULL CHECK(configuracao_versao>=0),
 operacao text NOT NULL CHECK(operacao IN ('inferencia','transcricao','sintese')),
 chamada integer NOT NULL CHECK(chamada BETWEEN 1 AND 20),
 provedor text NOT NULL CHECK(provedor IN ('anthropic','google','openai','elevenlabs')),
 modelo text NOT NULL CHECK(length(modelo) BETWEEN 1 AND 90),
 resultado text NOT NULL CHECK(resultado IN ('concluida','truncada','incerta','recusada')),
 consumo jsonb NOT NULL CHECK(jsonb_typeof(consumo)='object'),
 hash text NOT NULL CHECK(hash ~ '^[a-f0-9]{64}$'), criada_em timestamptz NOT NULL DEFAULT now(), concluida_em timestamptz,
 UNIQUE(tarefa_id,operacao,chamada)
);
REVOKE ALL ON atendimento_operacao.agente_consumo FROM PUBLIC;
UPDATE atendimento_operacao.configuracao
 SET conteudo=jsonb_build_object('provedor','anthropic','moedaOrcamento','USD')||conteudo,
     versao=versao+1,atualizada_em=now()
 WHERE chave='agente' AND (NOT conteudo ? 'provedor' OR NOT conteudo ? 'moedaOrcamento');
INSERT INTO atendimento_operacao.configuracao(chave,conteudo) VALUES
 ('agente_tom','{"nome":"Donatella","persona":"Assistente cordial da Grazing Table & Co.","formalidade":"equilibrada","conciso":true,"emojis":"nenhum","termosPreferidos":[],"termosProibidos":[],"exemplos":[]}'::jsonb),
 ('agente_skills','{"skills":[{"id":"catalogo","nome":"Catálogo","finalidade":"Consultar produtos, preços e disponibilidade nas ferramentas autorizadas.","escopo":["produto","preco","estoque"],"habilitada":true,"ferramentas":["search_products"],"versao":1,"responsavelId":"service:donatella-preparacao"},{"id":"pedido","nome":"Pedidos","finalidade":"Consultar somente o pedido pertencente ao contato do atendimento.","escopo":["pedido"],"habilitada":true,"ferramentas":["get_order"],"versao":1,"responsavelId":"service:donatella-preparacao"},{"id":"entrega","nome":"Entrega","finalidade":"Consultar condições de entrega revisadas.","escopo":["frete"],"habilitada":true,"ferramentas":["delivery_conditions"],"versao":1,"responsavelId":"service:donatella-preparacao"},{"id":"agenda","nome":"Agenda","finalidade":"Consultar horários disponíveis sem criar compromissos.","escopo":["agenda"],"habilitada":true,"ferramentas":["available_slots"],"versao":1,"responsavelId":"service:donatella-preparacao"},{"id":"conhecimento","nome":"Conhecimento","finalidade":"Consultar conhecimento aprovado e vigente.","escopo":["procedimento"],"habilitada":true,"ferramentas":["consultar_conhecimento"],"versao":1,"responsavelId":"service:donatella-preparacao"},{"id":"apoio","nome":"Apoio humano","finalidade":"Encaminhar dúvidas e exceções à equipe humana. O encaminhamento obrigatório é uma política permanente.","escopo":["produto","preco","estoque","frete","agenda","pedido","procedimento","alergia","excecao"],"habilitada":true,"ferramentas":["solicitar_apoio"],"versao":1,"responsavelId":"service:donatella-preparacao"}]}'::jsonb)
 ON CONFLICT(chave) DO NOTHING;
COMMIT;
