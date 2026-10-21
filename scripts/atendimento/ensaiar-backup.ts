// Ensaio do caminho privado real; proíbe fonte, banco operacional e registro real.
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readFile, open } from 'node:fs/promises';
import { prisma } from '../../src/lib/prisma';
import { prepararCarga, abrirCarga, decodificarCarga, serializarCarga, persistirCarga, type DocumentoCarga } from '../../src/lib/atendimento/carga';
import { arquivarCarga } from '../../src/lib/atendimento/arquivo-carga';
let etapa='pre-condicoes';
async function executar() {
  const url=new URL(process.env.DATABASE_URL ?? 'http://invalido.invalid');
  if (url.protocol!=='postgresql:' || url.hostname!=='127.0.0.1' || url.port!=='65437' || url.pathname!=='/donatella_ensaio_restauracao' || !process.env.ATENDIMENTO_CARGA_SECRET || !process.env.ATENDIMENTO_BACKUP_PRIVADO) throw Error('Ensaio exige destino e chave privados explícitos');
  if (process.argv.slice(2).some(a=>a!=='--revalidar') || process.argv.slice(2).length>1) throw Error('Argumento inesperado');
  const manifesto=join(process.env.ATENDIMENTO_BACKUP_PRIVADO,'..','cofre','ensaio-backup.json');
  if (process.argv.includes('--revalidar')) {
    etapa='revalidacao-persistencia';
    const referencia=JSON.parse(await readFile(manifesto,'utf8')) as {execucao:string;documento:string};
    if (!/^[a-f0-9-]{36}$/.test(referencia.execucao) || !/^[a-f0-9-]{36}$/.test(referencia.documento)) throw Error('Manifesto inválido');
    const arquivo=JSON.parse(await readFile(join(process.env.ATENDIMENTO_BACKUP_PRIVADO,referencia.execucao,`${referencia.documento}.json.enc`),'utf8')) as {hash:string;cifrado:string};
    const restaurada=abrirCarga(arquivo.cifrado,arquivo.hash);
    const prova=await prisma.$queryRaw<{hash:string;cifrado:string}[]>`SELECT hash,cifrado FROM atendimento_migracao.carga_documento WHERE execucao=${referencia.execucao}::uuid AND id=${referencia.documento}::uuid`;
    if (prova.length!==1 || serializarCarga(abrirCarga(prova[0].cifrado,prova[0].hash))!==serializarCarga(restaurada)) throw Error('Persistência divergente');
    console.log(JSON.stringify({ficcao:true,arquivoRestaurado:true,bancoPersistenteRevalidado:true,...referencia})); return;
  }
  const execucao=randomUUID(); const id=randomUUID(); const contato=randomUUID();
  const documento=decodificarCarga(JSON.stringify({execucao,id,tipo:'snapshot',schema:'public',tabela:'contacts',registros:[{chave:{id:contato},dados:{id:contato,name:'Contato fictício exclusivo do ensaio',valor:0}}],proxima:null,fim:true}).replace('"valor":0','"valor":9007199254740993.01')) as DocumentoCarga;
  const carga=prepararCarga(documento);
  etapa='arquivo-privado';
  await arquivarCarga(carga,process.env.ATENDIMENTO_BACKUP_PRIVADO,process.cwd());
  etapa='restauracao-arquivo';
  const arquivo=JSON.parse(await readFile(join(process.env.ATENDIMENTO_BACKUP_PRIVADO,execucao,`${id}.json.enc`),'utf8')) as {hash:string;cifrado:string};
  const restaurada=abrirCarga(arquivo.cifrado,arquivo.hash);
  if (serializarCarga(restaurada)!==serializarCarga(documento)) throw Error('Restauração divergente');
  etapa='conexao-banco';
  await prisma.$queryRaw`SELECT 1`;
  etapa='persistencia-banco';
  const importada=await persistirCarga({...carga,documento:restaurada});
  const repetida=await persistirCarga({...carga,documento:restaurada});
  if (importada.repetida || importada.registros!==1 || !repetida.repetida) throw Error('Importação/retomada divergente');
  const prova=await prisma.$queryRaw<{hash:string;cifrado:string}[]>`SELECT hash,cifrado FROM atendimento_migracao.carga_documento WHERE execucao=${execucao}::uuid AND id=${id}::uuid`;
  if (prova.length!==1 || serializarCarga(abrirCarga(prova[0].cifrado,prova[0].hash))!==serializarCarga(documento)) throw Error('Banco privado divergente');
  const registro=await open(manifesto,'w',0o600);
  try { await registro.writeFile(JSON.stringify({execucao,documento:id})); await registro.sync(); } finally { await registro.close(); }
  console.log(JSON.stringify({ficcao:true,arquivoRestaurado:true,bancoRestaurado:true,repeticaoIdempotente:true,precisaoPreservada:true,execucao,documento:id}));
}
async function principal() {
  try { await executar(); }
  catch (erro) {
    const codigo=(erro as {code?:string}).code;
    const conhecidos=new Set(['P1000','P1001','P1010','P2010','P2028','ECONNREFUSED','ETIMEDOUT','28P01','42501']);
    console.error(`ENSAIO_PRIVADO_INTERROMPIDO: etapa ${etapa}; código ${codigo && conhecidos.has(codigo) ? codigo : 'NAO_CLASSIFICADO'}; sem configuração ou conteúdo nos logs.`); process.exitCode=1;
  }
  finally { await prisma.$disconnect(); }
}
void principal();
