# Donatella — especificações HUB, ofertas e pedidos do site

## Objetivo e limites

Atualização de 20/10/2026, conforme o documento V2 do proprietário. Reutilizar o
Atendimento próprio e seus adaptadores. O HUB mantém as especificações. A loja
complementa com anúncio, link e dados comerciais; pedidos usam leitura atual.
Não alterar pedidos, Meta, voz, orçamento, atendimento humano ou backups.
Não ativar notificações, regras comerciais ou a IA para validar a entrega.

## Estado inicial comprovado

- Código publicado: `bb02a866d8f030d423c246b81b6952e65c7d536a`. A main local antiga
  do clone principal não representa a release; a base desta tarefa é a cópia
  própria já atualizada e preservada, incluindo os recibos posteriores.
- Donatella desligada, versão 6, autoridade automática falsa. Transporte humano
  habilitado. Configuração privada e automações comerciais preservadas.
- Host canônico: `https://grazingtable.com.br`. A entrada `www` redireciona para
  esse host. Credenciais permanecem exclusivamente no cabeçalho enviado ao
  host configurado; redirecionamento autenticado é recusado.
- Woo respondeu às leituras mínimas de produtos e pedidos. Três status vistos
  na amostra real: `em-producao`, `pedido-pronto` e `retirado-entrega`. Isso não
  comprova todos os status da loja nem sua interpretação operacional.
- HUB possui 55 produtos ativos com classificação PRINCIPAL e descrição comercial.
  O campo especificacao está vazio nesses registros. A descrição comercial é
  consultada no HUB; receitas, custos, notas internas e insumos ficam excluídos.
- A conexão central existente só permitia a view de identidade. Não havia
  ferramenta de produtos HUB funcional nesta release nem vínculo Woo comprovado.
  A extensão reutiliza a conexão somente leitura com uma projeção comercial.
  Não cria cópia mestre nem importa especificações da loja.
- Código interno do HUB não é SKU. Identidades externas encontradas pertencem
  ao iFood. Nomes semelhantes não aprovam uma associação automaticamente.
- O histórico local contém 1.235 pedidos Woo importados, 191 com contato
  vinculado. São candidatos à leitura atual, nunca prova de autorização nem
  fonte de status atual. O histórico não guarda telefone/comprador/itens.

## Associação aprovada

O proprietário confirmou nesta conversa, antes de gravar:

| Produto HUB | Anúncio Woo | Link oficial |
| --- | --- | --- |
| Brie Folhado com Mel — `e7e82470-0828-4332-8b9a-293a2dbe06e1` | `16019` | https://grazingtable.com.br/produto/brie-folhado-com-mel/ |

Não inferir vínculos dos outros produtos por nome. Pendências individuais não
bloqueiam os anúncios já conferidos.

## Implementação

- `operacao-hub-produtos.ts`: busca limitada na projeção comercial do HUB,
  com transação somente leitura, parâmetros, prazo SQL e descarte após cancelamento.
- `operacao-woo-consultas.ts`: operações GET delimitadas, destino confirmado
  sem autenticação antes do cabeçalho privado, sem redirecionamento, corpo/prazo
  limitados. Especificações e descrições brutas Woo não entram no modelo.
- `operacao-comercial.ts`: associação técnica, seleção pelo HUB, até três
  opções, fontes versionadas e reconsulta comercial antes do envio existente.
  Pedido exige identidade derivada da conversa e telefone completo do comprador.
  Número visível sozinho não autoriza revelar nem confirmar pedido de terceiro.
- Clientes sem vínculo conhecido podem informar o número visível para uma busca
  privada limitada. A API não oferece filtro nativo por telefone; sem candidato,
  comprador conhecido ou número, a equipe recebe a limitação. Não varrer o histórico.
- `ComercialConversa.tsx`: Copiar link e Inserir no atendimento. Inserir revalida
  anúncio e preço e altera somente o compositor. O envio mantém a ação humana.
  Pedidos do site oferece consulta manual e Atualizar. Trocar conversa cancela
  a consulta e elimina a projeção anterior.
