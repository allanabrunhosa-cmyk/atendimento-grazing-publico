# Lista única, busca e carregamento de conversas — 15/10/2026

## Escopo

- [x] Reutilizar o contrato do servidor: até 30 conversas por pedido.
- [x] Carregar o próximo bloco perto do fim da própria lista.
- [x] Remover as ações e o indicador de página da lista de conversas.
- [x] Manter seleção, filtros, permissões e histórico.
- [x] Conferir cancelamento, atualizações, falha e nova tentativa.
- [x] Exibir uma conversa por contato e reabrir a mesma conversa.
- [x] Proteger cadastro e vínculo por telefone exato, inclusive sob concorrência.
- [x] Filtrar ao digitar e oferecer X para limpar a busca.
- [x] Mover busca e filtro para o cabeçalho da lista.
- [x] Substituir Todos pelo ícone de conversas abertas, com contagem e nome acessível.
- [x] Tipos, lint, compilação, regras de design e imagens.
- [x] Bateria geral final: 1.027 testes aprovados; um teste opt-in de banco ignorado.
- [x] Publicação e conferência em produção.

Não alterar a paginação de Contatos, Atividades ou das mensagens. Sem migration, alteração de configuração de envio ou uso de dados reais para testar.

## Contratos

`useListaConversas` carrega apenas o próximo bloco durante a rolagem. A trava síncrona evita pedidos simultâneos. O identificador da conversa remove duplicações. A indicação `mais` encerra o carregamento. Respostas de outro filtro, sessão ou geração são descartadas, mesmo se o transporte ignorar o cancelamento.

`FimListaConversas` observa o final da lista com margem de 120 pixels. A rolagem também funciona por teclado e quando IntersectionObserver está indisponível. Falhas preservam as linhas carregadas e oferecem Tentar novamente; não iniciam um laço de tentativas automáticas.

Receber uma atualização recompõe e substitui atomicamente o prefixo carregado. Isso atualiza a ordem por pendências e última mensagem, remove conversas que saíram do filtro e preserva a seleção aberta. Cada página tem seu próprio snapshot no servidor; não há promessa de snapshot global entre páginas. Busca, estado e canal reiniciam o prefixo e a rolagem. Permissões e o limite de 30 permanecem no servidor existente.

## Conversa e telefone

O repositório escolhe uma representante por contato antes de aplicar filtros, contagens e paginação. Prefere a conversa aberta; depois usa última mensagem, criação e identificador para desempate. O ambiente real ou fictício é recortado antes da escolha. Sessões antigas permanecem no banco e no histórico completo; não são excluídas nem mescladas.

Início manual e recebimento pelo webhook reutilizam a representante encerrada. A reabertura preserva o identificador e registra atividade com autoria. Versão e idempotência continuam obrigatórias. Intenções antigas não recuperam autorização de envio pela reabertura. A data da última mensagem do cliente continua real; a reabertura não inventa uma janela de 24 horas.

Cadastro e vínculo usam travas na ordem identidade, telefone, contato e conversa. A comparação considera os dígitos exatos. Não acrescenta nem remove o nono dígito. Um único contato legado sem identidade pode receber o vínculo do webhook. Outra identidade com o mesmo telefone produz IDENTIDADE_CONFLITO, sem novo contato. O receptor durável preserva o evento para tratamento; não descarta a mensagem.

A guarda também impede que Woo crie contato com telefone já vinculado a outra identidade. O produtor Woo permanece desarmado. Sua política comercial de reabertura não mudou: se for ativado, ainda pode criar outra sessão histórica quando só há encerradas. A lista continua escolhendo uma representante. Alterar essa política exige trabalho próprio antes de ativar o produtor.

## Busca e interface

CampoBusca segue o contrato do componente oficial do HUB: lupa, campo controlado e X sutil com nome acessível. Limpar devolve o foco ao campo. A busca remota aguarda 300 ms após a digitação; limpar é imediato. Enter continua válido, mas não é necessário. O padrão foi aplicado ao Chat operacional, Contatos, consulta histórica e escolha de template. A busca local dos templates é imediata.

