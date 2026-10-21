# Cadastro de contato e início de conversa

## Objetivo

Permitir cadastrar um contato no Atendimento e abrir uma conversa pelo contato salvo. Validar formato e quantidade de dígitos do telefone antes do cadastro e no servidor. A validação de formato não confirma que a pessoa tem WhatsApp.

## Contrato

- Cadastro explícito, com nome e telefone obrigatórios. Telefone fica imutável após o cadastro.
- Normalização de máscaras e DDI, sem inventar ou remover o nono dígito.
- Contato existente usa seu ID e a identidade de canal registrada. Busca por nome não substitui o vínculo.
- Cadastro e abertura não enviam mensagem. O atendente confirma o envio no Chat.
- Sem mensagem recebida nas últimas 24 horas, a primeira mensagem usa um template aprovado.
- O servidor exige identidade e permissões atuais. Auditoria, idempotência e travas impedem duplicação por clique concorrente ou webhook.
- Reutilizar conversa aberta. Não reativar IA ou automações durante a abertura manual.

## Execução

- [x] Cadastro e início no servidor, com validação e auditoria.
- [x] Novo contato e início de conversa na interface.
- [x] Testes de formato, permissões, concorrência e primeira mensagem.
- [x] Prévia fictícia, tipos, lint, build e revisão.
- [x] Publicação e conferência de saúde e acesso.

Não usar dados reais ou enviar mensagens para testar. Preservar configurações, banco e credenciais. Não alterar telefone ou identidade de contatos antigos em lote.

## Referências e limites

