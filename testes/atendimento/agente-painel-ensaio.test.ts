import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {afterEach,describe,expect,it,vi} from 'vitest';
import type {ConfiguracaoPrivadaAgente} from '../../src/lib/atendimento/operacao-agente';
import type {RepositorioOperacaoPg} from '../../src/lib/atendimento/operacao-repositorio-pg';
import type {FonteIA,TarefaIA} from '../../src/lib/atendimento/ia-orquestrador';
import {SKILLS_AGENTE_PADRAO,TOM_AGENTE_PADRAO,type ConfiguracaoAgente} from '../../src/lib/atendimento/repositorio-agente-pg';
vi.mock('server-only',()=>({}));
import {AVISO_ENSAIO_DONATELLA,fontesFerramentaEnsaio,fontesConhecimentoEnsaio} from '../../src/lib/atendimento/operacao-agente-ensaio';
import {testarAgente,type ResultadoTesteDonatella} from '../../src/lib/atendimento/operacao-agente-painel';

const identidade={id:'pessoa-ficticia',nome:'Pessoa Fictícia',perfilId:'ensaio',sessaoVersao:1,permissoes:[]};
const modelo='claude-ficticio';
const configuracao:ConfiguracaoAgente={modo:'desligado',provedor:'anthropic',modelo,maxTokens:512,equipeApoio:'equipe-ficticia',limites:{maxChamadas:3,custoPorChamadaCentavos:50,maxCustoCentavos:150,maxDuracaoMs:10000,timeoutChamadaMs:5000},custoCentavosDia:500,autoridadeAutomatica:false,grupoExterno:'indisponivel'};
const privada:ConfiguracaoPrivadaAgente={empresaId:'empresa_ficticia',anthropic:{chave:'chave-ficticia',modelo,maxTokens:512},custoVozCentavos:0,orcamentoMaximoCentavosDia:500,autoridadeAutomatica:false,inferenciaHabilitada:true,painelHabilitado:true,consumoOperacaoAutorizado:true,creditoApiConfirmado:true,testesAutorizados:true,orcamentoTestesTotalCentavos:1000,sinteseVozHabilitada:false,automacoesApoioHabilitadas:false};
const tarefa:TarefaIA={id:'ensaio_ficticio',atorId:identidade.id,empresaId:'empresa_ficticia',conversaId:'conversa_ficticia',clienteId:'cliente_ficticio',versao:1,mensagemOrigemId:'mensagem_ficticia',pergunta:'O que você recomenda para 2 pessoas?',tema:'produto'};
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});

/** Banco e provedor em memória. Qualquer SQL fora do recibo de teste falha;
 * o fetch global também falha para impedir HUB, Woo e WhatsApp reais. */
