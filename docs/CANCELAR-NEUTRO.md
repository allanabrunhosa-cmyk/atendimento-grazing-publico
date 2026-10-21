# Cancelar com cor neutra — 13/10/2026

O pedido mais recente substitui o vermelho do botão Cancelar pela cor neutra. O componente compartilhado reutiliza `outline`. A folha operacional usa os tokens de fundo, borda e texto do sistema, inclusive no hover e no tema escuro. A regra também cobre o `DialogClose` do popup de exclusão de template e os painéis operacionais.

Excluir conserva o X com fundo pastel. Fechar janela e pequenas remoções conservam o X cinza. O som de novas mensagens e as demais funções do atendimento não mudam.

## Validação

818 testes passaram; um teste PostgreSQL condicionado ao ambiente não executou. Tipos, lint e build passaram. O lint focado também cobre o componente compartilhado e o novo teste.

O popup foi inspecionado com dados fictícios nos temas claro e escuro. Cancelar usa fundo e borda neutros, com texto legível. Enter no Cancelar fecha o popup e devolve o foco ao gatilho; Escape também fecha. A auditoria da interface não apontou problemas. Não houve exclusão ou envio real. Capturas locais são consultivas; não constituem aprovação de referência visual.

Medições do popup em 320/390/768/1440 CSS px, claro e escuro, confirmaram botões contidos e ausência de overflow interno. As capturas de navegador com viewport reduzido sofreram timeout; imagens dos dois temas no viewport normal foram inspecionadas. Esse limite não foi apresentado como comparação de pixels aprovada.

## Publicação

Publicado em 13/10/2026 às 23h24 BRT. Revisão funcional `ee0f9fe5a563e89ccefd2f18a3d0b74deec45911`. Runtime `257390f13113d1429a853a2e9a1332bc919a08cd34d13dc7a457a9d7cbbc17d3`. Manifesto `db314b8f4970b2d4887bf43bdfbb1541b365e206eef415ea413cb146acf0558c`. Configuração e compose preservados. Nenhum SQL ou restauração de banco.

Serviço healthy, zero reinícios. Saúde HTTPS 200; sessão sem autenticação 401. Acesso autenticado carregou `index-B2XeQsL2.js`. O popup ativo confirmou Cancelar com fundo branco, borda neutra e texto legível. Escape fechou sem executar exclusão. Código anterior preservado pelo publicador em `RAIZ_REMOTA_OPERACAO/releases-preservadas/repositorio-ee0f9fe5a563e89ccefd2f18a3d0b74deec45911`.
