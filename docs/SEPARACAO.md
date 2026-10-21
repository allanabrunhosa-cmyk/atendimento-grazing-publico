# Separação do atendimento — 13/10/2026

Base confirmada pelo manifesto da VPS: `grazing-hub@cb4b19c095702762550ae715900d294f5d3c47f0`.
A referência inicial `codex/donatella-crm-v2` não continha todas as últimas publicações. A revisão escolhida inclui contatos, templates e permissões já em operação.
Alterações locais de anexos e citações da outra frente ficaram fora da extração.

O novo repositório contém a interface operacional, login, receptor, workers, serviços, integrações Meta/Woo/IA, SQL manual, ferramentas relacionadas e testes. O cliente Prisma contém apenas a camada técnica de carga; não replica o schema comercial do HUB.
Os componentes visuais necessários ficam versionados aqui. Não há cópia manual de arquivos do HUB durante a compilação.

O HUB mantém cadastros centrais, contas, perfis, matriz de permissões, a view `atendimento_integracao.identidade` e o atalho para o domínio do atendimento.
A operação continua consultando essa view com a conexão central em modo somente leitura. Revogação e autorização permanecem no servidor.

O histórico foi filtrado por caminhos explícitos e dependências transitivas. Há 146 commits de origem, com autoria, datas, mensagens e SHA original registrados. Foram conferidos os 730 blobs transferidos. Nenhum ambiente real, backup, mídia de cliente ou credencial foi transferido.
O histórico do HUB e `sdrgrazing` ficaram intactos.

Validações locais: instalação independente, schema/cliente Prisma, tipos, lint oficial, compilação, 768 testes do atendimento e seis provas da publicação/retorno.
Uma fixture de contatos foi atualizada para reconhecer a consulta já publicada, sem alterar as asserções ou o código funcional.
O runtime da nova compilação é igual ao runtime ativo após desconsiderar comentários de caminho do compilador. JavaScript e CSS do Chat são iguais aos da base. Favicon e HTML diferem apenas pela normalização de fim de linha. O CSS do login deixa de incluir utilitários de módulos ausentes do novo projeto.

Publicação: `npm run publicar -- --aplicar`. Exige a revisão em `main` no repositório oficial e checkout limpo. O instalador compara o manifesto ativo para impedir publicação paralela e usa os locks existentes do backup.
O processo troca runtime/web e mantém os auxiliares e SQL anteriores. Não aplica SQL, não restaura bancos, não cria serviços e não modifica credenciais ou a rotina do Drive.
O manifesto e `RAIZ_REMOTA_OPERACAO/publicacao-origem.json` registram a origem nova. O recibo guarda o caminho da release anterior para retorno somente de código.

O coletor histórico estava `unhealthy` antes da separação. Ele não foi reiniciado ou alterado por esta tarefa. Essa pendência anterior não foi apresentada como corrigida.
