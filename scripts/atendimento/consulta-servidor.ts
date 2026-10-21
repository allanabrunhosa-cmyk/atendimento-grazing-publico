import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {readFile,stat,realpath} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {join,resolve,extname} from 'node:path';
import {createHmac,createHash,timingSafeEqual,scryptSync,randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {criarLeitorArquivos} from './consulta-arquivos';
import {COLUNA_CURSOR_HISTORICO,cursorHistoricoDaLinha,validarCursorHistorico} from './consulta-cursor';
import {HistoricoMensagemExcedente,paginarHistoricoPorBytes} from './consulta-paginacao';
const config=JSON.parse(await readFile('/run/secrets/consulta.json','utf8'));
const conta=JSON.parse(await readFile('/run/secrets/conta-hub.json','utf8'));
if(!Array.isArray(conta)||conta.length!==1||!conta[0].ativo||conta[0].excluidoEm||conta[0].id!==config.hubUsuarioId)throw Error('IDENTIDADE_NAO_REVISADA');
const pool=new Pool({connectionString:config.databaseUrl,max:3,connectionTimeoutMillis:3000,statement_timeout:5000,application_name:'donatella-consulta-restrita',options:'-c default_transaction_read_only=on'});
const midia=JSON.parse(await readFile('/run/secrets/media-index.json','utf8')) as Record<string,{arquivo:string;sha256:string;bytes:number;metadata:{eTag:string}}[]>;
const versaoFisica=criarLeitorArquivos(midia,async o=>{
 const r=await pool.query(`SELECT arquivo,sha256,bytes::integer FROM atendimento_migracao.arquivo_versao WHERE objeto_id=$1 AND bucket=$2 AND nome=$3 AND etag=$4 AND bytes=$5`,[o.id,o.bucket_id,o.name,o.metadata.eTag,o.metadata.size]);return r.rows;
});
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const host='https://atendimento.grazinghub.com.br',nomeCookie='donatella_homologacao_v2';
const assinar=(s:string)=>createHmac('sha256',config.sessaoSecret).update(s).digest('base64url');
const igual=(a:string,b:string)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
function sessao(req:IncomingMessage){const texto=(req.headers.cookie??'').split(';').map(v=>v.trim()).find(v=>v.startsWith(nomeCookie+'='))?.slice(nomeCookie.length+1);if(!texto)return false;const [payload,sig,...extras]=texto.split('.');if(!payload||!sig||extras.length||!igual(assinar(payload),sig))return false;try{const d=JSON.parse(Buffer.from(payload,'base64url').toString());return d.id===config.hubUsuarioId&&d.versao===config.versaoAcesso&&Number.isSafeInteger(d.exp)&&d.exp>Date.now();}catch{return false;}}
function enviar(res:ServerResponse,codigo:number,dados:unknown){res.writeHead(codigo,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(dados));}
async function corpo(req:IncomingMessage){let bytes=0;const partes:Buffer[]=[];for await(const p of req){bytes+=p.length;if(bytes>4096)throw Error('CORPO_INVALIDO');partes.push(p);}return JSON.parse(Buffer.concat(partes).toString());}
const tentativas=new Map<string,{n:number;ate:number}>();
const integridade=new Map<string,{mtime:number;ino:number}>();
const escapeLike=(s:string)=>s.replace(/[\\%_]/g,'\\$&');
const mimes:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
async function autorizado(){const r=await pool.query('SELECT 1 FROM atendimento_identidades.acessos_homologacao WHERE hub_usuario_id=$1 AND ativo AND somente_leitura AND versao=$2',[config.hubUsuarioId,config.versaoAcesso]);return r.rowCount===1;}
async function arquivoDaMensagem(mediaUrl:string|null){
 if(!mediaUrl)return null;
 try{const u=new URL(mediaUrl);if(u.origin!==config.origem)return null;const m=u.pathname.match(/^\/storage\/v1\/object\/(?:public|sign)\/(whatsapp-media|audio-messages)\/(.+)$/);if(!m)return null;
 const bucket=m[1],name=decodeURIComponent(m[2]);const r=await pool.query('SELECT id,metadata FROM donatella_storage.objects WHERE bucket_id=$1 AND name=$2 AND archived_at IS NULL AND NOT coalesce(is_delete_marker,false)',[bucket,name]);
 if(r.rowCount!==1)return null;const v=await versaoFisica({...r.rows[0],bucket_id:bucket,name});return v?{id:r.rows[0].id}:null;
 }catch{return null;}
}
export async function atender(req:IncomingMessage,res:ServerResponse){
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
 res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; media-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
 const url=new URL(req.url??'/',host);
 if(req.headers.host!=='atendimento.grazinghub.com.br'&&req.headers.host!=='localhost:3000')return enviar(res,421,{erro:'HOST_RECUSADO'});
 if(req.method==='GET'&&url.pathname==='/saude')return enviar(res,200,{servico:'consulta-restrita',escritas:false,ia:false,automacoes:false});
 // Únicos POSTs são sessão local; toda escrita de atendimento é recusada aqui.
 if(req.method!=='GET'){
  if(req.method!=='POST'||!['/api/login','/api/logout'].includes(url.pathname))return enviar(res,405,{erro:'HOMOLOGACAO_SOMENTE_LEITURA'});
  if(req.headers.origin!==host||req.headers['content-type']!=='application/json')return enviar(res,403,{erro:'ORIGEM_RECUSADA'});
  if(url.pathname==='/api/logout'){res.setHeader('Set-Cookie',`${nomeCookie}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`);return enviar(res,200,{ok:true});}
  const ip=req.socket.remoteAddress??'local',t=tentativas.get(ip);if(t&&t.ate>Date.now()&&t.n>=8)return enviar(res,429,{erro:'TENTE_NOVAMENTE_EM_UM_MINUTO'});
  const contador=t&&t.ate>Date.now()?t:{n:0,ate:Date.now()+60_000};contador.n++;tentativas.set(ip,contador);
  if(tentativas.size>1000)for(const [k,v]of tentativas)if(v.ate<Date.now())tentativas.delete(k);
  const d=await corpo(req);if(typeof d.email!=='string'||d.email.length>254||typeof d.senha!=='string'||d.senha.length>256)return enviar(res,400,{erro:'ENTRADA_INVALIDA'});
  const hash=scryptSync(d.senha,config.senhaSalt,32).toString('hex');
  if(d.email.trim().toLowerCase()!==conta[0].email.toLowerCase()||!igual(hash,config.senhaHash)||!await autorizado())return enviar(res,401,{erro:'ACESSO_RECUSADO'});
  const token=Buffer.from(JSON.stringify({id:config.hubUsuarioId,versao:config.versaoAcesso,exp:Date.now()+4*3600_000,nonce:randomBytes(12).toString('hex')})).toString('base64url');
  res.setHeader('Set-Cookie',`${nomeCookie}=${token}.${assinar(token)}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=14400`);return enviar(res,200,{ok:true});
 }
 if(url.pathname.startsWith('/api/')){
  if(!sessao(req)||!await autorizado())return enviar(res,401,{erro:'LOGIN_NECESSARIO'});
  if(url.pathname==='/api/sessao')return enviar(res,200,{nome:conta[0].nome,somenteLeitura:true});
  if(url.pathname==='/api/sincronizacao'){const r=await pool.query('SELECT estado,atualizado_em FROM atendimento_migracao.supervisao WHERE id=true');const datas=await pool.query('SELECT (SELECT max(recebido_em) FROM atendimento_migracao.carga_documento) "dadosRecebidosEm",(SELECT max(aplicado_em) FROM atendimento_migracao.materializacao) "materializadoEm"');return enviar(res,200,{...r.rows[0],...datas.rows[0],rotinasAtivas:false});}
  if(url.pathname==='/api/contatos'||url.pathname==='/api/conversas'){
   const busca=url.searchParams.get('q')??'',pagina=Number(url.searchParams.get('pagina')??0);if(busca.length>120||/[\x00-\x1f]/.test(busca)||!Number.isSafeInteger(pagina)||pagina<0||pagina>10000)return enviar(res,400,{erro:'FILTRO_INVALIDO'});
   const filtro='%'+escapeLike(busca)+'%',offset=pagina*30;
   const r=url.pathname==='/api/contatos'?await pool.query(`SELECT id,name,last_name,phone_number,email,last_activity,(SELECT count(*)::integer FROM donatella_public.conversations v WHERE v.contact_id=c.id) conversas FROM donatella_public.contacts c WHERE concat_ws(' ',name,last_name,phone_number,email) ILIKE $1 ORDER BY lower(coalesce(name,'')),id LIMIT 31 OFFSET $2`,[filtro,offset]):await pool.query(`SELECT v.id,v.contact_id,v.status,v.is_active,v.last_message_at,v.assigned_team,p.full_name responsavel,c.name,c.phone_number FROM donatella_public.conversations v JOIN donatella_public.contacts c ON c.id=v.contact_id LEFT JOIN donatella_public.profiles p ON p.user_id=v.assigned_user_id WHERE concat_ws(' ',c.name,c.phone_number) ILIKE $1 ORDER BY v.last_message_at DESC NULLS LAST,v.id LIMIT 31 OFFSET $2`,[filtro,offset]);
   return enviar(res,200,{registros:r.rows.slice(0,30),mais:r.rows.length>30,pagina});
  }
  if(url.pathname==='/api/historico'){
   let cursor:ReturnType<typeof validarCursorHistorico>;try{cursor=validarCursorHistorico(url.searchParams.get('conversa')??'',url.searchParams.get('antes'),url.searchParams.get('id'));}catch{return enviar(res,400,{erro:'CURSOR_INVALIDO'});}
   const r=await pool.query(`SELECT id,from_type,type,content,created_at,sent_at,status,media_url,${COLUNA_CURSOR_HISTORICO} FROM donatella_public.messages WHERE conversation_id=$1 AND ($2::timestamptz IS NULL OR (created_at,id)<($2::timestamptz,$3::uuid)) ORDER BY created_at DESC,id DESC LIMIT 51`,[cursor.conversa,cursor.antes,cursor.id]);
   const linhas=[];for(const m of r.rows.slice(0,50)){const anexo=await arquivoDaMensagem(m.media_url);const linha={id:m.id,from_type:m.from_type,type:m.type,content:m.content,created_at:m.created_at,sent_at:m.sent_at,status:m.status};linhas.push({registro:{...linha,autoria:m.from_type==='user'?'Contato':m.from_type==='nina'?'Nina':'Atendente humano',anexo,anexoIndisponivel:!!m.media_url&&!anexo},cursor:cursorHistoricoDaLinha(m)});}
   try{return enviar(res,200,paginarHistoricoPorBytes(linhas,r.rows.length>50));}catch(erro){if(erro instanceof HistoricoMensagemExcedente)return enviar(res,413,{erro:'HISTORICO_MENSAGEM_EXCEDENTE'});throw erro;}
  }
  if(url.pathname.startsWith('/api/anexo/')){
   const id=url.pathname.slice('/api/anexo/'.length);if(!uuid.test(id))return enviar(res,404,{erro:'ANEXO_NAO_ENCONTRADO'});
   const r=await pool.query('SELECT id,bucket_id,name,metadata FROM donatella_storage.objects WHERE id=$1 AND archived_at IS NULL AND NOT coalesce(is_delete_marker,false)',[id]);if(r.rowCount!==1)return enviar(res,404,{erro:'ANEXO_NAO_ENCONTRADO'});
   const o=r.rows[0],v=await versaoFisica(o);if(!v)return enviar(res,409,{erro:'VERSAO_FISICA_NAO_PRESERVADA'});
   const path=join(v.raiz,v.arquivo),info=await stat(path);if(await realpath(path)!==path||info.size!==v.bytes)return enviar(res,409,{erro:'ANEXO_DIVERGENTE'});
   const anterior=integridade.get(v.sha256);
   if(!anterior||anterior.mtime!==info.mtimeMs||anterior.ino!==info.ino){const hash=createHash('sha256');for await(const parte of createReadStream(path))hash.update(parte);if(hash.digest('hex')!==v.sha256)return enviar(res,409,{erro:'ANEXO_DIVERGENTE'});integridade.set(v.sha256,{mtime:info.mtimeMs,ino:info.ino});}
   const mime=String(o.metadata?.mimetype??'application/octet-stream');const permitido=/^(image\/(png|jpeg|webp|gif)|audio\/[a-z0-9.+-]+|video\/mp4|application\/pdf)$/.test(mime);
   // Downloads, incluindo PDF, não executam conteúdo ativo no domínio da aplicação.
   res.writeHead(200,{'Content-Type':permitido?mime:'application/octet-stream','Content-Length':v.bytes,'Content-Disposition':`attachment; filename="anexo${extname(o.name).replace(/[^a-zA-Z0-9.]/g,'').slice(0,12)}"`});createReadStream(path).pipe(res);return;
  }
  return enviar(res,404,{erro:'ROTA_NAO_DISPONIVEL'});
 }
 const caminho=url.pathname==='/'||url.pathname==='/crm'?'index.html':url.pathname.slice(1);
 if(!/^(index\.html|assets\/[A-Za-z0-9._-]+\.(js|css|svg|woff2))$/.test(caminho))return enviar(res,404,{erro:'ROTA_NAO_DISPONIVEL'});
 const arquivo=resolve('/release/web',caminho);const bytes=await readFile(arquivo);res.writeHead(200,{'Content-Type':mimes[extname(arquivo)]??'application/octet-stream'});res.end(bytes);
}
createServer((req,res)=>{void atender(req,res).catch(()=>{if(!res.headersSent)enviar(res,503,{erro:'CONSULTA_INDISPONIVEL'});else res.destroy();});}).listen(3000,'0.0.0.0');
