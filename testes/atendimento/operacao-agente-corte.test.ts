import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {ServicoAgenteOperacional} from '../../src/lib/atendimento/operacao-agente';
import type {ConfiguracaoAgente} from '../../src/lib/atendimento/repositorio-agente-pg';

vi.mock('server-only',()=>({}));
const f=vi.hoisted(()=>({arquivo:{} as Record<string,unknown>,pg:{} as Record<string,unknown>,versao:1,autorizado:true,pools:0,auditorias:[] as unknown[][],comandos:new Map<string,{autor_id:string;hash:string;resultado:unknown}>(),preparador:undefined as unknown as ServicoAgenteOperacional|undefined}));
vi.mock('node:fs/promises',async importar=>({...await importar<typeof import('node:fs/promises')>(),readFile:vi.fn(async()=>JSON.stringify(f.arquivo))}));
vi.mock('../../src/lib/atendimento/operacao-autenticacao-hub',()=>({criarAutenticacaoHub:()=>({autorizar:async()=>f.autorizado})}));
vi.mock('pg',()=>({Pool:class{
 constructor(){f.pools++;}
 async end(){}
 async connect(){return {query:this.query.bind(this),release:()=>undefined};}
 async query(sql:string,v:unknown[]=[]){
  const vazia={rows:[],rowCount:0};
  if(sql.startsWith('SELECT current_database()'))return {rows:[{nome:'donatella_operacao'}],rowCount:1};
  if(sql.includes('FROM atendimento_integracao.identidade'))return {rows:[{id:'hub-ficticio',nome:'Responsável fictício',perfilId:'fixture',sessaoVersao:1}],rowCount:1};
  if(sql.startsWith('SELECT autor_id,hash,resultado')){const c=f.comandos.get(String(v[0]));return {rows:c?[c]:[],rowCount:c?1:0};}
  if(sql.startsWith('SELECT conteudo,versao FROM atendimento_operacao.configuracao')||sql.startsWith('SELECT a.conteudo,a.versao'))return {rows:[{conteudo:structuredClone(f.pg),versao:String(f.versao)}],rowCount:1};
  if(sql.startsWith('UPDATE atendimento_operacao.configuracao SET conteudo=')){f.pg=JSON.parse(String(v[0]));f.versao++;return {rows:[],rowCount:1};}
  if(sql.startsWith('INSERT INTO atendimento_operacao.auditoria')){f.auditorias.push(v);return {rows:[],rowCount:1};}
  if(sql.startsWith('INSERT INTO atendimento_operacao.comando')){f.comandos.set(String(v[0]),{autor_id:String(v[1]),hash:String(v[2]),resultado:JSON.parse(String(v[3]))});return {rows:[],rowCount:1};}
  if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)||sql.startsWith('SET LOCAL')||sql.startsWith('SELECT pg_advisory_xact_lock')||sql.includes('AGENTE_CONFIGURACAO_ALTERADA'))return vazia;
  throw Error('SQL_FICTICIA_NAO_PREVISTA');
 }
}}));

