# Som, popup de templates e exclusão pastel — 13/10/2026

A regra posterior do botão Cancelar está em [Cancelar com cor neutra](CANCELAR-NEUTRO.md). Os registros abaixo descrevem as publicações anteriores.

## Escopo

- [x] Checkbox e rótulo alinhados no popup de exclusão, inclusive fora da raiz do Chat.
- [x] Controle de som com ícone ao lado de Contatos. Preferência por atendente neste navegador.
- [x] X vermelho com fundo pastel fixo. Fechar e pequenas remoções usam X cinza.
- [x] 813 testes, tipos, lint, build e conferência isolada de interface.
- [x] Publicação e conferência autenticada.

## Contratos

O popup reutiliza Dialog e o botão oficial. A opção de excluir na Meta continua explícita e inicia desmarcada. Confirmação, permissões, auditoria, idempotência e preservação do histórico não mudam.

O som inicia desligado. A escolha fica em localStorage, por usuário e navegador. Web Audio é liberado por interação com a página. A notificação PostgreSQL só sinaliza mensagem nova após a entrada única do cliente ser gravada. O SSE transmite somente um booleano, sem conteúdo ou identificação do cliente. Conexão inicial, reconexão, histórico, status de envio e mensagens próprias apenas atualizam a tela. Rajadas próximas geram um alerta; não há repetição por polling. O alerta exige conexão ao vivo e a liberação de áudio pelo navegador.

O componente compartilhado usa a variante excluir com fundo pastel e X vermelho. excluir-discreto oferece X cinza para fotos e pequenas seleções. Cancelar conserva o vermelho fixo da regra anterior. Falhas de envio conservam a exclamação vermelha e o motivo. Não há alteração de banco, envio real nem mudança de configuração dos canais.

## Validação e publicação

813 testes passaram; um teste PostgreSQL condicionado ao ambiente ficou fora desta bateria. Tipos, lint e build passaram. Eventos de entrada, rajadas, preferência, reconexão e mutações comuns foram testados sem cliente real.

Popup claro conferido em 320/390/768/1440 CSS px. Tema escuro conferido com texto legível e fundo do sistema. Checkbox e rótulo permanecem na mesma linha, sem overflow interno. Escape fecha e devolve o foco ao gatilho. Controle de som permanece ao lado de Contatos em 320 px; a preferência sobrevive ao recarregamento. O diagnóstico da interface não apontou problemas. A rolagem da tabela sintética com nome longo é separada do popup. Capturas isoladas são consultivas e permanecem Em revisão.

Publicado em 13/10/2026 às 21h22 BRT. Revisão funcional 7ad91c753c95700e40180253ba2de3628dfa9c8c. Runtime 257390f13113d1429a853a2e9a1332bc919a08cd34d13dc7a457a9d7cbbc17d3. Manifesto e37dd1f271bd549701f8ec0c6cdacdf747ec3908b9d2671f4c6eba77cfb8ce40. Serviço healthy, zero reinícios. Configuração e compose preservados. Sem SQL novo, envio real ou restauração de banco.

Acesso autenticado ao Chat confirmado: botão Ativar som de novas mensagens, estado desligado e abas Conversas/Dúvidas do Agente/Contatos presentes. Nenhum alerta na tela. Retorno de código preservado em RAIZ_REMOTA_OPERACAO/releases-preservadas/repositorio-7ad91c753c95700e40180253ba2de3628dfa9c8c.

## Alerta mais perceptível — 13/10/2026

O pedido adicional aumenta o volume e destaca a chegada da mensagem. O alerta usa dois toques ascendentes de onda triangular, com pausa entre eles. Ganho máximo de 0,08 para 0,30; duração de 0,32 para 0,72 segundo. Mantém a preferência do usuário, o botão de ligar/desligar e a proteção contra repetição em rajadas.

814 testes passaram; um teste condicionado ao ambiente não executou. Tipos, lint e build passaram. Reprodução acionada na prévia do navegador com mensagem fictícia, sem erro e sem contato real. Nenhum arquivo de servidor, banco ou configuração de canal foi alterado.

Refinamento publicado em 13/10/2026 às 22h53 BRT. Revisão funcional a70d07d9b027a6edefb52622d02172dbfd8dc703. Manifesto a5df98c3ee650e5c5166102593aec7b758c69df2dd3977805e4922848564964f. Serviço healthy, zero reinícios. Acesso autenticado confirmou o arquivo index-CaWjJQ5n.js, com os dois tons novos. Preferência de som preservada. Sem SQL ou restauração de banco.
