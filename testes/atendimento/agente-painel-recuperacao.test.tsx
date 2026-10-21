// @vitest-environment jsdom
import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import PainelAgenteDonatella from '../../apps/atendimento-chat-consulta/AgenteDonatella';
import {criarClienteOperacao,type PermissaoOperacao} from '../../apps/atendimento-chat-consulta/operacao-api';

const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json'}});
type Falhas={perderResposta?:boolean;semRegistro?:boolean;consultaIndisponivel?:boolean;leituraIndisponivel?:boolean;falharLeituraAposComando?:boolean;opcoesIndisponiveis?:boolean};
function fixture(falhas:Falhas={},usuario='ficticio',ambiente:'operacao'|'ensaio'='ensaio',permissoes:PermissaoOperacao[]=['consultar','ia.visualizar','ia.editar']){
 let ligada=false,versao=4,modelo='claude-ficticio';const recibos=new Map<string,{versao:number;pedido:string}>();
 const buscar=vi.fn<typeof fetch>(async(u,o)=>{
  const p=new URL(String(u),'https://ensaio.invalid').pathname.replace('/api/atendimento/operacao','');
  if(p==='/sessao')return json({usuario:{id:usuario,nome:'Pessoa fictícia',perfilId:'ficticio',permissoes},csrf:'csrf-ficticio',modo:'homologacao',escritasReais:false});
  if(p==='/agente'){if(falhas.leituraIndisponivel)return json({},503);return json({provedor:'anthropic',modelo,modo:ligada?'automatico':'desligado',maxTokens:500,equipeApoio:'equipe',limites:{maxChamadas:2,custoPorChamadaCentavos:3,maxCustoCentavos:6,maxDuracaoMs:10000,timeoutChamadaMs:5000},custoCentavosDia:500,autoridadeAutomatica:ligada,grupoExterno:'indisponivel',versao,moedaOrcamento:'USD',inferenciaHabilitada:true,credenciais:{anthropic:true,woo:false,voz:false},enviosReais:false,prontoParaLigar:true,pendencias:[],estadoEfetivo:ligada?'ligada':'desligada',enviosHumanosHabilitados:true,controle:{habilitada:ligada,ativadaEm:ligada?'2026-10-19T18:00:00Z':null},teste:{disponivel:false,pendencias:['Teste pago não executado nesta prova.'],limiteTotalCentavos:1000,reservadoCentavos:0}});}
  if(p==='/agente/opcoes')return falhas.opcoesIndisponiveis?json({},503):json({principal:'anthropic',provedores:[{id:'anthropic',nome:'Anthropic',configurado:true,disponivel:true,testado:true,modelos:[{id:'claude-ficticio',nome:'Claude fictício',disponivel:true,testado:true},{id:'claude-outro',nome:'Outro modelo',disponivel:true,testado:true}]}]});
  if(p==='/agente/configurar'||p==='/agente/controle'){
   const d=JSON.parse(String(o?.body));if(falhas.semRegistro){falhas.semRegistro=false;throw new TypeError('Rede fictícia interrompida antes da gravação');}
   const anterior=recibos.get(d.idempotencia);if(!anterior){if(p.endsWith('/configurar'))modelo=d.conteudo.modelo;else ligada=d.acao==='ligar';recibos.set(d.idempotencia,{versao:++versao,pedido:JSON.stringify(d)});}
   if(falhas.falharLeituraAposComando)falhas.leituraIndisponivel=true;
   if(falhas.perderResposta){falhas.perderResposta=false;throw new TypeError('Resposta fictícia perdida após gravação');}
   return json({versao:recibos.get(d.idempotencia)!.versao});
  }
  if(p==='/agente/reconciliar'){
   if(falhas.consultaIndisponivel)return json({},503);const d=JSON.parse(String(o?.body)),r=recibos.get(d.pedido.idempotencia);return json(r&&r.pedido===JSON.stringify(d.pedido)?{estado:'confirmada',versao:r.versao}:{estado:'nao_registrada',versao:null});
  }
  throw Error('Endpoint fictício não preparado: '+p);
 });
 const cliente=criarClienteOperacao(buscar,ambiente),avisar=vi.fn(),falhar=vi.fn(),alteracoes=vi.fn();
 return {buscar,cliente,avisar,alteracoes,falhas,async montar(){const sessao=await cliente.sessao(),vista=render(<PainelAgenteDonatella cliente={cliente} sessao={sessao} falhar={falhar} avisar={avisar} alteracoes={alteracoes}/>);await screen.findByRole('combobox',{name:'Modelo da agente'});return vista;},estado:()=>({ligada,versao,modelo})};
}
async function editarModelo(){fireEvent.click(screen.getByRole('combobox',{name:'Modelo da agente'}));const o=await screen.findByRole('option',{name:'Outro modelo'});fireEvent.pointerDown(o,{pointerType:'mouse'});fireEvent.click(o);}
const escritas=(f:ReturnType<typeof fixture>,caminho:string)=>f.buscar.mock.calls.filter(([u])=>String(u).endsWith(caminho));
afterEach(()=>{cleanup();sessionStorage.clear();vi.restoreAllMocks();});

