import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {criarAutenticacaoHub} from '../../src/lib/atendimento/operacao-autenticacao-hub';
import {RepositorioOperacaoPg} from '../../src/lib/atendimento/operacao-repositorio-pg';
import {ServicoAgenteOperacional} from '../../src/lib/atendimento/operacao-agente';
import {executarComandoAgenteCorte} from '../../src/lib/atendimento/operacao-agente-corte';
import type {IdentidadeOperacao} from '../../src/lib/atendimento/operacao-tipos';
const [acao,responsavel,idempotencia]=process.argv.slice(2);
if(!['habilitar','desligar'].includes(acao)||!responsavel||responsavel.length>128||!idempotencia||process.env.DONATELLA_COMANDO_CORTE_AUTORIZADO!=='1')throw Error('AGENTE_COMANDO_EXPRESSO_EXIGIDO');
const arquivo=process.env.DONATELLA_OPERACAO_CONFIG;if(!arquivo)throw Error('CONFIGURACAO_PRIVADA_EXIGIDA');
const c=JSON.parse(await readFile(arquivo,'utf8'));
function url(v:unknown,local=false){if(typeof v!=='string')throw Error('AGENTE_CORTE_CONFIGURACAO_INVALIDA');const u=new URL(v);if(u.protocol!=='postgresql:'||!u.password||u.search||u.hash||local&&(u.hostname!=='grazing-donatella-operacao-v2-banco'||u.pathname!=='/donatella_operacao'))throw Error('AGENTE_CORTE_BANCO_RECUSADO');return v;}
const local=new Pool({connectionString:url(c.databaseUrl,true),max:2,statement_timeout:10000}),central=new Pool({connectionString:url(c.centralDatabaseUrl),max:1,statement_timeout:10000,options:'-c default_transaction_read_only=on'});
try{
 const auth=criarAutenticacaoHub({central,local,origem:'https://atendimento.grazinghub.com.br',csrfSecret:c.csrfSecret});
 const usuario=(await central.query('SELECT id,nome,"perfilId","sessaoVersao" FROM atendimento_integracao.identidade WHERE id=$1 AND ativo AND NOT excluido',[responsavel])).rows[0];if(!usuario)throw Error('AGENTE_RESPONSAVEL_RECUSADO');
 const identidade:IdentidadeOperacao={...usuario,permissoes:[],tipo:'usuario'};
 const repo=new RepositorioOperacaoPg(local,auth.autorizar,()=>c.modo,'/midia');
 // Capacidade exclusiva deste CLI auditado, após o comando expresso e a
 // transferência humana. Prepara PG antes do gate; nunca infere ou envia.
 const prepararAutoridade=acao==='habilitar'&&c.modo==='operacao'&&c.autoridade==='vps'&&c.enviosHabilitados===true;
 const agente=new ServicoAgenteOperacional({operacao:repo,configuracao:{empresaId:'grazing',anthropic:{chave:c.ia.apiKey,modelo:c.ia.model,maxTokens:512},provedores:{anthropic:{chave:c.ia.apiKey,modelos:[c.ia.model],maxTokens:512,reservaMinimaCentavos:50}},orcamentoMaximoCentavosDia:c.orcamentoIAcentavos??0,custoVozCentavos:50,inferenciaHabilitada:false,autoridadeAutomatica:prepararAutoridade},carregarMidia:async()=>null});
 const r=await executarComandoAgenteCorte(agente,identidade,{habilitar:acao==='habilitar',modoServidor:c.modo,autoridade:c.autoridade,enviosHabilitados:c.enviosHabilitados===true,iaAutomatica:c.iaAutomatica===true,comandoExpresso:true,idempotencia});
 console.log(JSON.stringify({fase:'modo_agente_registrado',acao,versao:r.versao,auditado:true,inferencias:0,enviosExternos:0}));
}finally{await Promise.all([local.end(),central.end()]);}
