# Ajustes de Atendimento — 13/10/2026

## Escopo

- [x] Lápis amarelo abaixo do X nos dados do contato.
- [x] Remover templates da biblioteca. Exclusão na Meta é uma opção explícita.
- [x] Excluir e cancelar com vermelho fixo e efeito no hover.
- [x] Ampliar variáveis e validar o tamanho final do template no servidor.
- [x] Corrigir nomes automáticos. Preservar a edição humana.
- [x] Tags: Donatella roxo, Humano verde, Pausado amarelo, Encerrado vermelho.
- [x] Extrato de atividades com paginação e filtros por usuário/categoria.
- [x] Pedido adicional: exclamação vermelha em mensagem recusada e motivo ao passar o mouse. Resultado incerto tem aviso próprio.
- [x] 807 testes automáticos, tipos, lint e build.
- [x] 41 asserções PostgreSQL isoladas, sem rede e sem envio externo.
- [x] Interface em 320/390/768/1440, temas claro/escuro, filtros e teclado.
- [x] SQL manual aplicado com backup verificado. Código publicado e acesso autenticado conferido.

## Contratos

`src/lib/atendimento/operacao-atividades.ts` define os eventos macro. O extrato reutiliza a auditoria transacional. Não inclui `enfileirar` por mensagem. Utilização de template registra um evento próprio, dentro da mesma transação/idempotência do envio. Abertura usa POST com sessão e CSRF, registra a seleção do histórico e evita repetir o mesmo usuário/conversa em cinco minutos. Não registra polling.

O servidor limita usuários sem `configurar` às próprias atividades. A permissão vem do HUB. Usuários com `configurar` consultam o extrato geral. Nomes de autores ficam como evidência de auditoria; não há cópia de usuários ou autenticação paralela. Contatos recebidos pelo webhook têm autoria Sistema.

SQL manual `039-operacao-atividades-nomes.sql` adiciona a marca de nome manual e o nome do autor na auditoria. Contatos já editados recebem a marca de proteção. A migration não altera nomes. DTOs formatam nomes automáticos. Salvar outro campo preserva essa regra; a mudança efetiva do nome marca edição humana.

Templates removidos da biblioteca recebem `DELETED`, preservam mensagens e ficam fora de novos envios e sincronizações. A exclusão na Meta mantém reserva durável e não repete resultados incertos. Não foram excluídos templates reais para teste.

