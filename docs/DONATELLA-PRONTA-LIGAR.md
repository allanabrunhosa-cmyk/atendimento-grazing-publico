# Donatella pronta para ligar — execução de 19/10/2026

## Objetivo e estado

Concluir a camada de IA do Atendimento existente. Publicar com a IA automática
**desligada**. A ativação posterior pertence ao proprietário, pelo painel
**Agente & IA → Ligar Donatella**. Salvar configuração e testar com dados
fictícios não concedem autoridade de resposta a clientes.

**PRONTO PARA LIGAR A DONATELLA — PUBLICADA, CONFIGURADA E TESTADA; IA AUTOMÁTICA DESLIGADA.**
As evidências atuais constam em **Execução de 19/10/2026**. Não houve ativação
de produção nem envio automático a clientes nesta execução.

Fonte do pedido: `PROMPT_DONATELLA_IA_PRONTA_PARA_LIGAR.md`, preparado em
19/10/2026 e fornecido pelo proprietário. O arquivo contém instruções de execução;
não comprova prontidão, crédito de API nem publicação.

Repositório atual: `allanabrunhosa-cmyk/atendimento-grazing`. A antiga branch do
HUB é referência histórica. A separação está registrada em [SEPARACAO](SEPARACAO.md).
Preservar número, aplicativo, webhook, autenticação HUB, atendimento humano,
conversas, anexos e backups no Drive. Woo, campanhas, acompanhamentos de venda,
grupo externo, novos canais e síntese de voz permanecem fora desta execução.

## Referência Nina

Inspeção dirigida realizada no Chrome em 19/10/2026, somente em leitura.
Foram consultadas configuração, Skills, Saúde e Qualidade. Nenhuma conversa,
conteúdo privado de Skill, teste de conexão ou gravação foi aberto/acionado.
As observações confirmam parte do mapa de 09/10, preservado na antiga origem em
`docs/features/donatella-crm/REFERENCIA-NINA.md`.

| Recurso observado | Equivalente Grazing reutilizado | Ajuste desta entrega |
| --- | --- | --- |
| Configuração separa Salvar, Testar conexão e ligar; mostra Desligada e modos Observer/Autonomous | Agente & IA, configuração versionada e adaptadores nativos | Controle persistente Ligar/Pausar; teste fictício separado; pendências reais de prontidão |
| Skills mostra Persona, Fluxo Reserva, Dúvidas da casa, Status de pedido, Escalação e Regras duras | Skills, Tom de voz, Conhecimento e Dúvidas do Agente | Usar recepção, tábuas, presentes, eventos e apoio humano; não copiar regras de restaurante |
| Saúde apresenta Consumo de API e Integrações por unidade | Estado do serviço, consumo, fila e falhas existentes | Expor estado efetivo e limites sem segredos ou métricas inventadas |
| Qualidade permite períodos de 7, 30 e 90 dias | Metadados e testes dirigidos da própria Donatella | Conferir fluxos alterados; não criar um módulo de BI nesta entrega |

A inspeção prova controles visíveis. Não prova banco, filas, hospedagem,
integrações ou comportamento interno da Nina. Nenhum dado de cliente, segredo ou
prompt privado da referência foi copiado.

## Reuso e lacunas concretas

O runtime, o serviço `operacao-agente.ts`, o repositório PostgreSQL, os adaptadores
Anthropic/Google/OpenAI, o fluxo de Dúvidas/Conhecimento e a fila Meta já existem.
As configurações, Skills e Tom usam versão, permissão, auditoria e idempotência.
A tomada humana e a revalidação antes do envio também existem.

As flags do corte humano impediam a administração e o processamento da IA.
Preparar a capacidade de administração não equivale a ligar a IA. O controle
deve usar estado persistido, marco de ativação e permissão específica. Não pode
exigir outro comando técnico depois da entrega nem liberar automações Woo.

