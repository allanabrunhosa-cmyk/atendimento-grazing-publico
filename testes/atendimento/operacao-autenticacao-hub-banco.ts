import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {Pool} from 'pg';
import bcrypt from 'bcryptjs';
import {criarAutenticacaoHub} from '../../src/lib/atendimento/operacao-autenticacao-hub';

// Instância descartável, sem rede externa, dados reais ou tabelas preexistentes.
const endereco=process.env.LOGIN_ATENDIMENTO_BANCO_TESTE;
if(!endereco)throw Error('LOGIN_ENSAIO_EXIGIDO');
const url=new URL(endereco);
if(url.protocol!=='postgresql:'||!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!=='/donatella_ensaio_operacao')throw Error('LOGIN_ENSAIO_DESTINO_RECUSADO');
const admin=new Pool({connectionString:endereco,max:1});
const sufixo=randomUUID().replaceAll('-','');
const papelApp='login_app_'+sufixo,papelCentral='login_central_'+sufixo;
const origem='https://atendimento.grazinghub.com.br';
const senha=' Senha-Ficticia-2026 ';
let central:Pool|undefined,local:Pool|undefined,assercoes=0;
const conferir=(valor:unknown)=>{assert.ok(valor);assercoes++;};
async function executar(){
 const existentes=await admin.query("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v')");
 if(existentes.rows[0].n!==0)throw Error('LOGIN_ENSAIO_EXIGE_BANCO_VAZIO');
 await admin.query(await readFile('scripts/atendimento/sql/028-acesso-operacao-destino.sql','utf8'));
 await admin.query(`CREATE ROLE ${papelApp} LOGIN; CREATE ROLE ${papelCentral} LOGIN; CREATE SCHEMA atendimento_integracao; REVOKE ALL ON SCHEMA atendimento_integracao FROM PUBLIC; CREATE TABLE atendimento_integracao.identidade(id text PRIMARY KEY,nome text,email text,"senhaHash" text,ativo boolean,excluido boolean,"sessaoVersao" integer,"perfilId" text,"perfilSistema" text,permissoes jsonb,excecoes jsonb,"senhaDefinida" boolean DEFAULT true); GRANT CONNECT ON DATABASE donatella_ensaio_operacao TO ${papelApp},${papelCentral}; GRANT USAGE ON SCHEMA atendimento_acesso TO ${papelApp}; GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA atendimento_acesso TO ${papelApp}; GRANT USAGE ON SCHEMA atendimento_integracao TO ${papelCentral}; GRANT SELECT ON atendimento_integracao.identidade TO ${papelCentral};`);
 await admin.query('INSERT INTO atendimento_integracao.identidade VALUES($1,$2,$3,$4,true,false,1,$5,NULL,$6,$7,true)',['fixture-hub','Pessoa fictícia','fixture@example.invalid',await bcrypt.hash(senha,4),'fixture-perfil',{'crm.atendimento':['visualizar']},{}]);
 // Sem vínculo inicial: o primeiro login autorizado deve criá-lo.
 const como=(papel:string)=>{const v=new URL(endereco!);v.username=papel;v.password='';return v.toString();};
 central=new Pool({connectionString:como(papelCentral),max:1,options:'-c default_transaction_read_only=on'});
 local=new Pool({connectionString:como(papelApp),max:1});
 const privilegios=(await local.query("SELECT has_table_privilege(current_user,'atendimento_acesso.tentativa','DELETE') AS excluir,has_table_privilege(current_user,'atendimento_acesso.tentativa','UPDATE') AS atualizar")).rows[0];
 conferir(!privilegios.excluir&&privilegios.atualizar);
 await assert.rejects(()=>local!.query('DELETE FROM atendimento_acesso.tentativa WHERE false'),{code:'42501'});assercoes++;
 const auth=criarAutenticacaoHub({central,local,origem,csrfSecret:'f'.repeat(40)});
 let cookie='';
 const req=(cabecalhos:Record<string,string>={})=>({headers:{origin:origem,...cabecalhos}} as IncomingMessage);
 const res={setHeader:(nome:string,valor:string)=>{if(nome==='Set-Cookie')cookie=valor;}} as unknown as ServerResponse;
 conferir((await auth.login(req(),res,'fixture@example.invalid','incorreta')).status===401);
 conferir((await local.query('SELECT falhas FROM atendimento_acesso.tentativa')).rows[0].falhas===1);
 const sucesso=await auth.login(req(),res,'  FIXTURE@EXAMPLE.INVALID  ',senha);
 conferir(sucesso.status===200);
 conferir(cookie.includes('HttpOnly')&&cookie.includes('Secure')&&!cookie.includes('Domain='));
 const requisicao=req({cookie:cookie.split(';')[0]});
 conferir((await auth.autenticar(requisicao))?.id==='fixture-hub');
 conferir((await local.query('SELECT falhas FROM atendimento_acesso.tentativa')).rows[0].falhas===0);
 conferir((await local.query('SELECT count(*)::int AS n FROM atendimento_acesso.sessao')).rows[0].n===1);
 conferir((await auth.login(req(),res,'fixture@example.invalid',senha.trim())).status===401);
 await admin.query('UPDATE atendimento_acesso.tentativa SET falhas=0');
 for(const email of ['fixture@example.invalid',' FIXTURE@example.invalid','fixture@EXAMPLE.INVALID ',' fixture@example.invalid ','FIXTURE@EXAMPLE.INVALID'])conferir((await auth.login(req(),res,email,'incorreta')).status===401);
 conferir((await auth.login(req(),res,'fixture@example.invalid',senha)).status===429);
 conferir((await local.query('SELECT count(*)::int AS n,max(falhas) AS falhas FROM atendimento_acesso.tentativa')).rows[0].n===1);
 conferir(await auth.logout(req({...requisicao.headers as Record<string,string>,'x-csrf-token':auth.tokenCsrf(requisicao)!}),res));
 conferir(await auth.autenticar(requisicao)===null);
 console.log(JSON.stringify({ensaio:'login-hub-postgresql-permissoes-minimas',assercoes,loginConcluido:true,exclusaoPermitida:false,cookieEAutorizacaoValidados:true,dadosFicticios:true,enviosExternos:0}));
}
try{await executar();}catch(e){console.log(JSON.stringify({ensaio:'login-hub-postgresql-permissoes-minimas',falhou:true,codigo:e instanceof Error?e.name:'ERRO'}));process.exitCode=1;}
finally{await Promise.allSettled([admin.end(),central?.end(),local?.end()]);}
