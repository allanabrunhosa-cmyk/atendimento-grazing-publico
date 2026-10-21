import 'server-only';
import {createHash,randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {modeloTextoSuportadoOperacao} from './operacao-modelos';
type ModeloMeta={id:string;nome:string;idioma:string;estado:string;componentes:unknown[];formatoParametros:string};
type ModeloBanco=Omit<ModeloMeta,'formatoParametros'>;
type Procedencia={hashGerido:string|null;metaHash:string;estadoMeta:string;formatoParametros:string;bloqueado:boolean};
function canonico(v:unknown):unknown{if(Array.isArray(v))return v.map(canonico);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonico((v as Record<string,unknown>)[k])]));return v;}
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(canonico(v))).digest('hex');
const objeto=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const texto=(v:unknown,re:RegExp,max:number)=>typeof v==='string'&&v.length<=max&&re.test(v);
export function lerBibliotecaMeta(p:unknown):{modelos:ModeloMeta[];completa:boolean;hash:string}{
 const paginas=objeto(p)&&Array.isArray(p.paginas)?p.paginas:[p];
 if(!paginas.length||paginas.length>50)throw Error('META_BIBLIOTECA_PAGINAS_INVALIDAS');
 const modelos:ModeloMeta[]=[],ids=new Set<string>();let completa=false;
 for(const [pos,pagina]of paginas.entries()){
  if(!objeto(pagina)||!Array.isArray(pagina.data)||pagina.data.length>500||pagina.error)throw Error('META_BIBLIOTECA_INVALIDA');
  const next=objeto(pagina.paging)?pagina.paging.next:undefined;
  if(pos<paginas.length-1&&!(typeof next==='string'&&next))throw Error('META_BIBLIOTECA_SEQUENCIA_INVALIDA');
  if(pos===paginas.length-1)completa=next===undefined||next===null||next==='';
  for(const m of pagina.data){
   if(!objeto(m)||!texto(m.id,/^\d{5,40}$/,40)||!texto(m.name,/^[a-z0-9_]+$/,180)||!texto(m.language,/^[a-z]{2,3}(?:_[A-Z]{2})?$/,10)||!texto(m.status,/^[A-Z_]+$/,80)||!Array.isArray(m.components)||m.components.length>25||JSON.stringify(m.components).length>65536||m.components.some(c=>!objeto(c)))throw Error('META_MODELO_INVALIDO');
   const id=m.id as string;if(ids.has(id))throw Error('META_MODELO_DUPLICADO');ids.add(id);
   const formato=typeof m.parameter_format==='string'?m.parameter_format:'POSITIONAL';if(!['POSITIONAL','NAMED'].includes(formato))throw Error('META_MODELO_FORMATO_INVALIDO');
   modelos.push({id,nome:m.name as string,idioma:m.language as string,estado:m.status as string,componentes:m.components,formatoParametros:formato});
  }
 }
 modelos.sort((a,b)=>a.id.localeCompare(b.id));return {modelos,completa,hash:hash({modelos,completa})};
}
function banco(m:ModeloMeta):ModeloBanco{return {id:m.id,nome:m.nome,idioma:m.idioma,estado:m.estado==='APPROVED'&&(m.formatoParametros!=='POSITIONAL'||!modeloTextoSuportadoOperacao(m.componentes))?'FORMATO_INDISPONIVEL':m.estado,componentes:m.componentes};}
/** Somente o JSON oficial já obtido pelo canal privado é consumido. Sem GET,
 * envios, ativação ou tokens. Conteúdo alterado manualmente nunca é substituído. */