O adaptador anterior pedia somente IDs de fontes. O servidor concatenava o texto
das fontes e aplicava uma abertura/emoji fixos. Isso comprovava seleção real de
evidências, mas não redação consultiva pelo modelo. O contrato adicional de
redação é explícito: `respostaRedigida:true` no adaptador e no orquestrador.
O modelo retorna texto curto e as referências usadas, em JSON fechado.

`ia-resposta-fundamentada.ts` limita o texto e recusa segredos, comandos, números,
endereços e condições comerciais ausentes das fontes selecionadas. O
orquestrador continua conferindo empresa, cliente, tema, origem, versão e vigência
das fontes. Ausência de fonte, pedido de humano e situações críticas vão para
apoio. Fontes retiradas e tomada humana invalidam a resposta. As guardas lexicais
adicionais não representam uma prova semântica de toda paráfrase do modelo.

Orientação estática de produtos pode usar conhecimento aprovado quando a
ferramenta não retorna catálogo. Preço, estoque, frete, agenda e pedido continuam
exigindo fonte atual adequada. Nenhuma integração nova com Woo é necessária para
encaminhar uma dúvida sem fonte à equipe.

## Conhecimento, Skills e Tom

Usar somente versões aprovadas e vigentes da operação Grazing. Cada versão
preserva autoria, responsável, caso de origem, escopo e datas. Memória de cliente
e de conversa exige identidade exata. Uma correção de caso pode virar proposta;
nunca vira regra geral sem revisão. O histórico e o prompt legado não comprovam
preço, estoque, prazo ou política atual.

Fontes confiáveis possíveis: conhecimento já aprovado, condições de entrega
expressamente aprovadas e consultas existentes com autorização. Não copiar
cadastros do HUB nem inventar conteúdo comercial faltante. Produto sem fonte e
dados comerciais sem consulta adequada exigem coleta mínima e apoio humano.

Tom solicitado: português brasileiro, cordial, elegante, consultivo, objetivo,
frases curtas e emojis moderados. O perfil salvo entra na chamada do modelo como
estilo, sem autoridade para modificar fatos, ferramentas ou políticas.

## API, reservas e orçamento

O Claude Pro e a API são produtos distintos. O Pro não fornece crédito de API
para esta aplicação. Não há contratação, compra de créditos, recarga automática
ou aumento de limite autorizado nesta execução.

Evidência histórica de 11/10/2026 às 00:21:07 UTC:

- Anthropic `claude-sonnet-4-5-20250929`, com dados fictícios em banco isolado.
- Nove tentativas no diário; 450 centavos USD reservados sob 1.000 centavos USD
  totais autorizados para testes. A prova incluiu ElevenLabs na época.
- 4.226 tokens de entrada e 378 de saída registrados. Faturamento não conciliado.
- Texto, imagem, Tom, encaminhamento e retomada comprovados na versão daquela
  data; nenhum envio WhatsApp ou intenção de envio foi criado.

Fontes históricas: `AGENTE-PRONTIDAO.md`, `PROVEDORES-E-VOZ.md` e
`.tmp-homologacao/prova-paga-voz-resultado.json` da antiga origem. O diário privado
preservado usa a referência `testes-ficticios-USD10-20261010`; não criar outro
orçamento de US$ 10 nem apagar reservas antigas.

Na verificação privada desta execução, foram confirmados o teto histórico de
1.000 centavos USD, o teto futuro de 500 centavos USD/dia e as nove reservas de
50 centavos, totalizando 450. O GET Anthropic de 19/10/2026 às 18:24 UTC aceitou a
chave e encontrou o modelo configurado. GET de modelos não comprova geração nem
saldo atual. A prova paga atual deve permanecer dentro da autorização remanescente
e registrar a reserva antes do transporte.

Reserva conservadora, estimativa por tokens e cobrança conciliada são campos
distintos. O limite futuro de US$ 5/dia não é mensalidade nem autorização para
aumentar plano. Se não houver teto mensal autorizado, mostrar isso sem criar um.
O painel deve informar a data de reinício do limite diário e o estado do provedor.

