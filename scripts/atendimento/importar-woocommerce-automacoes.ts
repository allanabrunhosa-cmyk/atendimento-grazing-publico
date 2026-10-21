import {readFile,open,rename,lstat,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {importarAutomacoesWoo} from '../../src/lib/atendimento/operacao-woocommerce-importacao';
function url(v:unknown,host:string,bancos:string[]){if(typeof v!=='string')throw Error('WOO_IMPORTACAO_CONFIGURACAO_INVALIDA');const u=new URL(v);if(u.protocol!=='postgresql:'||u.hostname!==host||!bancos.includes(u.pathname.slice(1))||!u.password||u.search||u.hash)throw Error('WOO_IMPORTACAO_BANCO_RECUSADO');return v;}
let origem:Pool|undefined,destino:Pool|undefined;
try{
 const arquivo=process.env.DONATELLA_IMPORTACAO_CONFIG;if(!arquivo)throw Error('WOO_CONFIGURACAO_PRIVADA_EXIGIDA');
 const c=JSON.parse(await readFile(arquivo,'utf8'));
 if(c.baselineRegras!=='/baseline/regras.json'||(await lstat('/baseline')).isSymbolicLink())throw Error('WOO_BASELINE_CANAL_PRIVADO_EXIGIDO');
 const existente=await lstat(c.baselineRegras).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return null;throw e;});if(existente&&!existente.isFile())throw Error('WOO_BASELINE_ARQUIVO_INVALIDO');
 const baseline=c.wooMarcoFinal?JSON.parse(await readFile(c.baselineRegras,'utf8')):undefined;
 origem=new Pool({connectionString:url(c.origemDatabaseUrl,'grazing-donatella-homologacao-v2-banco',['donatella_preparacao']),max:1,options:'-c default_transaction_read_only=on',statement_timeout:20000});
 destino=new Pool({connectionString:url(c.destinoDatabaseUrl,'grazing-donatella-operacao-v2-banco',['donatella_operacao']),max:1,statement_timeout:20000});
 const {baselinePrivado,...resultado}=await importarAutomacoesWoo(origem,destino,'grazing',{baseline,marcoFinal:c.wooMarcoFinal});
 if(!c.wooMarcoFinal){const temporario='/baseline/.regras-'+randomUUID()+'.json';try{const f=await open(temporario,'wx',0o600);try{await f.writeFile(JSON.stringify(baselinePrivado));await f.sync();}finally{await f.close();}await rename(temporario,c.baselineRegras);const d=await open('/baseline','r');try{await d.sync();}finally{await d.close();}}finally{await unlink(temporario).catch(()=>undefined);}}
 console.log(JSON.stringify(resultado));
}catch(e){const sqlstate=typeof e==='object'&&e!==null&&'code'in e&&typeof e.code==='string'&&/^[A-Z0-9]{5}$/.test(e.code)?e.code:null;console.error(e instanceof Error&&/^[A-Z0-9_]{1,80}$/.test(e.message)?e.message:sqlstate?'WOO_IMPORTACAO_BANCO_'+sqlstate:'WOO_IMPORTACAO_FALHOU');process.exitCode=1;}
finally{await Promise.all([origem?.end(),destino?.end()]);}