O texto fixo para análise da Meta permanece em 1.024 caracteres. Exemplos de corpo passam de 200 para 1.024. Variáveis de envio passam de 200 para até 32.768 em corpo único. Com outros componentes, o corpo preenchido fica limitado a 1.024; cabeçalho preenchido fica limitado a 60. UI e servidor preservam esses limites. Digitação e colagem descontam o texto fixo, as demais variáveis e todas as repetições de uma variável. [Referência do provedor](https://developers.sinch.com/docs/conversation/channel-support/whatsapp/template-support).

Falhas mostram causas de códigos conhecidos. O histórico consulta apenas códigos da intenção/status, sem payloads ou detalhes privados. Novos erros da Meta guardam o código numérico, inclusive recusas no upload de arquivos. Falhas antigas sem causa usam um aviso explícito de causa ausente. Não há reenvio automático pelo aviso.

## Validação e publicação

Validação concluída. 807 testes passaram; um teste PostgreSQL local condicionado ao ambiente não foi executado nesta bateria. A prova dedicada em contêiner isolado passou com 41 asserções. Tipos, lint e build passaram. Nenhum envio externo foi usado para homologação.

Primeira publicação realizada em 13/10 às 19h22 BRT: `3a5fccca6030d681eb28f86e5358603347d3aa95`. SQL 039 aplicado após backup privado e leitura integral dos dumps. Configuração e compose preservados. A conferência identificou a rota direta de Atividades ausente; a versão final inclui sua liberação e limites de digitação/colagem.

Publicação final concluída em 13/10 às 20h15 BRT: `26fb2cbabe14e12aa9a324d6b19f7a07aa595d2b`. Runtime `e7af693aad040237cbe3116aa3bf1c73695b96f313fad0bf56e4f9ca2058b5ae`. Serviço healthy, zero reinícios. Rota direta `/operacao/atividades` conferida com sessão autenticada: extrato e filtros visíveis, sem alertas. Banco não foi restaurado; SQL não foi reaplicado nas trocas finais. IA, voz e automações continuam desligadas.

Fonte oficial: `atendimento-grazing`. O HUB publica separadamente o padrão compartilhado de botões. SQL será validado em banco isolado antes da aplicação manual. Publicação de código usa o comando oficial e preserva configuração, domínio, webhook, números e serviços.

## Classificação e estado — 15/10/2026

Lead e Cliente passam para a zona de tags ao lado do estado, na lista de conversas,
no cabeçalho e nos detalhes do atendimento. Contatos também reúne a classificação
com suas etiquetas. Os rótulos de estado passam a Humano e Donatella, sem o prefixo
“Com”. A classificação continua condicionada à permissão `contatos.visualizar`.

`TagContato` mantém uma implementação única. Os quatro papéis semânticos ficam no
catálogo tipado `apps/atendimento/preview/identidade.ts`: Lead usa fundo `#dbeafe`
e texto `#1e40af`; Cliente usa azul royal `#1d4ed8`, texto branco e peso destacado.
As cores permanecem nos dois temas. Contrastes calculados entre os pares sólidos:
7,15:1 e 6,70:1, respectivamente. Não representam certificação geral da interface.

A zona usa flex com quebra de linha. Uma regra herdada ocultava todos os chips da
lista até 700 px; a nova zona mantém seus chips visíveis. A prévia fictícia confirmou
os pares de cores e o agrupamento nos temas claro/escuro. Em largura real de 488 CSS
px, estado e classificação ficaram na mesma linha, sem rolagem horizontal. A captura
da tela estreita expirou; suas medidas e visibilidade foram conferidas pelo DOM.
Imagens desktop e medições ficam em `.tmp/tags-contatos-20261015/`, fora do Git.
A referência visual permanece Em revisão até aprovação humana.

Tipos, lint, compilação final e regras oficiais de design passaram. A bateria completa
aprovou 1.106 testes em 67 arquivos, com um teste PostgreSQL opt-in ignorado. A execução
usou um worker em threads e margem de 15 segundos para testes e hooks, como na tarefa
anterior. A prévia local foi encerrada. Arquivos ignorados e cópia de trabalho foram
preservados, sem limpeza de caches. Não há alteração de banco ou transporte nesta tarefa.

Publicado pelo publicador oficial em 15/10/2026 às 21h09 BRT. Revisão funcional
`379ee85a8fbf427117849b079b9d0bf07cb50068`. Runtime SHA
`16bc062d1de5221bdd0bdbcb470da8149c79c06624dbc4a41a3e9323a814a2e2`.
Manifesto SHA `4fcedc3cc2b6c199eaa6e9e1cfde7e96e9b203689d961b366300cdda663eaf6a`.
Interface `index-BW7p_QVl.js`. Os sete arquivos instalados conferem com os hashes do
manifesto; as classes de agrupamento e os tokens de classificação estão presentes.

Serviço healthy, zero reinícios automáticos. Saúde e Chat HTTPS retornaram 200;
API de sessão sem autenticação retornou 401. Configuração, banco, credenciais,
imagem e Compose preservados. Envios humanos continuam `true/vps`; IA, voz
automática e automações permanecem desarmadas. Nenhuma mensagem ou cadastro real
foi usado como teste. Retorno somente de código:
`RAIZ_REMOTA_OPERACAO/releases-preservadas/repositorio-379ee85a8fbf427117849b079b9d0bf07cb50068`.

## Tema escuro dos popups — 16/10/2026

O popup de envio de template herdava texto claro da raiz, mas conservava o fundo
branco da prévia. As regras escuras limitadas a `.operacao-chat` não alcançavam o
diálogo, pois o portal é renderizado no `body`. Campos, busca, destaque dos seletores
e cabeçalhos de tabelas também continham cores claras fixas.

`operacao.css` aplica os tokens existentes da identidade às superfícies compartilhadas,
inclusive fora da árvore do Chat. O esquema de controles nativos acompanha o tema na
raiz. Botões primários e desabilitados dos diálogos recebem o mesmo tratamento do Chat.
As regras ficam restritas à identidade do Atendimento; a geometria e o fluxo permanecem
os existentes. A proteção de cores forçadas mantém as cores do sistema.

A prévia fictícia conferiu envio e criação de template, editor de contato, seleção
aberta em portal, transferência, nota interna, Agenda e Pipeline. O popup de envio
foi conferido nos dois temas, com imagens e cores computadas. No escuro, diálogo
`rgb(36,30,48)`, campos `rgb(25,21,32)` e texto `rgb(240,234,250)`. O botão primário
habilitado usa `rgb(119,60,221)` com texto branco. A confirmação de descarte continuou
operante. Nenhuma mensagem foi enviada e nenhum dado real foi usado como teste.
Imagens e medições ficam em `.tmp/tema-escuro-popups-20261016/`, fora do Git.
A referência visual permanece Em revisão até aprovação humana.

Validação: 1.106 testes aprovados em 67 arquivos, com um teste PostgreSQL opt-in ignorado.
Execução com um worker em threads e margem de 15 segundos para testes e hooks, como
nas tarefas anteriores. Tipos, lint, regras oficiais de design e compilação passaram.

Publicado pelo publicador oficial em 16/10/2026 às 11h10 BRT. Revisão funcional
`fbbd70dae30137788cde3f269f0f3b7993e1b81d`. Runtime SHA
`16bc062d1de5221bdd0bdbcb470da8149c79c06624dbc4a41a3e9323a814a2e2`.
Manifesto SHA `3f59a0f655c3dfe8a79bac44af584df5b996cd88ee56fb9824b0cabe39839798`.
Interface `index-b3ge9e8w.js`; CSS `index-8joTx6YO.css`. Os sete arquivos instalados
conferem com os hashes do manifesto; o CSS da aplicação contém o novo escopo de tema.
O CSS independente do login não recebe o escopo do Chat.

Serviço healthy, zero reinícios automáticos. Saúde e Chat HTTPS retornaram 200;
API de sessão sem autenticação retornou 401. Banco, configuração, credenciais,
imagem e Compose preservados. Envios humanos continuam `true/vps`; IA, voz
automática e automações permanecem desarmadas. Nenhum SQL ou restauração foi
executado. Retorno somente de código:
`RAIZ_REMOTA_OPERACAO/releases-preservadas/repositorio-fbbd70dae30137788cde3f269f0f3b7993e1b81d`.
A prévia foi encerrada. Cópia de trabalho e arquivos ignorados foram preservados,
sem limpeza de caches ou criação de outra cópia de trabalho.