- Status de conexão, consulta e vínculos fica separado de notificações comerciais.
  Produto variável aponta para sua página oficial. Sem moeda confirmada, não
  mostrar preço. Disponibilidade de compra não comprova data, CEP, frete ou estoque
  físico. Status customizado conserva rótulo bruto sem inventar significado.

## Validação e publicação

Validações concluídas antes da publicação:

- Bateria oficial: **1.495 testes aprovados**, um teste opcional ignorado,
  89 arquivos aprovados, 92,95 segundos, dois workers. Tipos e lint oficiais
  passaram. Analisador visual: quatro consumidores, zero achados.
- PostgreSQL fictício isolado, sem rede externa: **62 verificações** de ledger,
  replay, permissão, conflito, versão, preparação das habilidades, tomada de
  contexto, convidado, terceiro e telefone internacional. Estado final OFF v7,
  zero mensagens/intenções/ativações/chamadas pagas. Bundle
  `b53723a384b613cd907a1966ba2fb1021ec3d8ec08c73dc75abac7834a443a11`.
- SQL HUB validado em PostgreSQL fictício: filtro ativo/PRINCIPAL, prioridade
  do nome, busca com acentos, leitura da view e bloqueio das tabelas completas.
  As fixtures e bases anteriores foram preservadas. Contêiner de teste parado.
- Chrome/CUA, build `index-Dmj8bUDC.js`, API fictícia: copiar conserva rascunho;
  inserir reconsulta o preço e acrescenta texto, conserva foco, não envia.
  Pedido fictício `LOJA-007` e estados/fonte/horário legíveis. Claro e escuro
  sem rolagem horizontal, 327/327 px. Prévia encerrada e porta 4198 livre.
  Os horários e dados de pedido dessa prévia são fixtures, não prova da loja.
- Inspeção real limitada detectou que a projeção `_fields` de campos aninhados
  em arrays omitia itens e frete nesta versão da loja. O adaptador pede esses
  dois arrays no primeiro nível e os reduz imediatamente aos campos permitidos.
  Não repassa payload bruto ou metadados ao modelo. Não foi comprovado contrato
  de agendamento, rastreio ou opções personalizadas por metadados nesta amostra;
  esses dados permanecem ausentes, sem inferência nem alegação de cobertura.
- Revisão dirigida identificou e corrigiu coluna de identidade no alias do
  contato, extração de número que confundia prosa com identificador e telefone
  internacional que recebia DDI brasileiro. Os casos passaram nas provas.
- Compilação final aprovada; runtime
  `45ef6d6fc3cbb1079aa01f97c87b56198d57626ce7ae5e5fb17f94bc7b1fd59b`.
  A primeira execução local precisou de acesso às dependências compartilhadas
  para o temporário do Vite. Não houve instalação ou atualização de pacotes.

Aplicações reais, sem ativar IA ou enviar mensagens:

- View HUB aplicada uma vez em 20/10, sob locks e após backup privado de schema
  e ACL relido. SQL SHA
  `e8f3cf2c6357279bc4ab3233cc5f882b21e3c8022ec5663fa61133901bb2ce57`.
  Backup SHA `da5a547c4f2728a06426f0ab8cb9ecff64289f7e1dc0389ead177934d367709c`.
  A conexão real confirmou 55 produtos, SELECT na view e escrita bloqueada.
  Identidade/ACL existentes, permissões das tabelas e configuração foram preservadas.
- Vínculo Brie e habilidades aplicados às **11h46min44s**, São Paulo
  (`2026-10-20T14:46:44.637Z`), por serviço com autorização real, auditoria,
  versão e idempotência. Vínculos v1, habilidades v3, agente **OFF v7**.
  Somente as habilidades existentes `catalogo` e `pedido` foram adaptadas.
  Tom, horários, demais habilidades e configuração privada permaneceram iguais.
- Leitura real posterior confirmou especificação no HUB, anúncio 16019 e link
  aprovado. Preço consultado naquele instante: **319 BRL**, valor fixo da loja.
  Esse valor é evidência datada, não preço fixado no código. Estado de conexão:
  conectado, um produto vinculado e 54 pendentes. Zero inferências ou mensagens.