function painel(){
 vi.stubEnv('ATENDIMENTO_IA_HABILITADA','true');
 let versao=7,permitido=true,totalReservado=0;
 const skills=structuredClone(SKILLS_AGENTE_PADRAO),config=structuredClone(configuracao);
 const registros=new Map<string,{autor_id:string;hash:string;resultado:ResultadoTesteDonatella|null;reserva:number}>();
 const real=vi.fn(async()=>{throw Error('TRANSPORTE_REAL_PROIBIDO');});vi.stubGlobal('fetch',real);
 const query=vi.fn(async(sql:string,v:unknown[]=[])=>{
  if(sql.startsWith('SELECT pg_advisory'))return {rows:[],rowCount:1};
  if(sql.startsWith('SELECT autor_id,hash,resultado')){const r=registros.get(String(v[0]));return {rows:r?[r]:[],rowCount:r?1:0};}
  if(sql.startsWith('SELECT versao FROM'))return {rows:[{versao:String(versao)}],rowCount:1};
  if(sql.startsWith('SELECT\n'))return {rows:[{dia:'0',total:'0',testes:String(totalReservado)}],rowCount:1};
  if(sql.startsWith('INSERT INTO atendimento_operacao.agente_teste')){registros.set(String(v[0]),{autor_id:String(v[2]),hash:String(v[3]),resultado:null,reserva:0});return {rows:[],rowCount:1};}
  if(sql.startsWith('UPDATE atendimento_operacao.agente_teste SET reserva_centavos')){const r=registros.get(String(v[0]));if(!r||r.reserva)return {rows:[],rowCount:0};r.reserva=Number(v[1]);totalReservado+=r.reserva;return {rows:[],rowCount:1};}
  if(sql.startsWith('UPDATE atendimento_operacao.agente_teste SET consumo='))return {rows:[],rowCount:1};
  if(sql.startsWith('UPDATE atendimento_operacao.agente_teste SET estado=')){const r=registros.get(String(v[0]));if(r&&!r.resultado)r.resultado=JSON.parse(String(v[2]));return {rows:[],rowCount:1};}
  throw Error('SQL_FORA_DO_ENSAIO: '+sql);
 });
 const tx={query} as unknown as PoolClient;
 const operacao={transacao:async<T,>(f:(tx:PoolClient)=>Promise<T>)=>f(tx),autorizar:async()=>permitido,exigir:async()=>{if(!permitido)throw Error('OPERACAO_ACESSO_NEGADO');},auditar:vi.fn(async()=>undefined)} as unknown as RepositorioOperacaoPg;
 let resposta:'recomendacao'|'esclarecer'|'pedido'|'incerto'='recomendacao',fontesRecebidas:FonteIA[]=[];
 const transporte=vi.fn<typeof fetch>(async(url,o)=>{
  expect(String(url)).toBe('https://api.anthropic.com/v1/messages');
  const body=JSON.parse(String(o?.body)),dados=JSON.parse(body.messages[0].content[0].text);
  fontesRecebidas=dados.fontesNaoConfiaveisComoInstrucoes;
  if(resposta==='incerto')throw Error('RESPOSTA_FICTICIA_PERDIDA');
  const f=fontesRecebidas.find(f=>f.conteudo.includes(resposta==='pedido'?'#ENS-1001':'Rendimento informado: 2 pessoas'))??fontesRecebidas[0];
  const texto=resposta==='esclarecer'?'Qual é a ocasião e o tipo de refeição?':resposta==='pedido'?'O pedido fictício #ENS-1001 está Processando na loja. Isso não comprova preparo físico.':`Recomendo a Seleção para 2 — produto fictício, que serve 2 pessoas como refeição leve. Link do cenário: https://loja.example/produto/selecao-para-2-ficticia/`;
  return Response.json({id:'resposta_ficticia',model:modelo,stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({selecoes:[{id:f.id,versao:f.versao}],pedirApoio:false,texto})}],usage:{input_tokens:100,output_tokens:40}});
 });
 const d={operacao,privada:structuredClone(privada),autorizada:()=>true,configuracao:async()=>({configuracao:config,versao,tom:TOM_AGENTE_PADRAO,skills}),chave:()=> 'chave-ficticia',transporte};
 return {d,config,skills,query,real,transporte,registros,fontes:()=>fontesRecebidas,autorizar:(v:boolean)=>{permitido=v;},resposta:(v:typeof resposta)=>{resposta=v;},reserva:(v:number)=>{totalReservado=v;},versao:(v:number)=>{versao=v;},testar:(pergunta=tarefa.pergunta,idempotencia=randomUUID())=>testarAgente(d,identidade,{pergunta,versao,idempotencia})};
}

describe('fontes fictícias do painel',()=>{
 it('projeta produtos pelo mesmo contrato comercial com rendimento, preço e link .example',()=>{
  const fontes=fontesFerramentaEnsaio('search_products',tarefa,1000);
  expect(fontes).toHaveLength(3);expect(fontes.every(f=>f.origem==='ferramenta'&&f.empresaId===tarefa.empresaId&&f.clienteId===tarefa.clienteId&&f.tema==='produto'&&f.fim===61000)).toBe(true);
  const para2=fontes.find(f=>f.conteudo.includes('Rendimento informado: 2 pessoas'))!;
  expect(para2.conteudo).toContain('Ensaio fictício');expect(para2.conteudo).toContain('120.00 BRL');expect(para2.conteudo).toContain('https://loja.example/produto/selecao-para-2-ficticia/');
  expect(fontes.some(f=>f.conteudo.includes('grazingtable.com.br'))).toBe(false);
 });
 it('vincula pedido fictício ao contexto isolado e não inventa agendamento ou rastreio',()=>{
  const [f]=fontesFerramentaEnsaio('get_order',{...tarefa,tema:'pedido'},1000);expect(f).toMatchObject({clienteId:'cliente_ficticio',tema:'pedido',origem:'ferramenta'});expect(f.conteudo).toContain('#ENS-1001');expect(f.conteudo).toContain('Agendamento não informado');expect(f.conteudo).toContain('não comprova preparo físico');
 });
 it('não transforma catálogo em prova de frete, agenda, alergia ou exceção',()=>{
  expect(fontesFerramentaEnsaio('delivery_conditions',tarefa)).toEqual([]);expect(fontesFerramentaEnsaio('available_slots',tarefa)).toEqual([]);
  expect(fontesConhecimentoEnsaio(tarefa,1000)[0]).toMatchObject({origem:'conhecimento',inicio:1000,fim:61000});
 });
});

