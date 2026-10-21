import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {Pool,PoolClient} from 'pg';
import bcrypt from 'bcryptjs';
import {type Permissoes,type Excecoes} from '../permissoes/catalogo';
import {resolverPermissoesAtendimento as permitidas} from '../permissoes/atendimento-resolucao';
import type {IdentidadeOperacao} from './operacao-tipos';

export type IdentidadeOperacaoHub={id:string;nome:string;perfilId:string;sessaoVersao:number;permissoes:string[];tipo:'usuario'};
type Usuario={id:string;nome:string;email:string;senhaHash:string;senhaDefinida:boolean;ativo:boolean;excluido:boolean;sessaoVersao:number;perfilId:string;perfilSistema:string|null;permissoes:Permissoes;excecoes:Excecoes;permissoesGranulares?:boolean;permissoesHierarquia?:boolean};
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const nomeCookie='donatella_operacao_v2';
const cookie=(req:IncomingMessage)=>{const a=(req.headers.cookie??'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(nomeCookie+'='));if(a.length!==1)return null;const v=a[0].slice(nomeCookie.length+1);return /^[a-zA-Z0-9_-]{43}$/.test(v)?v:null;};
const iguais=(a:string,b:string)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
export function criarAutenticacaoHub(c:{central:Pool;local:Pool;origem:string;csrfSecret:string}){
 if(c.origem!=='https://atendimento.grazinghub.com.br'&&c.origem!=='http://127.0.0.1:4194')throw Error('ORIGEM_ACESSO_RECUSADA');
 if(c.csrfSecret.length<32)throw Error('ACESSO_NAO_CONFIGURADO');
 const segura=c.origem.startsWith('https:');
 const emitir=(res:ServerResponse,token:string,idade:number)=>res.setHeader('Set-Cookie',`${nomeCookie}=${token}; Path=/; HttpOnly; SameSite=Lax; ${segura?'Secure; ':''}Max-Age=${idade}`);
 const csrf=(token:string)=>createHmac('sha256',c.csrfSecret).update('csrf:'+token).digest('base64url');
 async function central(id:string){const r=await c.central.query<Usuario>('SELECT * FROM atendimento_integracao.identidade WHERE id=$1',[id]);return r.rows.length===1?r.rows[0]:null;}
 async function vinculo(id:string,tx:Pool|PoolClient=c.local){return (await tx.query('SELECT 1 FROM atendimento_acesso.vinculo WHERE hub_usuario_id=$1 AND ativo',[id])).rowCount===1;}
 const identidade=(u:Usuario):IdentidadeOperacaoHub=>({id:u.id,nome:u.nome,perfilId:u.perfilId??'',sessaoVersao:u.sessaoVersao,permissoes:permitidas(u),tipo:'usuario'});
 async function autenticar(req:IncomingMessage){const token=cookie(req);if(!token)return null;const s=await c.local.query<{hub_usuario_id:string;versao:number}>('SELECT hub_usuario_id,versao FROM atendimento_acesso.sessao WHERE token_hash=$1 AND revogada_em IS NULL AND expira_em>now()',[hash(token)]);if(s.rows.length!==1)return null;const u=await central(s.rows[0].hub_usuario_id);if(!u||!u.ativo||u.senhaDefinida===false||u.excluido||u.sessaoVersao!==s.rows[0].versao||!await vinculo(u.id))return null;return identidade(u);}
 async function autorizar(i:IdentidadeOperacao,acao:string,tx?:PoolClient){const u=await central(i.id);return !!u&&u.ativo&&u.senhaDefinida!==false&&!u.excluido&&u.sessaoVersao===i.sessaoVersao&&u.perfilId===i.perfilId&&permitidas(u).some(a=>a===acao)&&await vinculo(i.id,tx);}
 const conferirCsrf=(req:IncomingMessage)=>{const t=cookie(req),v=req.headers['x-csrf-token'];return !!t&&req.headers.origin===c.origem&&typeof v==='string'&&iguais(csrf(t),v);};
 async function listarEquipe(){const r=await c.local.query<{hub_usuario_id:string}>('SELECT hub_usuario_id FROM atendimento_acesso.vinculo WHERE ativo ORDER BY hub_usuario_id LIMIT 100');const equipe=[];for(const l of r.rows){const u=await central(l.hub_usuario_id);if(u?.ativo&&!u.excluido&&permitidas(u).includes('consultar'))equipe.push({id:u.id,nome:u.nome,perfilId:u.perfilId});}return equipe;}
 async function login(req:IncomingMessage,res:ServerResponse,email:string,senha:string){
  email=email.trim().toLowerCase();
  if(req.headers.origin!==c.origem||email.length>254||Buffer.byteLength(senha,'utf8')>72||!email||!senha)return {status:400,erro:'ENTRADA_INVALIDA'};
  const chave=hash('login:'+email);const bloqueio=await c.local.query('SELECT 1 FROM atendimento_acesso.tentativa WHERE chave=$1 AND falhas>=5 AND ate>now()',[chave]);if(bloqueio.rowCount)return {status:429,erro:'AGUARDE_NOVA_TENTATIVA'};
  const r=await c.central.query<Usuario>('SELECT * FROM atendimento_integracao.identidade WHERE lower(email)=$1',[email]);const u=r.rows.length===1?r.rows[0]:null;
  const senhaValida=!!u&&u.ativo&&!u.excluido&&u.senhaDefinida!==false&&permitidas(u).includes('consultar')&&await bcrypt.compare(senha,u.senhaHash);
  // Relê a identidade depois do hash para recusar uma redefinição concorrente.
  const atual=senhaValida?await central(u.id):null;
  const elegivel=!!atual&&atual.ativo&&!atual.excluido&&atual.senhaDefinida!==false&&atual.senhaHash===u!.senhaHash&&atual.sessaoVersao===u!.sessaoVersao&&permitidas(atual).includes('consultar');
  // O vínculo local é técnico. A permissão continua vindo do HUB.
  // DO NOTHING preserva qualquer vínculo que tenha sido revogado explicitamente.
  if(elegivel)await c.local.query('INSERT INTO atendimento_acesso.vinculo(hub_usuario_id,revisado_em) VALUES($1,now()) ON CONFLICT(hub_usuario_id) DO NOTHING',[atual.id]);
  const valido=elegivel&&await vinculo(atual.id);
  if(!valido){await c.local.query("INSERT INTO atendimento_acesso.tentativa(chave,falhas,ate) VALUES($1,1,now()+interval '15 minutes') ON CONFLICT(chave) DO UPDATE SET falhas=CASE WHEN atendimento_acesso.tentativa.ate<now() THEN 1 ELSE atendimento_acesso.tentativa.falhas+1 END,ate=now()+interval '15 minutes'",[chave]);return {status:401,erro:'LOGIN_NAO_CONCLUIDO'};}
  // O papel da aplicação possui SELECT/INSERT/UPDATE, sem exclusão de registros.
  const token=randomBytes(32).toString('base64url');await c.local.query("INSERT INTO atendimento_acesso.sessao(token_hash,hub_usuario_id,versao,expira_em) VALUES($1,$2,$3,now()+interval '8 hours')",[hash(token),atual!.id,atual!.sessaoVersao]);await c.local.query('UPDATE atendimento_acesso.tentativa SET falhas=0,ate=now() WHERE chave=$1',[chave]);emitir(res,token,28800);return {status:200,usuario:identidade(atual!),csrfToken:csrf(token)};
 }
 async function logout(req:IncomingMessage,res:ServerResponse){if(!conferirCsrf(req))return false;const t=cookie(req);if(t)await c.local.query('UPDATE atendimento_acesso.sessao SET revogada_em=now() WHERE token_hash=$1',[hash(t)]);emitir(res,'',0);return true;}
 function tokenCsrf(req:IncomingMessage){const t=cookie(req);return t?csrf(t):null;}
 return {autenticar,autorizar,conferirCsrf,listarEquipe,login,logout,tokenCsrf};
}