O telefone novo brasileiro exige DDD válido e 10 dígitos nacionais para fixo, ou 11 para celular iniciado em 9. A máscara é removida; o DDI padrão é 55. Outro país exige formato internacional explícito. Nenhum número recebe o nono dígito por inferência. A identidade WhatsApp já recebida permanece intacta, inclusive números legados com representação diferente do cadastro visual. Fontes: [plano da Anatel](https://www.gov.br/anatel/pt-br/regulado/numeracao/plano-de-numeracao-brasileiro) e [numeração E.164](https://www.itu.int/rec/T-REC-E.164-202602-I).

A primeira mensagem usa template aprovado quando não existe entrada real do cliente na janela de 24 horas. Cadastro, abertura e envio de template não inventam uma entrada do cliente. [Política oficial do WhatsApp](https://whatsappbusiness.com/policy/).

A validação confirma o formato, sem garantir que a pessoa possui WhatsApp. Não foi localizado endpoint oficial de consulta sem envio para validar uma conta destinatária. O retorno de envio pode informar um wa_id diferente do número digitado. A reconciliação de aliases com esse retorno exige um contrato próprio; não se deve mesclar cadastros por uma hipótese sobre o nono dígito.

## Implementação e validação

`POST /contatos/criar` salva explicitamente e reutiliza a identidade exata sem sobrescrever dados. `POST /contatos/iniciar-conversa` usa contatoId e versão, preserva uma conversa ativa ou cria uma conversa humana. O número comercial vem da configuração do servidor. Cadastro, início, webhook e reabertura compartilham a trava da identidade. O extrato de atividades registra cadastro, abertura criada e vínculo de identidade.

As ações exigem capacidades existentes, consultadas no HUB. Não foi criada outra matriz de acesso. Cadastro e replay filtram notas e etiquetas conforme as permissões atuais. A interface permite abrir uma conversa existente por ID com acesso de leitura; iniciar uma nova exige atendimento e envio autorizados.

Uma nova conversa de contato que já possui histórico WhatsApp pode aproveitar o último recebimento real, sem aceitar datas futuras ou inventar entrada. Sem essa evidência, a janela fica fechada. O worker revalida a janela antes do envio. O telefone legado e o responsável de uma conversa já aberta permanecem.

O ensaio PostgreSQL passou com 53 verificações. Não realizou chamadas externas. Cobriu concorrência de cadastro/início/webhook/reabertura, replay e revogação, ocultação de notas/etiquetas, identidade legada, conflito de cadastro, primeira mensagem por template e janela real. Banco fictício sem rede e sem portas públicas. Registro privado: `<LOCAL_PRIVADO_PRESERVADO>`. O container fictício foi parado após a prova. Nenhuma SQL nova é necessária na publicação.

22 testes novos de interface passaram. Tipos, lint, compilação e regras oficiais de design passaram. A prévia local conferiu cadastro normalizado, número incompleto, abertura por contato salvo, primeira mensagem simulada no histórico, temas claro/escuro, largura de 320 pixels e fechamento por teclado. Não houve cadastro ou mensagem real de teste.

951 testes passaram na bateria completa. Um teste PostgreSQL condicionado ao ambiente ficou sem execução nessa bateria; o ensaio dedicado desta funcionalidade foi executado separadamente. A primeira bateria identificou uma fixture que ainda esperava o contrato antigo dos contatos, sem canal ou conversa vinculada. A fixture e sua asserção foram atualizadas para o contrato novo; a bateria completa passou depois. O ajuste final de contraste do popup foi conferido por imagem e pelas cores renderizadas nos dois temas.

## Publicação

Publicado em 14/10/2026 às 18h10 BRT pelo publicador oficial. Revisão funcional `fe2c1b3c9e0f1f85293a63b3cba5defe2fd1ecc5`. Runtime SHA `fe522fe4436ac4a42803c987f2ed1f9e74e63ad4f11cc99f94336d5edb297072`. Manifesto SHA `953fd8a776864fe206a869689ef5dbf39b8f23c118cd903e085467188ca6de2c`. Interface `index-Dh6spGao.js`.

O serviço permaneceu healthy, com zero reinícios automáticos. Saúde e Chat HTTPS retornaram 200; sessão sem autenticação retornou 401. O Chat autenticado abriu sem alertas, carregou a interface nova e mostrou Novo contato. Os envios humanos permaneceram `true/vps`. IA e automações continuam desarmadas.

JSON privado, Compose, imagem, credenciais e banco foram preservados. Não houve SQL, restauração de banco, cadastro real ou envio real de teste. Retorno de código em `RAIZ_REMOTA_OPERACAO/releases-preservadas/repositorio-fe2c1b3c9e0f1f85293a63b3cba5defe2fd1ecc5`. A prévia e os registros fictícios da prova permanecem preservados; não foi executada limpeza de armazenamento.

## Máscara e confirmação de saída — 14/10/2026

`CampoTelefoneContato` reutiliza o Input oficial. A máscara acompanha a digitação, a colagem e a edição no meio do valor. Fixo brasileiro limita a 10 dígitos nacionais; celular, a 11. Brasil com +55 conserva o DDI na exibição. Outros países usam + e até 15 dígitos internacionais. Colar o número brasileiro completo com DDI sem sinal identifica esse formato sem confundir o DDD 55. Não há inserção ou remoção do nono dígito.

Inserção ou colagem excedente é recusada por inteiro, sem cortar o telefone silenciosamente. A seleção de trechos e o cursor permanecem utilizáveis. Apagar um separador remove o dígito vizinho para evitar que a máscara prenda a tecla de apagar. A validação de cadastro no servidor permanece igual.

A confirmação de alterações não salvas mantém o AlertDialog oficial. Os botões usam o acabamento do Atendimento. O CSS do aplicativo organiza título, descrição, ícone e ações com os tokens existentes. Continuar editando e Escape preservam os campos e devolvem o foco. Sair sem salvar exige uma escolha explícita. A apresentação foi conferida nos temas claro/escuro e em 320 pixels.

52 testes focados passaram. A prévia fictícia confirmou digitação real com bloqueio de excesso, edição no meio com cursor preservado, formato canônico e continuidade após o aviso. Tipos, lint, build e regras oficiais de design passaram. Não houve instalação, nova cópia de trabalho ou uso de dados reais para testes.

A bateria completa passou com 981 testes. Um teste PostgreSQL condicionado ao ambiente permaneceu sem execução; esta alteração não muda o servidor, o schema ou o envio de mensagens. Os registros de teste usam números sintéticos de demonstração.

### Publicação da máscara e do aviso

Publicado em 14/10/2026 às 20h56 BRT pelo publicador oficial. Revisão funcional `54483fa0d0110838c6f4fc4a7ae39d2792ffe42f`. Runtime SHA `fe522fe4436ac4a42803c987f2ed1f9e74e63ad4f11cc99f94336d5edb297072`. Manifesto SHA `070fb82fe867a99c3257cf21d380140f9f8ba254f440dcbc9232602ff6c90e09`. Interface `index-BZTJBW_y.js`.

O serviço ficou healthy, com zero reinícios automáticos. Saúde e Chat HTTPS retornaram 200; sessão sem autenticação retornou 401. O Chat autenticado carregou a interface nova. A abertura do formulário vazio confirmou o limite formatado de 19 caracteres. O formulário foi fechado sem salvar. A digitação e o aviso foram conferidos na prévia fictícia.

Configuração privada, Compose, imagem e banco foram preservados. Os envios humanos permanecem `true/vps`. IA e automações continuam desarmadas. Não houve SQL, cadastro real ou mensagem real de teste. Retorno de código em `RAIZ_REMOTA_OPERACAO/releases-preservadas/repositorio-54483fa0d0110838c6f4fc4a7ae39d2792ffe42f`.
