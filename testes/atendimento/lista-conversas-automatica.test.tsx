// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {useListaConversas} from '../../apps/atendimento-chat-consulta/useListaConversas';
import type {ClienteOperacao,ConversaOperacao,PaginaConversasOperacao} from '../../apps/atendimento-chat-consulta/operacao-api';

type Opcoes=Parameters<typeof useListaConversas>[0];
type Pedido={argumentos:Parameters<ClienteOperacao['conversas']>;resolver:(pagina:PaginaConversasOperacao)=>void;rejeitar:(erro:unknown)=>void};
const instante='2026-10-15T12:00:00.000Z';
const conversa=(numero:number):ConversaOperacao=>({id:`conversa-ficticia-${numero}`,contatoId:`contato-ficticio-${numero}`,nome:`Contato fictício ${numero}`,telefone:null,canal:'whatsapp',estado:'humano',responsavelId:null,equipeId:null,tags:[],versao:1,ultimaMensagemEm:instante,ficticia:true,somenteLeitura:false});
const faixa=(inicio:number,quantidade=30)=>Array.from({length:quantidade},(_,indice)=>conversa(inicio+indice));
function pagina(numero:number,registros:ConversaOperacao[],mais:boolean,total=100):PaginaConversasOperacao{
 return {pagina:numero,registros,mais,contagens:{total,ia:0,humano:total,pausado:0,encerrada:0},contagensConferidasEm:instante};
}
const ids=(lista:PaginaConversasOperacao|null)=>lista?.registros.map(registro=>registro.id)??[];

function fixture(alteracoes:Partial<Opcoes>={}){
 const pedidos:Pedido[]=[],falhar=vi.fn();
 const consultar=vi.fn<ClienteOperacao['conversas']>((...argumentos)=>new Promise<PaginaConversasOperacao>((resolver,rejeitar)=>{pedidos.push({argumentos,resolver,rejeitar});}));
 const cliente={conversas:consultar} as unknown as ClienteOperacao;
 const opcoes:Opcoes={cliente,ativa:true,filtro:'',estado:'',canal:'',revisao:0,reinicio:0,falhar,...alteracoes};
 const hook=renderHook((opcoes:Opcoes)=>useListaConversas(opcoes),{initialProps:opcoes});
 const pedido=async(indice:number)=>{await waitFor(()=>expect(pedidos.length).toBeGreaterThan(indice));return pedidos[indice];};
 const responder=async(indice:number,valor:PaginaConversasOperacao)=>{const atual=await pedido(indice);await act(async()=>{atual.resolver(valor);});};
 const recusar=async(indice:number,erro:unknown)=>{const atual=await pedido(indice);await act(async()=>{atual.rejeitar(erro);});};
 const mais=()=>act(()=>{void hook.result.current.carregarMais();});
 return {...hook,opcoes,pedidos,consultar,falhar,pedido,responder,recusar,mais};
}

afterEach(()=>{cleanup();vi.restoreAllMocks();});