it('confirma Salvar após perda da resposta sem repetir o comando nem ligar a IA',async()=>{
 const f=fixture({perderResposta:true});await f.montar();await editarModelo();fireEvent.click(screen.getByRole('button',{name:'Salvar configurações'}));
 await waitFor(()=>expect(f.avisar).toHaveBeenCalledWith('Configurações salvas. Estado atual da Donatella: desligada.'));expect(escritas(f,'/agente/configurar')).toHaveLength(1);expect(escritas(f,'/agente/controle')).toHaveLength(0);expect(f.estado()).toMatchObject({ligada:false,versao:5,modelo:'claude-outro'});expect(sessionStorage.length).toBe(0);
});
it('mantém recibo confirmado quando a consulta do estado falha e permite apenas conferir',async()=>{
 const f=fixture({falharLeituraAposComando:true});await f.montar();await editarModelo();fireEvent.click(screen.getByRole('button',{name:'Salvar configurações'}));
 expect(await screen.findByText(/A operação foi confirmada no servidor/)).toBeTruthy();expect(screen.getByRole('button',{name:'Salvar configurações'})).toHaveProperty('disabled',true);expect(screen.getByRole('button',{name:'Ligar Donatella'})).toHaveProperty('disabled',true);expect(screen.queryByRole('button',{name:'Tentar a mesma solicitação'})).toBeNull();expect(escritas(f,'/agente/configurar')).toHaveLength(1);
 f.falhas.leituraIndisponivel=false;fireEvent.click(screen.getByRole('button',{name:'Conferir solicitação'}));await waitFor(()=>expect(f.avisar).toHaveBeenCalled());expect(escritas(f,'/agente/configurar')).toHaveLength(1);expect(sessionStorage.length).toBe(0);
});
it('preserva a tentativa incerta ao atualizar a tela e reconcilia sem novo envio',async()=>{
 const f=fixture({perderResposta:true,consultaIndisponivel:true});const vista=await f.montar();await editarModelo();fireEvent.click(screen.getByRole('button',{name:'Salvar configurações'}));
 await screen.findByText(/Ainda não foi possível conferir esta solicitação/);expect(f.alteracoes).toHaveBeenCalledWith('agente',true);const original=JSON.parse(String(escritas(f,'/agente/configurar')[0][1]?.body)),persistido=sessionStorage.getItem('atendimento:agente:pedido:ensaio:ficticio')!;expect(persistido).toContain(original.idempotencia);expect(persistido).not.toContain('csrf-ficticio');
 vista.unmount();f.falhas.consultaIndisponivel=false;await f.montar();await waitFor(()=>expect(f.avisar).toHaveBeenCalled());expect(escritas(f,'/agente/configurar')).toHaveLength(1);expect(sessionStorage.length).toBe(0);
});
it('só permite repetir após ausência confirmada, com payload e UUID originais',async()=>{
 const f=fixture({semRegistro:true});await f.montar();await editarModelo();fireEvent.click(screen.getByRole('button',{name:'Salvar configurações'}));const repetir=await screen.findByRole('button',{name:'Tentar a mesma solicitação'});expect(f.estado().versao).toBe(4);fireEvent.click(repetir);await waitFor(()=>expect(f.avisar).toHaveBeenCalled());const tentativas=escritas(f,'/agente/configurar');expect(tentativas).toHaveLength(2);expect(tentativas[0][1]?.body).toBe(tentativas[1][1]?.body);expect(f.estado().versao).toBe(5);
});
it('consulta antiga atrasada não substitui a versão reconciliada após atualizar a página',async()=>{
 const f=fixture({perderResposta:true,consultaIndisponivel:true});const vista=await f.montar();await editarModelo();fireEvent.click(screen.getByRole('button',{name:'Salvar configurações'}));await screen.findByText(/Ainda não foi possível conferir esta solicitação/);vista.unmount();f.falhas.consultaIndisponivel=false;
 const original=f.buscar.getMockImplementation()!;let primeira=true,liberar:(()=>void)|undefined;
 f.buscar.mockImplementation(async(u,o)=>{const resposta=await original(u,o);if(primeira&&String(u).endsWith('/agente')){primeira=false;const antiga=await resposta.json();return await new Promise<Response>(resolve=>{liberar=()=>resolve(json({...antiga,modelo:'claude-ficticio',versao:4}));});}return resposta;});
 await f.montar();await waitFor(()=>expect(f.avisar).toHaveBeenCalled());expect(screen.getByRole('combobox',{name:'Modelo da agente'}).textContent).toContain('Outro modelo');await act(async()=>liberar!());expect(screen.getByRole('combobox',{name:'Modelo da agente'}).textContent).toContain('Outro modelo');expect(escritas(f,'/agente/configurar')).toHaveLength(1);
});
it('reconcilia Ligar e Pausar após resposta perdida e recarrega estado efetivo',async()=>{
 const f=fixture({perderResposta:true});await f.montar();fireEvent.click(screen.getByRole('button',{name:'Ligar Donatella'}));fireEvent.click(await screen.findByRole('button',{name:'Confirmar e ligar Donatella'}));const pausar=await screen.findByRole('button',{name:'Pausar Donatella'});await waitFor(()=>expect(pausar).toHaveProperty('disabled',false));expect(f.estado().ligada).toBe(true);
 f.falhas.perderResposta=true;fireEvent.click(pausar);await waitFor(()=>expect(screen.getByRole('button',{name:'Ligar Donatella'})).toHaveProperty('disabled',false));expect(f.estado().ligada).toBe(false);expect(escritas(f,'/agente/controle')).toHaveLength(2);expect(escritas(f,'/agente/reconciliar')).toHaveLength(2);
 fireEvent.click(screen.getByRole('button',{name:'Atualizar configuração da agente'}));await waitFor(()=>expect(screen.getAllByText('Desligada').length).toBeGreaterThan(0));
});
it('falha nas opções não oculta estado automático nem confunde envios humanos',async()=>{
 const f=fixture({opcoesIndisponiveis:true});await f.montar();expect(await screen.findByRole('button',{name:'Ligar Donatella'})).toBeTruthy();expect(screen.getAllByText('Desligada').length).toBeGreaterThan(0);expect(screen.getByText(/envios habilitados/)).toBeTruthy();expect(screen.getByText(/Não foi possível conferir os modelos/)).toBeTruthy();
});
it('não recupera pedido de outro usuário ou de outro ambiente nem permite editar sem permissão',async()=>{
 sessionStorage.setItem('atendimento:agente:pedido:ensaio:outra-pessoa',JSON.stringify({comando:{tipo:'controle',pedido:{acao:'ligar',versao:4,idempotencia:crypto.randomUUID()}},situacao:'incerta',versao:null}));sessionStorage.setItem('atendimento:agente:pedido:operacao:ficticio',sessionStorage.getItem('atendimento:agente:pedido:ensaio:outra-pessoa')!);
 const f=fixture({},'ficticio','ensaio',['consultar','ia.visualizar']);await f.montar();expect(screen.getByRole('button',{name:'Ligar Donatella'})).toHaveProperty('disabled',true);expect(screen.getByRole('button',{name:'Salvar configurações'})).toHaveProperty('disabled',true);expect(escritas(f,'/agente/reconciliar')).toHaveLength(0);expect(escritas(f,'/agente/controle')).toHaveLength(0);
});
it('recusa alteração por Salvar com orientação explícita, sem tratar rejeição como confirmação perdida',async()=>{
 const buscar=vi.fn<typeof fetch>(async(u)=>String(u).endsWith('/sessao')?json({usuario:{id:'ficticio',nome:'Fictício',perfilId:'ficticio',permissoes:['consultar']},csrf:'csrf-ficticio',modo:'homologacao',escritasReais:false}):json({erro:'AGENTE_USE_CONTROLE_LIGAR_PAUSAR'},409));const cliente=criarClienteOperacao(buscar,'ensaio');await cliente.sessao();await expect(cliente.controlarAgente({acao:'ligar',versao:4,idempotencia:crypto.randomUUID()})).rejects.toMatchObject({codigo:'AGENTE_CONTROLE',status:409});
});