- Backup privado operacional relido antes da configuração:
  `RAIZ_REMOTA_OPERACAO/backups-prepublicacao/donatella-hub-woo-v2-20261020/configuracoes-antes.json`,
  SHA `ff7a150fcdb90531fcc0c3f9e49367a54ab61f7a12204d068cf6cae9a78edeb9`.
  Configuração privada SHA antes/depois
  `67e7fc0f93e8868e2c02df0449df884ab2011a550651b79009ec251051fa1cdf`.
  Recibos privados junto aos backups; nenhum segredo foi versionado.
- A revisão automática recusou duas vezes a cópia do ensaio. O proprietário
  autorizou explicitamente enviar ensaio, configuração aprovada e publicação
  para sua VPS 179.199.142.19. A mesma transferência foi liberada. Não houve
  transporte alternativo para contornar a recusa. O contêiner real permaneceu
  com filesystem protegido; o auxiliar usa stdin e guarda o backup no host privado.

Publicação oficial concluída às **11h50min34s** de 20/10/2026, São Paulo
(`2026-10-20T14:50:34.785679Z`):

- Código `5871d2c77ee78f7d672a2ca3f3e309e036683382`, preservado na main e no ramo
  `codex/donatella-hub-woo-consultas-20261020` do repositório próprio.
- Manifesto SHA `9d179f7beff732e6f4deabb06248a3d0edb3cb3e0e2f49312e14fd34ac6b177c`.
  Retorno somente de código em
  `RAIZ_REMOTA_OPERACAO/releases-preservadas/repositorio-5871d2c77ee78f7d672a2ca3f3e309e036683382`.
  Mesmo contêiner, saudável. O publicador preservou configuração e compose;
  não executou SQL nem restaurou banco. A view HUB foi a aplicação aditiva
  separada registrada acima.
- Chrome autenticado no endereço publicado confirmou `index-Dmj8bUDC.js`, a
  seção WooCommerce conectada, um produto vinculado, 54 pendentes, as duas
  habilidades de consulta habilitadas, Donatella **Desligada** e atendimento
  humano com envios habilitados. Não salvar nem ligar para esse smoke.
- A rota HTTP publicada `/api/atendimento/operacao/comercial/produtos?busca=Brie`
  devolveu o produto HUB versão 10, anúncio 16019, imagem e URL oficial, preço
  atual de 319 BRL, compra disponível. Os outros resultados sem associação
  trouxeram oferta nula. Consulta real às 11h51min29s, sem operação de envio.
- Saúde HTTPS confirmou operação/VPS, envios humanos habilitados, IA automática
  falsa, voz e automações comerciais falsas. A aba do painel ficou aberta.
  Imagem local `painel-publicado.png` na pasta ignorada desta tarefa.
- Conferência final limitada a um contato e três candidatos históricos do mesmo
  contato: nenhum teve a autorização confirmada. O auxiliar aceita recusa de
  escopo ou pedido ausente (404); não registrou a distinção por candidato.
  Não afirmar que todos tinham telefone divergente. Outros erros de API ou
  projeção encerrariam o ensaio; isso não ocorreu. Não ampliamos a busca.
  Configuração, sessão e IA OFF v7 ficaram intactas. Zero escritas ou envios.
  Essa leitura não comprova o retorno de um pedido real autorizado. Status,
  itens e modalidade passaram com fixtures, inclusive convidado e terceiro.
  Agendamento, rastreio e opções em metadados dos itens continuam sem mapeamento
  validado. Não inferir esses dados a partir de frete, produto atual ou status.

## Como conferir no painel

- Em **Chat → Dados do cliente → Produtos e links do site**, buscar **Brie**.
  **Copiar link** copia a URL oficial. **Inserir no atendimento** reconsulta a
  oferta e prepara o rascunho; o atendente decide quando enviar.
- Em **Pedidos do site**, consultar ou atualizar o pedido da conversa. Informar
  o número visível quando necessário. O servidor confere a identidade; não
  divulgar pedido sem autorização confirmada. Uma recusa não prova ausência
  de pedidos em outros canais.
