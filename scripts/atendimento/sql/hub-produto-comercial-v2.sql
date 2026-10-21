-- Manual/aditiva, SOMENTE HUB. Não executar no banco do Atendimento.
-- Fonte conferida em 20/10/2026: ProdutoVenda comercial, ativo e PRINCIPAL.
-- Não altera cadastro, identidade, preço, receita, custo, cliente ou automação.
-- Executar uma vez, após backup e conferência do dono da publicação.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 IF current_database()<>'grazing_hub' THEN
  RAISE EXCEPTION 'HUB_PRODUTO_COMERCIAL_BANCO_RECUSADO';
 END IF;
 IF to_regclass('atendimento_integracao.identidade') IS NULL OR
    to_regclass('public."ProdutoVenda"') IS NULL OR
    NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='donatella_identidade_operacao') THEN
  RAISE EXCEPTION 'HUB_PRODUTO_COMERCIAL_ORIGEM_AUSENTE';
 END IF;
END $$;
CREATE VIEW atendimento_integracao.produto_comercial WITH(security_barrier=true) AS
 SELECT p.id,p.nome,p.especificacao,p.descricao,p.versao::text versao,
        NULL::text sku,NULL::bigint woo_produto_id,NULL::bigint woo_variacao_id
 FROM public."ProdutoVenda" p
 WHERE p.ativo AND 'PRINCIPAL'=ANY(p.classificacoes);
COMMENT ON VIEW atendimento_integracao.produto_comercial IS
 'Projeção comercial somente leitura da Donatella. HUB é fonte das especificações. SKU e vínculo Woo exigem conferência separada; código interno não é SKU.';
REVOKE ALL ON atendimento_integracao.produto_comercial FROM PUBLIC;
GRANT SELECT ON atendimento_integracao.produto_comercial TO donatella_identidade_operacao;
COMMIT;
