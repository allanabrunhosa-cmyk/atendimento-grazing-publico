# Follow-up no topo — 20/10/2026

## Comportamento

O follow-up vencido mantém a conversa no topo do filtro atual. Abrir, ler ou receber
uma mensagem não remove essa prioridade. Concluir, cancelar ou reprogramar o alerta
para o futuro libera a posição. A conversa, o rascunho e o histórico aberto permanecem
selecionados durante a reordenação.

A causa era a ordenação por mensagens sem resposta e última mensagem. O lembrete
já permanecia no banco, mas não participava dessa ordenação. A consulta agora aplica
a prioridade antes do limite de 30 linhas e da paginação. Dentro de cada grupo,
preserva pendências, última mensagem e identificador para desempate.

Busca, canal, fila, estado e ambiente continuam limitando a lista. Conversas encerradas
com lembrete continuam no filtro Encerrado. O alerta não reabre a conversa.

## Atualização e limites

A resposta da lista inclui o próximo vencimento de todo o filtro, mesmo quando o
lembrete está em uma página ainda não carregada. A interface agenda uma nova leitura
desse prazo com o relógio do servidor e um delta monotônico. A atualização recompõe
atomicamente o prefixo já carregado e respeita a trava de consultas e os filtros.

SSE, reconexão, retomada da aba e sincronização periódica continuam existentes.
Uma aba suspensa ou sem rede depende da retomada para consultar o estado atualizado.
Falhas preservam os dados carregados e a repetição explícita. Nenhuma rotina de envio
ou automação foi criada. Não há schema, migration ou configuração nova.

## Evidência

Consumidor de referência: a lista atual do Chat, com `IndicadorFollowup`, o formulário
de alerta e os componentes/tokens existentes. Somente o texto de orientação mudou.
As imagens usam dados fictícios e transporte simulado. Permanecem **Em revisão**.

- [Desktop, tema claro](evidencias/followup-topo-20261020/desktop.png).
- [Celular, tema escuro](evidencias/followup-topo-20261020/mobile.png).

Registros técnicos completos: `.tmp/followup-fixo-20261020/`, fora do Git.

## Validação

- Node 22.23.3. Dependências e cliente Prisma de schema idêntico reutilizados.
- Bateria geral: 1.582 aprovados, uma falha e um opt-in não executado. A falha era
  uma espera do teste de colar imagem: o elemento aparecia antes de seu efeito React
  atribuir o `src`. O teste passou a aguardar o valor esperado, sem mudar asserção ou
  timeout. Reexecução de compositor, lista e API: 79 testes aprovados. Total distinto
  validado: 1.583 testes. O opt-in `ATENDIMENTO_COMPOSITOR_BANCO_TESTE` não foi ativado.
- Tipos, lint e build operacional aprovados.
- Regras visuais do HUB: zero achados no consumidor alterado.
- Prévia em 320, 390, 768 e 1440 pixels, claro/escuro: zero achados na auditoria DOM.
- Navegador: follow-up vencido acima de conversa mais recente sem resposta; leitura
  preserva a posição; conclusão fictícia reordena e mantém a seleção.
- PostgreSQL local isolado: 25 asserções novas de ordem, paginação, filtros, ambiente
  e permissão; 82 asserções de regressão de lembretes, concorrência e replay.
- Publicador oficial: nove testes aprovados, sem publicação nesta etapa.

A prova antiga de lembretes dependia de banco sem fixtures anteriores. Sua busca
agora usa o prefixo da execução e escolhe telefones fictícios livres. A prova preserva
os dados das execuções anteriores. As asserções funcionais não foram reduzidas.

Nenhuma mensagem real foi enviada. Não houve alteração de IA, canais, número,
webhook, bancos reais ou configurações fiscais. A prévia local foi encerrada.
PostgreSQL sintético preservado para a validação paralela do HUB. Espaço livre após
build e capturas: 20,23 GiB. Publicação será registrada após sua conclusão.
