import {readFile,open,rename,statfs} from 'node:fs/promises';
import {join} from 'node:path';
import {Pool} from 'pg';
import {abrirCarga,type CargaPreparada} from '../../src/lib/atendimento/carga';
import {criarMaterializador} from '../../src/lib/atendimento/materializacao';
import {coletarLote,criarOrigemColeta,type ConfiguracaoColeta} from '../../src/lib/atendimento/coleta';
import {arquivarCarga} from '../../src/lib/atendimento/arquivo-carga';
import {criarArquivoExterno} from './arquivo-externo';
import {criarCifraBackup} from './backup-r2';
import {criarCanalArquivos,type RegistroArquivoIncremental} from './arquivo-incremental-duravel';
import {prisma} from '../../src/lib/prisma';
import {retomarConfirmacoes} from '../../src/lib/atendimento/retomada-confirmacao';
import {avaliarContinuidade} from '../../src/lib/atendimento/observabilidade';
import {criarSupervisorRetentativas,esperarIntervaloSupervisao,POLITICA_RETENTATIVAS} from '../../src/lib/atendimento/supervisao-coleta';
const config=JSON.parse(await readFile('/run/secrets/coletor.json','utf8'));
const pool=new Pool({connectionString:config.DATABASE_URL,max:2,connectionTimeoutMillis:5000,application_name:'donatella-materializacao-v2'});
const catalogo=JSON.parse(await readFile('/release/estrutura.json','utf8'));
const materializar=criarMaterializador(pool,catalogo.tabelas,config.ATENDIMENTO_EXECUCAO_CARGA);
async function gravarEstadoArquivo(nome:'supervisao'|'processo',estado:Record<string,unknown>){
 const parcial=`/estado/.${nome}.parcial`,destino=`/estado/${nome}.json`;
 const f=await open(parcial,'w',0o600);try{await f.writeFile(JSON.stringify(estado));await f.sync();}finally{await f.close();}await rename(parcial,destino);
 const dir=await open('/estado','r');try{await dir.sync();}finally{await dir.close();}
}
async function inicial(){
 let docs=0,linhas=0;
 const pendentes=await pool.query(`SELECT d.id,d.hash,d.cifrado FROM atendimento_migracao.carga_documento d LEFT JOIN atendimento_migracao.materializacao m ON m.execucao=d.execucao AND m.documento_id=d.id WHERE d.execucao=$1 AND m.documento_id IS NULL ORDER BY d.recebido_em,d.id`,[config.ATENDIMENTO_EXECUCAO_CARGA]);
 for(const d of pendentes.rows){const c={documento:abrirCarga(d.cifrado,d.hash),hash:d.hash,cifrado:d.cifrado,estados:[]} satisfies CargaPreparada;const r=await materializar(c);linhas+=r.registros;docs++;}
 console.log(JSON.stringify({documentosMaterializados:docs,registros:linhas,semRotinasDeNegocio:true}));
}
async function supervisao(){
 const origem:ConfiguracaoColeta={execucao:config.ATENDIMENTO_EXECUCAO_CARGA,origem:config.ATENDIMENTO_ORIGEM_URL,credencial:config.ATENDIMENTO_ORIGEM_PUBLISHABLE_KEY,tokenColetor:config.ATENDIMENTO_ORIGEM_COLETOR_TOKEN,capturaAprovada:true,simular:false};
 const ler=criarOrigemColeta(origem);
 const arquivarExterno=criarArquivoExterno(config.backupExterno);
 let ultimaConferenciaR2Rodada:string|null=null;
 let etapa='inicializacao';
 const cifraArquivos=config.backupExterno&&config.arquivosIncrementais===true?criarCifraBackup(config.ATENDIMENTO_CARGA_SECRET):null;
 const registrarArquivo=async(r:RegistroArquivoIncremental)=>{
  const v=r.versao;
  await pool.query(`INSERT INTO atendimento_migracao.arquivo_versao(execucao,identidade,objeto_id,bucket,nome,etag,versao_origem,atualizado_origem,sha256,bytes,arquivo,pacote,manifesto_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING`,[origem.execucao,v.identidade,v.id,v.bucket,v.name,v.etag,v.version,v.updatedAt,r.sha256,r.bytes,r.arquivo,r.referencia.id,r.referencia.sha256]);
  const prova=await pool.query(`SELECT 1 FROM atendimento_migracao.arquivo_versao WHERE execucao=$1 AND identidade=$2 AND objeto_id=$3 AND bucket=$4 AND nome=$5 AND etag=$6 AND versao_origem IS NOT DISTINCT FROM $7 AND atualizado_origem=$8 AND sha256=$9 AND bytes=$10 AND arquivo=$11`,[origem.execucao,v.identidade,v.id,v.bucket,v.name,v.etag,v.version,v.updatedAt,r.sha256,r.bytes,r.arquivo]);
  if(prova.rowCount!==1)throw Error('ARQUIVO_INDICE_DESTINO_DIVERGENTE');
 };
 const canalArquivos=cifraArquivos?criarCanalArquivos({config:{...config.backupExterno,prefixo:'donatella-v2/arquivos'},cifra:cifraArquivos,estado:'/estado/arquivos',midiaInicial:'/midia',indiceInicial:'/run/secrets/media-index.json',origem:origem.origem,credencial:origem.credencial,registrar:registrarArquivo}):null;
 const registrar=async(id:string)=>{const r=await pool.query('UPDATE atendimento_migracao.confirmacao SET observada_em=coalesce(observada_em,now()) WHERE execucao=$1 AND documento_id=$2',[origem.execucao,id]);if(r.rowCount!==1)throw Error('DIARIO_CONFIRMAR_DIVERGENTE');};
 const arquivar=async(c:CargaPreparada)=>{
  // SIGTERM interrompe antes do próximo grupo. O grupo em andamento termina
  // arquivo/commit/ACK, sem antecipar confirmação ou iniciar os demais do lote.
  if(encerrar)throw Error('COLETA_ENCERRAMENTO_SOLICITADO');
  if(!arquivarExterno)throw Error('BACKUP_DESTINO_AUSENTE');
  const s=await statfs('/estado',{bigint:true});if(s.bavail*s.bsize<BigInt(512*1024*1024))throw Error('ESPACO_INSUFICIENTE');
  // Impede ativação acidental de ACK de mídia preservando somente metadados.
  // A captura não contém os bytes; versões novas precisam do canal físico completo.
  etapa='preservacao_fisica';
  if(c.documento.tipo==='transacao'&&c.documento.eventos.some(e=>e.schema==='storage'&&e.tabela==='objects'&&[e.anterior,e.posterior].some(r=>r&&['whatsapp-media','audio-messages'].includes(String(r.bucket_id))))){if(!canalArquivos)throw Error('ARQUIVOS_INCREMENTAIS_REQUEREM_PRESERVACAO');await canalArquivos.preservar(c.documento);}
  etapa='arquivo_local';
  await arquivarCarga(c,'/estado/cargas','/release');
  etapa='arquivo_externo';
  const bytes=await readFile(join('/estado/cargas',c.documento.execucao,c.documento.id+'.json.enc'));
  try{await arquivarExterno(`${c.documento.execucao}/${c.documento.id}.json.enc`,bytes);ultimaConferenciaR2Rodada=new Date().toISOString();}finally{bytes.fill(0);}
 };
 let estado:Record<string,unknown>={ultimaColetaBemSucedida:null,falhasConsecutivas:0,transacoesConfirmadas:0,eventosConfirmados:0};
 try{estado=JSON.parse(await readFile('/estado/supervisao.json','utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 const supervisor=criarSupervisorRetentativas(estado,Date.now,async controle=>{etapa='reserva_retentativa';estado={...estado,controleRetentativas:controle};await gravarEstadoArquivo('supervisao',estado);});
 let encerrar=false,erroPulso:unknown;const interrupcao=new AbortController();
 const parar=()=>{encerrar=true;interrupcao.abort();};process.on('SIGTERM',parar);process.on('SIGINT',parar);
 const iniciadoEm=new Date().toISOString();
 const pulsar=(fase:'ativo'|'encerrado')=>gravarEstadoArquivo('processo',{versao:1,pid:process.pid,fase,iniciadoEm,atualizadoEm:new Date().toISOString(),provaDeSincronizacao:false});
 await pulsar('ativo');
 const pulsacao=(async()=>{while(!encerrar){await esperarIntervaloSupervisao(POLITICA_RETENTATIVAS.pulsacaoMs,interrupcao.signal);if(!encerrar)await pulsar('ativo');}})().catch(e=>{erroPulso=e;parar();});
 try{
 while(!encerrar){
  const inicio=new Date().toISOString();
  ultimaConferenciaR2Rodada=null;
  const tentativa=await supervisor.tentar(async()=>{
   if(encerrar)throw Error('COLETA_ENCERRAMENTO_SOLICITADO');
   etapa='consulta_origem';
   const resultado=await coletarLote(origem,{
    arquivar,
    persistir:async c=>{etapa='persistencia_cifrada';await (await import('../../src/lib/atendimento/carga')).persistirCarga(c);etapa='materializacao';await materializar(c);etapa='diario_confirmacao';await pool.query('INSERT INTO atendimento_migracao.confirmacao(execucao,documento_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[origem.execucao,c.documento.id]);etapa='confirmacao_origem';},
    confirmada:c=>registrar(c.documento.id),
   },fetch,{aposLeituraValidada:async observacao=>{
    estado={...estado,http:null,ultimaConsultaOrigem:observacao.lidaEm,duracaoConsultaOrigemMs:observacao.duracaoConsultaOrigemMs,continuidadeCaptura:'validada_pelo_rpc',pendenciasObservadas:observacao.transacoes,pendenciasExatas:observacao.transacoes<20,primeiraPendenciaObservada:observacao.transacoes?(estado.primeiraPendenciaObservada??inicio):null};
    if(!arquivarExterno)throw Error('BACKUP_DESTINO_AUSENTE');
    etapa='retomada_confirmacao';
    const pendentes=await pool.query(`SELECT c.documento_id id FROM atendimento_migracao.confirmacao c WHERE execucao=$1 AND observada_em IS NULL ORDER BY pronta_em,documento_id LIMIT 20`,[origem.execucao]);
    await retomarConfirmacoes(pendentes.rows.map(r=>r.id),{verificar:async id=>{const r=await pool.query('SELECT hash,cifrado FROM atendimento_migracao.carga_documento WHERE execucao=$1 AND id=$2',[origem.execucao,id]);if(r.rowCount!==1)throw Error('RETOMADA_DIVERGENTE');const a=r.rows[0],documento=abrirCarga(a.cifrado,a.hash);const carga={documento,hash:a.hash,cifrado:a.cifrado,estados:[]};await arquivar(carga);await materializar(carga);},confirmar:id=>ler('confirmar',{ids:[id]}),registrar});
   }});
   return resultado;
  });
  estado={...estado,controleRetentativas:tentativa.controle};
  if(tentativa.tipo==='sucesso'){
   const resultado=tentativa.resultado;
   estado={...estado,ultimaColetaBemSucedida:new Date().toISOString(),falha:null,codigoTecnico:null,etapaFalha:null,http:null,falhasConsecutivas:0,transacoesConfirmadas:Number(estado.transacoesConfirmadas??0)+resultado.confirmadas,eventosConfirmados:Number(estado.eventosConfirmados??0)+resultado.eventos,backupExterno:ultimaConferenciaR2Rodada?'verificado_antes_de_cada_ack':'sem_operacao_r2_nesta_rodada'};
  }else if(tentativa.tipo==='falha'){
   const erro=tentativa.falha;
   estado={...estado,falha:erro.codigo,etapaFalha:etapa,codigoTecnico:erro.codigoTecnico,falhasConsecutivas:tentativa.controle.falhasConsecutivas,ultimaFalha:tentativa.controle.ultimaFalhaEm,backupExterno:arquivarExterno?'nao_comprovado_nesta_rodada':'destino_ausente',viradaBloqueada:true};
   if(erro.rpc)estado={...estado,continuidadeCaptura:'nao_comprovada_nesta_rodada',http:erro.http};
   console.error(JSON.stringify({falha:erro.codigo,etapa,codigoTecnico:erro.codigoTecnico,circuito:tentativa.controle.fase,proximaTentativaEm:tentativa.controle.proximaTentativaEm,ackNaoAntecipado:true}));
  }
  estado={...estado,estadoOperacionalColetor:tentativa.controle.fase==='intervencao'?'intervencao_necessaria':tentativa.controle.fase==='circuito_aberto'?'aguardando_sonda':'aguardando_rodada'};
  if(ultimaConferenciaR2Rodada)estado={...estado,ultimaConferenciaExterna:ultimaConferenciaR2Rodada};
  // Persistir o circuito antes das métricas locais: erro de diagnóstico não apaga
  // o prazo de espera e não gera nova rodada imediata após reinício.
  await gravarEstadoArquivo('supervisao',estado);
  try{
  const volume=await pool.query(`SELECT pg_database_size(current_database())::text bytes`);
  const armazenamento=await statfs('/estado',{bigint:true});
  const marcas=await pool.query(`SELECT (SELECT max(recebido_em) FROM atendimento_migracao.carga_documento WHERE execucao=$1) recepcao,(SELECT max(aplicado_em) FROM atendimento_migracao.materializacao WHERE execucao=$1) materializacao`,[origem.execucao]);
  if(canalArquivos){
   const arquivos=await pool.query(`SELECT count(*)::integer versoes,count(DISTINCT sha256)::integer conteudos,(SELECT coalesce(sum(bytes),0)::text FROM (SELECT sha256,max(bytes) bytes FROM atendimento_migracao.arquivo_versao WHERE execucao=$1 GROUP BY sha256) c) bytes FROM atendimento_migracao.arquivo_versao WHERE execucao=$1`,[origem.execucao]);
   estado={...estado,versoesArquivosPreservadas:arquivos.rows[0].versoes,conteudosArquivosPreservados:arquivos.rows[0].conteudos,volumeConteudoArquivosBytes:arquivos.rows[0].bytes};
  }
  const diario=await pool.query(`SELECT count(*) FILTER(WHERE observada_em IS NOT NULL)::integer observadas,count(*) FILTER(WHERE observada_em IS NULL)::integer pendentes,max(observada_em) ultima FROM atendimento_migracao.confirmacao WHERE execucao=$1`,[origem.execucao]);
  estado={...estado,confirmacoesObservadasNoDiario:diario.rows[0].observadas,confirmacoesPendentesNoDiario:diario.rows[0].pendentes,ultimaConfirmacaoObservada:diario.rows[0].ultima};
  estado={...estado,atualizadoEm:new Date().toISOString(),volumeBancoBytes:volume.rows[0].bytes,volumeEstadoLivreBytes:String(armazenamento.bavail*armazenamento.bsize),volumeEstadoTotalBytes:String(armazenamento.blocks*armazenamento.bsize),ultimaRecepcao:marcas.rows[0].recepcao,ultimaMaterializacao:marcas.rows[0].materializacao,atrasoDesdeUltimaColetaSegundos:estado.ultimaColetaBemSucedida?Math.floor((Date.now()-Date.parse(String(estado.ultimaColetaBemSucedida)))/1000):null,idadeRealEventosDisponivel:false};
  estado={...estado,falhaDiagnostico:null,observabilidade:avaliarContinuidade(estado,Date.now())};
  await gravarEstadoArquivo('supervisao',estado);
  await pool.query(`INSERT INTO atendimento_migracao.supervisao(id,estado,atualizado_em) VALUES(true,$1,now()) ON CONFLICT(id) DO UPDATE SET estado=excluded.estado,atualizado_em=excluded.atualizado_em`,[JSON.stringify(estado)]);
  }catch{
   estado={...estado,falha:estado.falha??'METRICAS_COLETOR_INDISPONIVEIS',falhaDiagnostico:'METRICAS_COLETOR_INDISPONIVEIS',controleRetentativas:supervisor.interromper(Error('METRICAS_COLETOR_INDISPONIVEIS')),estadoOperacionalColetor:'intervencao_necessaria',viradaBloqueada:true};
   await gravarEstadoArquivo('supervisao',estado);
   throw Error('METRICAS_COLETOR_INDISPONIVEIS');
  }
  if(!encerrar)await esperarIntervaloSupervisao(POLITICA_RETENTATIVAS.intervaloMs,interrupcao.signal);
 }
 }finally{
  parar();
  try{
   await pulsacao;
   if(erroPulso){estado={...estado,falha:'PULSACAO_COLETOR_INTERROMPIDA',controleRetentativas:supervisor.interromper(Error('PULSACAO_COLETOR_INTERROMPIDA')),estadoOperacionalColetor:'intervencao_necessaria',viradaBloqueada:true};await gravarEstadoArquivo('supervisao',estado);}
   await pulsar('encerrado');
  }finally{cifraArquivos?.fechar();process.off('SIGTERM',parar);process.off('SIGINT',parar);}
 }
 if(erroPulso)throw Error('PULSACAO_COLETOR_INTERROMPIDA');
}
async function conferir(){
 // Relê as projeções tipadas e os payloads cifrados em um snapshot consistente.
 const db=await pool.connect();let linhas=0,divergencias=0;const entidades:Record<string,number>={};
 try{
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const docs=await db.query(`SELECT d.id,d.hash,d.cifrado FROM atendimento_migracao.carga_documento d WHERE d.execucao=$1 ORDER BY d.id`,[config.ATENDIMENTO_EXECUCAO_CARGA]);
  for(const doc of docs.rows){
   const d=abrirCarga(doc.cifrado,doc.hash);
   const estados=await db.query(`SELECT schema_name,table_name,indice,excluido,chave_hash FROM atendimento_migracao.carga_registro WHERE execucao=$1 AND documento_id=$2`,[config.ATENDIMENTO_EXECUCAO_CARGA,doc.id]);
   const grupos=new Map<string,{dados:unknown[];exclusoes:Record<string,unknown>[]}>();
   for(const e of estados.rows){
    const t=catalogo.tabelas.find((t:{esquema:string;tabela:string})=>t.esquema===e.schema_name&&t.tabela===e.table_name);
    const ev=d.tipo==='transacao'?d.eventos[e.indice]:null;
    const dados=d.tipo==='snapshot'?d.registros[e.indice].dados:(e.excluido?ev?.anterior:ev?.posterior);
    const chave=d.tipo==='snapshot'?d.registros[e.indice].chave:(e.excluido?ev?.chave_anterior:ev?.chave_posterior);
    const qt=(s:string)=>'"'+s.replaceAll('"','""')+'"',nome=`${qt('donatella_'+t.esquema)}.${qt(t.tabela)}`;
    const grupo=grupos.get(nome)??{dados:[],exclusoes:[]};grupos.set(nome,grupo);
    if(e.excluido)grupo.exclusoes.push(chave!);else grupo.dados.push(dados);
    linhas++;const alvo=e.schema_name+'.'+e.table_name;entidades[alvo]=(entidades[alvo]??0)+1;
   }
   for(const [nome,g]of grupos){
    const qt=(s:string)=>'"'+s.replaceAll('"','""')+'"',t=catalogo.tabelas.find((t:{esquema:string;tabela:string})=>nome===`${qt('donatella_'+t.esquema)}.${qt(t.tabela)}`);
    const {serializarCarga}=await import('../../src/lib/atendimento/carga');
    // Uma consulta por página/grupo: comparação de todos os campos pelo tipo efetivo.
    if(g.dados.length){const r=await db.query(`SELECT count(*)::integer divergencias FROM jsonb_populate_recordset(NULL::${nome},$1::jsonb) esperado LEFT JOIN ${nome} atual ON ${t.pk.map((p:string)=>`atual.${qt(p)}=esperado.${qt(p)}`).join(' AND ')} WHERE to_jsonb(atual) IS DISTINCT FROM to_jsonb(esperado)`,[serializarCarga(g.dados)]);divergencias+=r.rows[0].divergencias;}
    for(const chave of g.exclusoes){const r=await db.query(`SELECT 1 FROM ${nome} WHERE ${t.pk.map((p:string,i:number)=>`${qt(p)}=$${i+1}`).join(' AND ')}`,t.pk.map((p:string)=>chave[p]));if(r.rowCount)divergencias++;}
   }
  }
  for(const t of catalogo.tabelas){const qt=(s:string)=>'"'+s.replaceAll('"','""')+'"';const r=await db.query(`SELECT (SELECT count(*) FROM ${qt('donatella_'+t.esquema)}.${qt(t.tabela)})=(SELECT count(*) FROM atendimento_migracao.carga_registro WHERE execucao=$1 AND schema_name=$2 AND table_name=$3 AND NOT excluido) igual`,[config.ATENDIMENTO_EXECUCAO_CARGA,t.esquema,t.tabela]);if(!r.rows[0].igual)divergencias++;}
  await db.query('ROLLBACK');
  const prova={instante:new Date().toISOString(),linhas,divergencias,entidades,comparacaoConteudoTipado:true,igualdadeAoVivoOrigem:false};
  await (await import('node:fs/promises')).writeFile('/estado/reconciliacao-materializada.json',JSON.stringify(prova),{mode:0o600});console.log(JSON.stringify({linhas,divergencias,entidades:Object.keys(entidades).length}));
  if(divergencias)throw Error('MATERIALIZACAO_DIVERGENTE');
 }finally{db.release();}
}
try{const acao=process.argv[2];if(acao==='materializar')await inicial();else if(acao==='conferir')await conferir();else if(acao==='supervisionar')await supervisao();else throw Error('ACAO_INVALIDA');}
catch(e){const erro=e as {code?:string;name?:string;table?:string;column?:string};console.error(JSON.stringify({falha:'RUNTIME_INTERROMPIDO',codigo:erro.code??null,tipo:erro.name??null,tabela:erro.table??null,coluna:erro.column??null}));process.exitCode=1;}
finally{await pool.end();await prisma.$disconnect();}
