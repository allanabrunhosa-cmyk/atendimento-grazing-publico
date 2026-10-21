import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {importarBibliotecaMeta} from '../../src/lib/atendimento/operacao-modelos-meta';
const endereco=process.env.AGENTE_BANCO_TESTE;if(!endereco||process.env.DONATELLA_ENSAIO_OPERACAO!=='1')throw Error('ENSAIO_MODELOS_META_EXIGIDO');
const u=new URL(endereco);if(u.protocol!=='postgresql:'||u.pathname!=='/donatella_ensaio_operacao'||!['grazing-donatella-operacao-v2-banco','donatella-ensaio-operacao-v2'].includes(u.hostname)||u.search||u.hash)throw Error('ENSAIO_MODELOS_META_BANCO_RECUSADO');
const pool=new Pool({connectionString:endereco,max:1,statement_timeout:10000});let provas=0;const conferir=(v:unknown)=>{assert.ok(v,'ENSAIO_MODELOS_META_FALHOU');provas++;};
const ids=['998877660011','998877660012','998877660013','998877660014'];
const base={id:ids[0],name:'fixture_meta_principal',language:'pt_BR',status:'APPROVED',parameter_format:'POSITIONAL',components:[{type:'BODY',text:'Aviso fictício.'}]};
const botoes={...base,id:ids[1],name:'fixture_meta_botoes',components:[...base.components,{type:'BUTTONS',buttons:[{type:'URL',text:'Fictício',url:'https://exemplo.invalid/{{1}}'}]}]};
const manual={...base,id:ids[2],name:'fixture_meta_manual'},pausado={...base,id:ids[3],name:'fixture_meta_pausado',status:'PAUSED'};
const linha=async(id:string)=>(await pool.query('SELECT id,nome,estado,componentes FROM atendimento_operacao.modelo WHERE id=$1',[id])).rows[0];
try{
 if(process.argv.includes('--retomada')){
  conferir((await pool.query('SELECT count(*)::int n FROM atendimento_operacao.modelo WHERE id=ANY($1::text[])',[ids])).rows[0].n===4);
  const primeiro=await linha(ids[0]);conferir(primeiro.estado==='META_DIVERGENCIA_REVISAR');conferir(primeiro.componentes[0].text==='Conteúdo manual fictício preservado.');conferir((await linha(ids[1])).estado==='FORMATO_INDISPONIVEL');console.log(JSON.stringify({fase:'modelos_meta_apos_reinicio',provas,bibliotecaDuravel:true,enviosExternos:0,fornecedoresChamados:0}));
 }else{
  if((await pool.query('SELECT 1 FROM atendimento_operacao.modelo WHERE id=ANY($1::text[])',[ids])).rowCount)throw Error('ENSAIO_MODELOS_META_IDS_OCUPADOS');
  const anterior=(await pool.query("SELECT conteudo,versao FROM atendimento_operacao.configuracao WHERE chave='modelos_meta_proveniencia'")).rows[0];
  try{
   await pool.query("DELETE FROM atendimento_operacao.configuracao WHERE chave='modelos_meta_proveniencia'");
   await pool.query("INSERT INTO atendimento_operacao.modelo(id,nome,idioma,estado,componentes) VALUES($1,'fixture_meta_manual_local','pt_BR','APPROVED','[{\"type\":\"BODY\",\"text\":\"Conteúdo manual anterior.\"}]')",[ids[2]]);
   const completa={paginas:[{data:[base,botoes],paging:{next:'https://graph.facebook.com/fronteira-ficticia'}},{data:[manual,pausado]}]};
   const inicial=await importarBibliotecaMeta(pool,completa);conferir(inicial.paginacaoCompleta&&inicial.recebidos===4);conferir(inicial.inseridos===3&&inicial.conflitos===1);conferir((await linha(ids[0])).estado==='APPROVED');conferir((await linha(ids[1])).estado==='FORMATO_INDISPONIVEL');conferir((await linha(ids[3])).estado==='PAUSED');const preservado=await linha(ids[2]);conferir(preservado.estado==='META_DIVERGENCIA_REVISAR'&&preservado.nome==='fixture_meta_manual_local'&&preservado.componentes[0].text==='Conteúdo manual anterior.');
   const repetido=await importarBibliotecaMeta(pool,completa);conferir(!repetido.mudou&&repetido.inseridos===0&&repetido.atualizados===0);
   const atualizado={...base,status:'PAUSED',components:[{type:'BODY',text:'Revisão oficial fictícia.'}]};const mudanca=await importarBibliotecaMeta(pool,{data:[atualizado,botoes]});conferir(mudanca.atualizados===1&&mudanca.ausentes===2);conferir((await linha(ids[0])).estado==='PAUSED');conferir((await linha(ids[2])).estado==='META_AUSENTE_REVISAR');conferir((await linha(ids[2])).componentes[0].text==='Conteúdo manual anterior.');
   const parcial={data:[{...atualizado,status:'APPROVED'}],paging:{next:'https://graph.facebook.com/fronteira-ficticia'}};const r=await importarBibliotecaMeta(pool,parcial);conferir(!r.paginacaoCompleta&&r.ausentes===0);conferir((await linha(ids[1])).estado==='FORMATO_INDISPONIVEL');
   const reapareceu=await importarBibliotecaMeta(pool,{data:[{...atualizado,status:'APPROVED'},botoes,pausado]});conferir(reapareceu.conflitos===0);conferir((await linha(ids[3])).estado==='PAUSED');
   await pool.query("UPDATE atendimento_operacao.modelo SET componentes='[{\"type\":\"BODY\",\"text\":\"Conteúdo manual fictício preservado.\"}]' WHERE id=$1",[ids[0]]);const bloqueado=await importarBibliotecaMeta(pool,parcial);conferir(bloqueado.conflitos===1);conferir((await linha(ids[0])).estado==='META_DIVERGENCIA_REVISAR'&&(await linha(ids[0])).componentes[0].text==='Conteúdo manual fictício preservado.');
   console.log(JSON.stringify({fase:'modelos_meta_fluxo_integrado',provas,modelosFicticios:4,jsonOficial:'fronteira_ficticia',enviosExternos:0,fornecedoresChamados:0,conteudoManualPreservado:true}));
  }finally{await pool.query("DELETE FROM atendimento_operacao.configuracao WHERE chave='modelos_meta_proveniencia'");if(anterior)await pool.query("INSERT INTO atendimento_operacao.configuracao(chave,conteudo,versao) VALUES('modelos_meta_proveniencia',$1::jsonb,$2)",[JSON.stringify(anterior.conteudo),anterior.versao]);}
 }
}finally{await pool.end();}