export async function importarBibliotecaMeta(pool:Pool,p:unknown){
 const biblioteca=lerBibliotecaMeta(p),tx=await pool.connect();
 try{
  await tx.query('BEGIN');await tx.query("SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='10s'");
  const db=(await tx.query('SELECT current_database() nome')).rows[0].nome;if(!['donatella_operacao','donatella_ensaio_operacao'].includes(db))throw Error('META_MODELOS_DESTINO_RECUSADO');
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('importar-modelos-meta',0))");
  const linha=(await tx.query("SELECT conteudo,versao FROM atendimento_operacao.configuracao WHERE chave='modelos_meta_proveniencia' FOR UPDATE")).rows[0];
  const anterior=linha?.conteudo??{versao:1,modelos:{}},registros:Record<string,Procedencia>={...(anterior.modelos??{})};
  let inseridos=0,atualizados=0,preservados=0,conflitos=0,indisponiveis=0,ausentes=0,estadosBloqueados=0;
  for(const meta of biblioteca.modelos){
   const esperado=banco(meta),gerido=registros[meta.id],atual=(await tx.query<ModeloBanco>('SELECT id,nome,idioma,estado,componentes FROM atendimento_operacao.modelo WHERE id=$1 FOR UPDATE',[meta.id])).rows[0];
   if(!atual){await tx.query('INSERT INTO atendimento_operacao.modelo(id,nome,idioma,estado,componentes) VALUES($1,$2,$3,$4,$5::jsonb)',[esperado.id,esperado.nome,esperado.idioma,esperado.estado,JSON.stringify(esperado.componentes)]);inseridos++;registros[meta.id]={hashGerido:hash(esperado),metaHash:hash(meta),estadoMeta:meta.estado,formatoParametros:meta.formatoParametros,bloqueado:false};}
   else if(hash(atual)===hash(esperado)||gerido?.hashGerido===hash(atual)){
    if(hash(atual)!==hash(esperado)){await tx.query('UPDATE atendimento_operacao.modelo SET nome=$2,idioma=$3,estado=$4,componentes=$5::jsonb,sincronizado_em=now() WHERE id=$1',[esperado.id,esperado.nome,esperado.idioma,esperado.estado,JSON.stringify(esperado.componentes)]);atualizados++;}else preservados++;
    registros[meta.id]={hashGerido:hash(esperado),metaHash:hash(meta),estadoMeta:meta.estado,formatoParametros:meta.formatoParametros,bloqueado:false};
   }else{
    // Não deixar o estado APPROVED antigo prometer aptidão quando o conteúdo
    // local diverge da conferência oficial. Nome/idioma/componentes são mantidos.
    if(atual.estado!=='META_DIVERGENCIA_REVISAR'){await tx.query("UPDATE atendimento_operacao.modelo SET estado='META_DIVERGENCIA_REVISAR',sincronizado_em=now() WHERE id=$1",[meta.id]);estadosBloqueados++;}
    registros[meta.id]={hashGerido:gerido?.hashGerido??null,metaHash:hash(meta),estadoMeta:meta.estado,formatoParametros:meta.formatoParametros,bloqueado:true};conflitos++;
   }
   if(esperado.estado!=='APPROVED')indisponiveis++;
  }
  if(biblioteca.completa)for(const [id,gerido]of Object.entries(registros)){
   if(biblioteca.modelos.some(m=>m.id===id))continue;
   const atual=(await tx.query<ModeloBanco>('SELECT id,nome,idioma,estado,componentes FROM atendimento_operacao.modelo WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!atual)continue;
   const eraGerido=gerido.hashGerido===hash(atual);
   if(atual.estado!=='META_AUSENTE_REVISAR'){await tx.query("UPDATE atendimento_operacao.modelo SET estado='META_AUSENTE_REVISAR',sincronizado_em=now() WHERE id=$1",[id]);estadosBloqueados++;}
   registros[id]={...gerido,hashGerido:eraGerido?hash({...atual,estado:'META_AUSENTE_REVISAR'}):gerido.hashGerido,estadoMeta:'AUSENTE',bloqueado:true};ausentes++;
  }
  const conteudo={versao:1,snapshotHash:biblioteca.hash,paginacaoCompleta:biblioteca.completa,modelos:registros},mudou=hash(conteudo)!==hash(anterior)||inseridos>0||atualizados>0||estadosBloqueados>0;
  if(mudou){await tx.query("INSERT INTO atendimento_operacao.configuracao(chave,conteudo) VALUES('modelos_meta_proveniencia',$1::jsonb) ON CONFLICT(chave) DO UPDATE SET conteudo=excluded.conteudo,versao=atendimento_operacao.configuracao.versao+1,atualizada_em=now()",[JSON.stringify(conteudo)]);
   await tx.query("INSERT INTO atendimento_operacao.auditoria(id,autor_id,entidade_id,acao,versao) VALUES($1,'service:importacao-meta','modelos_meta','importar_modelos_meta',$2)",[randomUUID(),Number(linha?.versao??0)+1]);
  }
  await tx.query('COMMIT');return {fase:'biblioteca_meta_materializada',recebidos:biblioteca.modelos.length,inseridos,atualizados,preservados,conflitos,indisponiveis,ausentes,estadosBloqueados,paginacaoCompleta:biblioteca.completa,snapshotHash:biblioteca.hash,mudou,enviosExternos:0,fornecedoresChamados:0};
 }catch(e){await tx.query('ROLLBACK').catch(()=>undefined);throw e;}finally{tx.release();}
}
