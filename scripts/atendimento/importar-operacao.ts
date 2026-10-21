import {Pool,type PoolClient,type QueryResult} from 'pg';
import {createHash} from 'node:crypto';
import {readFile,stat,realpath} from 'node:fs/promises';
import {join,resolve,basename} from 'node:path';
import {validarIdOperacao,objetoOperacao} from '../../src/lib/atendimento/operacao-tipos';

export type ConfiguracaoImportacaoOperacao={
 origemDatabaseUrl:string;destinoDatabaseUrl:string;origemStorageURL:string;phoneNumberId:string;
 usuariosRevisados:Record<string,string>;equipesRevisadas:Record<string,string>;
 manifestoInicial:string;midiaLegadaRaiz:string;midiaIncrementalRaiz:string;
 marcador:string;idImportacao:string;pagina?:number;
 /** Perfil aditivo: exige uma fotografia própria, nunca consulta as 37 entidades. */
 nucleoChat?:{schema:string};
};
type Dados=Record<string,unknown>;
type Midia={arquivo:string;sha256:string;bytes:number;metadata?:{eTag:string}};
export type EntidadeImportacaoOperacao='contato'|'conversa'|'mensagem'|'anexo'|'etapa'|'negocio'|'compromisso';
type Total={observados:number;inseridos:number;atualizados:number;iguais:number;preservados:number;lacunas:number;verificados:number;divergentes:number;hashConteudo:string;hashDestino:string};
export type ResumoImportacaoOperacao={
 id:string;inicioEm:string;fimEm?:string;duracaoMs?:number;marcador:string;entidades:Record<string,Total>;
 lacunas:Record<string,number>;arquivos:{referencias:number;conteudosVerificados:number;bytesVerificados:number;indisponiveis:number};enviosExternos:0;
};
export function canonicoImportacaoOperacao(v:unknown):string{
 if(Array.isArray(v))return '['+v.map(canonicoImportacaoOperacao).join(',')+']';
 if(objetoOperacao(v))return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonicoImportacaoOperacao(v[k])).join(',')+'}';
 return JSON.stringify(v)??'null';
}
export const hashImportacaoOperacao=(v:unknown)=>createHash('sha256').update(canonicoImportacaoOperacao(v)).digest('hex');
const data=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(v)&&Number.isFinite(Date.parse(v))?v:null;
const texto=(v:unknown,max:number,vazio=true)=>typeof v==='string'&&v.length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v)&&(vazio||v.trim())?v:v==null&&vazio?'':null;
const hashUUID=(s:string)=>{const h=createHash('sha256').update(s).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
const tags=(v:unknown)=>{
 if(v==null)return [];
 if(!Array.isArray(v)||v.length>30||v.some(t=>typeof t!=='string'||!t.trim()||t.length>60))throw Error('IMPORTACAO_ETIQUETAS_INCOMPATIVEIS');
 return v;
};
const uuidOpcional=(v:unknown)=>{if(v==null)return null;validarIdOperacao(v);return v;};
const valorExato=(v:unknown)=>{
 if(v==null)return null;
 if(typeof v!=='string'||!/^[-+]?\d{1,16}(?:\.\d{1,2})?$/.test(v))throw Error('IMPORTACAO_PRECISAO_INCOMPATIVEL');
 return v;
};
export function mapearLinhaImportacaoOperacao(entidade:EntidadeImportacaoOperacao,d:Dados,c:Pick<ConfiguracaoImportacaoOperacao,'phoneNumberId'|'usuariosRevisados'|'equipesRevisadas'>):Dados|null{
 validarIdOperacao(d.id);const id=d.id;
 if(entidade==='contato'){
  const nome=texto([d.name,d.last_name].filter(v=>typeof v==='string'&&v).join(' '),200),telefone=texto(d.phone_number,40,false),criada=data(d.created_at);
  if(nome===null||telefone===null||!criada)return null;
  if(d.email!=null&&texto(d.email,254)===null||texto(d.notes,8000)===null)return null;
  return {id,nome:nome||telefone,telefone,identidade_canal:typeof d.whatsapp_id==='string'&&/^\d{8,15}$/.test(d.whatsapp_id)?`whatsapp:${c.phoneNumberId}:${d.whatsapp_id}`:null,
   hub_cliente_id:null,email:d.email??null,tags:tags(d.tags),notas:texto(d.notes,8000)??'',memoria:objetoOperacao(d.client_memory)?d.client_memory:{},importado:true,criada_em:criada,atualizada_em:data(d.updated_at)??criada};
 }
 if(entidade==='conversa'){
  validarIdOperacao(d.contact_id);const criada=data(d.created_at)||data(d.started_at);
  if(!criada||!['human','paused','nina'].includes(String(d.status)))return null;
  return {id,contato_id:d.contact_id,estado:d.is_active===false?'encerrada':d.status==='human'?'humano':d.status==='paused'?'pausado':'ia',
   responsavel_id:typeof d.assigned_user_id==='string'?c.usuariosRevisados[d.assigned_user_id]??null:null,equipe_id:typeof d.assigned_team==='string'?c.equipesRevisadas[d.assigned_team]??null:null,
   tags:tags(d.tags),fila:typeof d.queue==='string'?d.queue:'novos',versao:1,ultima_mensagem_em:data(d.last_message_at),ultima_cliente_em:data(d._ultimaClienteEm),criada_em:criada,importada:true,ficticia:false};
 }
 if(entidade==='mensagem'){
  validarIdOperacao(d.conversation_id);const criada=data(d.created_at),conteudo=texto(d.content,65536);
  if(!criada||conteudo===null||!['user','human','nina'].includes(String(d.from_type))||!['sent','delivered','read','failed','processing'].includes(String(d.status)))return null;
  const autor=d.from_type==='user'?'cliente':d.from_type==='human'?'humano':'ia',metadata=objetoOperacao(d.metadata)?d.metadata:{};
  const origemAutor=typeof metadata.sender_id==='string'?metadata.sender_id:typeof metadata.user_id==='string'?metadata.user_id:null;
  return {id,conversa_id:d.conversation_id,wamid:typeof d.whatsapp_message_id==='string'&&d.whatsapp_message_id.length<=512?d.whatsapp_message_id:null,autor,
   autor_id:origemAutor?(c.usuariosRevisados[origemAutor]??`origem:${origemAutor}`):null,conteudo,tipo:['text','image','audio','document','video'].includes(String(d.type))?d.type:'unsupported',
   estado:d.status==='read'?'lido':d.status==='delivered'?'entregue':d.status==='failed'?'recusado':d.status==='processing'?'historico_pendente':'aceito',anexo_id:null,citada_id:null,
   criada_em:criada,enviada_em:data(d.sent_at),entregue_em:data(d.delivered_at),lida_em:data(d.read_at),importada:true,
   metadados:{...metadata,origemAutorId:origemAutor,origemAutorNome:texto(d._origemAutorNome,200,false),origemCitacaoId:uuidOpcional(d.reply_to_id),anexoHistoricoIndisponivel:!!d.media_url}};
 }
 if(entidade==='etapa'){
  const titulo=texto(d.title,120,false);return titulo?{id,titulo,posicao:Number.isSafeInteger(d.position)?d.position:0,ativa:d.is_active!==false}:null;
 }
 if(entidade==='negocio'){
  const titulo=texto(d.title,200,false),criada=data(d.created_at),notas=texto(d.notes,8000);if(!titulo||!criada||notas===null)return null;
  validarIdOperacao(d.stage_id);
  return {id,contato_id:uuidOpcional(d.contact_id),conversa_id:null,titulo,etapa_id:d.stage_id,responsavel_id:typeof d.owner_id==='string'?c.usuariosRevisados[d.owner_id]??null:null,
   valor:valorExato(d.value),notas,versao:1,criada_em:criada,atualizada_em:data(d.updated_at)??criada};
 }
 if(entidade==='compromisso'){
  const titulo=texto(d.title,200,false),criada=data(d.created_at),descricao=texto(d.description,8000);
  if(!titulo||!criada||descricao===null||typeof d.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d.date)||typeof d.time!=='string'||!/^\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(d.time)||!Number.isSafeInteger(d.duration)||Number(d.duration)<1||Number(d.duration)>1440)return null;
  const inicio=`${d.date}T${d.time}-03:00`;if(!data(inicio))return null;
  return {id,contato_id:uuidOpcional(d.contact_id),conversa_id:null,titulo,descricao,inicio,duracao_minutos:d.duration,responsavel_id:typeof d.user_id==='string'?c.usuariosRevisados[d.user_id]??null:null,
   estado:d.status==='cancelled'?'cancelado':d.status==='completed'?'concluido':'agendado',versao:1,criada_em:criada};
 }
 return null;
}
const compactar=(v:Dados,chaves:string[])=>Object.fromEntries(chaves.map(k=>[k,v[k]??null]));
const totalVazio=():Total=>({observados:0,inseridos:0,atualizados:0,iguais:0,preservados:0,lacunas:0,verificados:0,divergentes:0,hashConteudo:'',hashDestino:''});
const expressaoLinha=(entidade:EntidadeImportacaoOperacao)=>`to_jsonb(e)${entidade==='negocio'?" || jsonb_build_object('valor',e.valor::text)":''}`;
const relacoes:Partial<Record<EntidadeImportacaoOperacao,Record<string,EntidadeImportacaoOperacao>>>= {
 conversa:{contato_id:'contato'},anexo:{conversa_id:'conversa'},mensagem:{conversa_id:'conversa',anexo_id:'anexo'},negocio:{contato_id:'contato',etapa_id:'etapa'},compromisso:{contato_id:'contato'},
};
export async function importarOperacao(c:ConfiguracaoImportacaoOperacao,opcoes?:{origem?:Pool;destino?:Pool}){
 if(!/^[A-Za-z0-9_-]{1,100}$/.test(c.idImportacao)||!c.marcador||c.marcador.length>200||!/^\d{5,25}$/.test(c.phoneNumberId)||!Number.isSafeInteger(c.pagina??250)||(c.pagina??250)<1||(c.pagina??250)>1000)throw Error('IMPORTACAO_CONFIGURACAO_RECUSADA');
 if(c.nucleoChat&&!/^chat_minimo_[a-f0-9]{32}$/.test(c.nucleoChat.schema))throw Error('IMPORTACAO_CHAT_SCHEMA_RECUSADO');
 const tabelaOrigem=(t:string)=>c.nucleoChat?`${c.nucleoChat.schema}.${t}`:`donatella_public.${t}`;
 const tabelaObjetos=c.nucleoChat?`${c.nucleoChat.schema}.storage_objects`:'donatella_storage.objects';
 const inicio=Date.now(),resumo:ResumoImportacaoOperacao={id:c.idImportacao,inicioEm:new Date(inicio).toISOString(),marcador:c.marcador,entidades:{},lacunas:{},arquivos:{referencias:0,conteudosVerificados:0,bytesVerificados:0,indisponiveis:0},enviosExternos:0};
 const origem=opcoes?.origem??new Pool({connectionString:c.origemDatabaseUrl,max:1,application_name:'donatella-importacao-leitura'});
 const destino=opcoes?.destino??new Pool({connectionString:c.destinoDatabaseUrl,max:1,application_name:'donatella-importacao-escrita'});
 const s=await origem.connect();let t:PoolClient;
 try{t=await destino.connect();}catch(e){s.release();if(!opcoes?.origem)await origem.end();if(!opcoes?.destino)await destino.end();throw e;}
 let lock=false;
 const camposPorEntidade=new Map<EntidadeImportacaoOperacao,string[]>();
 const ponto=(codigo:string,entidade:EntidadeImportacaoOperacao)=>{resumo.lacunas[codigo]=(resumo.lacunas[codigo]??0)+1;(resumo.entidades[entidade]??=totalVazio()).lacunas++;};
 try{
  const dbs=await Promise.all([s.query('SELECT current_database() nome'),t.query('SELECT current_database() nome')]);
  if(!['donatella_preparacao','donatella_ensaio_origem'].includes(dbs[0].rows[0]?.nome)||!['donatella_operacao','donatella_ensaio_operacao'].includes(dbs[1].rows[0]?.nome))throw Error('IMPORTACAO_DESTINO_RECUSADO');
  lock=(await t.query("SELECT pg_try_advisory_lock(hashtextextended('donatella-importacao-operacional',0)) obtido")).rows[0].obtido;
  if(!lock)throw Error('IMPORTACAO_EM_ANDAMENTO');
  await s.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await s.query("SET LOCAL statement_timeout='10s'; SET LOCAL lock_timeout='1s'; SET LOCAL timezone='UTC'");
  const inicial:Record<string,Midia[]>=JSON.parse(await readFile(c.manifestoInicial,'utf8'));
  const objetos=await s.query(`SELECT to_jsonb(o) dados FROM ${tabelaObjetos} o WHERE bucket_id IN ('whatsapp-media','audio-messages')`);
  const indiceObjetos=new Map<string,Dados>(objetos.rows.map(r=>[r.dados.bucket_id+'/'+r.dados.name,r.dados]));
  const incrementais=await s.query('SELECT objeto_id,bucket,nome,etag,arquivo,sha256,bytes::integer FROM atendimento_migracao.arquivo_versao');
  const indiceIncrementais=new Map<string,Midia[]>();
  for(const r of incrementais.rows){const chave=[r.objeto_id,r.etag,r.bytes].join(':');indiceIncrementais.set(chave,[...(indiceIncrementais.get(chave)??[]),r]);}
  const ultimasClientes=await s.query(`SELECT conversation_id,jsonb_build_object('em',max(created_at)) dados FROM ${tabelaOrigem('messages')} WHERE from_type='user' GROUP BY conversation_id`);
  const clientePorConversa=new Map<string,string>(ultimasClientes.rows.map(r=>[r.conversation_id,r.dados.em]));
  const nomesAutores=new Map<string,string>();
  if((await s.query(`SELECT to_regclass('${tabelaOrigem('profiles')}') existente`)).rows[0].existente){
   const perfis=await s.query(`SELECT user_id,full_name FROM ${tabelaOrigem('profiles')}`);
   const ambiguos=new Set<string>();
   for(const p of perfis.rows){const nome=texto(p.full_name,200,false);if(!nome)continue;const id=String(p.user_id);if(nomesAutores.has(id)&&nomesAutores.get(id)!==nome){ambiguos.add(id);continue;}nomesAutores.set(id,nome);}
   for(const id of ambiguos)nomesAutores.delete(id);
  }
  const verificados=new Set<string>();

  async function gravarEstados(registros:Dados[]){
   if(!registros.length)return;
   await t.query(`INSERT INTO atendimento_operacao.importacao_estado(entidade,origem_id,destino_id,hash_origem,hash_destino,importacao_id)
    SELECT entidade,origem_id,destino_id,hash_origem,hash_destino,importacao_id FROM jsonb_to_recordset($1::jsonb)
    AS x(entidade text,origem_id uuid,destino_id uuid,hash_origem text,hash_destino text,importacao_id text)
    ON CONFLICT(entidade,origem_id) DO UPDATE SET hash_origem=excluded.hash_origem,hash_destino=excluded.hash_destino,importacao_id=excluded.importacao_id,atualizada_em=now()`,[JSON.stringify(registros)]);
  }
  async function aplicar(entidade:EntidadeImportacaoOperacao,originais:Dados[],mapeados:Dados[]){
   const total=resumo.entidades[entidade]??=totalVazio();if(!mapeados.length)return;
   const campos=Object.keys(mapeados[0]);camposPorEntidade.set(entidade,campos);
   const fontePorId=new Map(originais.map(v=>[v.id,hashImportacaoOperacao(v)]));
   await t.query('BEGIN');
   try{
    await t.query("SET LOCAL statement_timeout='10s'; SET LOCAL lock_timeout='3s'; SET LOCAL timezone='UTC'");
    const ids=mapeados.map(v=>v.id),anteriores=await t.query(`SELECT ${expressaoLinha(entidade)} dados FROM atendimento_operacao.${entidade} e WHERE id=ANY($1::uuid[]) FOR UPDATE`,[ids]);
    const estados=await t.query('SELECT origem_id,hash_origem,hash_destino FROM atendimento_operacao.importacao_estado WHERE entidade=$1 AND origem_id=ANY($2::uuid[])',[entidade,ids]);
    const porId=new Map<string,Dados>(anteriores.rows.map(v=>[v.dados.id,v.dados])),estadosId=new Map(estados.rows.map(v=>[v.origem_id,v]));
    const relacionadas=new Map<string,Set<string>>();
    for(const [campo,tabela] of Object.entries(relacoes[entidade]??{})){
     const refs=[...new Set(mapeados.map(v=>v[campo]).filter(Boolean))];
     const r=await t.query(`SELECT id FROM atendimento_operacao.${tabela} WHERE id=ANY($1::uuid[])`,[refs]);
     relacionadas.set(campo,new Set(r.rows.map(v=>v.id)));
    }
    const chaveUnica=entidade==='mensagem'?'wamid':entidade==='contato'?'identidade_canal':null;
    const donos=new Map<string,string>();
    if(chaveUnica){const chaves=mapeados.map(v=>v[chaveUnica]).filter(Boolean);const r=await t.query(`SELECT id,${chaveUnica} chave FROM atendimento_operacao.${entidade} WHERE ${chaveUnica}=ANY($1::text[])`,[chaves]);for(const v of r.rows)donos.set(v.chave,v.id);}
    const aceitos:Dados[]=[],estadosGravar:Dados[]=[];
    for(const d of mapeados){
     const id=String(d.id),antes=porId.get(id),estado=estadosId.get(id);
     if([...relacionadas].some(([campo,refs])=>d[campo]!=null&&!refs.has(String(d[campo])))){ponto('RELACAO_LEGADA_INDISPONIVEL',entidade);continue;}
     if(chaveUnica&&d[chaveUnica]&&donos.has(String(d[chaveUnica]))&&donos.get(String(d[chaveUnica]))!==id){ponto('IDENTIDADE_LEGADA_DUPLICADA',entidade);continue;}
     const hashAtual=antes?hashImportacaoOperacao(compactar(antes,campos)):null;
     if(antes&&(antes.importada===false||antes.importado===false||estado&&hashAtual!==estado.hash_destino||!estado&&hashAtual!==hashImportacaoOperacao(d))){total.preservados++;ponto('DESTINO_ALTERADO_PRESERVADO',entidade);continue;}
     if(antes&&estado?.hash_origem===fontePorId.get(d.id)){
      total.iguais++;estadosGravar.push({entidade,origem_id:id,destino_id:id,hash_origem:fontePorId.get(d.id),hash_destino:hashAtual,importacao_id:c.idImportacao});continue;
     }
     if(antes)total.atualizados++;else total.inseridos++;
     if(chaveUnica&&d[chaveUnica])donos.set(String(d[chaveUnica]),id);
     aceitos.push(d);
    }
    if(aceitos.length){
     const cols=campos.map(k=>'"'+k+'"').join(','),set=campos.filter(k=>k!=='id').map(k=>`"${k}"=excluded."${k}"`).join(',');
     await t.query(`INSERT INTO atendimento_operacao.${entidade} (${cols}) SELECT ${cols} FROM jsonb_populate_recordset(NULL::atendimento_operacao.${entidade},$1::jsonb) ON CONFLICT(id) DO UPDATE SET ${set}`,[JSON.stringify(aceitos)]);
     const apos=await t.query(`SELECT ${expressaoLinha(entidade)} dados FROM atendimento_operacao.${entidade} e WHERE id=ANY($1::uuid[])`,[aceitos.map(v=>v.id)]);
     for(const r of apos.rows)estadosGravar.push({entidade,origem_id:r.dados.id,destino_id:r.dados.id,hash_origem:fontePorId.get(r.dados.id),hash_destino:hashImportacaoOperacao(compactar(r.dados,campos)),importacao_id:c.idImportacao});
    }
    await gravarEstados(estadosGravar);await t.query('COMMIT');
   }catch(e){await t.query('ROLLBACK');throw e;}
  }

  async function obterMidia(d:Dados):Promise<Dados|null>{
   if(typeof d.media_url!=='string'||!d.media_url)return null;
   resumo.arquivos.referencias++;let chave:string;
   try{
    const u=new URL(d.media_url);if(u.origin!==new URL(c.origemStorageURL).origin)throw Error();
    const m=u.pathname.match(/^\/storage\/v1\/object\/(?:public|sign)\/(whatsapp-media|audio-messages)\/(.+)$/);if(!m)throw Error();chave=m[1]+'/'+decodeURIComponent(m[2]);
   }catch{ponto('ANEXO_URL_NAO_RESOLVIDA','anexo');resumo.arquivos.indisponiveis++;return null;}
   const o=indiceObjetos.get(chave),meta=o?.metadata;
   if(!o||!objetoOperacao(meta)||typeof meta.eTag!=='string'||!Number.isSafeInteger(meta.size)){ponto('ANEXO_METADATA_INDISPONIVEL','anexo');resumo.arquivos.indisponiveis++;return null;}
   const anteriores=(inicial[chave]??[]).filter(v=>v.metadata?.eTag===meta.eTag&&v.bytes===meta.size);
   const novos=indiceIncrementais.get([o.id,meta.eTag,meta.size].join(':'))??[],candidatos=anteriores.length?anteriores:novos;
   const midia=candidatos[0];
   if(!midia||candidatos.some(v=>v.sha256!==midia.sha256)||!/^[a-f0-9]{64}$/.test(midia.sha256)||midia.arquivo!==midia.sha256+'.bin'||midia.bytes<1||midia.bytes>20971520){ponto('ANEXO_VERSAO_NAO_PRESERVADA','anexo');resumo.arquivos.indisponiveis++;return null;}
   const raiz=anteriores.length?c.midiaLegadaRaiz:c.midiaIncrementalRaiz;
   if(!verificados.has(midia.sha256)){
    try{
     const caminho=join(raiz,midia.arquivo),efetivo=await realpath(caminho),raizReal=await realpath(raiz);
     if(efetivo!==resolve(raizReal,midia.arquivo)||(await stat(caminho)).size!==midia.bytes)throw Error();
     const bytes=await readFile(caminho);if(createHash('sha256').update(bytes).digest('hex')!==midia.sha256)throw Error();
     verificados.add(midia.sha256);resumo.arquivos.conteudosVerificados++;resumo.arquivos.bytesVerificados+=bytes.length;
    }catch{ponto('ANEXO_BYTES_INDISPONIVEIS','anexo');resumo.arquivos.indisponiveis++;return null;}
   }
   const mime=typeof d.media_type==='string'&&d.media_type.includes('/')?d.media_type:typeof meta.mimetype==='string'?meta.mimetype:'application/octet-stream';
   if(mime.length>100||!data(d.created_at)){ponto('ANEXO_TIPO_INCOMPATIVEL','anexo');return null;}
   return {id:hashUUID('anexo-historico:'+d.id),conversa_id:d.conversation_id,hash:midia.sha256,nome:basename(String(o.name)).slice(0,160)||'anexo-historico',mime,tamanho:midia.bytes,autor_id:null,importado:true,criada_em:data(d.created_at)};
  }

  const tipos:[string,EntidadeImportacaoOperacao][]=c.nucleoChat?[['contacts','contato'],['conversations','conversa'],['messages','mensagem']]:[['contacts','contato'],['conversations','conversa'],['pipeline_stages','etapa'],['deals','negocio'],['appointments','compromisso'],['messages','mensagem']];
  for(const [fonte,entidade] of tipos){
   let depois:string|null=null;const h=createHash('sha256'),total=resumo.entidades[entidade]??=totalVazio(),observados:string[]=[];
   for(;;){
    const r:QueryResult<{dados:Dados}>=await s.query(`SELECT to_jsonb(f)${fonte==='deals'?" || jsonb_build_object('value',f.value::text)":''} dados FROM ${tabelaOrigem(fonte)} f WHERE ($1::uuid IS NULL OR id>$1) ORDER BY id LIMIT $2`,[depois,c.pagina??250]);
    if(!r.rowCount)break;
    const registros:Dados[]=r.rows.map(v=>v.dados),mapeados:Dados[]=[],anexos:Dados[]=[];
    for(const d of registros){
     total.observados++;
     observados.push(String(d.id));
     if(entidade==='conversa')d._ultimaClienteEm=clientePorConversa.get(String(d.id))??null;
     if(entidade==='mensagem'&&objetoOperacao(d.metadata)){const autor=typeof d.metadata.sender_id==='string'?d.metadata.sender_id:typeof d.metadata.user_id==='string'?d.metadata.user_id:null;d._origemAutorNome=autor?nomesAutores.get(autor)??null:null;}
     h.update(hashImportacaoOperacao(d));let v:Dados|null;
     try{v=mapearLinhaImportacaoOperacao(entidade,d,c);}catch{v=null;}
     if(!v){ponto('REGISTRO_LEGADO_INCOMPATIVEL',entidade);continue;}
     if(entidade==='mensagem'){
      const anexo=await obterMidia(d);
      if(anexo){anexos.push(anexo);v.anexo_id=anexo.id;(v.metadados as Dados).anexoHistoricoIndisponivel=false;}
     }
     mapeados.push(v);
    }
    if(anexos.length){const at=resumo.entidades.anexo??=totalVazio();at.observados+=anexos.length;await aplicar('anexo',anexos,anexos);}
    await aplicar(entidade,registros,mapeados);depois=String(registros.at(-1)!.id);
   }
   total.hashConteudo=h.digest('hex');
   const ausentes=Number((await t.query('SELECT count(*)::integer n FROM atendimento_operacao.importacao_estado WHERE entidade=$1 AND NOT(origem_id=ANY($2::uuid[]))',[entidade,observados])).rows[0].n);
   if(ausentes){resumo.lacunas.ORIGEM_AUSENTE_HISTORICO_PRESERVADO=(resumo.lacunas.ORIGEM_AUSENTE_HISTORICO_PRESERVADO??0)+ausentes;total.lacunas+=ausentes;}
  }

  // A segunda passagem resolve citações sem supor que a ordem dos UUIDs seja cronológica.
  // Revalidar o hash sob trava impede que esta finalização altere uma escrita concorrente.
  const camposMensagem=camposPorEntidade.get('mensagem');
  if(camposMensagem){
   let depois:string|null=null;
   for(;;){
    await t.query('BEGIN');
    try{
     await t.query("SET LOCAL statement_timeout='10s'; SET LOCAL lock_timeout='3s'; SET LOCAL timezone='UTC'");
     const r:QueryResult<{dados:Dados;hash_origem:string;hash_destino:string;citada:string|null}>=await t.query(`SELECT to_jsonb(e) dados,p.hash_origem,p.hash_destino,c.id citada FROM atendimento_operacao.mensagem e
      JOIN atendimento_operacao.importacao_estado p ON p.destino_id=e.id AND p.entidade='mensagem' AND p.importacao_id=$1
      LEFT JOIN atendimento_operacao.mensagem c ON c.id::text=e.metadados->>'origemCitacaoId' AND c.conversa_id=e.conversa_id
      WHERE ($2::uuid IS NULL OR e.id>$2) ORDER BY e.id LIMIT 500 FOR UPDATE OF e`,[c.idImportacao,depois]);
     if(!r.rowCount){await t.query('COMMIT');break;}
     const atualizacoes:Dados[]=[],estados:Dados[]=[];
     for(const v of r.rows){
      const d=v.dados as Dados;
      if(hashImportacaoOperacao(compactar(d,camposMensagem))!==v.hash_destino){ponto('DESTINO_ALTERADO_PRESERVADO','mensagem');continue;}
      if((d.metadados as Dados).origemCitacaoId&&!v.citada)ponto('CITACAO_LEGADA_INDISPONIVEL','mensagem');
      if(v.citada&&d.citada_id!==v.citada){d.citada_id=v.citada;atualizacoes.push({id:d.id,citada_id:v.citada});estados.push({entidade:'mensagem',origem_id:d.id,destino_id:d.id,hash_origem:v.hash_origem,hash_destino:hashImportacaoOperacao(compactar(d,camposMensagem)),importacao_id:c.idImportacao});}
     }
     if(atualizacoes.length)await t.query('UPDATE atendimento_operacao.mensagem e SET citada_id=x.citada_id FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,citada_id uuid) WHERE e.id=x.id',[JSON.stringify(atualizacoes)]);
     await gravarEstados(estados);await t.query('COMMIT');depois=String(r.rows.at(-1)!.dados.id);
    }catch(e){await t.query('ROLLBACK');throw e;}
   }
  }
  // Conferência de conteúdo do destino. Totais sozinhos não comprovam igualdade.
  for(const [entidade,campos] of camposPorEntidade){
   let depois:string|null=null;const h=createHash('sha256'),total=resumo.entidades[entidade];
   for(;;){
    const r:QueryResult<{dados:Dados;hash_destino:string}>=await t.query(`SELECT ${expressaoLinha(entidade)} dados,p.hash_destino FROM atendimento_operacao.${entidade} e
     JOIN atendimento_operacao.importacao_estado p ON p.destino_id=e.id AND p.entidade=$1 AND p.importacao_id=$2
     WHERE ($3::uuid IS NULL OR e.id>$3) ORDER BY e.id LIMIT 500`,[entidade,c.idImportacao,depois]);
    if(!r.rowCount)break;
    for(const v of r.rows){const atual=hashImportacaoOperacao(compactar(v.dados,campos));h.update(atual);if(atual===v.hash_destino)total.verificados++;else{total.divergentes++;ponto('DESTINO_MUDOU_DURANTE_CONFERENCIA',entidade);}}
    depois=String(r.rows.at(-1)!.dados.id);
   }
   total.hashDestino=h.digest('hex');
  }
  await s.query('COMMIT');resumo.fimEm=new Date().toISOString();resumo.duracaoMs=Date.now()-inicio;
  await t.query("INSERT INTO atendimento_operacao.importacao(id,origem,marcador,resumo) VALUES($1,'donatella_preparacao',$2,$3) ON CONFLICT(id) DO UPDATE SET resumo=$3,concluida_em=now()",[c.idImportacao,c.marcador,JSON.stringify(resumo)]);
  return resumo;
 }catch(e){await s.query('ROLLBACK').catch(()=>undefined);throw e;}
 finally{if(lock)await t.query("SELECT pg_advisory_unlock(hashtextextended('donatella-importacao-operacional',0))").catch(()=>undefined);s.release();t.release();if(!opcoes?.origem)await origem.end();if(!opcoes?.destino)await destino.end();}
}