const originalArgs=process.argv.slice();
const config:ConfiguracaoAgente={modo:'desligado',provedor:'anthropic',moedaOrcamento:'USD',modelo:'claude-sonnet-4-5-20250929',maxTokens:512,equipeApoio:'apoio',limites:{maxChamadas:3,custoPorChamadaCentavos:1,maxCustoCentavos:10,maxDuracaoMs:45000,timeoutChamadaMs:15000},custoCentavosDia:500,autoridadeAutomatica:false,grupoExterno:'indisponivel'};
async function executar(){await import('../../scripts/atendimento/configurar-agente-corte');}
beforeEach(async()=>{
 vi.resetModules();vi.stubEnv('DONATELLA_COMANDO_CORTE_AUTORIZADO','1');vi.stubEnv('DONATELLA_OPERACAO_CONFIG','/fixture/operacao.json');
 process.argv=['node','/fixture/configurar-agente-corte.mjs','habilitar','hub-ficticio','facc9000-0000-4000-a000-000000000001'];
 f.arquivo={modo:'operacao',autoridade:'vps',enviosHabilitados:true,iaAutomatica:false,orcamentoIAcentavos:500,databaseUrl:'postgresql://fixture:senha-ficticia@grazing-donatella-operacao-v2-banco/donatella_operacao',centralDatabaseUrl:'postgresql://fixture:senha-ficticia@central-ficticia/hub',csrfSecret:'fixture-csrf',ia:{apiKey:'chave-ficticia',model:config.modelo}};
 f.pg=structuredClone(config) as unknown as Record<string,unknown>;f.versao=1;f.autorizado=true;f.pools=0;f.auditorias=[];f.comandos.clear();f.preparador=undefined;
 vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('HTTP_REAL_RECUSADO_NO_ENSAIO');}));vi.spyOn(console,'log').mockImplementation(()=>undefined);
 const {ServicoAgenteOperacional}=await import('../../src/lib/atendimento/operacao-agente'),original=ServicoAgenteOperacional.prototype.configurarModoCorte;
 vi.spyOn(ServicoAgenteOperacional.prototype,'configurarModoCorte').mockImplementation(function(this:ServicoAgenteOperacional,i,p){f.preparador=this;return original.call(this,i,p);});
});
afterEach(()=>{process.argv=originalArgs.slice();vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();});

describe('CLI auditado prepara PG sem armar inferência operacional',()=>{
 it('prepara automático com 500 centavos USD e gate privado ainda false, sem HTTP; worker segue desarmado',async()=>{
  await executar();expect(f.pg).toMatchObject({modo:'automatico',provedor:'anthropic',moedaOrcamento:'USD',modelo:config.modelo,custoCentavosDia:500,autoridadeAutomatica:true,limites:{maxChamadas:3,custoPorChamadaCentavos:50,maxCustoCentavos:150}});
  expect(f.arquivo.iaAutomatica).toBe(false);expect(f.auditorias).toHaveLength(1);expect(f.comandos.size).toBe(1);
  expect(await f.preparador!.processarProxima()).toEqual({estado:'inferencia_desarmada'});expect(fetch).not.toHaveBeenCalled();
 });
 it.each([{modo:'homologacao'},{modo:'receber'},{autoridade:'origem'},{autoridade:'nenhuma'},{enviosHabilitados:false}])('recusa preparação sem transferência humana %j',async p=>{
  Object.assign(f.arquivo,p);await expect(executar()).rejects.toThrow('AGENTE_AUTORIDADE_NAO_TRANSFERIDA');expect(f.pg).toEqual(config);expect(f.auditorias).toHaveLength(0);expect(fetch).not.toHaveBeenCalled();
 });
 it('recusa sem comando expresso antes de abrir o banco',async()=>{vi.stubEnv('DONATELLA_COMANDO_CORTE_AUTORIZADO','0');await expect(executar()).rejects.toThrow('AGENTE_COMANDO_EXPRESSO_EXIGIDO');expect(f.pools).toBe(0);expect(f.pg).toEqual(config);expect(fetch).not.toHaveBeenCalled();});
 it('preserva o teto privado: 500 PG não cabem em 499 privados',async()=>{f.arquivo.orcamentoIAcentavos=499;await expect(executar()).rejects.toThrow('AGENTE_CONFIGURACAO_NAO_AUTORIZADA');expect(f.pg).toEqual(config);expect(f.auditorias).toHaveLength(0);expect(fetch).not.toHaveBeenCalled();});
 it('recusa responsável sem permissão de configurar',async()=>{f.autorizado=false;await expect(executar()).rejects.toThrow('OPERACAO_ACESSO_NEGADO');expect(f.pg).toEqual(config);expect(f.auditorias).toHaveLength(0);expect(fetch).not.toHaveBeenCalled();});
 it('repete recibo idempotente sem nova configuração/auditoria',async()=>{await executar();const versao=f.versao;vi.resetModules();await executar();expect(f.versao).toBe(versao);expect(f.auditorias).toHaveLength(1);expect(f.comandos.size).toBe(1);expect(fetch).not.toHaveBeenCalled();});
});
