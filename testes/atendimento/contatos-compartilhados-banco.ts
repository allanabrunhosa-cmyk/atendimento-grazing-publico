import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {RepositorioOperacaoPg,RepositorioEntradaPg,materializarEventoOperacao,hashOperacao} from '../../src/lib/atendimento/operacao-repositorio-pg';
import type {AcaoOperacao,IdentidadeOperacao} from '../../src/lib/atendimento/operacao-tipos';
import type {EventoRecebido} from '../../src/lib/atendimento/webhook';
import {AVISO_CONTATOS_COMPARTILHADOS_GRANDE} from '../../src/lib/atendimento/operacao-contatos-compartilhados';
function endereco(nome:string,banco:string){const valor=process.env[nome]??'',u=new URL(valor);if(u.protocol!=='postgresql:'||u.pathname!=='/'+banco||!['127.0.0.1','localhost'].includes(u.hostname))throw Error('ENSAIO_ISOLADO_EXIGIDO');return valor;}
const pool=new Pool({connectionString:endereco('OPERACAO_BANCO_TESTE','donatella_ensaio_operacao'),max:3}),entradaPool=new Pool({connectionString:endereco('ENTRADA_BANCO_TESTE','donatella_ensaio_entrada'),max:2});
const entrada=new RepositorioEntradaPg(entradaPool),numero='123456789',waba='1122334455',numeroAlheio='987654321',remetente='5511900000731',remetenteAlheio='5511900000732';
const ator:IdentidadeOperacao={id:'fixture-cartoes-pg',nome:'Atendente Fictício',perfilId:'fixture',sessaoVersao:1,permissoes:[]};
const direitos=new Set<AcaoOperacao>(['consultar','atender','contatos.visualizar','mensagens.visualizar','mensagens.adicionar']);
let assercoes=0,chamadasEntrada=0,enviosExternos=0;globalThis.fetch=async()=>{enviosExternos++;throw Error('ENVIO_EXTERNO_PROIBIDO');};
const autorizar=async(i:IdentidadeOperacao,a:AcaoOperacao)=>i.id===ator.id&&direitos.has(a);
const repo=new RepositorioOperacaoPg(pool,autorizar,()=> 'homologacao','/tmp/midia-cartoes-ficticia',undefined,undefined,'humano',{numeroId:numero,wabaId:waba,ficticio:true},p=>{chamadasEntrada++;return entrada.contatosCompartilhados(p,true);});
const conferir=(ok:unknown)=>{assert.ok(ok);assercoes++;};
const igual=(a:unknown,b:unknown)=>{assert.deepEqual(a,b);assercoes++;};
const cartoes=(r:Awaited<ReturnType<RepositorioOperacaoPg['historico']>>,id:string)=>{const m=r.registros.find(m=>m.id===id);return m&&'contatosCompartilhados' in m?m.contatosCompartilhados:[];};
const cartao={name:{formatted_name:'Empresa Fictícia Cartão'},org:{company:'Empresa Fictícia'},phones:[{phone:'+55 (11) 90000-0991',type:'WORK',wa_id:'5511900009999'}],emails:[{email:'cartao@example.com'}]};
const esperado={nome:'Empresa Fictícia Cartão',empresa:'Empresa Fictícia',telefones:[{numero:'+55 (11) 90000-0991',tipo:'WORK'}],emails:['cartao@example.com']};
async function persistir(evento:EventoRecebido){evento={...evento,chave:hashOperacao([evento.waba,evento.numero,'mensagem',(evento.conteudo.item as Record<string,unknown>).id])};const corpo=Buffer.from(JSON.stringify({ficticio:true,execucao:randomUUID(),evento}));await entrada.persistir({hash:createHash('sha256').update(corpo).digest('hex'),corpo,eventos:[evento]});}
try {
 const wamid='wamid.fixture-cartoes-'+randomUUID(),evento:EventoRecebido={tipo:'mensagem',chave:hashOperacao([waba,numero,'mensagem',wamid]),waba,numero,conteudo:{item:{id:wamid,from:remetente,timestamp:String(Math.floor(Date.now()/1000)),type:'contacts',contacts:[cartao]}}};
 await persistir(evento);const recebido=await materializarEventoOperacao(repo,evento);if(!('mensagemId' in recebido))throw Error('MENSAGEM_FICTICIA_AUSENTE');
 const conversaId=String(recebido.conversaId),mensagemId=String(recebido.mensagemId),ler=async()=>(await pool.query('SELECT * FROM atendimento_operacao.mensagem WHERE id=$1',[mensagemId])).rows[0];
 igual((await ler()).tipo,'unsupported');igual((await ler()).metadados.contatosCompartilhados,[esperado]);igual((await ler()).conteudo,'Contato compartilhado: Empresa Fictícia Cartão');
 let h=await repo.historico(ator,{conversaId});igual(chamadasEntrada,0);igual(cartoes(h,mensagemId),[esperado]);igual(h.registros.find(m=>m.id===mensagemId)?.tipo,'contacts');
 const lista=await repo.listar(ator,{});conferir(lista.registros.some(c=>c.id===conversaId&&'ultimaMensagem' in c&&c.ultimaMensagem==='Contato compartilhado: Empresa Fictícia Cartão'&&c.ultimaMensagemTipo==='contacts'));
 // Simula a limitação antiga somente na base fictícia. O recibo não é reprocessado.
 await pool.query("UPDATE atendimento_operacao.mensagem SET conteudo='',metadados=jsonb_build_object('tipoOriginal','contacts') WHERE id=$1",[mensagemId]);
 const estadoEntrada=(await entradaPool.query('SELECT estado,tentativas,lease,concluido_em FROM atendimento_entrada.evento WHERE chave=$1',[evento.chave])).rows[0];
 const rawAntes=(await entradaPool.query('SELECT hash,corpo FROM atendimento_entrada.recibo ORDER BY recebido_em DESC LIMIT 1')).rows[0];
 h=await repo.historico(ator,{conversaId});igual(chamadasEntrada,1);igual(cartoes(h,mensagemId),[esperado]);igual(h.registros.find(m=>m.id===mensagemId)?.conteudo,'Contato compartilhado: Empresa Fictícia Cartão');igual((await ler()).metadados,{tipoOriginal:'contacts'});igual((await ler()).conteudo,'');
 igual((await entradaPool.query('SELECT estado,tentativas,lease,concluido_em FROM atendimento_entrada.evento WHERE chave=$1',[evento.chave])).rows[0],estadoEntrada);igual((await entradaPool.query('SELECT hash,corpo FROM atendimento_entrada.recibo WHERE hash=$1',[rawAntes.hash])).rows[0],rawAntes);
 // Mesmo wamid em outro remetente ou número empresarial não entra no resultado.
 for(const escopo of [{numero:numeroAlheio,from:remetente},{numero,from:remetenteAlheio}])await persistir({...evento,chave:randomUUID(),numero:escopo.numero,conteudo:{item:{...(evento.conteudo.item as Record<string,unknown>),from:escopo.from,contacts:[{name:{formatted_name:'NÃO EXPOR OUTRO ESCOPO'}}]}}});
 h=await repo.historico(ator,{conversaId});igual(cartoes(h,mensagemId),[esperado]);conferir(!JSON.stringify(h).includes('NÃO EXPOR OUTRO ESCOPO'));
 igual(await entrada.contatosCompartilhados([{wamid,waba,numero:'111111111',remetente}],true),new Map());igual(await entrada.contatosCompartilhados([{wamid,waba,numero,remetente:'5511900000733'}],true),new Map());
 await assert.rejects(()=>entrada.contatosCompartilhados([{wamid,waba,numero,remetente}],false),/DESTINO_ENTRADA_RECUSADO/);assercoes++;
 const citada=await materializarEventoOperacao(repo,{...evento,chave:randomUUID(),conteudo:{item:{id:'wamid.fixture-citacao-'+randomUUID(),from:remetente,timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:'Este contato fictício'},context:{id:wamid}}}});if(!('mensagemId' in citada))throw Error('CITACAO_FICTICIA_AUSENTE');
 h=await repo.historico(ator,{conversaId});igual(h.registros.find(m=>m.id===citada.mensagemId)?.citada?.tipo,'contacts');igual(h.registros.find(m=>m.id===citada.mensagemId)?.citada?.conteudo,'Contato compartilhado: Empresa Fictícia Cartão');
 // A origem fora do ar não impede consultar as demais mensagens.
 const offline=new RepositorioOperacaoPg(pool,autorizar,()=> 'homologacao','fixture',undefined,undefined,'humano',{numeroId:numero,wabaId:waba,ficticio:true},async()=>{throw Error('FONTE_INDISPONIVEL');});
 const indisponivel=await offline.historico(ator,{conversaId});igual(indisponivel.registros.find(m=>m.id===mensagemId)?.conteudo,'Contato compartilhado indisponível');igual(indisponivel.registros.find(m=>m.id===citada.mensagemId)?.conteudo,'Este contato fictício');
 const contaAntes=chamadasEntrada;direitos.delete('mensagens.visualizar');igual((await repo.historico(ator,{conversaId})).registros,[]);igual(chamadasEntrada,contaAntes);direitos.add('mensagens.visualizar');direitos.delete('consultar');await assert.rejects(()=>repo.historico(ator,{conversaId}),/ACESSO_NEGADO/);assercoes++;direitos.add('consultar');
 // A identidade exata do contato é necessária, mesmo que o telefone exibido coincida.
 const identidadeOriginal=(await pool.query('SELECT identidade_canal FROM atendimento_operacao.contato WHERE id=(SELECT contato_id FROM atendimento_operacao.conversa WHERE id=$1)',[conversaId])).rows[0].identidade_canal;
 for(const identidade of [null,`whatsapp:${numeroAlheio}:${remetente}`,`whatsapp:${numero}:${remetenteAlheio}`]){await pool.query('UPDATE atendimento_operacao.contato SET identidade_canal=$2 WHERE id=(SELECT contato_id FROM atendimento_operacao.conversa WHERE id=$1)',[conversaId,identidade]);const r=await repo.historico(ator,{conversaId});conferir(!cartoes(r,mensagemId).length);}
 await pool.query('UPDATE atendimento_operacao.contato SET identidade_canal=$2 WHERE id=(SELECT contato_id FROM atendimento_operacao.conversa WHERE id=$1)',[conversaId,identidadeOriginal]);
 const antesAmbiente=chamadasEntrada;await pool.query('UPDATE atendimento_operacao.conversa SET ficticia=false WHERE id=$1',[conversaId]);const ambienteAlheio=await repo.historico(ator,{conversaId});igual(chamadasEntrada,antesAmbiente);conferir(!cartoes(ambienteAlheio,mensagemId).length);await pool.query('UPDATE atendimento_operacao.conversa SET ficticia=true WHERE id=$1',[conversaId]);
 // Idempotência da referência original não perde o cartão nem cria outro evento.
 await persistir(evento);igual((await entrada.contatosCompartilhados([{wamid,waba,numero,remetente}],true)).get(wamid),[esperado]);
 // Um cartão muito grande não derruba o histórico nem corta o conteúdo persistido.
 const grande:EventoRecebido={...evento,chave:randomUUID(),conteudo:{item:{...(evento.conteudo.item as Record<string,unknown>),id:'wamid.fixture-grande-'+randomUUID(),contacts:[{name:{formatted_name:'Pessoa Fictícia Cartão Grande'},phones:Array.from({length:30000},(_,n)=>({phone:'551190'+String(n).padStart(7,'0'),type:'WORK'}))}]}}};
 await persistir(grande);const recebidoGrande=await materializarEventoOperacao(repo,grande);if(!('mensagemId' in recebidoGrande))throw Error('CARTAO_GRANDE_FICTICIO_AUSENTE');
 const historicoGrande=await repo.historico(ator,{conversaId});igual(cartoes(historicoGrande,String(recebidoGrande.mensagemId)),[]);igual(historicoGrande.registros.find(m=>m.id===recebidoGrande.mensagemId)?.conteudo,AVISO_CONTATOS_COMPARTILHADOS_GRANDE);igual(historicoGrande.registros.find(m=>m.id===recebidoGrande.mensagemId)?.tipo,'unsupported');conferir(historicoGrande.registros.some(m=>m.id===citada.mensagemId&&m.conteudo==='Este contato fictício'));
 igual((await pool.query("SELECT jsonb_array_length(metadados->'contatosCompartilhados'->0->'telefones') AS n FROM atendimento_operacao.mensagem WHERE id=$1",[recebidoGrande.mensagemId])).rows[0].n,30000);conferir(Buffer.byteLength(JSON.stringify(historicoGrande))<1024*1024);
 igual(enviosExternos,0);console.log(JSON.stringify({ensaio:'contatos-compartilhados',assercoes,enviosExternos,resgate:'somente_leitura',bancosFicticios:2}));
}finally{await Promise.all([pool.end(),entradaPool.end()]);}
