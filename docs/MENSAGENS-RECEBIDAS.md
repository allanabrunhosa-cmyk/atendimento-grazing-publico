# Mensagens recebidas sem conteúdo visível — 19/10/2026

## Objetivo e diagnóstico

Exibir reações recebidas no WhatsApp e impedir balões com apenas autor e horário. Recuperar a visualização do histórico pela origem durável exata, sem reprocessar eventos ou alterar mensagens reais.

A consulta de diagnóstico usou transações somente de leitura. O caso indicado pelo usuário é uma reação com emoji. Foram encontrados 25 registros de reação sem texto projetado, 15 registros de formato não suportado com erro Meta 131051 e oito cartões de contato já cobertos pelo resgate anterior. Todos possuem origem durável exata. O diagnóstico não imprimiu nomes, telefones, IDs nem conteúdo de conversas.

`interpretarMensagemEntradaOperacao` devolvia texto vazio para tipos não tratados. O histórico antigo recuperava somente cartões de contatos. A interface não oferecia um aviso geral para os outros formatos.

## Escopo e critérios

- [x] Projetar reações como texto legível, preservando emojis válidos e distinguindo remoção explícita de dados inválidos.
- [x] Mostrar aviso honesto quando a Meta informar formato não suportado. Não inferir mensagem apagada, temporária, áudio ou imagem pelo código 131051.
- [x] Recuperar reações antigas e citações em memória, por identidade e evento exatos.
- [x] Preservar a recuperação existente dos cartões de contatos.
- [x] Proteger a interface contra texto ausente e mídia sem anexo, sem duplicar avisos em cartões ou anexos válidos.
- [x] Preservar permissões, janela, estado, auditoria, cursores e idempotência. Nenhum envio real de teste.
- [x] Testes focados, prova PostgreSQL fictícia, regressão, tipos, lint, regras visuais e compilação.
- [x] Publicação oficial e conferência de saúde, acesso e arquivos instalados.

## Restrições

A recuperação consulta o recibo em leitura e mantém os bytes originais. Não modifica mensagens, não recria intenções e não reabre atendimentos. Formatos que não possuem conteúdo utilizável recebem aviso explícito. Não se promete reconstruir dados que não foram entregues.

O escopo específico desta correção é reação e erro de formato não suportado. Localização, pedidos e formulários desconhecidos recebem o aviso geral; não há implementação de novos fluxos de envio. Conteúdo recebido é renderizado como texto React, sem executar HTML ou comandos.

A [OpenAPI oficial da Meta](https://github.com/facebook/openapi/blob/main/business-messaging-api_v23.0.yaml) descreve `reaction.emoji`, `reaction.message_id` e o exemplo de formato não suportado com código 131051. A projeção não expõe identificadores internos nem o JSON bruto.

## Execução e validação

A bateria completa passou com 1.303 testes; um teste condicionado ao ambiente ficou sem execução nessa bateria. A prova PostgreSQL dedicada passou separadamente com 43 verificações em duas bases fictícias, sem rede pública. Cobriu persistência, recuperação histórica e citações, origem incorreta, outro contato, permissões, ambiente, fonte indisponível, igualdade dos dados antes/depois da leitura e ausência de intenções, timers ou envios externos.

Tipos, lint, regras de design e compilação passaram. Os testes de interface preservam cartões, anexos, templates, emojis compostos e HTML como texto literal. A prévia fictícia foi conferida no tema claro. Não se declara uma nova conferência visual no tema escuro: a prévia ficou indisponível durante a restrição de memória local. Não houve alteração de CSS nesta entrega. As referências visuais permanecem Em revisão.

Uma conferência agregada adicional da projeção corrigida, somente de leitura, reconheceu as 25 reações e os 15 avisos Meta131051 na origem real, incluindo o caso da imagem. Nenhum conteúdo de conversa foi impresso. Isso confirma a disponibilidade e a interpretação da origem; não é um envio ou uma operação de cliente para teste.

As execuções locais iniciais tiveram falha ou falta de progresso por memória. A validação final usou processos sequenciais, um worker de teste e heap limitado a 640 MiB, sem mudar limites da aplicação. Logs e provas ficam em `.tmp/mensagens-formatos-20261019/`. A prova preservada fica em `<LOCAL_PRIVADO_PRESERVADO>`.

Publicado em 19/10/2026 às 14h06 BRT pelo publicador oficial. Revisão funcional `aa99fbdde84cf19ba90e82b2f24cf6fb85d25a99`. Runtime SHA-256 `c7ec310607de4c4d4d98520dcb722aadcd069d7c7e48c7425dea9b6496e45e7a`. Manifesto SHA-256 `7b38cf46d132a58705704c0d16009e26bc759b609519147eb42ce56c529adf3c`. Interface `assets/index-bW37DK9w.js`. Os arquivos instalados conferem com os hashes; servidor contém a projeção de reações e a interface contém a proteção contra balões vazios.

Serviço healthy e zero reinícios. Saúde e Chat HTTPS retornaram 200; sessão sem autenticação retornou 401. O JavaScript permanece protegido por sessão. Banco, configuração, Compose, imagem e container foram preservados. Envios humanos permanecem `true/vps`; IA, síntese e automações WooCommerce continuam desarmadas. Não há SQL nova, restauração ou alteração de dados reais.

Retorno somente de código: `RAIZ_REMOTA_OPERACAO/releases-preservadas/repositorio-aa99fbdde84cf19ba90e82b2f24cf6fb85d25a99`. O PostgreSQL fictício, a prévia e as abas de teste foram encerrados. Checkout, provas e arquivos ignorados foram preservados. Não houve limpeza automática. Espaço livre final do C: 16,7 GB.

O espaço livre inicial do C: foi 16,5 GB. O checkout e as dependências existentes serão reutilizados. Não executar limpeza automática ou instalar dependências.

## Implementação

- `src/lib/atendimento/operacao-mensagem-recebida.ts` projeta somente reação, remoção explícita e avisos controlados. Não expõe alvo, JSON, detalhes de erros ou campos arbitrários. O tipo persistido permanece `unsupported`.
- `src/lib/atendimento/operacao-repositorio-pg.ts` recupera mensagens/citações vazias de cliente em memória. O leitor exige WABA, número empresarial, remetente, wamid, chave original e banco do ambiente exatos. Usa transação READ ONLY, timeout, até 100 referências e o limite original de 2 MiB por recibo.
- O alvo é limitado a 507 caracteres no SQL e validado por completo no JavaScript. Isso evita os quantificadores acima de 255 que a expressão POSIX do PostgreSQL não admite.
- `scripts/atendimento/operacao-runtime.ts` conecta o novo leitor, mantendo o leitor de contatos independente. Sem permissão de mensagens, nenhum dos leitores recebe referências.
- `apps/atendimento-chat-consulta/TextoMensagem.tsx` impede balões vazios sem duplicar o conteúdo de cartões ou anexos.
