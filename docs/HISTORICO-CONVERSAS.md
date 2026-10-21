# Histórico completo de conversas — 15/10/2026

## Objetivo e escopo

Recuperar na tela as mensagens de atendimentos encerrados do mesmo contato. Preservar mensagens, anexos, autoria e datas. Mostrar encerramentos e reaberturas na linha do tempo.

- [x] Diagnóstico: o webhook cria outra conversa quando não há conversa ativa; a consulta antiga filtrava apenas um ID.
- [x] Consulta pelo contato exato, sem mesclar cadastros por telefone ou nome.
- [x] Eventos da auditoria, com autoria e data. Reabertura automática identificada como Sistema — WhatsApp.
- [x] Paginação completa, permissões e bloqueio de ações indevidas sobre mensagens de atendimentos anteriores.
- [x] Prova PostgreSQL fictícia, testes, tipos, lint, build e imagens.
- [x] Publicação e conferência de saúde e acesso.

Não apagar, copiar ou mover mensagens reais. Não restaurar banco por cima da operação. Datas e autores ausentes no legado devem permanecer explicitamente desconhecidos.

## Implementação

`operacao-historico.ts` limita a consulta ao mesmo `contato_id` e ambiente fictício/real. Não infere identidade por telefone, nome ou DDD. Mensagens e eventos compartilham a ordenação por data com microssegundos e UUID, o cursor e o teto de bytes. A janela visual de mil registros não limita o histórico armazenado; o cursor permite consultar páginas anteriores.

Encerramento e reabertura manual reutilizam a auditoria transacional. Criar outro atendimento de um contato com histórico registra reabertura. O webhook registra Sistema — WhatsApp. Replay de comando ou de webhook não duplica o evento. Uma ação que não muda o estado é recusada.

A [correção da lista única](LISTA-CONVERSAS-AUTOMATICA.md) passa a reutilizar o mesmo identificador ao iniciar novamente pelo contato ou receber uma nova mensagem. As sessões históricas existentes permanecem preservadas e aparecem em um histórico completo, com uma representante na lista.

Encerramentos e reaberturas antigos usam a evidência da auditoria. Um início legado sem auditoria aparece como Atendimento iniciado, na data de criação conhecida. Autor ausente aparece como Responsável não registrado. Não se inventa um encerramento, uma data ou uma autoria histórica. Uma reabertura posterior não remove esse início legado.

O servidor mantém as permissões do HUB. O histórico anterior preserva texto, templates, anexos e citações. Ações de responder e tentar novamente continuam limitadas ao atendimento da mensagem; visualizar mensagens de uma sessão anterior não autoriza operar essa sessão. As notas permanecem vinculadas e preservadas em sua conversa de origem. Não há SQL nova ou transformação de dados para recuperar a visualização.

## Validação

109 testes focados passaram. A bateria completa passou com 985 testes; um teste PostgreSQL condicionado ao ambiente ficou sem execução nessa bateria. A prova dedicada desta correção foi executada separadamente, em PostgreSQL sem rede nem portas públicas: 1.167 verificações, 1.116 registros em 23 páginas, sem duplicação ou perda. Inclui fechamento, replay, reabertura manual e automática, anexos, citação antiga, mais de mil registros, microssegundos, permissões, isolamento entre contatos/ambientes e autoria legada ausente. Nenhum envio externo foi realizado.

Tipos, lint, compilação e regras oficiais de design passaram. A prévia fictícia mostrou mensagens anteriores e avisos nos temas claro/escuro. Em 320 pixels CSS, os dois avisos preservaram a largura do conteúdo. A referência visual permanece Em revisão. O banco fictício foi parado; seus dados e registros foram preservados em `<LOCAL_PRIVADO_PRESERVADO>`.

Uma conferência de leitura na operação comparou o conjunto completo de IDs de mensagens de um contato com vários atendimentos com a consulta nova. Todas as páginas corresponderam à origem, incluindo mensagens dos atendimentos anteriores, sem duplicações ou perdas. A transação usou snapshot consistente e modo somente leitura. Nenhum conteúdo, nome ou telefone foi impresso ou enviado ao Git.

## Publicação

Publicado em 15/10/2026 às 10h33 BRT pelo publicador oficial. Revisão funcional `b28bfd1a7ee5156fe2667a9365cd39bb30dd1aa7`. Runtime SHA `a55508b2b5285fb1fd76aa5332f670c24657f11ee0b30f312fca28d2eeaa38ce`. Manifesto SHA `e53b4744f18cdb5d4514c8c835bb8bdfdce96279c0d29a759a28510737fd88ea`. Interface `index-CIiH0ZA4.js`.

Serviço healthy, zero reinícios automáticos. Saúde e Chat HTTPS retornaram 200; sessão sem autenticação retornou 401. O Chat autenticado carregou a interface nova sem alertas. Configuração privada, Compose, imagem e banco foram preservados. Envios humanos continuam `true/vps`; IA e automações continuam desarmadas. Não houve SQL nova, restauração, movimentação de mensagens ou envio real de teste.

Retorno somente de código: `RAIZ_REMOTA_OPERACAO/releases-preservadas/repositorio-b28bfd1a7ee5156fe2667a9365cd39bb30dd1aa7`. A cópia local e os arquivos ignorados permanecem preservados. O caminho não consta no catálogo permitido da manutenção; não foi acrescentado ao catálogo e nenhum cache foi removido.
