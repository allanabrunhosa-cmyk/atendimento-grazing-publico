# Correção de envio — 14/10/2026

## Causa

As tentativas recentes eram recusadas com `ENVIO_DESABILITADO`, sem recibo da Meta. O JSON privado configurava operação VPS com envio ativo. O Compose persistido mantinha `ATENDIMENTO_ENVIO_HABILITADO=false` e `ATENDIMENTO_AUTORIDADE_ENVIO=origem`. A saúde HTTP não detectava essa divergência.

## Correção operacional

Às 09h37 BRT, somente as duas flags do serviço `operacao` foram alinhadas para `true/vps`. O serviço foi recriado com a mesma imagem, sem recriar dependências. JSON privado, credenciais, banco, volumes, domínio e demais parâmetros foram preservados. Escopo `chat_humano`, fase `humano`, IA, voz e automações permaneceram com os desarmes anteriores.

Backup privado: `<LOCAL_PRIVADO_PRESERVADO>`. O subconjunto de 16 tentativas recusadas, incertas ou canceladas manteve estado, tentativas e recibo. Nenhuma foi rearmada. Retorno de configuração está preservado; nunca restaurar banco para esse ajuste.

## Proteção de código

O publicador verifica a coerência das flags Docker quando o JSON espera operação VPS com envio ativo. Verifica antes da troca e depois do reinício. Divergência, ausência ou duplicidade recusam a publicação. Modos legítimos sem envio continuam permitidos. O publicador não altera flags automaticamente. O aviso de `ENVIO_DESABILITADO` agora explica a causa em português, sem expor credenciais.

## Validação

818 testes passaram; um teste PostgreSQL condicionado ao ambiente não executou. Tipos, lint e build passaram. Nove testes do publicador passaram também no Linux, com pastas fictícias e comandos externos simulados.

A primeira bateria concorrente teve uma falha de espera por elemento na fixture do compositor. Sem alterar essa fixture ou seu limite, os dez testes do arquivo passaram isolados e a bateria completa passou com um trabalhador.

Serviço healthy, zero reinícios e saúde HTTPS 200. Consultas Meta somente de leitura confirmaram número, token, aplicativo e permissão de envio. Após a correção, a leitura agregada confirmou 11 novas tentativas entregues, iniciadas pelos atendentes. Não houve mensagem de teste enviada pelo agente.

## Publicação da proteção

Publicado em 14/10/2026 às 09h49 BRT. Revisão funcional `f06ac934a6a6a22ac466268e21b3dcc365d38eef`. Manifesto `767acd57a540cf35b75575dc81e5ba6d308942d890ccaabe0f7ba5d1d71db288`. O runtime conservou o SHA `257390f13113d1429a853a2e9a1332bc919a08cd34d13dc7a457a9d7cbbc17d3`.

Serviço healthy, zero reinícios e flags `true/vps` confirmadas após a publicação. Saúde e Chat HTTPS 200; sessão sem autenticação 401. O Chat autenticado abriu sem alertas e carregou `index-C3QJeHcq.js`. O publicador preservou JSON privado e Compose corrigido, sem SQL ou restauração de banco. A versão anterior está em `RAIZ_REMOTA_OPERACAO/releases-preservadas/repositorio-f06ac934a6a6a22ac466268e21b3dcc365d38eef`.
