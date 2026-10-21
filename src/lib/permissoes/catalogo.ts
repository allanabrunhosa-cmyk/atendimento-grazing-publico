export const ACOES = ["visualizar", "editar", "adicionar", "excluir"] as const;
export type Acao = typeof ACOES[number];
export const ROTULOS: Record<Acao, string> = { visualizar: "Visualizar", editar: "Editar", adicionar: "Adicionar", excluir: "Excluir" };
export type Permissoes = Record<string, Acao[]>;
export type Excecoes = Record<string, Partial<Record<Acao, boolean>>>;
type SecaoCatalogo = { id: string; nome: string; rota: string; acoes: readonly Acao[]; administradorApenas?: boolean };
type ModuloCatalogo = { id: string; nome: string; secoes: SecaoCatalogo[] };
export const CATALOGO = [
  { id: "suprimentos", nome: "Suprimentos", secoes: [
    { id: "fornecedores", nome: "Fornecedores", rota: "/fornecedores", acoes: ACOES },
    { id: "insumos", nome: "Insumos e preparações", rota: "/insumos", acoes: ACOES },
    { id: "suprimentos.porcoes", nome: "Tabela de Porções", rota: "/porcoes", acoes: ACOES },
    { id: "compras", nome: "Pedidos de compra", rota: "/compras", acoes: ACOES },
    { id: "compras.receber", nome: "Receber e reabrir pedidos", rota: "", acoes: ["visualizar", "editar"] },
    { id: "notas", nome: "Manifesto de notas", rota: "/notas-fiscais", acoes: ["visualizar", "adicionar", "editar"] },
    { id: "notas.manifestar", nome: "Manifestar e conciliar notas", rota: "", acoes: ["visualizar", "editar"] },
    { id: "inventario", nome: "Estoque e locais", rota: "/inventario", acoes: ACOES },
    { id: "inventario.contagem", nome: "Contagens", rota: "/inventario/contagem", acoes: ACOES },
    { id: "inventario.entrada", nome: "Entrada de insumo", rota: "/inventario/entrada-avulsa", acoes: ["visualizar", "adicionar"] },
    { id: "inventario.perdas", nome: "Perdas e categorias", rota: "/inventario/perdas", acoes: ["visualizar", "adicionar", "editar", "excluir"] },
  ] },
  { id: "financeiro", nome: "Financeiro", secoes: [
    { id: "financeiro.dre", nome: "DRE", rota: "/financeiro", acoes: ["visualizar"] },
    { id: "financeiro.fluxo", nome: "Fluxo de caixa", rota: "/financeiro/fluxo-de-caixa", acoes: ["visualizar"] },
    { id: "financeiro.movimentacoes", nome: "Movimentações e lançamentos", rota: "/financeiro/movimentacoes", acoes: ACOES },
    { id: "financeiro.conciliacao", nome: "Conciliação bancária (importar, conciliar e desfazer)", rota: "", acoes: ACOES },
    { id: "financeiro.nfse", nome: "Manifesto de NFS-e", rota: "/financeiro/manifesto-nfs", acoes: ["visualizar", "adicionar", "editar"] },
    { id: "financeiro.baixas", nome: "Baixas e estornos", rota: "/financeiro/contas", acoes: ["visualizar", "editar"] },
    { id: "financeiro.bancario", nome: "Conta bancária e cartões", rota: "/financeiro/bancario", acoes: ACOES },
    { id: "financeiro.faturas", nome: "Cartões e faturas (importar, classificar e cancelar)", rota: "/financeiro/cartoes", acoes: ACOES },
    { id: "financeiro.cartoes-pagamentos", nome: "Faturas: conciliar e desfazer pagamentos", rota: "", acoes: ["visualizar", "editar", "excluir"] },
    { id: "financeiro.cartoes-regras", nome: "Faturas: regras de classificação", rota: "", acoes: ACOES },
    { id: "financeiro.saldo", nome: "Alterar saldo inicial", rota: "", acoes: ["visualizar", "editar"] },
    { id: "financeiro.plano", nome: "Plano de contas", rota: "/financeiro/plano-de-contas", acoes: ACOES },
  ] },
  { id: "producao", nome: "Produção", secoes: [
    { id: "producao", nome: "Validades (consultar e emitir)", rota: "/producao", acoes: ["visualizar", "adicionar"] },
  ] },
  { id: "vendas", nome: "Vendas", secoes: [
    { id: "vendas", nome: "Visão geral", rota: "/vendas", acoes: ["visualizar"] },
    { id: "vendas.clientes", nome: "Clientes", rota: "/vendas/clientes", acoes: ["visualizar", "adicionar", "editar"] },
    { id: "vendas.produtos", nome: "Produtos, composição e preços", rota: "/vendas/produtos", acoes: ["visualizar", "adicionar", "editar"] },
    { id: "vendas.catalogo", nome: "Categorias e complementos compartilhados", rota: "/vendas/catalogo", acoes: ["visualizar", "adicionar", "editar"] },
    { id: "vendas.fiscal", nome: "Cadastro fiscal dos produtos", rota: "/vendas/fiscal", acoes: ["visualizar", "editar"] },
    { id: "vendas.formas-pagamento", nome: "Formas de pagamento e taxas", rota: "/vendas/formas-pagamento", acoes: ["visualizar", "adicionar", "editar"] },
    { id: "vendas.horarios", nome: "Horários de entrega", rota: "/vendas/horarios", acoes: ["visualizar", "editar"] },
    { id: "vendas.area-entrega", nome: "Entregas: configuração e simulador", rota: "/vendas/area-entrega", acoes: ["visualizar", "editar"] },
    { id: "vendas.importacao", nome: "Importação assistida do catálogo", rota: "/vendas/importacao", acoes: ["visualizar", "adicionar"] },
    { id: "vendas.pedidos", nome: "Gestor de pedidos: consultar e criar/editar orçamentos", rota: "/vendas/pedidos", acoes: ["visualizar", "adicionar"] },
    { id: "vendas.pedidos.producao", nome: "Pedidos: equipe de produção", rota: "/vendas/pedidos/producao", acoes: ["visualizar", "editar"] },
    { id: "vendas.pedidos.confirmar", nome: "Pedidos: confirmar", rota: "", acoes: ["visualizar", "editar"] },
    { id: "vendas.pedidos.revisar", nome: "Pedidos: revisar e registrar entrega", rota: "", acoes: ["visualizar", "editar"] },
    { id: "vendas.pedidos.desconto", nome: "Pedidos: conceder desconto", rota: "", acoes: ["visualizar", "editar"] },
    { id: "vendas.pedidos.preco", nome: "Pedidos: alterar preço manualmente", rota: "", acoes: ["visualizar", "editar"] },
    { id: "vendas.pedidos.cancelar", nome: "Pedidos: cancelar", rota: "", acoes: ["visualizar", "editar"] },
    { id: "vendas.pedidos.frete", nome: "Pedidos: ajustar frete manualmente", rota: "", acoes: ["visualizar", "editar"] },
    { id: "vendas.pedidos.cobertura", nome: "Pedidos: aprovar cobertura excepcional", rota: "", acoes: ["visualizar", "editar"] },
    { id: "vendas.pedidos.logistica", nome: "Pedidos: registrar custos de entrega", rota: "", acoes: ["visualizar", "editar"] },
  ] },
  { id: "crm", nome: "CRM", secoes: [
    { id: "crm", nome: "Acesso ao módulo", rota: "/crm", acoes: ["visualizar"] },
    { id: "crm.atendimento", nome: "Atendimento", rota: "/crm/atendimento", acoes: ["visualizar"] },
    { id: "crm.atendimento.equipe", nome: "Atendimento: gestão da equipe", rota: "/crm/atendimento/team", acoes: ACOES },
    { id: "crm.atendimento.configuracoes", nome: "Atendimento: configurações", rota: "/crm/atendimento/settings", acoes: ["visualizar", "editar"] },
    { id: "crm.atendimento.automacoes", nome: "Atendimento: automações", rota: "/crm/atendimento/automations", acoes: ACOES },
  ] },
  ...[ ["rh", "RH"], ["patrimonio", "Patrimônio"] ].map(([id,nome]) => ({ id, nome, secoes: [{ id, nome: "Acesso ao módulo", rota: `/${id}`, acoes: ["visualizar"] }] })),
  { id: "configuracoes", nome: "Configurações", secoes: [
    { id: "configuracoes.usuarios", nome: "Usuários & Permissões", rota: "/configuracoes/usuarios", acoes: ACOES },
    { id: "configuracoes.loja", nome: "Dados da empresa e certificado", rota: "/configuracoes/empresa", acoes: ["visualizar", "editar", "excluir"] },
    { id: "configuracoes.design", nome: "Central de Design", rota: "/configuracoes/design", acoes: ["visualizar"], administradorApenas: true },
  ] },
] as ModuloCatalogo[];
export const SECOES = CATALOGO.flatMap(m => m.secoes);
export function recursoDaRota(rota: string): string | null {
  if (rota === "/vendas/canais" || rota.startsWith("/vendas/canais/")) return "vendas.produtos";
  if (rota === "/configuracoes/entregas") return "vendas.area-entrega";
  if (rota === "/configuracoes") return "configuracoes.usuarios";
  if (rota.startsWith("/financeiro/lancamentos")) return "financeiro.movimentacoes";
  if (rota.startsWith("/inventario/movimentacoes")) return "inventario";
  return [...SECOES].filter(s => s.rota && (rota === s.rota || rota.startsWith(s.rota + "/"))).sort((a,b) => b.rota.length-a.rota.length)[0]?.id ?? null;
}
export function permissaoEfetiva(base: Permissoes, excecoes: Excecoes, recurso: string, acao: Acao) {
  const valor = (a: Acao) => excecoes[recurso]?.[a] ?? base[recurso]?.includes(a) ?? false;
  return valor("visualizar") && valor(acao);
}
export function todasPermissoes(): Permissoes { return Object.fromEntries(SECOES.filter(s => !s.administradorApenas).map(s => [s.id, [...s.acoes]])); }
export class ErroValidacaoPermissoes extends Error {}
export function validarPermissoes(entrada: unknown): Permissoes {
  if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) throw new ErroValidacaoPermissoes("Permissões inválidas.");
  const saida: Permissoes = {};
  for (const [recurso, acoes] of Object.entries(entrada)) {
    const secao = SECOES.find(s => s.id === recurso);
    if (!secao || secao.administradorApenas || !Array.isArray(acoes) || acoes.some(a => !secao.acoes.includes(a)) || new Set(acoes).size !== acoes.length) throw new ErroValidacaoPermissoes("Permissão desconhecida.");
    if (acoes.length && !acoes.includes("visualizar")) throw new ErroValidacaoPermissoes("Habilite Visualizar antes das demais ações.");
    saida[recurso] = acoes;
  }
  return saida;
}
export function validarExcecoes(entrada: unknown, base: Permissoes): Excecoes {
  if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) throw new ErroValidacaoPermissoes("Personalizações inválidas.");
  const saida: Excecoes = {};
  for (const [recurso, valores] of Object.entries(entrada)) {
    const secao = SECOES.find(s => s.id === recurso);
    if (!secao || secao.administradorApenas || !valores || typeof valores !== "object" || Array.isArray(valores)) throw new ErroValidacaoPermissoes("Personalização desconhecida.");
    for (const [acao, valor] of Object.entries(valores)) {
      if (!secao.acoes.includes(acao as Acao) || typeof valor !== "boolean") throw new ErroValidacaoPermissoes("Personalização inválida.");
      if (valor !== (base[recurso]?.includes(acao as Acao) ?? false)) (saida[recurso] ??= {})[acao as Acao] = valor;
    }
  }
  return saida;
}
