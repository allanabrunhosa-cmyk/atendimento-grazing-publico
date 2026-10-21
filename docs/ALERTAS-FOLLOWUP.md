# Alertas de follow-up — 19/10/2026

## Objetivo e critérios

Agendar um lembrete manual por conversa. Mostrar o sino desde o cadastro, na área inferior direita do slot, junto do aviso de aguardando resposta. Ao vencer, o sino passa a pulsar. Manter o aviso até conclusão ou cancelamento explícito. Destacar a empresa ou o contexto informado na descrição do contato, com peso menor que o nome da pessoa.

- [x] Botão de sino no cabeçalho. Formulário padrão com dia, hora e atalhos de 1 hora, 3 horas, 1 dia, 3 dias e 7 dias.
- [x] Horário de Brasília explícito. Prazo mínimo de 1 minuto e máximo de 365 dias, conferido no servidor.
- [x] Agendar, reprogramar, concluir e cancelar. Repetição idempotente e versão própria.
- [x] Permissões `consultar` e `atender`, ator humano e ambiente revalidados em transação e replay.
- [x] Uma pendência por conversa. Fechamento, reabertura e mensagens preservam o lembrete.
- [x] Registro macro em Atividades. Sem timer, intenção de envio ou alteração da janela de resposta.
- [x] Empresa/contexto destacado na lista, cabeçalho, painel e cadastro. Campo existente e permissões preservados.
- [x] Prova PostgreSQL isolada: 82 verificações, sem duplicações nem envios externos.
- [x] Validação final de interface, regressões, tipos, lint e compilação.
- [x] Backup privado verificado e SQL040 nas duas bases operacionais.
- [x] Publicação oficial e conferência HTTPS.

## Contrato e operação

`POST /conversa/:id/lembrete` recebe ação, UUID de idempotência e versão. Reprogramar, concluir e cancelar também exigem o ID do lembrete. O replay retorna a pendência atual, após conferir a autorização. Uma leitura anterior ao salvamento é invalidada na interface para não desfazer o resultado confirmado.

A SQL manual e aditiva `040-operacao-lembretes-humanos.sql` cria `atendimento_operacao.lembrete_conversa` e o índice único parcial de pendência por conversa. Deve ser aplicada em `donatella_operacao` e `donatella_ensaio_operacao` antes da nova versão. Não reaplicar migrations anteriores. A conta da aplicação pode consultar, inserir e atualizar; não pode excluir. O backup pode consultar.

Lista e histórico projetam só a pendência. Datas usam UTC canônico; o formulário converte os componentes no fuso `America/Sao_Paulo`. O prazo visual usa o relógio do servidor mais um delta monotônico. A lista atualiza o vencimento a cada 15 segundos e ao voltar à aba. Redução de movimento mantém o sino estático.

O sino marca uma tarefa para a equipe. Não envia mensagens, não reabre atendimentos e não ativa automações. Novos agendamentos após conclusão ou cancelamento criam outro registro. O histórico dos lembretes e a auditoria permanecem no banco.

## Validação e publicação

A bateria final passou com 1.228 testes; um teste condicionado a PostgreSQL ficou sem execução nessa bateria. A prova dedicada deste recurso passou separadamente com 82 verificações, em PostgreSQL sem rede nem portas públicas. Inclui concorrência, replay após conclusão/cancelamento, revogação, ambiente, grants e preservação ao fechar/reabrir/receber mensagem. Não foram criados contatos nem enviados conteúdos para clientes reais.

Tipos, lint, compilação e análise de design passaram. O teste de interface cobre o vencimento sem outra leitura, posição do ícone, permissões, conversa encerrada, rascunho, retorno do foco e histórico atrasado sem apagar ou ressuscitar lembretes. A prévia fictícia nos temas claro e escuro foi conferida no navegador. Arquivos de evidência locais: `.tmp/followup-20261019/`.

A SQL040 foi aplicada em 19/10/2026 às 11h48 BRT nas duas bases, após dumps privados verificados com índice e SHA-256. Backup: `<LOCAL_PRIVADO_PRESERVADO>`. SQL SHA-256: `1158a0a37e96e506f3a3d555bdaf615b1a9cf678b3cd0a1cc765a42096cc4351`. Não houve restauração nem modificação de mensagens. O PostgreSQL fictício foi parado; dados e relatórios foram preservados em `<LOCAL_PRIVADO_PRESERVADO>`.

