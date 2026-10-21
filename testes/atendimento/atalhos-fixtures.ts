import {vi} from 'vitest';
import type {Pool} from 'pg';
import {RepositorioOperacaoPg} from '../../src/lib/atendimento/operacao-repositorio-pg';
import {ServicoAtalhosOperacao} from '../../src/lib/atendimento/operacao-atalhos';
import type {AcaoOperacao,IdentidadeOperacao,ModoOperacao} from '../../src/lib/atendimento/operacao-tipos';

export const atorAtalhos:IdentidadeOperacao={id:'fixture-ana',nome:'Ana Fictícia',perfilId:'fixture',sessaoVersao:1,permissoes:[],tipo:'usuario'};
export function ambienteAtalhos(){
 let cfg:{conteudo:unknown;versao:number}|null=null,modo:ModoOperacao='homologacao';
 let comandos=new Map<string,{autor_id:string;hash:string;resultado:unknown}>(),auditorias:unknown[][]=[];
 const direitos=new Set<AcaoOperacao>(['consultar','atalhos.visualizar','atalhos.adicionar','atalhos.editar','atalhos.excluir']),sqls:string[]=[];
 const consulta=vi.fn(async(sql:string,args:unknown[]=[])=>{
  sqls.push(sql);let rows:unknown[]=[];
  if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)||sql.startsWith('SET LOCAL')||sql.startsWith('SELECT pg_advisory'))return {rows,rowCount:0};
  if(sql==='SELECT current_database() nome')rows=[{nome:'donatella_ensaio_operacao'}];
  else if(sql.startsWith('SELECT autor_id,hash,resultado FROM atendimento_operacao.comando')){const r=comandos.get(String(args[0]));rows=r?[r]:[];}
  else if(sql.startsWith('INSERT INTO atendimento_operacao.comando'))comandos.set(String(args[0]),{autor_id:String(args[1]),hash:String(args[2]),resultado:JSON.parse(String(args[3]))});
  else if(sql.startsWith('INSERT INTO atendimento_operacao.auditoria'))auditorias.push(args);
  else if(sql.startsWith('INSERT INTO atendimento_operacao.configuracao')){cfg={conteudo:JSON.parse(String(args[0])),versao:(cfg?.versao??0)+1};rows=[{versao:cfg.versao}];}
  else if(sql.startsWith('SELECT conteudo,versao FROM atendimento_operacao.configuracao')){
   if(!sql.includes("chave='atalhos_texto'"))throw Error('CHAVE_FORA_ESCOPO_FICTICIO');rows=cfg?[cfg]:[];
  }else throw Error('SQL_FORA_ESCOPO_FICTICIO');
  return {rows,rowCount:rows.length};
 });
 const pool={query:consulta,connect:async()=>{
  const antes=structuredClone({cfg,comandos,auditorias});return {query:async(sql:string,args?:unknown[])=>{
   if(sql==='ROLLBACK'){cfg=antes.cfg;comandos=antes.comandos;auditorias=antes.auditorias;}return consulta(sql,args);
  },release:vi.fn()};
 }} as unknown as Pool;
 const repo=new RepositorioOperacaoPg(pool,async(_i,a)=>direitos.has(a),()=>modo,'/tmp/atalhos-ficticios'),servico=new ServicoAtalhosOperacao(repo);
 return {repo,servico,direitos,sqls,setModo:(v:ModoOperacao)=>{modo=v;},setConfig:(conteudo:unknown,versao=1)=>{cfg={conteudo,versao};},snapshot:()=>structuredClone({cfg,comandos:[...comandos],auditorias})};
}
