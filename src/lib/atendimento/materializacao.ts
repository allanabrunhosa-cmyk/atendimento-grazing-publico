import 'server-only';
import {Pool,type PoolClient} from 'pg';
import {abrirCarga,serializarCarga,type CargaPreparada} from './carga';
type Tabela={esquema:string;tabela:string;colunas:{nome:string;tipo:string}[];pk:string[]};
const q=(s:string)=>'"'+s.replaceAll('"','""')+'"';
export function criarMaterializador(pool:Pool,catalogo:Tabela[],execucao:string){
 if(catalogo.length!==37)throw Error('ESCOPO_DIVERGENTE');
 const tabelas=new Map(catalogo.map(t=>[`${t.esquema}.${t.tabela}`,t]));
 async function aplicar(client:PoolClient,carga:CargaPreparada){
  const d=abrirCarga(carga.cifrado,carga.hash);
  if(d.execucao!==execucao)throw Error('EXECUCAO_DIVERGENTE');
  const conferirColunas=(schema:string,tabela:string,dados:Record<string,unknown>|null)=>{
   const t=tabelas.get(`${schema}.${tabela}`);if(!t)throw Error('ALVO_RECUSADO');
   // jsonb_populate_record ignora campos desconhecidos: recusar drift evita perder
   // silenciosamente uma coluna nova, inclusive em estados anteriores/exclusões.
   if(dados&&(Object.keys(dados).length!==t.colunas.length||t.colunas.some(c=>!Object.hasOwn(dados,c.nome))))throw Error('SCHEMA_ALTERADO');
  };
  if(d.tipo==='snapshot')for(const r of d.registros)conferirColunas(d.schema,d.tabela,r.dados);
  else for(const e of d.eventos){conferirColunas(e.schema,e.tabela,e.anterior);conferirColunas(e.schema,e.tabela,e.posterior);}
  // Bloqueio por execução: serializa importação e incrementais sem watermark global.
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[execucao]);
  const anterior=await client.query('SELECT 1 FROM atendimento_migracao.materializacao WHERE execucao=$1 AND documento_id=$2',[execucao,d.id]);
  if(anterior.rowCount)return {repetida:true,registros:0};
  const atual=await client.query<{schema_name:string;table_name:string;indice:number;excluido:boolean}>(`SELECT schema_name,table_name,indice,excluido FROM atendimento_migracao.carga_registro WHERE execucao=$1 AND documento_id=$2 ORDER BY schema_name,table_name,chave_hash`,[execucao,d.id]);
  const porTabela=new Map<string,{dados:unknown[];exclusoes:Record<string,unknown>[]}>();
  for(const e of atual.rows){
   const alvo=`${e.schema_name}.${e.table_name}`;
   if(!tabelas.has(alvo))throw Error('ALVO_RECUSADO');
   const grupo=porTabela.get(alvo)??{dados:[],exclusoes:[]};porTabela.set(alvo,grupo);
   if(d.tipo==='snapshot'){
    if(d.schema!==e.schema_name||d.tabela!==e.table_name||e.excluido)throw Error('INDICE_DIVERGENTE');
    grupo.dados.push(d.registros[e.indice].dados);
   }else{
    const evento=d.eventos[e.indice];
    if(evento.schema!==e.schema_name||evento.tabela!==e.table_name)throw Error('INDICE_DIVERGENTE');
    if(e.excluido){if(!evento.chave_anterior)throw Error('INDICE_DIVERGENTE');grupo.exclusoes.push(evento.chave_anterior);}
    else{if(!evento.posterior)throw Error('INDICE_DIVERGENTE');grupo.dados.push(evento.posterior);}
   }
  }
  let registros=0;
  for(const [alvo,g]of porTabela){
   const t=tabelas.get(alvo)!,nome=`${q('donatella_'+t.esquema)}.${q(t.tabela)}`,cols=t.colunas.map(c=>q(c.nome)),pk=t.pk.map(q);
   for(const chave of g.exclusoes){const r=await client.query(`DELETE FROM ${nome} WHERE ${t.pk.map((p,i)=>`${q(p)}=$${i+1}`).join(' AND ')}`,t.pk.map(p=>chave[p]));registros+=r.rowCount??0;}
   if(g.dados.length){
    const valores=t.colunas.filter(c=>!t.pk.includes(c.nome)).map(c=>`${q(c.nome)}=excluded.${q(c.nome)}`).join(',');
    const r=await client.query(`INSERT INTO ${nome} (${cols.join(',')}) SELECT ${cols.join(',')} FROM jsonb_populate_recordset(NULL::${nome},$1::jsonb) ON CONFLICT(${pk.join(',')}) DO ${valores?'UPDATE SET '+valores:'NOTHING'}`,[serializarCarga(g.dados)]);registros+=r.rowCount??0;
   }
  }
  await client.query('INSERT INTO atendimento_migracao.materializacao(execucao,documento_id) VALUES($1,$2)',[execucao,d.id]);
  return {repetida:false,registros};
 }
 const materializar=async(carga:CargaPreparada)=>{const client=await pool.connect();try{await client.query('BEGIN');await client.query("SET LOCAL statement_timeout='60s'");const r=await aplicar(client,carga);await client.query('COMMIT');return r;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}};
 // A cópia final usa a mesma validação e idempotência, mas a transação pertence
 // ao chamador: todas as páginas entram antes da conferência das FKs deferidas.
 return Object.assign(materializar,{aplicarTx:aplicar});
}