Publicado pelo publicador oficial em 19/10/2026 às 11h56 BRT. Revisão funcional `8cb81c382e6c64af0d5bca90390da65dd91f74d1`. Runtime SHA-256: `eab0a3c7a59279a0bd2925c2b3e8b9c7c8fad7c2b635b01fd9e2a776b0642691`. Manifesto SHA-256: `8f812cbbc08f42cff712c7f6fd625fd13dfa86ff3e11e84b2b23c60f23d649e6`. Interface `assets/index-veFgZONN.js`, conferida por hash e presença dos componentes.

Às 11h57 BRT, o serviço estava healthy, sem reinícios automáticos. Saúde e Chat HTTPS retornaram 200; sessão sem autenticação retornou 401. O arquivo da interface permanece protegido por sessão. Configuração, Compose, imagem e container foram preservados. Envios humanos permanecem `true/vps`; IA, síntese de voz e automações WooCommerce permanecem desarmadas.

Retorno somente de código: `RAIZ_REMOTA_OPERACAO/releases-preservadas/repositorio-8cb81c382e6c64af0d5bca90390da65dd91f74d1`. A SQL aditiva e os lembretes devem ser preservados em eventual retorno de código. Nenhum banco foi restaurado.

A aba de testes, o servidor local desta tarefa e o PostgreSQL fictício foram encerrados. O checkout, as provas e os arquivos ignorados foram preservados. O caminho não foi incluído no catálogo de limpeza. O espaço livre final ficou em 11,7 GB.

As referências visuais permanecem Em revisão até aprovação humana. O espaço livre inicial do C: foi 11,7 GB. Dependências e checkout existentes foram reutilizados, sem limpeza automática.

## Caminhos

- Interface: `apps/atendimento-chat-consulta/AlertaFollowupOperacao.tsx`, `lembrete-followup-horario.ts`, `IndicadorFollowup.tsx` e `DescricaoContato.tsx`.
- Contrato e projeção: `src/lib/atendimento/operacao-lembretes.ts`. Transação: `operacao-repositorio-pg.ts`. Rota: `scripts/atendimento/operacao-servidor.ts`.
- Prova PostgreSQL: `testes/atendimento/lembretes-banco.ts`. Testes HTTP, cliente, formulário e integração ficam no mesmo diretório.

## Ajuste da posição — 19/10/2026

O indicador aparece desde o cadastro do alerta. Follow-up e pendência de resposta ficam lado a lado no canto inferior direito do slot. O rótulo diferencia agendado de pendente e informa o horário. Apenas alertas vencidos pulsam; a preferência de redução de movimento desativa a animação. Não há alteração no servidor, no agendamento ou no banco.

Validação desta correção: 10 testes focados e bateria completa com 1.230 testes aprovados; um teste condicionado ao ambiente permanece sem execução na bateria. Tipos, lint, regras de design e compilação passaram. A prévia fictícia mostrou os dois avisos juntos, com relógio e com contagem de não lidas, nos temas claro e escuro. A aba e o servidor local da tarefa foram encerrados. Provas em `.tmp/posicao-followup-20261019/`.

Publicado em 19/10/2026 às 13h31 BRT pelo publicador oficial. Revisão funcional `d188c1d8bcde2a9d4ae8e476a523483aa430f4f0`. Interface `assets/index-C8shZdZe.js`, com hash e área de indicadores conferidos. Manifesto SHA-256 `b84519b75dc5a5e70fc7ca83f0b7c16a4e447c209c78ada502ec5e5b5fcd3e5d`. O runtime do servidor permaneceu igual ao da entrega anterior.

Serviço healthy, zero reinícios. Saúde e Chat HTTPS: 200. Sessão sem autenticação: 401. O arquivo da interface continua protegido. Banco, configuração, Compose, imagem e container foram preservados. Não há SQL nova nem alteração de dados. IA e automações continuam desarmadas.

Retorno somente de código: `RAIZ_REMOTA_OPERACAO/releases-preservadas/repositorio-d188c1d8bcde2a9d4ae8e476a523483aa430f4f0`. Provas e checkout preservados; nenhuma limpeza automática. Espaço livre final do C: 11,7 GB.
