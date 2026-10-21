import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {RepositorioOperacaoPg} from '../../src/lib/atendimento/operacao-repositorio-pg';
import type {IdentidadeOperacao} from '../../src/lib/atendimento/operacao-tipos';

const endereco=process.env.OPERACAO_BANCO_TESTE??'',url=new URL(endereco);
if(url.protocol!=='postgresql:'||url.pathname!=='/donatella_ensaio_operacao'||!['127.0.0.1','localhost'].includes(url.hostname)||url.search||url.hash)throw Error('ENSAIO_ISOLADO_EXIGIDO');
const pool=new Pool({connectionString:endereco,max:2}),prefixo='Ordem follow-up fictícia '+randomUUID(),numeroId='123456789';
const ator:IdentidadeOperacao={id:'fixture-ordem-followup',nome:'Atendente fictício',perfilId:'fixture',sessaoVersao:1,permissoes:[]};
let acesso=true,assercoes=0,baseTelefone=0;
const repo=new RepositorioOperacaoPg(pool,async()=>acesso,()=> 'homologacao','midia-ficticia',undefined,undefined,'humano',{numeroId,ficticio:true});
globalThis.fetch=async()=>{throw Error('ENVIO_EXTERNO_PROIBIDO');};
const igual=(atual:unknown,esperado:unknown)=>{assert.deepEqual(atual,esperado);assercoes++;};
const conferir=(valor:unknown)=>{assert.ok(valor);assercoes++;};
const consultar=(extra:Parameters<RepositorioOperacaoPg['listar']>[1]={})=>repo.listar(ator,{busca:prefixo,...extra});
const ids=(pagina:Awaited<ReturnType<typeof consultar>>)=>pagina.registros.map(v=>v.id);
const futuros=async(ms=3600000)=>new Date(new Date((await pool.query('SELECT clock_timestamp() AS agora')).rows[0].agora).getTime()+ms).toISOString();
async function criar(indice:number,estado='humano',canal='whatsapp',ficticia=true){
 const contato=randomUUID(),id=randomUUID(),telefone='5511901'+String(baseTelefone+indice+1).padStart(6,'0');
 await pool.query('INSERT INTO atendimento_operacao.contato(id,nome,telefone,identidade_canal) VALUES($1,$2,$3,$4)',[contato,prefixo+' '+indice,telefone,`${canal}:${numeroId}:${telefone}`]);
 await pool.query("INSERT INTO atendimento_operacao.conversa(id,contato_id,estado,ficticia,ultima_mensagem_em,fila) VALUES($1,$2,$3,$4,now()-($5::int*interval '1 minute'),'fila-ficticia')",[id,contato,estado,ficticia,indice]);return id;
}
async function lembrete(id:string,agendadoPara?:string){
 const r=await repo.alterarLembreteConversa(ator,id,{acao:'agendar',versao:0,idempotencia:randomUUID(),agendadoPara:agendadoPara??await futuros()});assert.ok(r.lembrete);return r.lembrete;
}
try{
 baseTelefone=Number((await pool.query("SELECT coalesce(max(right(telefone,6)::int),0) AS ultima FROM atendimento_operacao.contato WHERE telefone ~ '^5511901[0-9]{6}$'")).rows[0].ultima);
 const conversas=[];for(let n=0;n<65;n++)conversas.push(await criar(n));
 const proximo=await futuros(120000),futuro=await lembrete(conversas[64],proximo),vencido=await lembrete(conversas[63]);
 await pool.query("UPDATE atendimento_operacao.lembrete_conversa SET agendado_para=now()-interval '1 hour' WHERE id=$1",[vencido.id]);
 const mensagem=randomUUID();await pool.query("INSERT INTO atendimento_operacao.mensagem(id,conversa_id,autor,conteudo,tipo,estado) VALUES($1,$2,'cliente','Texto fictício','text','recebido')",[mensagem,conversas[0]]);
 const pagina1=await consultar(),pagina2=await consultar({pagina:2}),pagina3=await consultar({pagina:3});
 igual(pagina1.registros.length,30);igual(pagina2.registros.length,30);igual(pagina3.registros.length,5);igual(pagina1.mais,true);igual(pagina3.mais,false);
 igual(ids(pagina1).slice(0,2),[conversas[63],conversas[0]]);igual(new Set([...ids(pagina1),...ids(pagina2),...ids(pagina3)]).size,65);
 conferir(!ids(pagina1).includes(conversas[64]));igual('proximoLembreteEm' in pagina1?pagina1.proximoLembreteEm:null,proximo);
 // Uma nova mensagem e a leitura não removem a prioridade do lembrete vencido.
 await pool.query('INSERT INTO atendimento_operacao.leitura_mensagem(mensagem_id,autor_id) VALUES($1,$2)',[mensagem,ator.id]);
 igual(ids(await consultar())[0],conversas[63]);
 await pool.query("UPDATE atendimento_operacao.conversa SET ultima_mensagem_em=now()+interval '1 minute' WHERE id=$1",[conversas[0]]);
 igual(ids(await consultar())[0],conversas[63]);
 // O vencimento de uma conversa fora da primeira página entra no primeiro bloco.
 await pool.query("UPDATE atendimento_operacao.lembrete_conversa SET agendado_para=now()-interval '1 minute' WHERE id=$1",[futuro.id]);
 igual(ids(await consultar()).slice(0,3),[conversas[63],conversas[64],conversas[0]]);
 // Reprogramar para o futuro libera a posição. Cancelar e concluir também.
 const reagendado=await repo.alterarLembreteConversa(ator,conversas[63],{acao:'reagendar',lembreteId:vencido.id,versao:1,idempotencia:randomUUID(),agendadoPara:await futuros()});
 igual(ids(await consultar()).slice(0,2),[conversas[64],conversas[0]]);
 await repo.alterarLembreteConversa(ator,conversas[64],{acao:'cancelar',lembreteId:futuro.id,versao:1,idempotencia:randomUUID()});
 igual(ids(await consultar())[0],conversas[0]);
 await pool.query("UPDATE atendimento_operacao.lembrete_conversa SET agendado_para=now()-interval '1 minute' WHERE id=$1",[vencido.id]);
 igual(ids(await consultar())[0],conversas[63]);
 await repo.alterarLembreteConversa(ator,conversas[63],{acao:'concluir',lembreteId:vencido.id,versao:reagendado.lembrete!.versao,idempotencia:randomUUID()});igual(ids(await consultar())[0],conversas[0]);
 const encerrada=await criar(70,'encerrada'),instagram=await criar(71,'pausado','instagram'),real=await criar(72,'humano','whatsapp',false);
 for(const id of [encerrada,instagram]){const l=await lembrete(id);await pool.query("UPDATE atendimento_operacao.lembrete_conversa SET agendado_para=now()-interval '1 minute' WHERE id=$1",[l.id]);}
 igual(ids(await consultar())[0],instagram);conferir(!ids(await consultar()).includes(encerrada));conferir(!ids(await consultar()).includes(real));
 igual(ids(await consultar({estado:'encerrada'})),[encerrada]);igual(ids(await consultar({canal:'instagram'})),[instagram]);igual(ids(await consultar({fila:'outra-fila'})),[]);
 igual(ids(await consultar({canal:'whatsapp'}))[0],conversas[0]);igual(ids(await consultar({estado:'humano'}))[0],conversas[0]);
 acesso=false;await assert.rejects(()=>consultar(),/ACESSO_NEGADO/);assercoes++;
 console.log(JSON.stringify({ensaio:'ordem-followup',assercoes,conversasFicticias:68,paginacao:30,enviosExternos:0,migrationsNovas:0}));
}finally{await pool.end();}