describe('carregamento automático da lista de conversas',()=>{
 it('traz ao topo o follow-up que venceu fora do prefixo sem depender de eventos ou do relógio local',async()=>{
  vi.spyOn(Date,'now').mockReturnValue(Date.parse('2040-01-01T00:00:00Z'));
  vi.spyOn(performance,'now').mockReturnValue(1000);
  const timers=vi.spyOn(globalThis,'setTimeout'),f=fixture({filtro:'Cliente fictício',estado:'humano',canal:'whatsapp'});
  const prazo={proximoLembreteEm:'2026-10-15T12:00:30.000Z',lembretesRecebidosEm:1000};
  await f.responder(0,{...pagina(0,faixa(0),true),...prazo});f.mais();await f.responder(1,{...pagina(1,faixa(30),true),...prazo});
  const tick=timers.mock.calls.filter(([,ms])=>ms===30050).at(-1)?.[0];expect(typeof tick).toBe('function');
  vi.mocked(performance.now).mockReturnValue(31050);act(()=>{if(typeof tick==='function')tick();});
  const primeiro=await f.pedido(2);expect(primeiro.argumentos).toEqual(['Cliente fictício','humano','',0,expect.any(AbortSignal),'whatsapp']);
  await f.responder(2,pagina(0,[conversa(90),...faixa(0,29)],true));expect(ids(f.result.current.lista)).toEqual(faixa(0,60).map(v=>v.id));
  await f.responder(3,pagina(1,faixa(29),true));expect(ids(f.result.current.lista)[0]).toBe(conversa(90).id);
  expect(f.result.current.lista?.registros).toHaveLength(60);expect(f.pedidos.map(p=>p.argumentos[3])).toEqual([0,1,0,1]);
 });

 it('cancela a atualização do vencimento quando o filtro ou a sessão deixam de valer',async()=>{
  vi.spyOn(performance,'now').mockReturnValue(1000);const timers=vi.spyOn(globalThis,'setTimeout'),limpar=vi.spyOn(globalThis,'clearTimeout'),f=fixture();
  await f.responder(0,{...pagina(0,faixa(0),true),proximoLembreteEm:'2026-10-15T12:00:30.000Z',lembretesRecebidosEm:1000});
  const indice=timers.mock.calls.findIndex(([,ms])=>ms===30050),timer=timers.mock.results[indice].value;
  f.rerender({...f.opcoes,ativa:false});expect(limpar).toHaveBeenCalledWith(timer);expect(f.consultar).toHaveBeenCalledOnce();
 });

 it('acumula dois blocos de 30 e o último parcial sem repetir pedidos após o fim',async()=>{
  const f=fixture();await f.pedido(0);expect(f.result.current.carregando).toBe(true);
  expect(f.pedidos[0].argumentos).toEqual(['','','',0,expect.any(AbortSignal),'']);
  await f.responder(0,pagina(0,faixa(0),true,65));
  expect(f.result.current.lista?.registros).toHaveLength(30);expect(f.result.current.carregando).toBe(false);
  f.mais();await f.pedido(1);expect(f.result.current.carregandoMais).toBe(true);
  expect(f.result.current.lista?.registros).toHaveLength(30);
  await f.responder(1,pagina(1,faixa(30),true,999));
  expect(f.result.current.lista?.registros).toHaveLength(60);expect(f.result.current.carregandoMais).toBe(false);
  f.mais();await f.responder(2,pagina(2,faixa(60,5),false,999));
  expect(ids(f.result.current.lista)).toEqual(faixa(0,65).map(registro=>registro.id));
  expect(f.result.current.lista).toMatchObject({pagina:2,mais:false,contagens:{total:999}});
  await act(async()=>{await f.result.current.carregarMais();await f.result.current.carregarMais();});
  expect(f.pedidos.map(pedido=>pedido.argumentos[3])).toEqual([0,1,2]);expect(f.falhar).not.toHaveBeenCalled();
 });

 it('remove duplicatas entre blocos sem embaralhar as conversas já exibidas',async()=>{
  const f=fixture();await f.responder(0,pagina(0,faixa(0),true));
  f.mais();await f.responder(1,pagina(1,[conversa(29),...faixa(30,29)],false));
  expect(ids(f.result.current.lista)).toEqual(faixa(0,59).map(registro=>registro.id));
  expect(new Set(ids(f.result.current.lista)).size).toBe(59);
 });

 it('não consulta outra página quando a primeira já encerra os resultados',async()=>{
  const f=fixture();await f.responder(0,pagina(0,[],false,0));
  await act(async()=>{await f.result.current.carregarMais();});
  expect(f.consultar).toHaveBeenCalledTimes(1);expect(f.result.current.lista?.mais).toBe(false);
 });

 it('bloqueia pedidos simultâneos e continua pela página seguinte depois da resposta',async()=>{
  const f=fixture();await f.responder(0,pagina(0,faixa(0),true));
  act(()=>{void f.result.current.carregarMais();void f.result.current.carregarMais();void f.result.current.carregarMais();});
  await f.pedido(1);expect(f.consultar).toHaveBeenCalledTimes(2);
  await f.responder(1,pagina(1,faixa(30),true));
  f.mais();await f.pedido(2);expect(f.pedidos.map(pedido=>pedido.argumentos[3])).toEqual([0,1,2]);
  await f.responder(2,pagina(2,faixa(60,2),false));expect(f.result.current.lista?.registros).toHaveLength(62);
 });

 it('atualiza todo o prefixo atomicamente e aplica reordenações e remoções recebidas',async()=>{
  const f=fixture();await f.responder(0,pagina(0,faixa(0),true));f.mais();await f.responder(1,pagina(1,faixa(30),true));
  const anteriores=ids(f.result.current.lista);
  f.rerender({...f.opcoes,revisao:1});await f.pedido(2);
  expect(f.result.current.carregando).toBe(true);expect(ids(f.result.current.lista)).toEqual(anteriores);
  const primeira=[conversa(70),{...conversa(0),nome:'Nome fictício atualizado'},...faixa(1,28)];
  await f.responder(2,pagina(0,primeira,true,80));await f.pedido(3);
  expect(ids(f.result.current.lista)).toEqual(anteriores);
  await f.responder(3,pagina(1,faixa(30),false,999));
  expect(ids(f.result.current.lista)).toEqual([...primeira,...faixa(30)].map(registro=>registro.id));
  expect(ids(f.result.current.lista)).not.toContain(conversa(29).id);
  expect(f.result.current.lista?.registros[1].nome).toBe('Nome fictício atualizado');
  expect(f.result.current.lista).toMatchObject({pagina:1,mais:false,contagens:{total:80},contagensConferidasEm:instante});
  expect(f.pedidos.map(pedido=>pedido.argumentos[3])).toEqual([0,1,0,1]);
 });

 it('conclui o prefixo mesmo com várias revisões e agrupa a rajada em uma única atualização posterior',async()=>{
  const f=fixture();await f.responder(0,pagina(0,faixa(0),true));f.mais();await f.responder(1,pagina(1,faixa(30),true));
  const anteriores=ids(f.result.current.lista);f.rerender({...f.opcoes,revisao:1});const primeira=await f.pedido(2);
  f.rerender({...f.opcoes,revisao:2});f.rerender({...f.opcoes,revisao:3});
  expect(f.consultar).toHaveBeenCalledTimes(3);expect(primeira.argumentos[4]?.aborted).toBe(false);
  await f.responder(2,pagina(0,faixa(100),true));const segunda=await f.pedido(3);
  expect(ids(f.result.current.lista)).toEqual(anteriores);
  f.rerender({...f.opcoes,revisao:4});f.rerender({...f.opcoes,revisao:5});
  expect(f.consultar).toHaveBeenCalledTimes(4);expect(segunda.argumentos[4]?.aborted).toBe(false);
  await f.responder(3,pagina(1,faixa(130),true));await f.pedido(4);
  expect(ids(f.result.current.lista)).toEqual(faixa(100,60).map(registro=>registro.id));
  expect(f.result.current.carregando).toBe(true);
  await f.responder(4,pagina(0,faixa(200),true));
  expect(ids(f.result.current.lista)).toEqual(faixa(100,60).map(registro=>registro.id));
  await f.responder(5,pagina(1,faixa(230),false));
  expect(ids(f.result.current.lista)).toEqual(faixa(200,60).map(registro=>registro.id));
  expect(f.result.current.carregando).toBe(false);expect(f.pedidos.map(pedido=>pedido.argumentos[3])).toEqual([0,1,0,1,0,1]);
  expect(f.pedidos.every(pedido=>pedido.argumentos[4]?.aborted===false)).toBe(true);
 });

 it('descarta a revisão agrupada da consulta antiga quando o filtro muda',async()=>{
  const f=fixture();await f.responder(0,pagina(0,faixa(0),true));f.mais();await f.responder(1,pagina(1,faixa(30),true));
  f.rerender({...f.opcoes,revisao:1});const antigo=await f.pedido(2);f.rerender({...f.opcoes,revisao:2});
  f.rerender({...f.opcoes,filtro:'Outra busca fictícia',revisao:2});await f.pedido(3);
  expect(antigo.argumentos[4]?.aborted).toBe(true);expect(f.result.current.lista).toBeNull();
  await f.responder(3,pagina(0,faixa(300,3),false));await f.responder(2,pagina(0,faixa(100),true));
  expect(ids(f.result.current.lista)).toEqual(faixa(300,3).map(registro=>registro.id));expect(f.consultar).toHaveBeenCalledTimes(4);
  expect(f.result.current.carregando).toBe(false);expect(f.result.current.erro).toBeNull();
 });

 it.each([
  {filtro:'Empresa fictícia'},
  {estado:'humano'},
  {canal:'instagram' as const},
  {reinicio:1},
 ])('reinicia a lista e descarta respostas antigas ao mudar %j',async(alteracao)=>{
  const f=fixture();await f.responder(0,pagina(0,faixa(0),true));f.mais();const antigo=await f.pedido(1);
  const novasOpcoes={...f.opcoes,...alteracao};f.rerender(novasOpcoes);const novo=await f.pedido(2);
  expect(antigo.argumentos[4]?.aborted).toBe(true);expect(ids(f.result.current.lista)).toEqual([]);
  expect(novo.argumentos).toEqual([novasOpcoes.filtro,novasOpcoes.estado,'',0,expect.any(AbortSignal),novasOpcoes.canal]);
  await f.responder(2,pagina(0,faixa(200,3),false));
  await f.responder(1,pagina(1,faixa(30),true));
  expect(ids(f.result.current.lista)).toEqual(faixa(200,3).map(registro=>registro.id));
  expect(f.result.current.lista?.mais).toBe(false);expect(f.falhar).not.toHaveBeenCalled();
 });

 it('ignora inclusive a primeira resposta atrasada de um filtro substituído',async()=>{
  const f=fixture();const antigo=await f.pedido(0);
  f.rerender({...f.opcoes,filtro:'Busca nova fictícia'});await f.pedido(1);
  expect(antigo.argumentos[4]?.aborted).toBe(true);
  await f.responder(1,pagina(0,faixa(300,2),false));await f.responder(0,pagina(0,faixa(0),true));
  expect(ids(f.result.current.lista)).toEqual(faixa(300,2).map(registro=>registro.id));
 });

 it('preserva as linhas após falha no próximo bloco e só retoma com repetição explícita',async()=>{
  const f=fixture();await f.responder(0,pagina(0,faixa(0),true));
  f.mais();const erro=new Error('Falha fictícia no próximo bloco');await f.recusar(1,erro);
  expect(ids(f.result.current.lista)).toEqual(faixa(0).map(registro=>registro.id));
  expect(f.result.current.erro).toBe('mais');expect(f.result.current.carregandoMais).toBe(false);expect(f.falhar).toHaveBeenCalledWith(erro);
  await act(async()=>{await f.result.current.carregarMais();});expect(f.consultar).toHaveBeenCalledTimes(2);
  f.rerender({...f.opcoes,revisao:1});expect(f.consultar).toHaveBeenCalledTimes(2);expect(f.result.current.erro).toBe('mais');
  act(()=>f.result.current.repetir());await f.pedido(2);expect(f.pedidos[2].argumentos[3]).toBe(1);
  await f.responder(2,pagina(1,faixa(30),false));
  expect(f.result.current.erro).toBeNull();expect(ids(f.result.current.lista)).toEqual(faixa(0,60).map(registro=>registro.id));
 });

 it('preserva o prefixo anterior se a atualização falha e repete o prefixo inteiro',async()=>{
  const f=fixture();await f.responder(0,pagina(0,faixa(0),true));f.mais();await f.responder(1,pagina(1,faixa(30),true));
  const anteriores=ids(f.result.current.lista);f.rerender({...f.opcoes,revisao:1});
  await f.responder(2,pagina(0,faixa(100),true));f.rerender({...f.opcoes,revisao:2});await f.recusar(3,new Error('Atualização fictícia interrompida'));
  expect(ids(f.result.current.lista)).toEqual(anteriores);expect(f.result.current.erro).toBe('atualizar');
  await act(async()=>{await f.result.current.carregarMais();});expect(f.consultar).toHaveBeenCalledTimes(4);
  act(()=>f.result.current.repetir());await f.responder(4,pagina(0,faixa(100),true));
  expect(ids(f.result.current.lista)).toEqual(anteriores);
  await f.responder(5,pagina(1,faixa(130,7),false));
  expect(ids(f.result.current.lista)).toEqual(faixa(100,37).map(registro=>registro.id));
  expect(f.result.current.erro).toBeNull();expect(f.pedidos.map(pedido=>pedido.argumentos[3])).toEqual([0,1,0,1,0,1]);
 });

 it('permite repetir a primeira consulta que falhou sem avançar a página',async()=>{
  const f=fixture();await f.recusar(0,new Error('Falha inicial fictícia'));
  expect(f.result.current.lista).toBeNull();expect(f.result.current.erro).toBe('atualizar');expect(f.result.current.carregando).toBe(false);
  act(()=>f.result.current.repetir());await f.responder(1,pagina(0,faixa(0,4),false));
  expect(f.pedidos.map(pedido=>pedido.argumentos[3])).toEqual([0,0]);expect(f.result.current.erro).toBeNull();
  expect(f.result.current.lista?.registros).toHaveLength(4);
 });

 it.each(['atualizar','mais'] as const)('conclui a repetição de %s em andamento e atende a revisão agrupada depois',async(tipo)=>{
  const f=fixture();const falha=tipo==='mais'?1:0;
  if(tipo==='mais'){await f.responder(0,pagina(0,faixa(0),true));f.mais();}
  await f.recusar(falha,new Error('Falha fictícia antes da repetição'));
  expect(f.result.current.erro).toBe(tipo);act(()=>f.result.current.repetir());
  const indiceRepeticao=falha+1,repeticao=await f.pedido(indiceRepeticao);
  expect(f.result.current.erro).toBeNull();
  f.rerender({...f.opcoes,revisao:1});f.rerender({...f.opcoes,revisao:2});
  expect(f.consultar).toHaveBeenCalledTimes(indiceRepeticao+1);expect(repeticao.argumentos[4]?.aborted).toBe(false);
  await f.responder(indiceRepeticao,pagina(tipo==='mais'?1:0,faixa(30),true));
  const indiceAtualizacao=indiceRepeticao+1,atualizacao=await f.pedido(indiceAtualizacao);
  expect(atualizacao.argumentos[3]).toBe(0);expect(f.result.current.carregando).toBe(true);
  expect(ids(f.result.current.lista)).toEqual((tipo==='mais'?faixa(0,60):faixa(30)).map(registro=>registro.id));
  await f.responder(indiceAtualizacao,pagina(0,faixa(100),true));
  const indiceFinal=indiceAtualizacao+(tipo==='mais'?1:0);
  if(tipo==='mais')await f.responder(indiceFinal,pagina(1,faixa(130),true));
  expect(f.result.current.erro).toBeNull();expect(f.result.current.carregando).toBe(false);expect(f.result.current.carregandoMais).toBe(false);
  f.mais();await f.responder(indiceFinal+1,pagina(tipo==='mais'?2:1,faixa(tipo==='mais'?160:130,5),false));
  expect(ids(f.result.current.lista)).toEqual(faixa(100,tipo==='mais'?65:35).map(registro=>registro.id));expect(f.falhar).toHaveBeenCalledOnce();
 });

 it('interrompe o prefixo na página que passou a ser a última após remoções',async()=>{
  const f=fixture();await f.responder(0,pagina(0,faixa(0),true));f.mais();await f.responder(1,pagina(1,faixa(30),true));
  f.rerender({...f.opcoes,revisao:1});await f.responder(2,pagina(0,faixa(100,4),false,4));
  expect(f.consultar).toHaveBeenCalledTimes(3);expect(f.result.current.lista).toMatchObject({pagina:0,mais:false,contagens:{total:4}});
  expect(ids(f.result.current.lista)).toEqual(faixa(100,4).map(registro=>registro.id));
 });

 it.each([
  {nome:'página vazia que anuncia mais resultados',resposta:pagina(1,[],true)},
  {nome:'bloco sem novas conversas que anuncia mais resultados',resposta:pagina(1,faixa(0),true)},
  {nome:'bloco maior que o limite de 30',resposta:pagina(1,faixa(30,31),true)},
  {nome:'número de página diferente do solicitado',resposta:pagina(2,faixa(30),true)},
 ])('impede laço de consultas para $nome',async({resposta})=>{
  const f=fixture();await f.responder(0,pagina(0,faixa(0),true));f.mais();await f.responder(1,resposta);
  expect(f.result.current.erro).toBe('mais');expect(f.falhar).toHaveBeenCalledOnce();
  expect(ids(f.result.current.lista)).toEqual(faixa(0).map(registro=>registro.id));
  await act(async()=>{await f.result.current.carregarMais();await f.result.current.carregarMais();});
  expect(f.consultar).toHaveBeenCalledTimes(2);
 });

 it('cancela e limpa a lista ao revogar o acesso, ignorando a resposta pendente',async()=>{
  const f=fixture();await f.responder(0,pagina(0,faixa(0),true));f.mais();const pendente=await f.pedido(1);
  f.rerender({...f.opcoes,ativa:false});expect(pendente.argumentos[4]?.aborted).toBe(true);
  expect(f.result.current.lista).toBeNull();expect(f.result.current.carregando).toBe(false);expect(f.result.current.carregandoMais).toBe(false);
  await f.responder(1,pagina(1,faixa(30),true));
  await act(async()=>{await f.result.current.carregarMais();f.result.current.repetir();});
  expect(f.result.current.lista).toBeNull();expect(f.consultar).toHaveBeenCalledTimes(2);expect(f.falhar).not.toHaveBeenCalled();
  f.rerender(f.opcoes);await f.responder(2,pagina(0,faixa(200,2),false));
  expect(f.pedidos[2].argumentos[3]).toBe(0);expect(ids(f.result.current.lista)).toEqual(faixa(200,2).map(registro=>registro.id));
 });

 it('não consulta dados antes de existir acesso e cancela a consulta ao desmontar',async()=>{
  const f=fixture({ativa:false});expect(f.consultar).not.toHaveBeenCalled();
  f.rerender({...f.opcoes,ativa:true});const pendente=await f.pedido(0);f.unmount();
  expect(pendente.argumentos[4]?.aborted).toBe(true);
  await f.recusar(0,new Error('Resposta fictícia após desmontagem'));expect(f.falhar).not.toHaveBeenCalled();
 });
});
