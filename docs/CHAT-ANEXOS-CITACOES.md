# Anexos, respostas e emojis — 13/10/2026

Implementação no Chat operacional. Origem da alteração preservada em
`grazing-hub@9b6bf002b4688a3b7ad5220a87abd270eadc0459`; publicação passa a ocorrer
exclusivamente por este repositório, conforme a separação já concluída.

- Arrastar imagem/documento para o compositor ou colar uma imagem prepara um anexo.
  A mensagem só sai após Enviar. Legenda e citação são preservadas. Um arquivo por mensagem.
- Prévia local da imagem, nome/tamanho e remoção por X. O blob é liberado ao remover.
  Upload concorrente, múltiplos arquivos e substituição silenciosa são recusados.
- Seletor de emojis no cursor/seleção; digitação e colagem preservam sequências Unicode.
  O limite do texto não corta emoji, modificador de pele ou sequência familiar.
- Respostas mostram autor e conteúdo citado, inclusive fora da página atual. Contexto
  recebido é preservado para resolver entrega fora de ordem. Atendimento anterior do
  mesmo contato pode ser citado; referência de outro contato não expõe conteúdo.
- Texto/imagem/documento enviados como resposta usam o `context.message_id` oficial.
  Referência sem wamid válido é recusada; não há envio silencioso sem a citação solicitada.
- Permissões granulares, CSRF, autoria do HUB, filas, idempotência, resultado incerto,
  recebimento e mídias privadas permanecem nos mesmos serviços.