- Em **Agente & IA**, conferir **WooCommerce — consultas de pedidos e links**.
  Um produto tem vínculo aprovado; 54 permanecem pendentes de associação segura.
  A Donatella continua desligada. Esta entrega não autoriza ativá-la para teste.

SQL manual/aditivo: `scripts/atendimento/sql/hub-produto-comercial-v2.sql`,
exclusivamente no HUB, após backup privado e teste isolado. Não executá-lo no
banco do Atendimento. O publicador não aplica SQL nem restaura bancos.

Contratos oficiais consultados: [produtos](https://developer.woocommerce.com/docs/apis/rest-api/v3/products/),
[pedidos](https://developer.woocommerce.com/docs/apis/rest-api/v3/orders/) e
[credenciais](https://woocommerce.com/document/woocommerce-rest-api/).
As referências não substituem as provas de acesso à loja descritas acima.

## Atualização — associação semântica e autonomia

Em 20/10/2026, o proprietário autorizou a associação automática por nome e
significado. Essa orientação substitui a exigência anterior de confirmação
individual para correspondências claras. Exemplo: **Grazing para 1** no HUB
corresponde a **Grazing para 1 — tábua de frios** na loja.

Implementação desta atualização:

- Identidade comercial normaliza acentos, ordem editorial, complementos
  descritivos e equivalências de quantidade/unidade. Mantém diferenças de
  tamanho, capacidade, ingredientes, restrições, kits, versões e variações.
  Uma equivalência ambígua não é aprovada por proximidade de nome.
- Sem ID ou SKU explícito, a consulta resolve o anúncio automaticamente.
  Associação explícita existente tem prioridade; erro nela não autoriza
  substituição silenciosa. Não cria outro cadastro mestre ou nova importação.
- Candidatos usam busca e paginação limitadas, com prova de completude e cache
  curto. Preço, compra, título e link são revalidados na oferta atual.
- Busca conserva quantidades e consulta formas numéricas e por extenso.
  Recomendações usam rendimento declarado no HUB. Não inferem rendimento de
  um anúncio parecido. Uma quantidade negada não vira necessidade do cliente.
- Orientação da agente permite esclarecer preferências, ocasião e orçamento
  diretamente com o cliente. Apoio humano fica para dúvidas importantes,
  conflitos, identidade incerta e condições sem fonte. Alergias, exceções,
  limites, permissões e tomada humana conservam suas proteções.
- O ensaio do painel ganhou catálogo fictício de 1, 2 e 4 pessoas, preço e
  links `.example`, pela mesma projeção factual usada na operação. Não consulta
  clientes, HUB ou loja reais. Fontes e resultado identificam a simulação.
  Formatação brasileira de preço é derivada do valor consultado; a guarda
  continua recusando valor, capacidade ou URL inventados.
- A contagem do painel identifica produtos já conferidos. Os demais são
  consultados automaticamente sob demanda; não exigem aprovação individual
  para correspondências claras. Esse contador não comprova varredura integral.

Validação final antes da publicação: **1.580 testes aprovados**, um opcional
ignorado, 91 arquivos aprovados em 102,52 segundos. Tipos e lint oficiais
aprovados. Analisador visual: quatro consumidores, zero achados. Compilação
aprovada, runtime `6d478fd1f3f290b68a175a4318243c7c221614b4f48bab1baf8e64b661c0a715`.
Os casos incluem associação semântica, paginação completa, consulta concorrente,
cancelamento, quantidade, ensaio do painel, preço brasileiro e proteção factual.

A preparação auditada da habilidade foi confirmada às **13h17** de 20/10
(`2026-10-20T16:17:00.174Z`). Habilidades v3 → v4; agente OFF v7 → **OFF v8**.
Não houve ativação, inferência ou envio. O vínculo aprovado do Brie permaneceu
v1. Tom, horários, limites, atendimento humano e configuração privada ficaram
preservados. A conferência restrita do auxiliar confirmou três ofertas, com
associação automática para produtos sem vínculo explícito. Essa leitura não
equivale a revisar todos os produtos da loja.

Backup privado antes da configuração:
`RAIZ_REMOTA_OPERACAO/backups-prepublicacao/donatella-semantica-20261020/configuracoes-antes.json`,
SHA `8458330884758599e4335358ad0c06073688d04fa241b9eedb63d51ec32e62a9`.
Configuração privada permanece com o SHA registrado acima. Auxiliar sem
credenciais, SHA `42ae3a4017f53fa2c41d24d922abfe1d8213efa6d4c89993e2063557b7ec7276`.

Conferência visual isolada aprovada em claro e escuro, build
`index-XK_N001T.js`. Novos rótulos legíveis; coluna 327/327 px. Copiar preservou
o rascunho. Inserir reconsultou a oferta, atualizou o preço fictício de 29,50
para 31,50 e acrescentou texto. Zero envios, IA falsa. Aba e servidor de prévia
encerrados; porta 4198 livre. Artefatos ignorados em
`.tmp/donatella-semantica-20261020/`.

Publicação oficial confirmada às **13h21min13s** de 20/10
(`2026-10-20T16:21:13.729125Z`), código
`cb689678ed2120e320725fdc772629a5fae45725`. Manifesto SHA
`d43c102812711f5dc6112f74173c9e1e42cd010d4fa7cbc479af994ce3b306ce`.
Retorno de código preservado em
`RAIZ_REMOTA_OPERACAO/releases-preservadas/repositorio-cb689678ed2120e320725fdc772629a5fae45725`.
Contêiner saudável. Configuração e compose preservados; nenhum SQL executado
ou banco restaurado nesta atualização.

Conferência real pela URL publicada, sem enviar mensagens ou ativar a IA:

- Busca **Grazing para 1**, às 13h22min12s: associação automática com anúncio
  **225** e link oficial
  `https://grazingtable.com.br/produto/tabua-frios-individual-grazing-para-1/`.
  Versão vegetariana associada separadamente ao anúncio **983**.
- Busca **O que recomenda para 2 pessoas?**, às 13h22min42s: **Grazing para 2**
  ligado ao anúncio **889** e versão vegetariana ao **896**. As opções de
  personalização sem equivalência segura ficaram sem oferta. Não foram
  substituídas pela versão comum. Produtos variáveis conservam a página do
  produto; o preço depende das opções e não foi inventado.
- Painel mostrou cinco vínculos conferidos, incluindo o Brie previamente
  aprovado. Os demais produtos continuam com conferência automática sob demanda.
  Não houve varredura de todo o catálogo nem nova gravação de vínculos manuais.
- Um ensaio no painel com **provedor real e fontes fictícias** respondeu à
  pergunta de duas pessoas, selecionou a opção fictícia correspondente, preço
  brasileiro e link `.example`, e perguntou sobre preferências. Resultado
  `RESPOSTA_REDIGIDA_FUNDAMENTADA`, configuração v8, uma fonte selecionada,
  2.495 tokens de entrada e 204 de saída informados pelo provedor. Nenhum pedido
  de apoio humano nem envio ao WhatsApp. Esse ensaio não é uma consulta real
  de produto ou cliente; as leituras reais estão descritas nos itens anteriores.
- Reserva preventiva desse ensaio: **US$ 0,50**; reserva acumulada de testes
  **US$ 5,50**, dentro do teto original de **US$ 10,00**. Reserva não comprova
  cobrança efetiva. Nenhum limite foi aumentado ou crédito comprado.
- Leitura persistida posterior confirmou **OFF v8**, autoridade falsa,
  habilidades v4 e mesmo SHA da configuração privada. Saúde HTTPS confirmou
  envios humanos habilitados, IA automática falsa, voz e automações comerciais
  falsas. Nenhuma alteração de número, webhook, histórico, pedido ou Drive.
- Aba do teste publicado preservada para conferência. Imagens locais
  `teste-publicado.png` (conexão e estado) e `recomendacao-publicada.png`
  (pergunta e resultado do ensaio) na pasta ignorada desta atualização.
