# Contatos compartilhados no Atendimento

## Objetivo

Mostrar cartões de contatos recebidos no WhatsApp, com nome, telefones e ações para salvar e iniciar uma conversa. Recuperar a exibição dos cartões antigos quando houver registro durável correspondente.

## Execução

- [x] Interpretar e preservar cartões novos com campos limitados.
- [x] Recuperar cartões antigos por identidade exata, sem reprocessar webhook.
- [x] Entregar somente o contrato necessário ao navegador.
- [x] Exibir cartão, seleção de telefone, salvar e iniciar conversa.
- [x] Preservar permissões, auditoria, idempotência e conversa única.
- [x] Testes, banco isolado, tipos, lint e compilação.
- [x] Conferência semântica da interface em prévia fictícia.
- [x] Publicação e conferência de produção.

## Restrições

Não enviar mensagens para testar. Não cadastrar contatos reais como teste. Não alterar identidade ou telefone de contatos existentes. Não reativar IA ou automações. Não versionar payloads reais ou dados pessoais.

O cartão fica em `value.messages[].contacts`. O campo `value.contacts` descreve o remetente. Telefone e `wa_id` são dados distintos; o identificador não substitui o telefone do cartão. Não inferir nono dígito. A validação de formato não comprova uma conta WhatsApp. O contrato recebido não contém foto; usar ícone ou iniciais. [Contrato OpenAPI oficial da Meta](https://github.com/facebook/openapi/blob/main/business-messaging-api_v23.0.yaml).

Os cartões preservam todos os itens válidos dentro dos limites de bytes existentes: webhook de até 2 MiB e página de histórico de até 1 MiB. Não se declara um limite de quantidade da Meta para recebidos. A interface mostra 20 cartões por vez e permite expandir até o último. Uma projeção de contatos acima de 512 KiB recebe aviso explícito no balão e não oferece ações; o restante do histórico continua legível. Seus metadados e bytes originais permanecem íntegros no recibo durável. O aviso solicita reenvio em partes; não corta os dados silenciosamente.

Salvar um cartão usa o cadastro existente. Iniciar conversa reutiliza a identidade exata e não envia mensagem. A primeira mensagem continua sujeita à janela real do cliente e aos templates aprovados. A exibição não importa os cartões automaticamente.

## Implementação

`operacao-contatos-compartilhados.ts` projeta apenas nome, telefones, e-mails e empresa. Os textos têm limites de 200, 80, 254 e 200 caracteres, respectivamente; o tipo do telefone tem 40. Não entrega `wa_id`, endereço bruto, URL, foto ou envelope do remetente. Telefones e e-mails inválidos não viram ações. O tipo persistido continua `unsupported`, com `tipoOriginal=contacts` e metadados estruturados; o DTO projeta `contacts` para cartões válidos. Nenhuma alteração de schema é necessária.

O histórico enriquece cartões antigos em memória. Consulta outro banco em transação de leitura. Usa a chave única original do evento e confere WABA, número empresarial, remetente, identificador da mensagem e ambiente. Não reprocessa webhook nem altera estado, auditoria, janela ou mensagens. Falha temporária da origem não impede consultar o restante do histórico. Prévia e citação usam resumo legível.

Salvar abre o formulário oficial preenchido para revisão. Vários números exigem escolha explícita. Iniciar usa as rotas existentes de cadastro e abertura. Repetições após confirmação incerta mantêm os mesmos pedidos e chaves. Troca de conversa, desmontagem ou perda de permissão impede continuação da navegação. Editar o número no popup não muda o destino do cartão original.

## Validação

A prova PostgreSQL dedicada passou com 39 asserções em duas bases fictícias, sem rede pública ou envio externo. Cobriu persistência nova, resgate antigo em leitura, identidade exata, permissões, citação e payload excepcional, preservando os dados originais.

Uma conferência agregada somente de leitura identificou oito mensagens antigas de contatos vazias. Todas possuem registro durável exato, com oito cartões preservados. A conferência não imprimiu nome, telefone ou conteúdo e não alterou dados reais.

`npm test -- --maxWorkers=1 --testTimeout=15000 --hookTimeout=15000`: 1.095 testes aprovados em 66 arquivos. Um teste PostgreSQL opt-in ficou ignorado na bateria; a prova dedicada acima foi executada separadamente. A execução sequencial reutiliza a margem já diagnosticada para recursos locais, sem alterar limites da aplicação.

`npm run typecheck`, `npm run lint` e `npm run build` passaram. As regras oficiais de design verificaram seis arquivos sem achados. O DOM da prévia fictícia confirmou nome, telefone e os dois botões no histórico. Os testes de interface cobrem cadastro preenchido, seleção de telefone, mais de 20 cartões, resultado incerto, revogação e navegação após desmontagem, sem envio automático.

A captura de imagens não foi concluída: a conexão de controle do Chrome deixou de responder, inclusive ao retomar a aba existente. Não se declara aprovação visual por inferência. A referência visual permanece Em revisão. A falha não foi atribuída à aplicação; testes de interface e compilação passaram.

Logs, prova e prévia ficam em `.tmp/contatos-compartilhados-20261015/`, fora do Git. O contêiner fictício foi parado; suas duas bases e registros permanecem em `<LOCAL_PRIVADO_PRESERVADO>`.

## Publicação

Publicado em 15/10/2026 às 14h37 BRT pelo publicador oficial. Revisão funcional `61fade4411919bf053a61e4bf2791de3143fe917`. Runtime SHA `16bc062d1de5221bdd0bdbcb470da8149c79c06624dbc4a41a3e9323a814a2e2`. Manifesto SHA `587f5434c9a8a8b3950dcd06df801d1a2bd5aa4d7f554d79cf82fe9b4b85f112`. Interface `index-Bj7Bs27I.js`.

Serviço healthy, com zero reinícios automáticos. Saúde e Chat HTTPS retornaram 200. A API de sessão sem autenticação retornou 401. Banco, credenciais, Compose, imagem e configuração privada foram preservados. Os envios humanos continuam `true/vps`; IA, voz automática e automações continuam desarmadas. Não houve SQL, restauração, cadastro real ou envio real de teste. Os cartões antigos são recuperados na consulta, sem modificar mensagens ou recibos.

A conferência final às 14h39 BRT confirmou os mesmos identificadores e a saúde estável. O arquivo JavaScript instalado confere com o manifesto e contém o componente dos cartões. A requisição pública desse arquivo sem sessão redireciona para o login; não se declara conferência de bytes do JavaScript por acesso anônimo.

Retorno somente de código: `RAIZ_REMOTA_OPERACAO/releases-preservadas/repositorio-61fade4411919bf053a61e4bf2791de3143fe917`. A prévia local foi encerrada. Cópia de trabalho e arquivos ignorados permanecem preservados. A cópia não consta no catálogo permitido da manutenção; não foi acrescentada ao catálogo e nenhum cache foi removido.
