# Atendimento Grazing

Código do atendimento publicado em <https://atendimento.grazinghub.com.br/operacao/chat>.
O HUB mantém cadastros centrais, usuários e permissões. A operação usa a integração existente, com consulta central somente leitura.

Use Node 22.12 ou superior, até a série 24.

```sh
npm ci
npm run db:validate
npm run db:generate
npm test
python3 testes/atendimento/publicacao-repositorio-test.py
npm run typecheck
npm run lint
npm run build
npm run dev
```

`dev` abre a interface local. Não conecte testes a bancos ou canais reais. Testes padrão usam simulações. As configurações privadas ficam na VPS, fora do Git.

Depois de validar, faça commit e push para `main`. A publicação exige checkout limpo e a mesma revisão no GitHub:

```sh
npm run publicar
npm run publicar -- --aplicar
```

O primeiro comando verifica a candidata. O segundo publica na VPS existente, após aprovação.
Defina chave, destino, raiz remota e locks de backup na configuração operacional privada.
Os parâmetros são obrigatórios; não há fallback para um cofre ou alvo de produção.
Consulte `scripts/atendimento/parametros-publicacao.mjs` para os nomes das opções e variáveis.
Execute ambos na mesma revisão. A verificação vale por uma hora. Uma publicação paralela exige reavaliar a origem e verificar novamente.
O processo mantém a imagem, o contêiner, domínio, webhook, número, credenciais, bancos e backups do Drive. Não executa SQL histórico. Auxiliares anteriores permanecem preservados.
Após publicar, confira apenas a saúde e o acesso ao Chat. O recibo privado informa a release disponível para retorno somente de código, sem restaurar bancos.

Origem operacional: `grazing-hub@cb4b19c095702762550ae715900d294f5d3c47f0`. O runtime inicial reproduziu o SHA-256 ativo `db0f15d22e55b0506b47c335bf283c4c2581e7533e9bbf039793842a2c8dddab`.
Os 146 commits relevantes foram extraídos por lista explícita de arquivos. Cada commit registra o SHA original. Veja [o inventário](docs/EXTRACAO.json).
Alterações locais não publicadas e `sdrgrazing` não fazem parte desta extração.

## Código público e arquivos privados

Código, regras, schema, migrations sem dados reais, testes e exemplos fictícios permanecem
na base pública. As credenciais e os certificados pertencem ao ambiente privado do serviço.
Documentos, exportações e originais operacionais ficam no Drive privado da operação.
Não publique dados pessoais, pedidos, valores reais ou destinos de cofres em commits e PRs.

O histórico anterior permanece privado. Esta candidata não publica as branches antigas.
Após a troca aprovada da base ativa, transfira trabalho pendente por diff revisado e PR.
Não envie o histórico original para a base pública. A troca da origem de publicação exige
revalidar o contrato de origem do build e do publicador; esta branch não fez deploy.
