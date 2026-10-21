# Permissões do Atendimento

A gestão ocorre no HUB, em Configurações → Usuários e perfis → Permissões.
A árvore usa Atendimento → Seção → Recurso. Cada recurso oferece visualizar,
editar, adicionar e excluir conforme as operações disponíveis.

O catálogo versionado fica em `src/lib/permissoes/atendimento.ts`.
O HUB mantém a mesma definição. A resolução efetiva fica em
`src/lib/permissoes/atendimento-resolucao.ts`. O Atendimento consulta a view
central em modo somente leitura e revalida a autorização em cada operação.

O agrupamento visual não concede acesso por herança. Visualizar um recurso
não autoriza sua edição. Adicionar não autoriza atualizar um registro existente.
Exceções de usuário continuam prevalecendo sobre o perfil.

Contatos, novas conversas, alertas de follow-up, atalhos, biblioteca de templates,
sincronização com a Meta e consulta de atividades possuem controles separados.
A consulta das atividades da equipe permite o filtro por atendente. Sem ela,
o usuário com acesso às próprias atividades consulta somente seus registros.
O controle de mensagens e de estado da conversa permanece separado.
Reabrir uma conversa encerrada exige editar Conversas e fila, inclusive quando
a solicitação parte do contato ou repete uma operação anterior.

Ações sem operação correspondente aparecem com um traço na matriz.
Não há exclusão de mensagens ou conversas. O cancelamento de alerta e a remoção
de template preservam o histórico. O telefone do contato continua fixo.

## Publicação coordenada

Publicar primeiro esta versão compatível do Atendimento. Depois, aplicar no HUB
a migration manual `20261021120000_atendimento_permissoes_hierarquia` e publicar
a matriz. A migration materializa os acessos efetivos anteriores e preserva
as sessões. O marcador `permissoesHierarquia` confirma a conclusão no servidor.

Antes desse marcador, as novas capacidades seguem os requisitos históricos.
Depois dele, dependem das chaves exatas. A ausência de uma chave nova nega a ação.
O acesso de entrada passa a usar `crm`, normalizado a partir do acesso antigo.
O alias histórico permanece no banco para compatibilidade.

Testes usam respostas simuladas e PostgreSQL exclusivo, sem rede externa.
Não editar perfis reais, ativar a IA ou enviar mensagens a clientes para testar.
O estado da Donatella, a autoridade dos envios humanos e as integrações privadas
não fazem parte desta alteração.
