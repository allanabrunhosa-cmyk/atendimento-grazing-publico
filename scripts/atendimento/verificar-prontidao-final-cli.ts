// Manual, após T0/importação/checkpoint e dentro do segundo comando autorizado.
// Só consulta bancos/R2 e publica recibos privados. Nunca habilita atendimento.
import {readFile,lstat,open,link,unlink} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {criarCifraBackup,recuperarPacoteR2} from './backup-r2';
import {criarRepositorioS3,type ConfiguracaoS3} from './repositorio-s3';
import {extrairCheckpointOperacaoR2} from './checkpoint-operacao-r2';
import type {EntradaVerificacaoR2} from './verificacao-r2';
import type {EstadoCopiaFinal} from './copia-final-origem';
import type {ObservacaoManutencao} from './manutencao-origem';
import {conferirReferenciaEstado,conferirRecibosFinais,conferirConteudoFinal,conferirLimitacoesHistoricas,type MensagemDestino,type ReferenciaEstadoFinal,type RelatorioFinal,type ReciboImportacaoFinal,type EnsaioReceptor} from './prova-copia-final';
import {montarProvaFinal} from './prontidao-final-documentos';

const corte='/corte',sha=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex'),uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
async function ler(p:string,limite=128*1024,privado=true){
 for(let a=p;;a=dirname(a)){const s=await lstat(a);if(s.isSymbolicLink())throw Error('PRONTIDAO_FINAL_CAMINHO_RECUSADO');if(dirname(a)===a)break;}
 const s=await lstat(p);if(!s.isFile()||s.size>limite||privado&&(s.mode&0o077)!==0)throw Error('PRONTIDAO_FINAL_ARQUIVO_PRIVADO_RECUSADO');return readFile(p);
}
async function exclusivo(p:string,v:unknown){
 const b=Buffer.from(JSON.stringify(v)),temp=join(dirname(p),'.'+randomUUID()+'.parcial');
 const f=await open(temp,'wx',0o600);try{await f.writeFile(b);await f.sync();}finally{await f.close();}
 try{await link(temp,p);}finally{await unlink(temp);}
 const d=await open(dirname(p),'r');try{await d.sync();}finally{await d.close();}return sha(b);
}
type Coletor={ATENDIMENTO_CARGA_SECRET:string;backupExterno:ConfiguracaoS3};
async function executar(){
 if(process.platform!=='linux'||process.argv.length!==3||process.argv[2]!=='--conferir-prontidao-final')throw Error('PRONTIDAO_FINAL_EXECUCAO_MANUAL_EXIGIDA');
 const config=JSON.parse((await ler(corte+'/prova-final.json')).toString()) as {versao:1;execucao:string;checkpointOperacao:string};
 if(config.versao!==1||!uuid.test(config.execucao)||!uuid.test(config.checkpointOperacao))throw Error('PRONTIDAO_FINAL_CONFIGURACAO_RECUSADA');
 const id=config.execucao,base='/estado/copia-final/'+id,runtimeSha256=sha(await ler('/release/operacao.mjs',16*1024*1024,false));
 const gateBytes=await ler('/run/secrets/operacao.json'),gate=JSON.parse(gateBytes.toString()),authBytes=await ler(corte+'/autorizacao.json'),auth=JSON.parse(authBytes.toString());
 if(gate.modo!=='receber'||gate.autoridade!=='nenhuma'||gate.enviosHabilitados!==false||gate.iaAutomatica!==false||gate.voz?.sinteseHabilitada!==false)throw Error('PRONTIDAO_FINAL_DESTINO_NAO_DESARMADO');
 const conferirAutorizacao=async()=>{
  const inicio=Date.parse(auth.inicio),fim=Date.parse(auth.fim),agora=Date.now();
  if(auth.versao!==1||auth.segundoComandoExpresso!==true||typeof auth.referenciaMensagem!=='string'||!auth.referenciaMensagem.trim()||!Number.isFinite(inicio)||!Number.isFinite(fim)||fim<=inicio||fim-inicio>8*3600_000||agora<inicio||agora>=fim||auth.runtimeSha256!==runtimeSha256||auth.wabaId!==gate.meta?.wabaId||auth.phoneId!==gate.meta?.phoneId||sha(await ler(corte+'/autorizacao.json'))!==sha(authBytes)||sha(await ler('/run/secrets/operacao.json'))!==sha(gateBytes))throw Error('PRONTIDAO_FINAL_AUTORIZACAO_DIVERGENTE');
 };
 await conferirAutorizacao();
 const nomes={origemSha256:'origem-congelada.json',configCopiaSha256:'copia-final.json',relatorioSha256:`executor/${id}-relatorio.json`,importacaoOperacionalSha256:`importacoes-operacao/${id}-recibo.json`};
 const bytes=Object.fromEntries(await Promise.all(Object.entries(nomes).map(async([k,p])=>[k,await ler(join(corte,p),256*1024)])));
 const vinculos={origemSha256:sha(bytes.origemSha256),configCopiaSha256:sha(bytes.configCopiaSha256),relatorioSha256:sha(bytes.relatorioSha256),importacaoOperacionalSha256:sha(bytes.importacaoOperacionalSha256)};
 const origem=JSON.parse(bytes.origemSha256.toString()) as ObservacaoManutencao,relatorio=JSON.parse(bytes.relatorioSha256.toString()) as RelatorioFinal,importacao=JSON.parse(bytes.importacaoOperacionalSha256.toString()) as ReciboImportacaoFinal;
 if(JSON.parse(bytes.configCopiaSha256.toString()).execucao!==id)throw Error('PRONTIDAO_FINAL_COPIA_DIVERGENTE');
 const origemPosteriorArquivo=`verificacoes/${id}-origem-posterior.json`,posteriorBytes=await ler(join(corte,origemPosteriorArquivo)),posterior=JSON.parse(posteriorBytes.toString()) as ObservacaoManutencao;
 const ensaioArquivo=`verificacoes/ensaio-receptor-${runtimeSha256}.json`,ensaioBytes=await ler(join(corte,ensaioArquivo)),ensaio=JSON.parse(ensaioBytes.toString()) as EnsaioReceptor;
 const estadoBytes=await ler(base+'/estado.json',512*1024),estado=JSON.parse(estadoBytes.toString()) as EstadoCopiaFinal;
 conferirRecibosFinais({estado,origem,posterior,relatorio,importacao,ensaio,runtimeSha256,vinculos,agora:new Date().toISOString()});
 const referencia=JSON.parse((await ler(base+'/estado-ref-r2.json')).toString()) as ReferenciaEstadoFinal;conferirReferenciaEstado(referencia,id);
 if(JSON.stringify(relatorio.estadoFinalR2)!==JSON.stringify(referencia))throw Error('PRONTIDAO_FINAL_RECEITA_RECUPERACAO_DIVERGENTE');
 const cfg=JSON.parse((await ler('/run/secrets/coletor.json')).toString()) as Coletor,checkpointCfg=JSON.parse((await ler('/run/secrets/checkpoint.json')).toString()) as EntradaVerificacaoR2;
 if(checkpointCfg.segredoTrabalho!==cfg.ATENDIMENTO_CARGA_SECRET)throw Error('PRONTIDAO_FINAL_CUSTODIA_DIVERGENTE');
 const importador=JSON.parse((await ler('/run/secrets/importacao.json')).toString()) as {origemDatabaseUrl:string;destinoDatabaseUrl:string;origemStorageURL:string};
 if(importador.destinoDatabaseUrl!==gate.databaseUrl)throw Error('PRONTIDAO_FINAL_PAPEL_DESTINO_DIVERGENTE');
 const db=new URL(importador.origemDatabaseUrl);if(db.protocol!=='postgresql:'||db.hostname!=='grazing-donatella-homologacao-v2-banco'||db.pathname!=='/donatella_preparacao'||db.username!=='donatella_importacao_operacao')throw Error('PRONTIDAO_FINAL_BANCO_RECUSADO');
 process.env.DATABASE_URL=importador.origemDatabaseUrl;process.env.ATENDIMENTO_CARGA_SECRET=cfg.ATENDIMENTO_CARGA_SECRET;
 const {abrirCarga,serializarCarga}=await import('../../src/lib/atendimento/carga');
 const opcoesPool={max:1,connectionTimeoutMillis:5000,statement_timeout:60_000,options:'-c default_transaction_read_only=on -c timezone=UTC',application_name:'donatella-prova-final-v2'};
 for(const [chave,banco]of [['databaseUrl','donatella_operacao'],['entradaDatabaseUrl','donatella_entrada']]){const u=new URL(gate[chave]);if(u.hostname!=='grazing-donatella-operacao-v2-banco'||u.pathname!=='/'+banco||u.protocol!=='postgresql:'||u.search||u.hash)throw Error('PRONTIDAO_FINAL_BANCO_RECUSADO');}
 const pool=new Pool({connectionString:importador.origemDatabaseUrl,...opcoesPool}),operacao=new Pool({connectionString:importador.destinoDatabaseUrl,...opcoesPool}),entrada=new Pool({connectionString:gate.entradaDatabaseUrl,...opcoesPool}),cifra=criarCifraBackup(cfg.ATENDIMENTO_CARGA_SECRET);
 let objetosVerificados=0,bytesVerificados=0;
 const criarRepo=(c:ConfiguracaoS3)=>{const r=criarRepositorioS3(c);return {...r,ler:async(k:string,l?:number)=>{await conferirAutorizacao();const b=await r.ler(k,l);if(b){objetosVerificados++;bytesVerificados+=b.length;}return b;},preservar:async()=>{throw Error('PRONTIDAO_FINAL_R2_SOMENTE_LEITURA');}};};
 try{
  const salvo=await criarRepo({...cfg.backupExterno,prefixo:referencia.prefixo}).ler(referencia.chave,referencia.bytes);
  if(!salvo||salvo.length!==referencia.bytes||sha(salvo)!==referencia.sha256)throw Error('PRONTIDAO_FINAL_ESTADO_R2_DIVERGENTE');
  const aberto=cifra.abrir(salvo,referencia.contexto);try{if(!aberto.equals(estadoBytes))throw Error('PRONTIDAO_FINAL_ESTADO_R2_DIVERGENTE');}finally{aberto.fill(0);salvo.fill(0);}
  const catalogo=JSON.parse((await ler('/preparacao/estrutura.json',8*1024*1024,false)).toString()) as {tabelas:{esquema:string;tabela:string;pk:string[]}[]};
  const q=(s:string)=>'"'+s.replaceAll('"','""')+'"',paginas=criarRepo(cfg.backupExterno);
  const abrirPagina=async(doc:string)=>{const b=await paginas.ler(`${id}/${doc}.json.enc`,32*1024*1024);if(!b)throw Error('PRONTIDAO_FINAL_PAGINA_R2_AUSENTE');try{const local=await ler(`${base}/${id}/${doc}.json.enc`,32*1024*1024);if(sha(local)!==sha(b))throw Error('PRONTIDAO_FINAL_PAGINA_R2_DIVERGENTE');const a=JSON.parse(b.toString());return {documento:abrirCarga(a.cifrado,a.hash),hash:a.hash};}finally{b.fill(0);}};
  const conteudo=await conferirConteudoFinal({estado,relatorio,conferirAutorizacao,abrirPagina,
   compararPagina:async(d)=>{if(!d.registros.length)return 0;const t=catalogo.tabelas.find(t=>t.esquema===d.schema&&t.tabela===d.tabela);if(!t||!Array.isArray(t.pk)||!t.pk.length)throw Error('PRONTIDAO_FINAL_CATALOGO_DIVERGENTE');const nome=q('donatella_'+d.schema)+'.'+q(d.tabela),r=await pool.query(`SELECT count(*)::int divergencias FROM jsonb_populate_recordset(NULL::${nome},$1::jsonb) esperado LEFT JOIN ${nome} atual ON ${t.pk.map(p=>`atual.${q(p)}=esperado.${q(p)}`).join(' AND ')} WHERE to_jsonb(atual) IS DISTINCT FROM to_jsonb(esperado)`,[serializarCarga(d.registros.map(r=>r.dados))]);return r.rows[0].divergencias;},
   recuperarMidia:receber=>recuperarPacoteR2({id,sha256:relatorio.midiaFinalR2.sha256,cifra,repositorio:criarRepo({...cfg.backupExterno,prefixo:relatorio.midiaFinalR2.prefixo}),receber}),
  });
  const limitacoes=await conferirLimitacoesHistoricas({importacao,conteudo,abrirPagina,origemStorageURL:importador.origemStorageURL,normalizarMensagens:async registros=>{
   const r=await pool.query('SELECT to_jsonb(m) dados FROM jsonb_populate_recordset(NULL::donatella_public.messages,$1::jsonb) WITH ORDINALITY m ORDER BY m.ordinality',[serializarCarga(registros)]);
   // WITH ORDINALITY acrescenta uma coluna ao registro composto; remova-a
   // antes do mesmo hash que o importador calcula para a tabela original.
   return r.rows.map(v=>{const {ordinality:_,...dados}=v.dados;void _;return dados;});
  },lerMensagemDestino:async mensagemId=>{
   await conferirAutorizacao();const r=await operacao.query<MensagemDestino>(`SELECT to_jsonb(m) dados,p.origem_id "origemId",p.destino_id "destinoId",p.importacao_id "importacaoId",p.hash_origem "hashOrigem",p.hash_destino "hashDestino" FROM atendimento_operacao.mensagem m JOIN atendimento_operacao.importacao_estado p ON p.entidade='mensagem' AND p.destino_id=m.id WHERE m.id=$1::uuid AND p.importacao_id=$2`,[mensagemId,'corte-'+id]);
   if(r.rows.length>1)throw Error('PRONTIDAO_FINAL_LIMITACAO_DESTINO_AMBIGUO');return r.rows[0]??null;
  }});
  // Nenhuma intenção de envio pode ter sido importada do histórico. Novas
  // entradas ficam no banco separado, cujo fsync é conferido sem criar eventos.
  const filas=await operacao.query('SELECT count(*)::int quantidade FROM atendimento_operacao.intencao i JOIN atendimento_operacao.mensagem m ON m.id=i.mensagem_id WHERE m.importada');
  if(filas.rows[0].quantidade!==0)throw Error('PRONTIDAO_FINAL_FILA_HISTORICA_REATIVADA');
  const duravel=await entrada.query("SELECT current_database() banco,current_setting('fsync') fsync,current_setting('synchronous_commit') sincronizacao,to_regclass('atendimento_entrada.recibo') recibos,to_regclass('atendimento_entrada.evento') eventos");
  if(duravel.rows[0].banco!=='donatella_entrada'||duravel.rows[0].fsync!=='on'||duravel.rows[0].sincronizacao!=='on'||!duravel.rows[0].recibos||!duravel.rows[0].eventos)throw Error('PRONTIDAO_FINAL_ENTRADA_NAO_DURAVEL');
  const cpBytes=await ler(`/checkpoints/checkpoints-operacao-v2/checkpoint-${config.checkpointOperacao}.json`),cp=JSON.parse(cpBytes.toString());
  if(cp.versao!==2||cp.id!==config.checkpointOperacao||cp.banco!=='donatella_operacao'||cp.bancoEntrada!=='donatella_entrada'||cp.proveniencia!=='copia_real_preservada'||cp.falha!==null||cp.emExecucao!==false||cp.baseExternaIntegralConferida!==true||Date.parse(cp.criadoEm)<Date.parse(importacao.fim)||!Number.isFinite(Date.parse(cp.criadoEm))||!Number.isFinite(Date.parse(cp.concluidoEm))||Date.parse(cp.concluidoEm)<Date.parse(cp.criadoEm)||Date.parse(cp.concluidoEm)>Date.now())throw Error('PRONTIDAO_FINAL_CHECKPOINT_POSTERIOR_EXIGIDO');
  let runtimeConferido=false,entradaConferida=false,configConferida=false,receitaConferida=false;
  const cpProva=await extrairCheckpointOperacaoR2(checkpointCfg,cp.id,cp.referencia.sha256,async(nome,b)=>{
   if(nome==='operacao/release/operacao.mjs'){if(sha(b)!==runtimeSha256)throw Error('PRONTIDAO_FINAL_CHECKPOINT_RUNTIME_DIVERGENTE');runtimeConferido=true;}
   if(nome==='operacao/configuracao/operacao.json'){if(sha(b)!==sha(gateBytes))throw Error('PRONTIDAO_FINAL_CHECKPOINT_CONFIG_DIVERGENTE');configConferida=true;}
   if(nome==='operacao/banco/entrada.indice.json')entradaConferida=true;
   if(nome===`operacao/configuracao/corte/executor/${id}-relatorio.json`){if(sha(b)!==vinculos.relatorioSha256)throw Error('PRONTIDAO_FINAL_CHECKPOINT_RECEITA_DIVERGENTE');receitaConferida=true;}
  },criarRepo);
  if(!runtimeConferido||!entradaConferida||!configConferida||!receitaConferida||cpProva.bancoEntrada!=='donatella_entrada'||!cpProva.coberturaEntrada||cpProva.proveniencia!=='copia_real_preservada')throw Error('PRONTIDAO_FINAL_CHECKPOINT_COBERTURA_AUSENTE');
  await conferirAutorizacao();
  for(const [k,p]of Object.entries(nomes))if(sha(await ler(join(corte,p),256*1024))!==vinculos[k as keyof typeof vinculos])throw Error('PRONTIDAO_FINAL_RECIBO_ALTERADO');
  if(sha(await ler(join(corte,origemPosteriorArquivo)))!==sha(posteriorBytes)||sha(await ler(join(corte,ensaioArquivo)))!==sha(ensaioBytes)||sha(await ler(base+'/estado.json',512*1024))!==sha(estadoBytes))throw Error('PRONTIDAO_FINAL_RECIBO_ALTERADO');
  const verificadaEm=new Date().toISOString(),documentos=montarProvaFinal({id,t0:estado.t0,runtimeSha256,vinculos,verificadaEm,conteudo,limitacoes,referencia,objetosVerificados,bytesVerificados,origemPosterior:{arquivo:origemPosteriorArquivo,sha256:sha(posteriorBytes),verificadaEm:posterior.verificadaEm},entrada:{arquivoProva:ensaioArquivo,sha256Prova:sha(ensaioBytes),checkpointR2:{id:cp.id,manifestoSha256:cp.referencia.sha256,criadoEm:cp.criadoEm,concluidoEm:cp.concluidoEm}}});
  await exclusivo('/resultado/reconciliacao.json',documentos.reconciliacao);
  await exclusivo('/resultado/prova.json',documentos.prova);
  // Só o documento composto derivado dos recibos pode ser entregue ao gate.
  await exclusivo('/resultado/prontidao-final.json',documentos.prontidao);
  console.log(JSON.stringify({prontidaoFinalConferida:true,idCopiaFinal:id,runtimeSha256,tabelas:37,paginas:conteudo.paginasVerificadas,arquivos:conteudo.arquivosVerificados,objetosR2:objetosVerificados,bytesR2:bytesVerificados,limitacoesHistoricas:limitacoes.limitacoesHistoricas.length,reconciliacaoSha256:sha(JSON.stringify(documentos.reconciliacao)),enviosHabilitados:false}));
 }finally{await Promise.all([pool.end(),operacao.end(),entrada.end()]);cifra.fechar();}
}
try{await executar();}catch(e){const m=e instanceof Error?e.message:'';console.error(/^(PRONTIDAO_FINAL|COPIA_FINAL|BACKUP|CHECKPOINT_OPERACAO|MANUTENCAO)_[A-Z0-9_]+$/.test(m)?m:'PRONTIDAO_FINAL_INTERROMPIDA');process.exitCode=1;}
