import { readFile } from 'node:fs/promises';
import { avaliarSaudeColetor } from '../../src/lib/atendimento/supervisao-coleta';

try {
  const [estado,pulsacao] = await Promise.all([
    readFile('/estado/supervisao.json','utf8').then(JSON.parse),
    readFile('/estado/processo.json','utf8').then(JSON.parse),
  ]);
  const saude = avaliarSaudeColetor(estado,pulsacao,Date.now(),pid => { try { process.kill(pid,0); return true; } catch { return false; } });
  console.log(JSON.stringify(saude));
  // Docker health representa sincronização recente comprovada, não apenas PID/mtime.
  process.exitCode = saude.coletaSaudavel ? 0 : 1;
} catch {
  console.log(JSON.stringify({ processoAtivo: false, coletaSaudavel: false, falha: 'SAUDE_NAO_COMPROVADA' }));
  process.exitCode = 1;
}
