import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Pool} from 'pg';
import {RepositorioOperacaoPg,materializarEventoOperacao} from '../../src/lib/atendimento/operacao-repositorio-pg';
import type {RepositorioEntradaPg} from '../../src/lib/atendimento/operacao-repositorio-pg';
import {WorkerOperacao} from '../../src/lib/atendimento/operacao-envio';
import type {EventoRecebido} from '../../src/lib/atendimento/webhook';
import type {IdentidadeOperacao} from '../../src/lib/atendimento/operacao-tipos';
// Garantia de envio: o resultado de um POST já aceito não pode se perder.
// Executar somente na base nova do ensaio. Transporte sempre simulado.
const conexao=process.env.OPERACAO_BANCO_TESTE;
if(!conexao)throw Error('ENSAIO_BANCO_EXIGIDO');
const destino=new URL(conexao);
if(destino.protocol!=='postgresql:'||destino.pathname!=='/donatella_ensaio_operacao'||!['localhost','127.0.0.1'].includes(destino.hostname))throw Error('ENSAIO_DESTINO_RECUSADO');
process.env.ATENDIMENTO_ENVIO_HABILITADO='true';process.env.ATENDIMENTO_AUTORIDADE_ENVIO='vps';
const pool=new Pool({connectionString:conexao,max:6});
const autora:IdentidadeOperacao={id:'fixture-autora-garantia',nome:'Autora fictícia',perfilId:'fixture',sessaoVersao:1,permissoes:[]};
let assercoes=0,contador=0,posts=0,falhasRegistro=0,falhasIdentidade=0,corpoPost:Record<string,unknown>={};
const conferir=(v:unknown,rotulo:string)=>{assert.ok(v,rotulo);assercoes++;};
const repo=new RepositorioOperacaoPg(pool,async()=>true,()=>'operacao',await mkdtemp(join(tmpdir(),'garantia-ficticia-')),undefined,undefined,'humano');
// Simula a indisponibilidade de conexão vista em produção, somente após o POST.
const transacaoReal=repo.transacao.bind(repo);
repo.transacao=(async(executar:Parameters<typeof transacaoReal>[0])=>{if(falhasRegistro>0){falhasRegistro--;throw Error('timeout exceeded when trying to connect');}return transacaoReal(executar);}) as typeof repo.transacao;
const transporte={token:'fixture-sem-validade',numeroId:'123456789',versao:'v23.0',autoridade:'vps' as const,enviosHabilitados:true};
let aoAceitar:(wamid:string)=>Promise<void>=async()=>undefined;
const meta:typeof fetch=async(_url,init)=>{posts++;corpoPost=JSON.parse(String(init?.body));const wamid='wamid.garantia'+posts+'x'+Date.now();await aoAceitar(wamid);return new Response(JSON.stringify({messaging_product:'whatsapp',messages:[{id:wamid}]}),{status:200,headers:{'content-type':'application/json'}});};
const identidade=async(id:string)=>{if(falhasIdentidade>0&&--falhasIdentidade===0)throw Error('timeout exceeded when trying to connect');return id===autora.id?autora:null;};
const worker=(esperas:number[])=>new WorkerOperacao(repo,{} as RepositorioEntradaPg,identidade,transporte,undefined,meta,undefined,undefined,esperas);
async function fixture(){
 const contatoId=randomUUID(),conversaId=randomUUID(),telefone=String(5511900000000+Math.floor(Math.random()*90000)+contador++);
 await pool.query("INSERT INTO atendimento_operacao.contato(id,nome,telefone,identidade_canal) VALUES($1,'Contato fictício de garantia',$2,$3)",[contatoId,telefone,'whatsapp:123456789:'+telefone]);
 await pool.query("INSERT INTO atendimento_operacao.conversa(id,contato_id,estado,ficticia,ultima_cliente_em) VALUES($1,$2,'humano',false,now()-interval '1 minute')",[conversaId,contatoId]);
 const envio=await repo.enfileirar(autora,{conversaId,versao:1,idempotencia:randomUUID(),tipo:'text',texto:'Resposta fictícia de garantia'});
 return {conversaId,telefone,envio};
}
const intencao=async(id:string)=>(await pool.query('SELECT * FROM atendimento_operacao.intencao WHERE id=$1',[id])).rows[0];
const mensagem=async(id:string)=>(await pool.query('SELECT * FROM atendimento_operacao.mensagem WHERE id=$1',[id])).rows[0];
const status=(wamid:string,estado:string,referencia?:string):EventoRecebido=>({chave:randomUUID(),tipo:'status',waba:'1',numero:'123456789',conteudo:{item:{id:wamid,status:estado,timestamp:String(Math.floor(Date.now()/1000)),recipient_id:'5511900000000',...(referencia?{biz_opaque_callback_data:referencia}:{})}}} as unknown as EventoRecebido);
const expirarLease=(id:string)=>pool.query("UPDATE atendimento_operacao.intencao SET lease_ate=now()-interval '1 second' WHERE id=$1 AND estado='processando'",[id]);
try{
 // Restos de uma execução anterior não podem ser enviados neste ensaio.
 await pool.query("UPDATE atendimento_operacao.intencao SET estado='cancelado',codigo='ENSAIO_ANTERIOR',lease=null,lease_ate=null WHERE estado IN ('pendente','processando')");

 // 1. Fluxo normal: um POST, com a referência da intenção para a Meta devolver.
 const a=await fixture();let r=await worker([]).enviarProximo();
 conferir(r.estado==='aceito'&&posts===1,'envio normal aceito com um POST');
 conferir(corpoPost.biz_opaque_callback_data===a.envio.id,'POST carrega o ID da intenção');
 conferir((await intencao(a.envio.id)).estado==='aceito'&&(await mensagem(a.envio.mensagemId)).wamid,'aceite gravado');

 // 2. Conexão falha três vezes depois do aceite: regrava sem novo POST.
 const b=await fixture();aoAceitar=async()=>{falhasRegistro=3;};r=await worker([5,5,5]).enviarProximo();aoAceitar=async()=>undefined;
 let ib=await intencao(b.envio.id);
 conferir(r.estado==='aceito'&&posts===2&&falhasRegistro===0,'regravação consumiu as falhas sem novo POST');
 conferir(ib.estado==='aceito'&&/^wamid\./.test(ib.wamid)&&(await mensagem(b.envio.mensagemId)).estado==='aceito','aceite gravado após as falhas');

 // 3. Registro impossível: vira incerto e o status assinado da Meta concilia.
 const c=await fixture();let wamidC='';aoAceitar=async w=>{wamidC=w;falhasRegistro=99;};
 await assert.rejects(()=>worker([1]).enviarProximo(),/timeout exceeded/);assercoes++;aoAceitar=async()=>undefined;falhasRegistro=0;
 conferir((await intencao(c.envio.id)).estado==='processando','intenção permanece em processamento');
 await expirarLease(c.envio.id);r=await worker([]).enviarProximo();
 conferir(r.estado==='vazio'&&posts===3,'lease vencido não gera novo POST');
 conferir((await intencao(c.envio.id)).estado==='incerto'&&(await mensagem(c.envio.mensagemId)).estado==='incerto','sem status a intenção fica incerta');
 await materializarEventoOperacao(repo,status(wamidC,'sent'));
 conferir((await intencao(c.envio.id)).estado==='incerto','status sem referência não concilia');
 await materializarEventoOperacao(repo,status(wamidC,'sent',randomUUID()));
 conferir((await intencao(c.envio.id)).estado==='incerto','referência desconhecida não concilia');
 await materializarEventoOperacao(repo,status(wamidC,'delivered',c.envio.id));
 let ic=await intencao(c.envio.id),mc=await mensagem(c.envio.mensagemId);
 conferir(ic.estado==='entregue'&&ic.wamid===wamidC&&ic.codigo===null&&ic.lease===null,'status com referência concilia a intenção');
 conferir(mc.estado==='entregue'&&mc.wamid===wamidC&&mc.enviada_em&&mc.entregue_em,'bolha passa a entregue com o wamid');
 await materializarEventoOperacao(repo,status(wamidC,'read',c.envio.id));
 conferir((await intencao(c.envio.id)).estado==='lido'&&(await mensagem(c.envio.mensagemId)).estado==='lido','leitura posterior avança');

 // 4. Status chega enquanto o worker ainda processa: concilia e o registro
 // seguinte do worker reconhece o mesmo wamid, sem erro nem regressão.
 const d=await fixture();aoAceitar=async w=>{await materializarEventoOperacao(repo,status(w,'delivered',d.envio.id));};
 r=await worker([]).enviarProximo();aoAceitar=async()=>undefined;
 const id=await intencao(d.envio.id);
 conferir(r.estado==='aceito'&&posts===4,'worker conclui após conciliação concorrente');
 conferir(id.estado==='entregue'&&/^wamid\./.test(id.wamid)&&(await mensagem(d.envio.mensagemId)).estado==='entregue','estado entregue preservado');

 // 5. Um wamid já vinculado não pode ser tomado por outra intenção.
 const e=await fixture();aoAceitar=async()=>{falhasRegistro=99;};await assert.rejects(()=>worker([]).enviarProximo(),/timeout exceeded/);assercoes++;aoAceitar=async()=>undefined;falhasRegistro=0;
 await materializarEventoOperacao(repo,status(id.wamid,'delivered',e.envio.id));
 conferir((await intencao(e.envio.id)).estado==='processando'&&(await intencao(e.envio.id)).wamid===null,'wamid de outra mensagem é recusado');
 await expirarLease(e.envio.id);

 // 6. Falha de infraestrutura antes do POST: volta à fila e sai na rodada seguinte.
 const f=await fixture();falhasIdentidade=2;r=await worker([]).enviarProximo();
 let ifi=await intencao(f.envio.id);
 conferir(r.estado==='reprogramado'&&posts===5,'falha anterior ao POST reprograma sem enviar');
 conferir(ifi.estado==='pendente'&&ifi.lease===null&&ifi.codigo===null,'intenção volta à fila');
 await pool.query('UPDATE atendimento_operacao.intencao SET proxima_tentativa=now() WHERE id=$1',[f.envio.id]);
 r=await worker([]).enviarProximo();ifi=await intencao(f.envio.id);
 conferir(r.estado==='aceito'&&posts===6&&ifi.estado==='aceito'&&ifi.tentativas===2,'segunda rodada envia uma única vez');

 // 7. Recusa de domínio continua recusa: não reprograma.
 const g=await fixture();await pool.query("UPDATE atendimento_operacao.conversa SET ultima_cliente_em=now()-interval '2 days' WHERE id=$1",[g.conversaId]);
 r=await worker([]).enviarProximo();
 conferir(r.estado==='vazio'&&posts===6&&(await intencao(g.envio.id)).estado==='cancelado','janela fechada cancela sem POST');
 console.log(JSON.stringify({ensaio:'garantia-envio',assercoes,posts,resultado:'aprovado'}));
}finally{await pool.end();}
