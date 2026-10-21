import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {Pool} from 'pg';
import {importarBibliotecaMeta} from '../../src/lib/atendimento/operacao-modelos-meta';
const arquivo=process.env.DONATELLA_MODELOS_CONFIG;if(!arquivo)throw Error('META_MODELOS_CONFIGURACAO_PRIVADA_EXIGIDA');
const raiz=process.env.ATENDIMENTO_RAIZ_REMOTA_OPERACAO;
if(!raiz||!/^\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/.test(raiz)||resolve(raiz)!==raiz||/\s/.test(raiz))throw Error('META_MODELOS_RAIZ_PRIVADA_OBRIGATORIA');
let c;try{c=JSON.parse(await readFile(arquivo,'utf8'));}catch{throw Error('META_MODELOS_CONFIGURACAO_INVALIDA');}
if(typeof c.databaseUrl!=='string'||typeof c.metaArquivo!=='string'||!c.metaArquivo.startsWith(join(raiz,'configuracao')+'/')||resolve(c.metaArquivo)!==c.metaArquivo||!c.metaArquivo.endsWith('.json'))throw Error('META_MODELOS_CONFIGURACAO_INVALIDA');
let u;try{u=new URL(c.databaseUrl);}catch{throw Error('META_MODELOS_BANCO_RECUSADO');}if(u.protocol!=='postgresql:'||u.hostname!=='grazing-donatella-operacao-v2-banco'||u.pathname!=='/donatella_operacao'||!u.password||u.search||u.hash)throw Error('META_MODELOS_BANCO_RECUSADO');
const json=await readFile(c.metaArquivo,'utf8');if(Buffer.byteLength(json)>2097152)throw Error('META_MODELOS_ARQUIVO_GRANDE');
const pool=new Pool({connectionString:c.databaseUrl,max:1,statement_timeout:10000});
let payload;try{payload=JSON.parse(json);}catch{throw Error('META_MODELOS_JSON_INVALIDO');}
try{console.log(JSON.stringify(await importarBibliotecaMeta(pool,payload)));}catch(e){throw Error(e instanceof Error&&/^[A-Z0-9_]{1,80}$/.test(e.message)?e.message:'META_MODELOS_IMPORTACAO_FALHOU');}finally{await pool.end();}
