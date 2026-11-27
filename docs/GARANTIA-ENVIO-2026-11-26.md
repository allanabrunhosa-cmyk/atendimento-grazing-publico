# Garantia de envio e agilidade — 26/11/2026

## Sintoma

Atendentes viam mensagens com "Envio sem confirmação" e demora entre enviar e a bolha atualizar. A navegação entre conversas também ficava lenta em horário de movimento.

## Causa

Leitura agregada da operação, sem conteúdo de conversas:

- Todas as tentativas incertas tinham o código `LEASE_EXPIRADO_RECONCILIAR`: 2, 5, 15 e 11 por dia entre 23 e 26/11.
- Quase todas tinham status `sent`/`delivered` da Meta sem intenção vinculada. A Meta aceitou e entregou; o serviço não gravou o recibo. O cliente recebeu a mensagem, mas a bolha ficou incerta e sem o wamid.
- O pool local tinha três conexões e uma fica presa no `LISTEN` do tempo real. Restavam duas para telas e worker, com espera máxima de três segundos. Numa rajada de consultas, o worker não conseguia conexão para gravar o resultado e a exceção era descartada sem registro. O mesmo limite produzia recusas `ENVIO_FALHOU` antes do POST e respostas lentas nas telas.
- Um único laço recebia um webhook, processava automações e enviava uma mensagem por rodada, com pausa fixa de um segundo. O tempo mediano da fila ao aceite era de 2 s, com pico de 12 s.

## Correção

- O resultado de um POST é regravado com esperas crescentes dentro do lease, sem novo POST.
- Todo envio leva `biz_opaque_callback_data` com o ID da intenção. A Meta devolve o valor nos status assinados. Uma intenção sem wamid, em processamento ou incerta, é conciliada pelo status: recebe o wamid e segue para aceito, entregue ou lido. Um wamid já usado nunca é reaproveitado.
- Falha de infraestrutura antes do POST devolve a intenção à fila (até quatro rodadas) em vez de virar recusa.
- O worker tem pool próprio. O pool local passou de três para oito conexões, o central de duas para quatro, com conexões ociosas mantidas por um minuto.
- A identidade do HUB fica em memória por três segundos (máximo de cinco). O login sempre relê. Uma revogação passa a valer em até três segundos.
- Recebimento e envio rodam em laços separados, esvaziam a fila sem pausa e acordam com o aviso do banco. Falhas do laço são registradas com código, sem conteúdo.
- O agrupamento de eventos caiu de 350 ms para 100 ms no servidor e de 400 ms para 150 ms na tela.

Nenhuma migration. Nenhuma repetição automática de POST: resultado ambíguo continua sem novo envio.

## Limite conhecido

Tentativas incertas anteriores a esta publicação não levaram a referência e não são conciliadas automaticamente.

## Validação

- `testes/atendimento/garantia-envio.test.ts`: referência no POST, guarda da conciliação e memória da identidade.
- `testes/atendimento/operacao-garantia-envio-banco.ts`: 22 verificações em PostgreSQL local fictício, com transporte simulado. Cobre regravação após falha, conciliação por status, corrida entre status e worker, wamid alheio, reenfileiramento e recusa de domínio. Nenhum envio externo.
