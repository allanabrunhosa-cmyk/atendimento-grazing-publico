import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
const destino = '.tmp-homologacao/duvidas-ensaio';
await mkdir(destino, { recursive: true });
await build({ entryPoints: ['testes/atendimento/duvidas-banco.ts'], outfile: destino + '/duvidas-banco.mjs', bundle: true, platform: 'node', target: 'node22', format: 'esm', packages: 'external', plugins: [{ name: 'servidor-cli', setup(b) { b.onResolve({ filter: /^server-only$/ }, () => ({ path: 'server-only', namespace: 'noop' })); b.onLoad({ filter: /.*/, namespace: 'noop' }, () => ({ contents: '', loader: 'js' })); } }] });
await copyFile('scripts/atendimento/sql/019-duvidas-aprendizagem-destino.sql', destino + '/019-duvidas-aprendizagem-destino.sql');
await copyFile('scripts/atendimento/ensaiar-duvidas-isolado.sh', destino + '/ensaiar-duvidas-isolado.sh');
console.log('Pacote de ensaio fictício compilado, sem credenciais ou dados reais.');