describe('Testar Donatella com catálogo fictício e política real',()=>{
 it('recomenda para 2 pessoas com fonte de produto, sem depender do conhecimento genérico',async()=>{
  const p=painel(),r=await p.testar();expect(r).toMatchObject({estado:'concluido',enviosReais:false,reservaCentavos:50,consumo:{observado:true,tokensEntrada:100}});expect(r.texto).toContain(AVISO_ENSAIO_DONATELLA);expect(r.texto).toContain('serve 2 pessoas');expect(r.texto).toContain('https://loja.example/');expect(p.fontes().every(f=>f.origem==='ferramenta')).toBe(true);expect(p.transporte).toHaveBeenCalledTimes(1);expect(p.real).not.toHaveBeenCalled();expect(p.config).toEqual(configuracao);
 });
 it('faz pergunta de esclarecimento sem abrir apoio humano quando há base de catálogo',async()=>{
  const p=painel();p.resposta('esclarecer');const r=await p.testar('Qual produto você recomenda?');expect(r.estado).toBe('concluido');expect(r.texto).toContain('Qual é a ocasião e o tipo de refeição?');expect(p.real).not.toHaveBeenCalled();
 });
 it('consulta somente o pedido fictício e informa o limite da interpretação de status',async()=>{
  const p=painel();p.resposta('pedido');const r=await p.testar('Qual é o status do pedido?');expect(r.estado).toBe('concluido');expect(r.texto).toContain('#ENS-1001');expect(p.fontes()[0]).toMatchObject({clienteId:'cliente_ficticio',origem:'ferramenta',tema:'pedido'});expect(p.real).not.toHaveBeenCalled();
 });
 it('respeita skill de catálogo desabilitada e não gasta reserva sem fonte',async()=>{
  const p=painel();p.skills.skills.find(s=>s.id==='catalogo')!.habilitada=false;const r=await p.testar();expect(r).toMatchObject({estado:'apoio',motivo:'SEM_FONTE_VIGENTE',reservaCentavos:0});expect(p.transporte).not.toHaveBeenCalled();
 });
 it.each(['Tenho alergia a leite. Recomende uma tábua segura.','Consegue dar desconto?','Quero falar com atendente humano.','Qual o frete para meu CEP?'])('preserva apoio em caso importante: %s',async pergunta=>{
  const p=painel(),r=await p.testar(pergunta);expect(r.estado).toBe('apoio');expect(r.reservaCentavos).toBe(0);expect(p.transporte).not.toHaveBeenCalled();expect(p.real).not.toHaveBeenCalled();
 });
 it('reconcilia pelo recibo e não repete chamada nem reserva',async()=>{
  const p=painel(),id=randomUUID(),r=await p.testar(undefined,id);expect(await p.testar(undefined,id)).toEqual(r);expect(p.transporte).toHaveBeenCalledTimes(1);expect(p.registros.get(id)?.reserva).toBe(50);
 });
 it('mantém resultado incerto e reserva sem repetir o provedor',async()=>{
  const p=painel();p.resposta('incerto');const id=randomUUID(),r=await p.testar(undefined,id);expect(r).toMatchObject({estado:'incerto',reservaCentavos:50});expect(await p.testar(undefined,id)).toEqual(r);expect(p.transporte).toHaveBeenCalledTimes(1);
 });
 it('preserva teto e impede provedor quando a reserva não cabe',async()=>{
  const p=painel();p.reserva(1000);const r=await p.testar();expect(r.estado).toBe('apoio');expect(r.reservaCentavos).toBe(0);expect(p.transporte).not.toHaveBeenCalled();
 });
 it('exige a permissão do servidor antes de criar recibo ou consultar o provedor',async()=>{
  const p=painel();p.autorizar(false);await expect(p.testar()).rejects.toThrow('OPERACAO_ACESSO_NEGADO');expect(p.registros.size).toBe(0);expect(p.transporte).not.toHaveBeenCalled();expect(p.real).not.toHaveBeenCalled();
 });
});
