# Atalhos de texto e descrição dos alertas — 20/10/2026

## Comportamento

O botão de atalhos fica dentro do campo de mensagem, no canto direito. Aparece quando o rascunho está vazio. Abre a biblioteca compartilhada da equipe, com busca automática, criação, edição e exclusão confirmada.

Digite `/` como primeiro caractere para abrir as sugestões. O nome após a barra filtra a lista. Setas e Enter selecionam o texto. A seleção substitui o comando pelo texto no rascunho e mantém o foco. Não envia a mensagem. Um novo Enter explícito usa o envio humano normal. Barra no meio do texto não abre sugestões. Escape fecha a seleção. Quebras de linha, composição de caracteres, citação, anexos, assinatura e retomada do foco continuam no compositor existente.

Cada atalho tem nome de até 50 caracteres e texto de até 4.096 caracteres. O nome usa letras sem acentos, números, hífen ou sublinhado. Nomes são únicos por ambiente. A biblioteca aceita até 200 itens e um envelope JSON de até 900 KiB. Ao inserir, vale também o limite disponível da mensagem, incluindo a assinatura do atendente. Textos maiores são recusados sem truncar o rascunho.

O alerta de follow-up aceita uma descrição opcional de até 1.000 caracteres. Ela aparece no formulário e no aviso do sino. É possível alterar apenas a descrição, inclusive após o vencimento. Essa ação preserva a data, a hora e a prioridade do alerta. O agendamento continua manual e não envia mensagens. A prioridade dos alertas vencidos, incorporada de `6c7bf30`, permanece ativa.

## Contratos e persistência

`GET /atalhos` retorna `{versao,registros:[{id,nome,texto}]}`. `POST /atalhos/salvar` recebe nome, texto, versão, UUID de idempotência e ID opcional. `POST /atalhos/excluir` recebe ID, versão e UUID de idempotência. Os recibos retornam a nova versão e o item salvo ou o ID excluído.

O servidor exige usuário humano e `consultar`. Gravações também exigem `atender` e ambiente operacional ou de homologação. Origem, sessão e CSRF usam o handler existente. A configuração `atalhos_texto` armazena a biblioteca por ambiente. Não há novo cadastro no HUB nem nova tabela para atalhos. Versão otimista, trava transacional, recibos idempotentes e auditoria protegem alterações concorrentes. O extrato registra criar, editar e excluir sem copiar o texto para o log.

Uma confirmação perdida conserva o pedido e seu UUID. O botão de conferir repete essa mesma operação. Após confirmação, a interface consulta a lista atual. Um recibo antigo não ressuscita um atalho excluído por outra pessoa. Falha nessa consulta mantém a escrita como confirmada e oferece apenas nova consulta. Não cria outra escrita.

`POST /conversa/:id/lembrete` aceita `descricao` em agendar e reprogramar. A ação `atualizar` exige o ID, a versão e a descrição; não recebe novo horário. Omitir a descrição ao reprogramar preserva a anterior. Uma string vazia remove somente a descrição. Concluir e cancelar preservam o histórico. O extrato inclui a alteração da descrição.

A SQL manual e aditiva `042-operacao-lembrete-descricao.sql` acrescenta `descricao varchar(1000) NOT NULL DEFAULT ''` à tabela de lembretes. Aplicar somente essa SQL em `donatella_operacao` e `donatella_ensaio_operacao`, após backup privado verificado e prova isolada. Não reaplicar SQL histórica. A coluna deve existir antes do novo runtime. Um retorno de código deve preservar a coluna e os dados novos.

## Caminhos

- Compositor: `apps/atendimento-chat-consulta/ChatOperacao.tsx`, `AtalhosTextoOperacao.tsx/.css` e `atalhos-api.ts`.
- Componentes: Autocomplete e Dialog oficiais, botão de edição amarelo, X pastel e cancelar neutro. Autocomplete usa o motor de seleção do Base UI e destaca os resultados assíncronos. O consumidor usa CSS operacional explícito, pois esta aplicação não compila as classes utilitárias da Central. Referência visual permanece Em revisão até aprovação humana.
- Serviço e rota: `src/lib/atendimento/operacao-atalhos.ts`, `operacao-atalhos-http.ts` e `scripts/atendimento/operacao-runtime.ts`.
- Alertas: `AlertaFollowupOperacao.tsx`, `IndicadorFollowup.tsx`, `operacao-lembretes.ts` e `operacao-repositorio-pg.ts`.
- Provas: `testes/atendimento/atalhos-banco.ts`, `lembretes-banco.ts`, `lembretes-ordem-banco.ts` e testes próximos. Artefatos locais ficam em `.tmp/alerta-descricao-atalhos-20261020/`.

