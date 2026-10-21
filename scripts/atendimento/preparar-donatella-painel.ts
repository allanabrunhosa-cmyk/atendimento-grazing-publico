import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {criarAutenticacaoHub} from '../../src/lib/atendimento/operacao-autenticacao-hub';
import {RepositorioOperacaoPg} from '../../src/lib/atendimento/operacao-repositorio-pg';
import {prepararDonatellaPainel} from '../../src/lib/atendimento/preparacao-donatella';
import type {IdentidadeOperacao} from '../../src/lib/atendimento/operacao-tipos';

const [idempotencia,documentoSha256]=process.argv.slice(2);
if(process.env.DONATELLA_PREPARACAO_AUTORIZADA!=='1'||!idempotencia||!/^[a-f0-9]{64}$/.test(documentoSha256??''))throw Error('DONATELLA_PREPARACAO_EXPRESSA_EXIGIDA');
const arquivo=process.env.DONATELLA_OPERACAO_CONFIG;if(!arquivo)throw Error('CONFIGURACAO_PRIVADA_EXIGIDA');
const c=JSON.parse(await readFile(arquivo,'utf8'));
if(c.modo!=='operacao'||c.autoridade!=='vps'||c.enviosHabilitados!==true||c.iaAutomatica!==false||c.voz?.sinteseHabilitada!==false||c.woocommerce?.automacoesHabilitadas!==false||c.orcamentoIAcentavos!==500||c.autorizacaoOrcamentoIA?.testesCentavosUSD!==1000||c.autorizacaoOrcamentoIA?.diarioFuturoCentavosUSD!==500||typeof c.hubUsuarioId!=='string'||c.hubUsuarioId.length>128)throw Error('DONATELLA_PREPARACAO_CONFIGURACAO_RECUSADA');
function url(v:unknown,local=false){if(typeof v!=='string')throw Error('DONATELLA_PREPARACAO_BANCO_RECUSADO');const u=new URL(v);if(u.protocol!=='postgresql:'||!u.password||u.search||u.hash||local&&(u.hostname!=='grazing-donatella-operacao-v2-banco'||u.pathname!=='/donatella_operacao'))throw Error('DONATELLA_PREPARACAO_BANCO_RECUSADO');return v;}
const local=new Pool({connectionString:url(c.databaseUrl,true),max:2,statement_timeout:10000}),central=new Pool({connectionString:url(c.centralDatabaseUrl),max:1,statement_timeout:10000,options:'-c default_transaction_read_only=on'});
try{
 const auth=criarAutenticacaoHub({central,local,origem:'https://atendimento.grazinghub.com.br',csrfSecret:c.csrfSecret});
 const usuario=(await central.query('SELECT id,nome,"perfilId","sessaoVersao" FROM atendimento_integracao.identidade WHERE id=$1 AND ativo AND NOT excluido',[c.hubUsuarioId])).rows[0];
 if(!usuario)throw Error('DONATELLA_PREPARACAO_RESPONSAVEL_RECUSADO');
 const identidade:IdentidadeOperacao={...usuario,permissoes:[],tipo:'usuario'},repo=new RepositorioOperacaoPg(local,auth.autorizar,()=>c.modo,'/midia');
 const r=await prepararDonatellaPainel(repo,identidade,{idempotencia,documentoSha256,modelo:c.ia?.model??'',orcamentoMaximoCentavosDia:c.orcamentoIAcentavos});
 console.log(JSON.stringify({fase:'donatella_preparada_desligada',...r,auditado:true}));
}finally{await Promise.all([local.end(),central.end()]);}