Busca e filtro ficam no cabeçalho da lista operacional, dentro do mesmo bloco fixo dos filtros rápidos. As indicações redundantes de quantidade e Ao vivo foram removidas. O ícone de caixa de entrada representa conversas abertas, mantém a contagem e expõe nome acessível. Contatos preserva sua posição e sua paginação.

## Validação e publicação

Provas de banco usam PostgreSQL isolado sem rede pública, números fictícios e transporte externo proibido. Dados de ensaios anteriores permanecem preservados em bancos privados. As provas cobrem concorrência, reabertura, conflitos de identidade, histórico, paginação e isolamento entre ambientes.

Resultados confirmados antes da publicação:

- `npm test -- --maxWorkers=1 --testTimeout=15000 --hookTimeout=15000`: 63 arquivos aprovados e um opt-in ignorado; 1.027 testes aprovados.
- Prova conversa única: 75 asserções.
- Prova cadastro e início: 53 asserções.
- Prova histórico completo: 1.173 asserções, 1.120 linhas e 23 páginas.
- Tipos, lint e lint adicional do CampoBusca aprovados.
- Regras de design: oito arquivos, nenhum achado.
- Compilação operacional aprovada, sem credenciais incluídas.
- Prévia no navegador: blocos de 30, 60 e 73 conversas, busca sem Enter, limpeza e foco; cabeçalho claro e escuro.
- Tela estreita: 320 pixels, sem rolagem horizontal; campo e filtro visíveis no cabeçalho.

A primeira execução geral atingiu limites de tempo e de inicialização de processos. A segunda, com dois processos, apontou espera curta no preparo do teste de busca e um timeout de teste legado de IA. O preparo agora conclui as atualizações React antes de medir o debounce. A execução final é sequencial e usa margem de 15 segundos por teste, sem alterar os limites operacionais da aplicação.

Provas e imagens locais ficam em `.tmp/lista-automatica-20261015/`, fora do Git. Imagens são evidência técnica em ambiente fictício; a referência visual permanece Em revisão.

## Publicação

Publicado em 15/10/2026 às 13h41 BRT pelo publicador oficial. Revisão funcional `ca4319617fc61468612dddbbab598122001b762a`. Runtime SHA `25cc77b3e528cf96502d57a233f0f7a052cd75ce010528ae859a7cf59992755f`. Manifesto SHA `6cea238453d5a97067ec7072cc43b9374aab924527af98707ee6aa56108d79b2`. Interface `index-BnhpGQL6.js`.

Serviço healthy, sem reinícios automáticos. Saúde e Chat HTTPS retornaram 200; sessão sem autenticação retornou 401. No Chat autenticado, a conferência de leitura confirmou o novo arquivo de interface, busca e filtro dentro do cabeçalho, ícone de conversas abertas, ausência da paginação antiga e nenhum alerta. Nenhuma conversa real foi aberta para testar.

A conferência repetida às 13h43 BRT manteve o mesmo contêiner, revisão e manifesto, serviço healthy e zero reinícios automáticos.

Banco, credenciais, Compose, imagem e configuração privada foram preservados. Envios humanos continuam `true/vps`; IA, voz automática e automações continuam desarmadas. Não houve SQL nova, restauração, exclusão de mensagens ou envio real de teste. Retorno somente de código: `RAIZ_REMOTA_OPERACAO/releases-preservadas/repositorio-ca4319617fc61468612dddbbab598122001b762a`.

O contêiner PostgreSQL fictício e a prévia local foram encerrados. Seus bancos e provas permanecem em `<LOCAL_PRIVADO_PRESERVADO>`. A cópia local e os arquivos ignorados permanecem preservados. A cópia não está no catálogo permitido de manutenção; não foi adicionada ao catálogo e nenhum cache foi removido.
