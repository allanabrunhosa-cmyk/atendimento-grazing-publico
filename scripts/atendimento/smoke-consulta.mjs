// Recebe a senha exclusiva pelo stdin. Só GETs e sessão local; nenhuma escrita de atendimento.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Pool} from 'pg';
let entrada='';for await(const p of process.stdin)entrada+=p;
const {senha,origem='http://localhost:3000'}=JSON.parse(entrada);
const email=JSON.parse(await readFile('/run/secrets/conta-hub.json','utf8'))[0].email;
const cabecalhos={Host:'atendimento.grazinghub.com.br',Origin:'https://atendimento.grazinghub.com.br','Content-Type':'application/json'};
const provas={};
const request=(p,op={})=>fetch(origem+p,{redirect:'error',headers:cabecalhos,...op});
provas.saude=(await request('/saude')).status;
provas.anonimo=(await request('/api/conversas')).status;
provas.escritaBloqueada=(await request('/api/envio',{method:'POST',body:'{}'})).status;
provas.origemLoginRecusada=(await request('/api/login',{method:'POST',body:'{}',headers:{...cabecalhos,Origin:'https://exemplo.invalid'}})).status;
const login=await request('/api/login',{method:'POST',body:JSON.stringify({email,senha})});provas.login=login.status;
const cookie=login.headers.get('set-cookie');if(login.status!==200||!cookie||!/Secure/.test(cookie)||!/HttpOnly/.test(cookie)||!/SameSite=Strict/.test(cookie))throw Error('LOGIN_FALHOU');
const auth=p=>request(p,{headers:{...cabecalhos,Cookie:cookie.split(';')[0]}});
const contatos=await auth('/api/contatos');provas.contatos=contatos.status;const c=await contatos.json();provas.paginaContatos=c.registros?.length;
const conversas=await auth('/api/conversas');provas.conversas=conversas.status;const v=await conversas.json();provas.paginaConversas=v.registros?.length;
provas.busca=(await auth('/api/conversas?q=fixture-inexistente-6d77466f')).status;
provas.paginacao=(await auth('/api/conversas?pagina=1')).status;
if(v.registros?.length){const h=await auth('/api/historico?conversa='+v.registros[0].id);provas.historico=h.status;const m=await h.json();provas.mensagens=m.registros?.length;provas.autoriaEData=m.registros?.every(x=>x.autoria&&x.created_at);if(m.mais)provas.historicoAnterior=(await auth(`/api/historico?conversa=${v.registros[0].id}&antes=${encodeURIComponent(m.cursor.antes)}&id=${m.cursor.id}`)).status;}
provas.sincronizacao=(await auth('/api/sincronizacao')).status;
provas.crmNovaAba=(await auth('/crm')).status;
provas.cookieAlterado=(await request('/api/contatos',{headers:{...cabecalhos,Cookie:cookie.split(';')[0]+'alterado'}})).status;
const privado=JSON.parse(await readFile('/run/secrets/consulta.json','utf8'));
const pool=new Pool({connectionString:privado.databaseUrl,max:1,options:'-c default_transaction_read_only=on'});
try{
 const longa=await pool.query('SELECT conversation_id FROM donatella_public.messages GROUP BY conversation_id HAVING count(*)>50 LIMIT 1');
 if(longa.rowCount){const h=await auth('/api/historico?conversa='+longa.rows[0].conversation_id);const dados=await h.json();provas.historicoLongo=(h.status===200&&dados.mais&&dados.registros.length===50);provas.historicoAnterior=(await auth(`/api/historico?conversa=${longa.rows[0].conversation_id}&antes=${encodeURIComponent(dados.cursor.antes)}&id=${dados.cursor.id}`)).status;}
 const indice=JSON.parse(await readFile('/run/secrets/media-index.json','utf8'));
 const anexos=await pool.query("SELECT id,bucket_id,name,metadata FROM donatella_storage.objects WHERE bucket_id IN ('whatsapp-media','audio-messages') LIMIT 30");
 let testado=false;
 for(const a of anexos.rows){const v=(indice[a.bucket_id+'/'+a.name]??[]).find(v=>v.metadata.eTag===a.metadata?.eTag);if(!v)continue;const r=await auth('/api/anexo/'+a.id);const bytes=Buffer.from(await r.arrayBuffer());provas.anexoAutorizado=r.status;provas.anexoBytesIguais=r.status===200&&bytes.length===v.bytes&&createHash('sha256').update(bytes).digest('hex')===v.sha256;provas.anexoAnonimo=(await request('/api/anexo/'+a.id)).status;testado=true;break;}
 provas.anexoEncontrado=testado;
 const novos=await pool.query(`SELECT v.objeto_id,v.sha256,v.bytes::integer FROM atendimento_migracao.arquivo_versao v JOIN donatella_storage.objects o ON o.id=v.objeto_id AND o.bucket_id=v.bucket AND o.name=v.nome AND o.metadata->>'eTag'=v.etag AND (o.metadata->>'size')::bigint=v.bytes WHERE o.archived_at IS NULL AND NOT coalesce(o.is_delete_marker,false) ORDER BY v.preservado_em DESC LIMIT 3`);
 provas.anexosIncrementaisTestados=novos.rowCount;provas.anexosIncrementaisIguais=true;provas.anexosIncrementaisAnonimosRecusados=true;
 for(const a of novos.rows){const r=await auth('/api/anexo/'+a.objeto_id),bytes=Buffer.from(await r.arrayBuffer());provas.anexosIncrementaisIguais&&=r.status===200&&bytes.length===a.bytes&&createHash('sha256').update(bytes).digest('hex')===a.sha256;provas.anexosIncrementaisAnonimosRecusados&&=(await request('/api/anexo/'+a.objeto_id)).status===401;}
}finally{await pool.end();}
console.log(JSON.stringify(provas));
if(provas.saude!==200||provas.anonimo!==401||provas.login!==200||provas.escritaBloqueada!==405||provas.origemLoginRecusada!==403||provas.contatos!==200||provas.conversas!==200||provas.historico!==200||provas.cookieAlterado!==401||!provas.anexoBytesIguais||provas.anexoAnonimo!==401||provas.historicoAnterior!==200||!provas.anexosIncrementaisIguais||!provas.anexosIncrementaisAnonimosRecusados)throw Error('SMOKE_INCOMPLETO');
