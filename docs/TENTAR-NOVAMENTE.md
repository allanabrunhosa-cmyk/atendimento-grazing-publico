# Tentar novamente — Atendimento

## Objetivo e contrato

Mensagens humanas claramente não enviadas oferecem Tentar novamente. A ação cria uma nova intenção de envio e reutiliza a mesma mensagem no histórico. Texto, assinatura, autor exibido, anexo, citação e posição permanecem. A tentativa anterior conserva seu resultado e recibo.

O servidor decide a elegibilidade. Exige sessão e permissões atuais, conversa humana, versão, janela de atendimento ou template aprovado, anexo e citação válidos. A solicitação indica a intenção anterior e uma chave idempotente. Cliques concorrentes não podem criar duas tentativas novas. A ação registra o atendente na auditoria.

Uma mensagem com resultado incerto no transporte não oferece nova tentativa. Se apenas a resposta HTTP do comando se perder, Conferir tentativa repete o mesmo pedido e chave para recuperar seu resultado. Não existe repetição automática. Callbacks antigos não substituem o estado da intenção atual.

Se a tentativa anterior receber confirmação atrasada de entrega ou leitura antes do novo POST, o worker cancela a nova intenção e concilia a bolha com o recibo confirmado. O diário conserva ambas as tentativas. Uma confirmação que chegar depois do novo POST não pode desfazer o envio externo. Um callback sent atrasado não desfaz uma recusa; delivered e read ainda podem avançar.

O histórico e os contadores usam a intenção atual. A bolha preserva o ID e sua posição. O instante efetivo do envio conta para responder ao cliente. Uma consulta focada mantém o status de mensagens que estão fora da página mais recente do histórico.

## Execução

- [x] Backend, API e auditoria.
- [x] Botão oficial, bloqueios e conferência do comando.
- [x] Testes unitários e PostgreSQL fictício, sem envio externo.
- [x] Prévia isolada nos dois temas e verificação por teclado.
- [x] Tipos, lint, build e revisão independente.
- [x] Publicação oficial e conferência de saúde e acesso.

Nenhuma migration é necessária: o esquema existente permite várias intenções vinculadas à mesma mensagem. Não se altera ou rearma o histórico em lote. O serviço mantém o envio humano `true/vps` e os desarmes atuais de IA e automações.

## Validação

870 testes passaram na bateria completa. Um teste PostgreSQL condicionado ao ambiente ficou sem execução nessa bateria; o novo ensaio PostgreSQL do reenvio foi executado separadamente. Mais 39 testes focados conferiram os estados finais da interface. Tipos, lint, build e diff passaram.

O ensaio PostgreSQL executou 65 verificações em base nova, com fixtures e transporte simulados. Um POST fictício validou a confirmação recebida antes do recibo HTTP. Nenhum envio externo ocorreu. Concorrência, replay, permissões, janela, template, assinatura, mídia, citação, callbacks, intenção ativa, pendências e histórico paginado foram conferidos.

As fixtures ficam em container sem rede e sem portas públicas. Registro privado do ensaio: `<LOCAL_PRIVADO_PRESERVADO>`. SQL histórico foi aplicado somente nessa base fictícia. A publicação não precisa executar SQL.

Tipos, lint, build e regras oficiais de design do componente passaram. A prévia local conferiu o botão nos dois temas, acionamento por teclado, rascunho preservado e conferência manual de resposta perdida. Os avisos de envios cancelados usam o mesmo ícone vermelho e explicam o contexto ou acesso revogado.

## Publicação

Publicado em 14/10/2026 às 10h43 BRT pelo publicador oficial. Revisão funcional `4b1d659f85bdc32569afb343ac5f0c4d21b23f7a`. Runtime SHA `ee8900048c0c629b99d0b7f515769f72850e63e97965e3b54055b06e57c93160`. Manifesto SHA `96217752481d2264ada92239d22cd108d426310447d1c84704038b8a5e06f07a`. Interface `index-BY1kyKqh.js`.

O container existente permaneceu healthy, com zero reinícios automáticos. Saúde e Chat HTTPS retornaram 200; sessão sem autenticação retornou 401. O Chat autenticado abriu sem alertas e carregou a interface nova. As flags de envio permaneceram `true/vps`; IA e automações continuaram desarmadas. JSON privado, Compose, imagem, credenciais e banco foram preservados. Não houve SQL, restauração de banco ou envio real de teste.

Retorno de código preservado em `RAIZ_REMOTA_OPERACAO/releases-preservadas/repositorio-4b1d659f85bdc32569afb343ac5f0c4d21b23f7a`. O container PostgreSQL fictício foi parado após a validação. Os artefatos do ensaio e da prévia permanecem preservados; nenhuma limpeza de armazenamento foi executada.