## Estado da entrega

Prova PostgreSQL isolada aprovada: 115 verificações de lembretes, 25 de ordem e paginação e 58 de atalhos. Total de 198 verificações. O ambiente usou rede `none`, sem portas no host. Nenhum envio externo ocorreu. O container exclusivo foi parado e as fixtures foram preservadas em `<LOCAL_PRIVADO_PRESERVADO>`.

A SQL042 foi aplicada nas duas bases após backup privado completo, SHA-256, índice e leitura integral dos dumps. Backup: `<LOCAL_PRIVADO_PRESERVADO>`. A comparação transacional confirmou horários, estados e histórico dos lembretes preservados. Configuração, Compose, IA e autoridade humana foram preservados. Não houve restauração. SQL SHA-256: `0fb73c32aedfb31789a4e478764c531523dc7b60b859bf52e026b9e2cdb74df6`.

Validação final: 1.690 testes aprovados. Um opt-in de compositor com banco não foi ativado na bateria geral; não está contado como aprovado. As três provas PostgreSQL desta entrega passaram separadamente. Tipos, lint, análise de design dos seis consumidores e build operacional passaram.

Prévia fictícia: criação, edição e exclusão de atalhos; filtro por barra; Enter direto após consulta assíncrona; seleção sem envio; descrição alterada sem mudar o horário vencido. Temas claro e escuro conferidos. Em 390 pixels, o gerenciador fica dentro da tela e o alerta tem rolagem própria. Capturas Chrome após redimensionamento tiveram falha da ferramenta; as imagens de celular foram obtidas no navegador isolado. Os tamanhos temporários foram restaurados. Nenhuma mensagem ou chamada de IA foi usada para esta validação.

Referências visuais **Em revisão**:

- [Gerenciador no tema claro](evidencias/atalhos-texto-20261020/desktop-claro.png).
- [Gerenciador no celular, tema escuro](evidencias/atalhos-texto-20261020/mobile-escuro.png).
- [Alerta com descrição no celular](evidencias/atalhos-texto-20261020/alerta-mobile-escuro.png).

## Publicação e conferência

Publicado pelo publicador oficial em 20/10/2026 às 21h58 BRT. Revisão funcional `77e350e6aafb2e787c867c8cfafc3fbd74a1d627`. Runtime SHA-256 `0bd7539f8e92b6d765dd36066a6d31b1a98df864827f8def35e8162e153ac80c`. Manifesto SHA-256 `1672b2f3e4e48df2206ffdd6984fd2fbb243d42866fb73e179816575269e2ee8`. Interface `assets/index-Bk-n2ury.js`, também conferida no DOM carregado pelo navegador.

Às 22h00 BRT, o serviço estava healthy, sem reinícios automáticos. HTTPS: saúde 200, sessão sem autenticação 401, Chat sem sessão redireciona com 303 para `/operacao/login`, login 200. A primeira versão do verificador esperava 200 diretamente no Chat; o código da rota confirmou que 303 é a proteção correta. O verificador foi corrigido e todas as checagens passaram. O acesso autenticado ao Chat também foi conferido no Chrome.

Na URL publicada, o ambiente de ensaio consultou a biblioteca pelo servidor e exibiu o popup de atalhos, a ação Novo atalho e o campo Descrição do alerta. Nenhum atalho ou alerta foi criado nessa conferência. A biblioteca começa vazia nas duas bases. As mutações foram verificadas no PostgreSQL exclusivo e na prévia com API fictícia. Nenhuma mensagem real foi enviada.

Configuração privada, Compose, imagens, containers e permissões dos lembretes foram preservados. A IA operacional permanece desligada, versão 8, sem autoridade automática e sem marco de ativação. O atendimento humano permanece habilitado com autoridade `vps`. Voz e automações comerciais permanecem desarmadas. Número, webhook, token, histórico e backups no Drive não foram alterados.

Retorno somente de código: `/etc/grazing-donatella-operacao-v2/releases-preservadas/repositorio-77e350e6aafb2e787c867c8cfafc3fbd74a1d627`. Preservar a SQL042 e as descrições em eventual retorno. Não houve restauração de banco. O servidor local, a prévia e a aba de conferência foram encerrados. Os arquivos privados e as provas foram preservados.