Limites: JPG/PNG 5 MiB; documentos 20 MiB; áudio/vídeo 16 MiB; figurinha WebP
até 100 KiB estática ou 500 KiB animada, conforme o validador existente. A [referência
oficial da Meta](https://www.postman.com/meta/whatsapp-business-platform/folder/13382743-ecb27be5-4d27-4763-bbee-6a8002c04bf3)
permite documentos até 100 MB; o teto interno de 20 MiB foi preservado. A tela informa
formatos e limites. O servidor confere tamanho, MIME, assinatura e vínculo da conversa.

O validador Base64 antigo causava `RangeError` com arquivo fictício de 4 MiB.
A expressão foi corrigida sem retirar teto, alfabeto, grupos de quatro ou padding.
Imagens e PDFs fictícios de 4 MiB passaram pela gravação/recuperação no banco local
com igualdade dos bytes e hash; replay não criou outro anexo. Arquivos de 20 MiB
também passaram pelo teste do validador. Não afirmar entrega externa dessa mídia:
o transporte oficial foi testado com fronteira simulada, sem mensagens a clientes.

Validação da candidata: 791 testes padrão aprovados; o único opt-in PostgreSQL foi
executado separadamente em localhost:56423/donatella_ensaio_operacao e passou, com
rollback dos registros fictícios. Total: 792 testes distintos aprovados. Tipos,
lint, schema e compilação independente aprovados.
Na cópia de origem: DOM desktop e 390 × 843 CSS sem overflow; colagem real de PNG
e seleção de documento de 4 MiB conferidas no navegador, sem envio. Captura da
prévia local expirou; não declarar captura completa dessa prévia. A bateria antiga
do monorepo teve falhas de React duplicado em três demonstrações, registradas ali;
elas não pertencem ao aplicativo operacional nem foram usadas como provas aprovadas.

## Publicação confirmada

Publicada em **2026-10-13T16:49:47.531089-03:00** pelo publicador oficial,
revisão `9f4d6da54f7178d5afc4c7e32eac4958d8b1720d`, após a pré-publicação da mesma
revisão. Runtime `27c249b774c25f2a3f4b92085d4406f11dd70644602c762ee06a130c7cbc10f9`;
manifesto `cabfac4282412460ae46a39ec400faef1f916c9c048235afe29361b0bd7f0fbf`.
O hash dentro do contêiner coincide com a release. Serviço `running/healthy`, zero
reinícios inesperados; processo iniciado em `2026-10-13T16:49:29.540651307-03:00`.

Configuração privada e compose preservados. Sem SQL, restauração de banco, mudança
de callback/número ou ativação de IA/voz/Woo. Código anterior preservado em
`RAIZ_REMOTA_OPERACAO/releases-preservadas/repositorio-9f4d6da54f7178d5afc4c7e32eac4958d8b1720d`.
Retorno somente de código; não restaura banco sobre mensagens novas.

Sessão real do HUB abriu o Chat: lista/histórico carregados, 43 ações de responder
na conversa do proprietário, citação preparada sem envio, 24 emojis e limites
informados. Sem alerta ou erro de console observado. Captura recortada real salva
privadamente fora do Git. Login público 200; API sem sessão 401.

Backup Drive observado com `externalReadVerified=true`, falha nula, snapshot
`e1062e60ce2fc27f17006184b17ab82687f23da8e7dabdf993168e732c12b010`, criado em
`2026-10-13T16:11:44.183626-03:00` e verificado em `2026-10-13T16:13:08.790733-03:00`.
Esse ponto antecede esta publicação de código. Não afirmar cobertura da nova release
ou das gravações posteriores. Agendamentos e arquivos de backup não foram alterados.

## Foco do compositor — 15/10/2026

O campo de mensagem solicita foco ao selecionar uma conversa e após enviar uma
mensagem livre. A solicitação espera o histórico, o rascunho e o término da operação.
Usa `focus({preventScroll:true})` uma vez, quando o campo está habilitado.

A solicitação pertence à conversa selecionada. Mover o foco para outro controle,
abrir um diálogo ou sair do Chat cancela a solicitação. Atualizações do histórico
e gravação automática do rascunho não solicitam foco. Resultado incerto mantém o
envio bloqueado. Shift+Enter, composição de texto e proteção contra envio repetido
preservam suas regras existentes.

Validação: 1.106 testes aprovados em 67 arquivos. Um teste PostgreSQL opt-in ficou
ignorado, sem alteração de banco neste ajuste. A bateria usou um worker em threads
e margem de 15 segundos para testes e hooks. O modo de processos foi interrompido
após não produzir resultado; uma execução focada nesse modo já havia registrado
falha ao iniciar worker neste host. A configuração da aplicação não foi alterada.
Os 11 casos novos conferem foco após envio, falha recuperável, seleção, rascunho,
busca durante eventos e atualização periódica, popup, composição e Shift+Enter.

Tipos, lint, compilação e regras oficiais de design passaram. A conexão de
controle do Chrome retornou `Debugger unattached`; não se declara validação no
navegador. Logs ficam em `.tmp/foco-compositor-20261015/`, fora do Git.

Publicado pelo publicador oficial em 15/10/2026 às 15h00 BRT. Revisão funcional
`25789399334b0b6ef2341f91fba6735d0609676c`. Runtime SHA
`16bc062d1de5221bdd0bdbcb470da8149c79c06624dbc4a41a3e9323a814a2e2`.
Manifesto SHA `48db605a4f6ccdca395d742b41a1816af7e7997ec9a465f62db8c30958248d19`.
Interface instalada `index-DhnciJLk.js`, com bytes conferidos no manifesto. O acesso
anônimo ao arquivo redireciona ao login. Saúde e Chat HTTPS retornaram 200; API de
sessão sem autenticação retornou 401. Serviço healthy, zero reinícios automáticos.

Banco, configuração, credenciais, imagem e Compose preservados. Envios humanos
continuam `true/vps`; IA, voz automática e automações permanecem desarmadas.
Nenhum SQL, cadastro real ou mensagem real foi usado como teste. Retorno somente
de código: `RAIZ_REMOTA_OPERACAO/releases-preservadas/repositorio-25789399334b0b6ef2341f91fba6735d0609676c`.
Nenhuma prévia, base ou cópia nova foi criada para este ajuste. A cópia de trabalho
e os arquivos ignorados permanecem preservados; nenhum cache foi removido.

## Gravação de áudio pelo atendente — 19/10/2026

Implementado nesta frente, ainda não publicado no momento deste registro:
- Microfone no compositor. Iniciar pede permissão ao navegador; Parar prepara o anexo.
  O atendente pode ouvir, remover ou clicar em Enviar. Parar não envia ao cliente.
- MediaRecorder negocia Ogg/Opus ou MP4/AAC. Não há renomeação de WebM nem nova
  dependência de conversão. Navegador incompatível orienta atualizar ou anexar um
  arquivo de áudio já suportado. [Formatos da Meta](https://www.postman.com/meta/whatsapp-business-platform/folder/13382743-ecb27be5-4d27-4763-bbee-6a8002c04bf3).
- Teto de cinco minutos e 16 MiB. Cancelar, sair da conversa, falha ou revogação da
  capacidade liberam o microfone e descartam a gravação. Nenhum áudio fica no Git.
- Áudio não tem legenda no canal. Texto pendente impede gravar/anexar áudio, sem
  apagar o rascunho. A prévia usa URL local revogada ao retirar ou enviar.
- Usa o upload privado, mensagens.adicionar, janela de resposta, fila, citação,
  idempotência e bloqueio de resultado incerto existentes. Backend e SQL preservados.

Arquivos: GravarAudioCompositor.tsx, ChatOperacao.tsx, AnexoCompositor.tsx e operacao.css
em apps/atendimento-chat-consulta; regressões em testes/atendimento/audio-compositor.test.tsx
compositor-interface.test.tsx. Consumidor de referência: compositor/anexos existente;
Button oficial, mesmos tokens, sem nova variante. Prévia fictícia versionada em
`testes/visual/audio`, na porta local 4254, sem banco ou canal externo.

Validação local da árvore de trabalho sobre e8d2e32: 1.118 testes aprovados e um
opt-in PostgreSQL ignorado. Comando: `node node_modules/vitest/vitest.mjs run
--maxWorkers=1 --pool=threads --testTimeout=15000 --hookTimeout=15000 --reporter=json
--outputFile=.tmp/audio-20261019/regressao.json`. Tipos, lint e build oficial passaram.
As regras da Central de Design, aplicadas aos três componentes alterados, não
apontaram novos desvios. Sem comparação de pixels contra referência aprovada.

Navegador: gravação real de som sintético em MP4/AAC, prévia reproduzível de 19 s,
Enviar bloqueado durante a captura e disponível após Parar. Nenhum microfone real
ou cliente foi usado. Oito cenas em 320/390/768/1440 CSS px, claro/escuro, passaram
pela auditoria parcial sem achados; capturas de gravação e prévia em desktop/390
inspecionadas. Isso não comprova entrega externa no WhatsApp, Safari real ou WCAG.
Artefatos privados em `.tmp/audio-20261019`; capturas na .tmp da cópia principal
HUB. Revisão candidata e recibo final de publicação serão registrados após o deploy.
