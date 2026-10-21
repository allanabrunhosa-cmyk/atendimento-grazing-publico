import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CENARIOS_IA, executarCenarioIA } from "../../testes/atendimento/fixtures/ia-cenarios";
// Apenas dados demo-*, transporte/provedor em memória e armazenamento exclusivo.
// Nenhuma flag operacional, segredo, webhook ou URL de fornecedor é carregada.
const raiz = resolve(".tmp-homologacao/donatella-ia-ficticia"), prefixo = `demo-avaliacao-${randomUUID().slice(0, 8)}`;
const casos = [];
for (const c of CENARIOS_IA) casos.push(await executarCenarioIA(c, raiz, prefixo));
const resumo = { tipo: "avaliacao-ficticia-sem-envios", executadoEm: new Date().toISOString(), total: casos.length, aprovados: casos.filter(c => c.aprovado).length, metricas: ["desfecho", "fatos", "ferramenta", "encaminhamento"], casos };
await writeFile(join(raiz, "ultima-avaliacao.json"), JSON.stringify(resumo, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ total: resumo.total, aprovados: resumo.aprovados, enviosReais: 0, inferenciasExternas: 0 }));
if (resumo.aprovados !== resumo.total) process.exitCode = 1;
