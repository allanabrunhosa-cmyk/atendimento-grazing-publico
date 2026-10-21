// @vitest-environment jsdom
import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import PaineisOperacao from '../../apps/atendimento-chat-consulta/PaineisOperacao';
import {criarClienteOperacao,type SessaoOperacao} from '../../apps/atendimento-chat-consulta/operacao-api';

const em='2026-10-10T14:00:00.000Z';
const sessao:SessaoOperacao={usuario:{id:'usuario-ficticio',nome:'Pessoa de teste',perfilId:'fixture',permissoes:['consultar','automacoes.visualizar','followup.visualizar','followup.editar']},csrf:'fixture',modo:'homologacao',escritasReais:false};
const json=(v:unknown)=>new Response(JSON.stringify(v),{headers:{'content-type':'application/json'}});
function fixture(){
 let pendentes=2;
 const configuracao={habilitado:false,minutos:60,texto:'Acompanhamento fictício'};
 const buscar=vi.fn<typeof fetch>(async(entrada,o)=>{
  const p=new URL(String(entrada),'https://fixture.invalid').pathname.replace('/api/atendimento/operacao','');
  if(p==='/sessao')return json(sessao);
  if(p==='/status')return json({modo:'homologacao',enviosReais:false,receptor:'desarmado',fila:{pendentes:0,incertos:0,falhas:0},backup:{ultimoSucessoEm:null,falha:null},agente:{modo:'desligado',modelo:'fixture',disponivel:false},woocommerce:{habilitado:false,enviosLiberados:false,regras:3,pendentes,enfileiradas:4,canceladas:1,ultimaRecepcao:em},atualizadoEm:em,importadoEm:em});
  if(p==='/agente/followup')return json({configuracao,versao:3,origem:'local'});
  if(p==='/agente/followup/configurar'&&o?.method==='POST')return json({versao:4});
  if(p==='/configuracao')return json({versao:1,agente:{modo:'desligado',modelo:'fixture'},horarios:{inicio:'09:00',fim:'18:00',dias:[1,2,3,4,5]},automacoes:false,enviosReais:false});
  if(p==='/agente')return json({modo:'desligado',modelo:'fixture',maxTokens:512,equipeApoio:'fixture',limites:{maxChamadas:2,custoPorChamadaCentavos:2,maxCustoCentavos:4,maxDuracaoMs:10000,timeoutChamadaMs:5000},custoCentavosDia:0,autoridadeAutomatica:false,grupoExterno:'indisponivel',versao:1,credenciais:{anthropic:false,woo:false,voz:false},enviosReais:false});
  throw Error('ENDPOINT_FIXTURE_INEXISTENTE:'+p);
 });
 return {cliente:criarClienteOperacao(buscar),buscar,alterarPendentes:()=>{pendentes=1;}};
}
function montar(permissoes=sessao.usuario.permissoes){const f=fixture(),falhar=vi.fn(),avisar=vi.fn();render(<PaineisOperacao tela="automacoes" cliente={f.cliente} sessao={{...sessao,usuario:{...sessao.usuario,permissoes}}} falhar={falhar} avisar={avisar}/>);return {...f,falhar,avisar};}
afterEach(()=>cleanup());

it('Automações reúne acompanhamento e pedidos sem formulário ou consulta de horários',async()=>{
 const {buscar,falhar}=montar();
 expect(await screen.findByLabelText('Mensagem de acompanhamento')).toBeTruthy();
 const pedidos=await screen.findByRole('region',{name:'Notificações de pedidos'});
 await within(pedidos).findByText('Regras disponíveis: 3. Execução: desligada. Envios: desarmados.');
 expect(screen.queryByLabelText('Início do atendimento')).toBeNull();
 expect(screen.queryByLabelText('Fim do atendimento')).toBeNull();
 expect(screen.queryByText('Dias de atendimento')).toBeNull();
 expect(screen.queryByRole('button',{name:'Salvar configuração'})).toBeNull();
 expect(screen.queryByLabelText('Modo efetivo da Donatella')).toBeNull();
 expect(buscar.mock.calls.some(([u])=>/\/(configuracao|agente)$/.test(String(u)))).toBe(false);
 expect(buscar.mock.calls.every(([,o])=>o?.method==='GET')).toBe(true);
 expect(falhar).not.toHaveBeenCalled();
});
it('acompanhamento mantém salvamento explícito, versão e idempotência sem alterar modo ou horários',async()=>{
 const {cliente,buscar,avisar}=montar();await cliente.sessao();
 const mensagem=await screen.findByLabelText('Mensagem de acompanhamento');
 fireEvent.change(mensagem,{target:{value:'Nova mensagem fictícia'}});fireEvent.blur(mensagem);
 expect(buscar.mock.calls.some(([,o])=>o?.method==='POST'||o?.method==='PUT')).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'Salvar acompanhamento'}));
 await waitFor(()=>expect(avisar).toHaveBeenCalled());
 const escritas=buscar.mock.calls.filter(([,o])=>o?.method==='POST'||o?.method==='PUT');
 expect(escritas).toHaveLength(1);
 expect(String(escritas[0][0])).toMatch(/\/agente\/followup\/configurar$/);
 expect(JSON.parse(String(escritas[0][1]?.body))).toEqual({conteudo:{habilitado:false,minutos:60,texto:'Nova mensagem fictícia'},versao:3,idempotencia:expect.any(String)});
});
it('reconferir notificações não salva nem descarta uma edição do acompanhamento',async()=>{
 const {buscar,alterarPendentes}=montar();
 const intervalo=await screen.findByLabelText('Intervalo em minutos'),painel=await screen.findByRole('region',{name:'Notificações de pedidos'});
 await within(painel).findByText(/Pendências de execução: 2/);
 fireEvent.change(intervalo,{target:{value:'75'}});alterarPendentes();
 fireEvent.click(within(painel).getByRole('button',{name:'Atualizar notificações de pedidos'}));
 await within(painel).findByText(/Pendências de execução: 1/);
 expect(intervalo).toHaveProperty('value','75');
 expect(screen.getByRole('button',{name:'Salvar acompanhamento'})).toHaveProperty('disabled',false);
 expect(buscar.mock.calls.every(([,o])=>o?.method==='GET')).toBe(true);
});
it('o acompanhamento conserva limites numéricos e permissão de configuração',async()=>{
 const {buscar}=montar(['consultar','followup.visualizar']);
 const intervalo=await screen.findByLabelText('Intervalo em minutos');
 fireEvent.change(intervalo,{target:{value:'75'}});
 expect(screen.getByRole('button',{name:'Salvar acompanhamento'})).toHaveProperty('disabled',true);
 fireEvent.change(intervalo,{target:{value:'4'}});
 expect(screen.getByRole('button',{name:'Salvar acompanhamento'})).toHaveProperty('disabled',true);
 expect(buscar.mock.calls.every(([,o])=>o?.method==='GET')).toBe(true);
});
