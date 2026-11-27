// @vitest-environment jsdom
import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import PromptCentralDonatella from '../../apps/atendimento-chat-consulta/PromptCentral';
import {criarClienteOperacao,type PermissaoOperacao,type SessaoOperacao} from '../../apps/atendimento-chat-consulta/operacao-api';
const json=(d:unknown,status=200)=>new Response(JSON.stringify(d),{status,headers:{'Content-Type':'application/json'}});
afterEach(()=>{cleanup();});

async function abrir(permissoes:PermissaoOperacao[],inicial={versao:0,texto:''}){
 const enviados:{caminho:string;corpo:Record<string,unknown>}[]=[];let prompt={...inicial};
 const buscar=vi.fn<typeof fetch>(async(u,o)=>{const p=new URL(String(u),'https://ensaio.invalid').pathname.replace('/api/atendimento/operacao','');
  if(p==='/sessao')return json({usuario:{id:'ficticio',nome:'Pessoa fictícia',perfilId:'ficticio',permissoes},csrf:'csrf-ficticio',modo:'homologacao',escritasReais:false});
  if(p==='/agente/prompt')return json(prompt);
  if(p==='/agente/prompt/configurar'){const d=JSON.parse(String(o?.body)) as Record<string,unknown>;enviados.push({caminho:p,corpo:d});prompt={versao:prompt.versao+1,texto:String(d.texto).trim()};return json({versao:prompt.versao});}
  throw Error('Endpoint de ensaio inexistente: '+p);
 });
 const cliente=criarClienteOperacao(buscar,'ensaio'),falhar=vi.fn(),avisar=vi.fn(),sessao=await cliente.sessao() as SessaoOperacao;
 render(<PromptCentralDonatella cliente={cliente} sessao={sessao} falhar={falhar} avisar={avisar}/>);
 return {enviados,falhar,avisar,campo:await screen.findByLabelText('Texto do prompt central') as HTMLTextAreaElement};
}

it('salva o prompt central com a versão lida e avisa que as próximas respostas já usam o texto',async()=>{
 const f=await abrir(['ia.visualizar','ia.editar']);
 expect(screen.getByText(/Ainda não salvo\./)).toBeTruthy();
 expect(screen.getByText('Sem prompt central, a Donatella responde só com as regras fixas, as skills e o tom de voz.')).toBeTruthy();
 const salvar=screen.getByRole('button',{name:'Salvar prompt central'}) as HTMLButtonElement;expect(salvar.disabled).toBe(true);
 fireEvent.change(f.campo,{target:{value:'Você é a Donatella da loja de exemplo.\nOriente sempre o pedido pelo site.'}});
 expect(salvar.disabled).toBe(false);fireEvent.click(salvar);
 await waitFor(()=>expect(f.avisar).toHaveBeenCalledWith(expect.stringContaining('Prompt central salvo (versão 1).')));
 expect(f.enviados).toEqual([{caminho:'/agente/prompt/configurar',corpo:{texto:'Você é a Donatella da loja de exemplo.\nOriente sempre o pedido pelo site.',versao:0,idempotencia:expect.any(String)}}]);
 expect(await screen.findByText(/Versão 1 salva\./)).toBeTruthy();
 expect(f.falhar).not.toHaveBeenCalled();
});

it('não deixa salvar telefone, e-mail ou CPF e permite descartar',async()=>{
 const f=await abrir(['ia.visualizar','ia.editar'],{versao:2,texto:'Base salva.'});
 fireEvent.change(f.campo,{target:{value:'Base salva. Fale com contato@exemplo.invalid'}});
 expect(screen.getByText('Tire do texto o telefone, e-mail ou CPF antes de salvar. A Donatella repetiria esse dado a clientes.')).toBeTruthy();
 expect((screen.getByRole('button',{name:'Salvar prompt central'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'Descartar alterações'}));
 expect(f.campo.value).toBe('Base salva.');expect(f.enviados).toHaveLength(0);
});

it('sem permissão de editar, mostra o prompt sem deixar mudar',async()=>{
 const f=await abrir(['ia.visualizar'],{versao:4,texto:'Base salva.'});
 expect(f.campo.disabled).toBe(true);expect(f.campo.value).toBe('Base salva.');
 expect(screen.getByText('Editar exige a permissão de editar a IA no HUB.')).toBeTruthy();
});

it('leitura que falha mostra o motivo e deixa tentar de novo',async()=>{
 let recusar=true;
 const buscar=vi.fn<typeof fetch>(async u=>{const p=new URL(String(u),'https://ensaio.invalid').pathname.replace('/api/atendimento/operacao','');
  if(p==='/sessao')return json({usuario:{id:'ficticio',nome:'Pessoa fictícia',perfilId:'ficticio',permissoes:['ia.visualizar','ia.editar']},csrf:'csrf-ficticio',modo:'homologacao',escritasReais:false});
  if(p==='/agente/prompt'){if(recusar){recusar=false;return json({},503);}return json({versao:3,texto:'Base salva.'});}
  throw Error('Endpoint de ensaio inexistente: '+p);
 });
 const cliente=criarClienteOperacao(buscar,'ensaio'),falhar=vi.fn(),sessao=await cliente.sessao() as SessaoOperacao;
 render(<PromptCentralDonatella cliente={cliente} sessao={sessao} falhar={falhar} avisar={vi.fn()}/>);
 expect(await screen.findByText('Não foi possível ler o prompt central agora.')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Tentar novamente'}));
 expect((await screen.findByLabelText('Texto do prompt central') as HTMLTextAreaElement).value).toBe('Base salva.');
 expect(screen.queryByRole('button',{name:'Tentar novamente'})).toBeNull();
 expect(falhar).toHaveBeenCalledTimes(1);
});
