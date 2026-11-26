// @vitest-environment jsdom
import React from 'react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import SeletorModeloAgente,{nomeModelo} from '../../apps/atendimento-chat-consulta/SeletorModeloAgente';
import type {OpcoesAgenteOperacao} from '../../apps/atendimento-chat-consulta/operacao-api';

const opcoes:OpcoesAgenteOperacao={principal:'anthropic',provedores:[
 {id:'anthropic',nome:'Anthropic',configurado:true,disponivel:true,testado:false,modelos:[
  {id:'claude-sonnet-4-5-20250929',nome:'claude-sonnet-4-5-20250929',disponivel:true,testado:false},
  {id:'claude-sonnet-5-5',nome:'claude-sonnet-5-5',disponivel:true,testado:false},
  {id:'claude-haiku-5-5',nome:'claude-haiku-5-5',disponivel:true,testado:false},
  {id:'claude-opus-5-5',nome:'claude-opus-5-5',disponivel:false,testado:false},
 ]},
 {id:'google',nome:'Google',configurado:false,disponivel:false,testado:false,modelos:[]},
 {id:'openai',nome:'OpenAI',configurado:false,disponivel:false,testado:false,modelos:[{id:'gpt-exemplo',nome:'GPT de exemplo',disponivel:false,testado:false}]},
]};
const salvo={provedor:'anthropic' as const,modelo:'claude-sonnet-4-5-20250929'};
function montar(disabled=false,modelo='claude-sonnet-4-5-20250929',esforco?:'baixo'|'medio'|'alto'){
 const onChange=vi.fn(),onEsforco=vi.fn();
 render(<SeletorModeloAgente opcoes={opcoes} provedor="anthropic" modelo={modelo} salvo={salvo} esforco={esforco} disabled={disabled} onChange={onChange} onEsforco={onEsforco}/>);
 return {onChange,onEsforco,gatilho:screen.getByRole('button',{name:'Provedor e modelo da agente'})};
}
afterEach(cleanup);

describe('nome dos modelos',()=>{
 it('deixa legível o identificador da Anthropic e respeita o nome vindo do servidor',()=>{
  expect(nomeModelo('claude-sonnet-4-5-20250929')).toBe('Claude Sonnet 4.5');
  expect(nomeModelo('claude-haiku-5-5')).toBe('Claude Haiku 5.5');
  expect(nomeModelo('claude-opus-5')).toBe('Claude Opus 5');
  expect(nomeModelo('claude-sonnet-5-5','Sonnet escolhido no servidor')).toBe('Sonnet escolhido no servidor');
  expect(nomeModelo('gpt-exemplo')).toBe('gpt-exemplo');
 });
});

describe('seletor de provedor e modelo',()=>{
 it('mostra o modelo atual no botão e lista os modelos do provedor, com o salvo e a data de desligamento',async()=>{
  const {gatilho}=montar();
  expect(gatilho.textContent).toContain('Claude Sonnet 4.5');expect(gatilho.textContent).toContain('Anthropic · configurado');
  fireEvent.click(gatilho);
  const atual=await screen.findByRole('radio',{name:'Claude Sonnet 4.5, em uso, desligado pelo provedor em 30/11/2026'});
  expect(atual.getAttribute('aria-checked')).toBe('true');
  expect(screen.getByRole('radio',{name:'Claude Sonnet 5.5'}).getAttribute('aria-checked')).toBe('false');
  expect(screen.getByRole('radio',{name:'Claude Opus 5.5'})).toHaveProperty('disabled',true);
  expect(screen.getByText('indisponível')).toBeTruthy();
  expect(screen.getByRole('button',{name:'Claude'}).getAttribute('aria-pressed')).toBe('true');
 });
 it('escolher um modelo devolve provedor e modelo e fecha a lista',async()=>{
  const {gatilho,onChange}=montar();fireEvent.click(gatilho);
  fireEvent.click(await screen.findByRole('radio',{name:'Claude Haiku 5.5'}));
  expect(onChange).toHaveBeenCalledExactlyOnceWith('anthropic','claude-haiku-5-5');
  expect(screen.queryByRole('radiogroup')).toBeNull();
 });
 it('a busca filtra por nome ou identificador, sem diferenciar acento e maiúscula',async()=>{
  const {gatilho}=montar();fireEvent.click(gatilho);
  const busca=await screen.findByRole('searchbox',{name:'Buscar modelos'});
  fireEvent.change(busca,{target:{value:'HAIKU'}});
  expect(screen.getAllByRole('radio').map(r=>r.getAttribute('aria-label'))).toEqual(['Claude Haiku 5.5']);
  fireEvent.change(busca,{target:{value:'sonnet-5'}});
  expect(screen.getAllByRole('radio').map(r=>r.getAttribute('aria-label'))).toEqual(['Claude Sonnet 5.5']);
  fireEvent.change(busca,{target:{value:'inexistente'}});
  expect(screen.queryByRole('radio')).toBeNull();expect(screen.getByText('Nenhum modelo com esse nome.')).toBeTruthy();
 });
 it('provedor sem chave mostra os modelos bloqueados e não deixa escolher',async()=>{
  const {gatilho,onChange}=montar();fireEvent.click(gatilho);
  fireEvent.click(await screen.findByRole('button',{name:'OpenAI'}));
  const gpt=screen.getByRole('radio',{name:'GPT de exemplo'});expect(gpt).toHaveProperty('disabled',true);
  fireEvent.click(gpt);expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByText(/Sem chave no servidor/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Gemini'}));
  expect(screen.queryByRole('radio')).toBeNull();expect(screen.getByText(/Nenhum modelo registrado/)).toBeTruthy();
  expect(screen.queryByRole('searchbox')).toBeNull();
 });
 it('adicionar provedor só explica que a chave é cadastrada no servidor',async()=>{
  const {gatilho}=montar();fireEvent.click(gatilho);
  fireEvent.click(await screen.findByRole('button',{name:'Adicionar provedor'}));
  expect(screen.getByText(/Nenhuma chave passa por esta tela/)).toBeTruthy();
  expect(screen.queryByRole('textbox')).toBeNull();expect(screen.queryByRole('searchbox')).toBeNull();
 });
 it('esforço aparece só nos modelos que aceitam, com o padrão do modelo marcado',async()=>{
  const sonnet=montar(false,'claude-sonnet-5-5');
  expect(sonnet.gatilho.textContent).toContain('esforço alto');
  fireEvent.click(sonnet.gatilho);
  const grupo=await screen.findByRole('radiogroup',{name:'Esforço'});
  expect(grupo.querySelector('[aria-checked=true]')?.textContent).toBe('Alto');
  fireEvent.click(screen.getByRole('radio',{name:'Médio'}));
  expect(sonnet.onEsforco).toHaveBeenCalledExactlyOnceWith('medio');
  expect(screen.getByRole('radiogroup',{name:'Modelos Claude'})).toBeTruthy();
  cleanup();
  const haiku=montar(false,'claude-haiku-5-5','baixo');expect(haiku.gatilho.textContent).toContain('esforço baixo');
  cleanup();
  const antigo=montar();expect(antigo.gatilho.textContent).not.toContain('esforço');
  fireEvent.click(antigo.gatilho);
  expect(await screen.findByText('Sem ajuste no Claude Sonnet 4.5')).toBeTruthy();
  expect(screen.queryByRole('radiogroup',{name:'Esforço'})).toBeNull();
 });
 it('sem permissão o botão fica desligado',()=>{
  expect(montar(true).gatilho).toHaveProperty('disabled',true);
 });
});