Antes de afirmar preço/capacidade atual, conferir as fontes oficiais da Anthropic:
[preços](https://platform.claude.com/docs/en/about-claude/pricing),
[modelos](https://platform.claude.com/docs/en/about-claude/models/overview) e
[cache](https://platform.claude.com/docs/pt-BR/build-with-claude/prompt-caching).
A documentação de
[Claude Pro](https://support.claude.com/pt/articles/8325606-o-que-e-o-plano-pro)
esclarece a separação da API. Registrar a conferência atual antes da entrega;
esses links não constituem, por si só, uma verificação realizada.

## Mídia e limites

Síntese de voz permanece desligada. O player, a recepção e o armazenamento humano
continuam independentes da IA. A transcrição existente exige configuração e
autorização próprias. Sem isso, áudio segue para apoio com o arquivo preservado.

O código de duração existente aceita WAV PCM16 e Ogg Opus completos, até 10 MB e
60 segundos. Outros formatos ou duração não comprovada vão para a equipe.
Imagens usam bytes locais autorizados e os limites do adaptador; não buscar URLs
fornecidas pelo cliente. Google/Gemini recusa GIF no contrato atual. Não alegar
interpretação automática de todo vídeo, documento ou figurinha.

## Plano de validação e provas desta execução

Dados fictícios, banco isolado e transporte Meta desarmado em todos os ensaios.

| Cenário | Critério |
| --- | --- |
| Fonte aprovada e Tom/Skills salvos | Texto efetivo do modelo, referências válidas e perfil consumido |
| Informação ausente ou comercial antiga | Apoio humano; nenhum preço, prazo ou condição inventado |
| Humano solicitado ou tomado durante geração | Resposta antiga invalidada antes da fila |
| Duplicidade, nova mensagem e reinício | Sem inferência/envio repetido; configuração e pendências preservadas |
| Ligar/Pausar e salvar | Permissão, CSRF, versão, auditoria; produção sempre desligada |
| Histórico anterior à ativação | Nenhuma varredura ou resposta em lote; só futuras entradas elegíveis |
| Erro do provedor ou limite de gasto | Recepção/envio humano preservados; falha e reserva visíveis |
| Áudio/imagem não suportados | Apoio explícito; arquivo/player humano preservados |
| Conteúdo malicioso e outra identidade | Sem segredo, ação indevida ou dados de outro contato |

Já executado: **84 testes focados em três arquivos**, incluindo redação, contrato
do adaptador e avaliação do orquestrador. Passaram com transportes fictícios,
sem API paga ou envio externo. Cobrem texto do adaptador, consumo, retomada sem
reinferir, fonte estática de produto, fontes ausentes/antigas, identificadores e
condições novas recusados, referência inválida e tomada humana. A primeira
tentativa não iniciou o runner por permissão do cache compartilhado; a execução
autorizada posterior passou. Não classificar esses testes como prova de API real.

Prova paga atual, PostgreSQL, controles do painel, verificações gerais, QA visual
e publicação estão registrados em **Execução de 19/10/2026**. As provas de 11/10
não substituem a validação do código alterado agora.

## Backup e publicação

O destino externo atual é Google Drive. O documento dono da migração está na
antiga origem de backups, em `docs/features/donatella-crm/BACKUP-DRIVE.md`.
O repositório `Donatella/Operacao` é horário e inclui bancos, filas, conversas,
anexos, configurações e infraestrutura. O estado e os recibos são privados na VPS.
Não reativar R2 nem criar outro arquivo externo permanente.

As provas de restauração de 13/10 e seus snapshots são históricas. Antes de SQL
novo, confirmar o snapshot atual e sua integridade. A configuração persistida e
o conhecimento novos devem entrar na cobertura existente. Não restaurar banco
antigo sobre produção. Publicação usa `npm run publicar`, com origem oficial,
checkout limpo e retorno apenas de código.

Estado final, revisão funcional, hashes, horário da publicação, snapshot atual,
testes da candidata e conferência HTTPS constam na execução abaixo. Crédito,
autorização de consumo, configuração essencial, teste e publicação foram
conferidos antes da declaração de prontidão.

## Execução de 19/10/2026

- Revisão funcional publicada: `bf431afa0a2412028a7c602614b3b95ea5962357`.
  Publicação oficial em `2026-10-19T18:51:40.335342Z`.
  Runtime `e0d4a1213fe903163588a0867b6f88faf7d545fcb19c02e91ea7f5b8303344be`;
  manifesto `6ff5d723df7b73e69a90576554212048a122abbcf4386999266ea6db814a2caa`.
  Mesmo contêiner, saudável. Número, webhook, credenciais, compose e banco preservados.
- SQL041 aditivo aplicado aos dois bancos após três dumps privados com leitura
  integral. O banco operacional estava OFF e permaneceu OFF. O ensaio legado
  estava automático; foi pausado com versão, comando idempotente, auditoria e
  preservação do estado anterior. O bloco de pausa passou antes no PG fictício.
- Configuração operacional versão 3; Skills e Tom versão 2. Quatro fontes
  oficiais estáticas registram o documento, seu SHA, responsável e aprovação
  desta execução. Não foi criado caso fictício, contato ou conversa na operação.
  Pedidos, entrega e agenda sem fonte validada ficam desativados como skills.
  Ausência de preço/prazo/fonte atual segue para a equipe.
- Bateria: **1.339 testes passaram**, um teste opt-in de banco ficou ignorado.
  A integração PG foi executada separadamente, com **131 verificações**.
  Depois das novas guardas, **12 testes focados** passaram; há sobreposição
  com a bateria geral. Tipos, lint, compilação e regras visuais dos três
  consumidores passaram. Interface clara e escura conferida em prévia fictícia.
- Ensaio complementar do fluxo preparado: **73 verificações aprovadas** em
  `testes/atendimento/agente-fluxo-preparado-banco.ts`. Entrada fictícia percorreu
  materialização, orquestrador, redação diferente da fonte literal, decisão
  persistida, intenção única, autoria IA, revalidação e worker. Três chamadas de
  modelo foram simuladas; um envio foi aceito pelo simulador. Replay não duplicou
  resposta. Tomada humana cancelou a intenção pendente e impediu enfileiramento
  durante a geração. Zero chamadas externas, Meta ou API paga; estado final OFF.
  O PostgreSQL fictício foi parado. A falha inicial vinha do horário futuro da
  própria fixture; a correção ocorreu somente no teste. Código publicado intacto.
  Bundle SHA-256 `2182e6c9cd2665f50652c2f6f7c7f5cc42517f063a59a38a4e7a34d4d1fdfcbb`;
  resultado privado preservado em
  `<LOCAL_PRIVADO_PRESERVADO>`.
- API Anthropic consultada em leitura no dia 19: modelo existente disponível.
  O proprietário confirmou saldo/faturamento ativo da API. O teste real pelo
  painel usou `claude-sonnet-4-5-20250929`, configuração 3, com contexto e fonte
  fictícios: **1.278 tokens de entrada e 191 de saída**, resposta redigida e
  fundamentada. Não criou fila Meta nem mensagem WhatsApp. Preço/prazo sem
  fonte produziram apoio humano, sem inferência e sem reserva adicional.
- O diário histórico de nove tentativas foi relido: US$ 4,50 reservados sob a
  autorização original de US$ 10. A nova inferência reservou US$ 0,50. Total
  conservador: **US$ 5,00 de US$ 10**, sem reset, recarga, compra ou aumento.
  Isso não representa fatura conciliada. O limite futuro permanece US$ 5/dia.
- HTTPS saudável, sessão anônima recusada com 401 e painel autenticado conferido.
  Saúde pública confirma `iaAutomatica:false`, capacidade do painel preparada,
  voz e automações Woo desativadas, envio humano com autoridade VPS preservado.
  O botão Ligar abre confirmação; nenhuma ativação de produção foi executada.
- Backup anterior Drive relido: `8d0580d8f596e064bf160141623f2a62b3cd262b083495cd2b62489ecd12054c`.
  Backup posterior: `5fd33f9deb94e70e071ed2772fea3891b4480f73c02a141b561badd99d503da1`.
  Releitura externa concluída em `2026-10-19T19:00:57.420998Z`. Configuração,
  compose, manifesto, runtime e SQL041 conferidos por hash. Dumps relidos;
  o dump operacional tem 63.119.424 bytes e SHA-256
  `ebf8f379f2d97526f17a7aaa441ff7f015ced0277d0600465a44c4e4409011ee`.
  O catálogo do dump confirma dados das tabelas de controle, testes,
  configuração e das seis tabelas de apoio/conhecimento. Não houve restauração,
  exclusão ou reinício do serviço durante essa conferência. A rotina existente,
  o destino e a cota do Drive foram preservados. O recibo privado está em
  `RAIZ_REMOTA_OPERACAO/backups-prepublicacao/painel-donatella-df92e1f3ad94401a/pos-publicacao-5fd33f9deb94e70e-prova.json`.

A capacidade privada do painel libera o adaptador nativo no processo. Ela não
é o estado da agente. O modo PG continua OFF até o comando autorizado separado.
O envio repete a validação de modo, versão, responsável e janela do cliente.
Áudios e arquivos humanos permanecem disponíveis; STT/TTS e alertas/follow-ups
externos automáticos não foram ativados. Retorno explícito à IA prepara futuras
entradas elegíveis e não dispara uma resposta ao histórico antigo.

## Uso pelo proprietário

1. Abrir [Agente & IA](https://atendimento.grazinghub.com.br/operacao/agente).
   O painel mostra **Desligada**. Clicar **Ligar Donatella** e confirmar quando
   desejar iniciar. A ativação não exige comando na VPS nem alteração técnica.
2. A agente considera novas entradas elegíveis. Conversas assumidas pela equipe
   continuam humanas. O horário salvo é segunda a sexta, das 08h às 18h,
   em `America/Sao_Paulo`. O limite operacional permanece US$ 5/dia.
3. Usar **Pausar Donatella** no mesmo painel para suspender a operação. A pausa
   invalida respostas automáticas ainda não enviadas. O atendimento humano segue
   disponível. A tomada humana por conversa também impede resposta pendente.
4. Consultar **Chat → Dúvidas do Agente** para questões sem fonte. A agente está
   preparada para recepção, triagem, tábuas, presentes e coleta para eventos.
   Preço, prazo, estoque e exceções sem fonte atual seguem para a equipe.
   Áudio ou anexo sem suporte também segue para apoio, com o arquivo preservado.

O teste real usou a API Anthropic, separada do Claude Pro. Não contratou plano,
comprou créditos nem aumentou limites. A ativação e os envios a clientes não
foram ensaiados em produção; controles, cancelamento e transporte humano foram
validados com dados fictícios em ambiente isolado.

## Correção prioritária de 19/10 — aba antiga e confirmação

O relato posterior expôs uma lacuna da entrega: a conferência usou uma aba nova,
mas outra aba já aberta continuou executando a interface anterior. Navegar pelo
menu da aplicação não recarrega o JavaScript. `Cache-Control: no-store` não
substitui o código que já está em execução.

Diagnóstico em leitura, antes de repetir qualquer gravação:

- A aba do proprietário apontava `index-bW37DK9w.js` e mostrava o seletor antigo
  de modo. A release `bf431afa...`, o contêiner e o manifesto coincidiam com a
  entrega. O HTML ativo apontava `index-CadlYV6L.js`, com Ligar/Pausar. Após
  recarregar a mesma aba, ela passou a carregar esse arquivo e mostrou Ligar.
  Não havia outra rota legada, Service Worker ou ocultação por permissão.
- A configuração operacional estava **desligada**, versão 4, com autoridade
  automática falsa e sem marco de ativação. O proprietário mantinha permissão
  de administrador e vínculo ativo. A capacidade do painel estava preparada.
  Modo operacional, autoridade VPS e transporte humano permaneciam habilitados.
  Limites continuavam em 500 centavos USD/dia; voz e Woo permaneciam desligados.
- A versão 4 veio do Tom salvo às **16h28min11s**, horário de São Paulo:
  `configurar_agente_tom`, Tom versão 3 e versão geral da agente 4. A auditoria
  não mostrava salvamento da configuração da agente nem ativação nesse intervalo.
- O código anterior enviava mudança de modo por `/agente/configurar`. O servidor
  atual recusa essa mudança com `AGENTE_USE_CONTROLE_LIGAR_PAUSAR`. O mapeamento
  HTTP devolvia 503, e o cliente tratava qualquer 503 de POST como confirmação
  incerta. Há também risco distinto de POST confirmado seguido de falha na
  consulta de atualização da tela. Esses resultados exigem tratamentos separados.
- Aplicação e proxy não guardavam requisições no intervalo analisado. Não foi
  possível recuperar o status histórico exato da tentativa recusada. Não repetir
  uma gravação de produção para obter essa prova. A reprodução pertence ao ensaio
  isolado; ausência de auditoria de uma transação recusada não prova sua ausência.

A correção mantém Salvar separado de Ligar/Pausar. A consulta
`POST /agente/reconciliar` é uma leitura do recibo do comando, com permissão,
CSRF, mesmo UUID, autor e hash. A trava do comando aguarda commit ou rollback.
Ela não executa o pedido nem cria outra operação. A interface preserva o pedido
pendente por usuário e ambiente até conferir o resultado e o estado atual.

O servidor informa a interface publicada no cabeçalho `X-Atendimento-Interface`.
A aba confere essa identificação em leitura. Quando houver atualização, mostra
um aviso. A atualização depende de ação do usuário e protege edições, rascunhos
e operações pendentes. Não reinicia o atendimento nem altera suas autoridades.

Validações focadas da correção:

- 32 testes HTTP passaram. Recusas conhecidas retornam 4xx. Erros têm referência
  e log dirigido com rota fixa, status, código permitido e horário. O log não
  contém corpo, pessoa, segredo, SQL ou stack. Erros de transporte permanecem
  distintos de uma recusa explícita.
- Cliente real → HTTP em loopback → serviço → PostgreSQL isolado: **75
  verificações**, **17 requisições**. Salvar e Ligar com resposta perdida após
  commit recuperam o recibo. Pausar seguido de falha na consulta também recupera
  o estado. Replay conserva UUID e versão. Outro autor/hash e falta de permissão
  não confirmam a operação. A consulta espera commit ou rollback e não grava.
  Estado final OFF, envio humano independente, zero chamadas externas/Meta/API
  paga. O banco fictício foi parado; provas e bases anteriores foram preservadas.
  Bundle `c18c356a01ca9faa65369ad4c608e0698d3fd9ef66ee1e1d744aba762411b602`.
  Resultado privado em
  `<LOCAL_PRIVADO_PRESERVADO>`.
- UI/API: rodada com 78 testes aprovada. A regressão adicional de consulta antiga
  atrasada passou no arquivo de recuperação, com nove casos. Há sobreposição
  entre as rodadas; não somar os totais. Aviso de versão: três testes aprovados.
  Tipos, lint, compilação e regras visuais dos três consumidores passaram.

- Bateria final: **1.371 testes aprovados**, um teste opcional de banco ignorado.
  A primeira rodada paralela excedeu o tempo de localizar a conversa no primeiro
  teste de anexos humanos. O arquivo passou isolado, com 12 casos, sem alteração
  de código. A rodada completa com dois workers passou em 90,67 segundos.
- QA visual no Chrome com build atual e API fictícia local: Salvar modelo
  preservou OFF. Ligar confirmado mostrou Ligada/Pausar. Pausar e recarregar
  preservaram OFF e envio humano habilitado. Aparência clara e escura conferida.
  Prévia e banco de teste encerrados; nenhum envio ou ativação em produção.
- Revisão dirigida do diff não encontrou bloqueio material. Abas anteriores à
  criação do aviso precisam da primeira recarga manual. O aviso protege as
  versões seguintes; não afirmar que código antigo já aberto foi substituído
  sozinho. A aba do proprietário foi reconferida após publicar e renovar a sessão.

Publicação oficial da correção em **19/10/2026, 17h07min05s**, horário de São
Paulo (`2026-10-19T20:07:05.122046Z`):

- Revisão `bb02a866d8f030d423c246b81b6952e65c7d536a`.
  Runtime `e1b477adfe55dc2aaa697b53c84e7518c61294ac58188b4ad8ef02d54683f2dc`;
  manifesto `5f165d268e68f6b686051ab00943c42474df0035677db73590f6e186a090a556`.
  O publicador preservou configuração e compose. Não executou SQL nem restaurou
  banco. Mesmo contêiner, saudável. Retorno somente de código preservado em
  `RAIZ_REMOTA_OPERACAO/releases-preservadas/repositorio-bb02a866d8f030d423c246b81b6952e65c7d536a`.
- HTTPS 200, `Cache-Control: no-store` e `X-Atendimento-Interface` apontando para
  `/operacao/assets/index-EqWj18vz.js`, igual ao build conferido na prévia.
  Após publicar, o banco continuava na versão 4, OFF, autoridade automática falsa
  e sem marco. O transporte humano seguia habilitado com autoridade VPS.
  Orçamento, horários, número, webhook, credenciais, voz/Woo e rotina de backups
  não foram alterados. Não houve teste pago ou ativação de IA nesta correção.
- A sessão do navegador expirou na primeira tentativa de conferência final. O
  proprietário renovou o acesso. A conferência autenticada no Chrome confirmou
  `/operacao/agente`, carregando `index-EqWj18vz.js`. O painel mostra **Ligada**,
  **Pausar Donatella** habilitado e **Salvar configurações** separado, desabilitado
  por não haver alterações. O atendimento humano aparece com envios habilitados.
  Uma aba nova, na mesma sessão, confirmou o estado salvo sem aviso de operação
  pendente. As duas tentativas de captura de imagem excederam o tempo do navegador;
  a conferência foi feita pela árvore de acessibilidade e pelos controles reais.
- Entre a publicação OFF e essa conferência, a auditoria registrou um comando
  `ligar_donatella` atribuído ao proprietário às **17h17min00s** de 19/10/2026
  (`2026-10-19T20:17:00.476Z`). Há um recibo na mesma transação, versão 5, e o marco
  de ativação corresponde ao horário mostrado no painel. A auditoria não identifica
  a aba ou o dispositivo que enviou o comando. A leitura atual confirma modo
  automático e autoridade automática verdadeiros, com transporte humano habilitado.
  O horário atual mostrado é todos os dias, das 00h às 23h59; ele difere do horário
  observado antes da publicação. Nenhuma configuração, ativação, pausa ou mensagem
  foi enviada pelo agente técnico nesta conferência. A ativação existente foi
  preservada. O estado real ao encerrar é **ligada** por comando do proprietário.

A publicação anterior acima continua identificada pelo seu hash; não confundir
as duas revisões. A conferência autenticada está concluída. Os testes de mudança
de estado e recuperação da confirmação permanecem os ensaios isolados registrados
acima; não foram repetidos com clientes na produção.
