// @vitest-environment jsdom
import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import ConhecimentoOperacional from '../../apps/atendimento-chat-consulta/ConhecimentoOperacional';
import CondicoesEntregaDonatella from '../../apps/atendimento-chat-consulta/CondicoesEntrega';
import {criarClienteOperacao,type PermissaoOperacao,type SessaoOperacao} from '../../apps/atendimento-chat-consulta/operacao-api';
const json=(d:unknown,status=200)=>new Response(JSON.stringify(d),{status,headers:{'Content-Type':'application/json'}});
afterEach(()=>{cleanup();});

function fixture(permissoes:PermissaoOperacao[]){
 const enviados:{caminho:string;corpo:Record<string,unknown>}[]=[];let entrega={versao:3,texto:'',aprovada:false};
 const buscar=vi.fn<typeof fetch>(async(u,o)=>{const p=new URL(String(u),'https://ensaio.invalid').pathname.replace('/api/atendimento/operacao','');
  const corpo=()=>{const d=JSON.parse(String(o?.body)) as Record<string,unknown>;enviados.push({caminho:p,corpo:d});return d;};
  if(p==='/sessao')return json({usuario:{id:'ficticio',nome:'Pessoa fictícia',perfilId:'ficticio',permissoes},csrf:'csrf-ficticio',modo:'homologacao',escritasReais:false});
  if(p==='/conhecimento')return json({candidatos:[]});
  if(p==='/conhecimento/cadastrar'){corpo();return json({id:'fonte-ficticia'});}
  if(p==='/conhecimento/importar'){const d=corpo(),itens=d.itens as unknown[];return json({resultados:itens.map((_,indice)=>indice===1?{indice,estado:'recusado',codigo:'CONHECIMENTO_DADOS_PESSOAIS'}:{indice,estado:'criado'})});}
  if(p==='/agente/entrega')return json(entrega);
  if(p==='/agente/entrega/configurar'){const d=corpo();entrega={versao:entrega.versao+1,texto:String(d.texto),aprovada:d.aprovada===true};return json({versao:entrega.versao});}
  throw Error('Endpoint de ensaio inexistente: '+p);
 });
 const cliente=criarClienteOperacao(buscar,'ensaio'),falhar=vi.fn(),avisar=vi.fn();
 return {enviados,falhar,avisar,
  async conhecimento(){const sessao=await cliente.sessao() as SessaoOperacao;render(<ConhecimentoOperacional cliente={cliente} sessao={sessao} falhar={falhar} avisar={avisar}/>);await screen.findByText('Nenhuma fonte ou proposta disponível.');},
  async entrega(){const sessao=await cliente.sessao() as SessaoOperacao;render(<CondicoesEntregaDonatella cliente={cliente} sessao={sessao} falhar={falhar} avisar={avisar}/>);return screen.findByLabelText('Texto das condições');}};
}

it('registra uma fonte nova como pendente, com responsável da sessão',async()=>{
 const f=fixture(['consultar','conhecimento.visualizar','conhecimento.adicionar']);await f.conhecimento();
 const registrar=screen.getByRole('button',{name:'Registrar como pendente'});expect((registrar as HTMLButtonElement).disabled).toBe(true);
 fireEvent.change(screen.getByLabelText('Pergunta do cliente'),{target:{value:'Vocês aceitam Pix?'}});
 fireEvent.change(screen.getByLabelText('Resposta aprovada'),{target:{value:'Aceitamos Pix na loja fictícia.'}});
 fireEvent.click(registrar);
 await waitFor(()=>expect(f.avisar).toHaveBeenCalledWith('Fonte registrada como pendente. Ela só orienta a Donatella depois de aprovada.'));
 expect(f.enviados).toHaveLength(1);
 expect(f.enviados[0]).toMatchObject({caminho:'/conhecimento/cadastrar',corpo:{pergunta:'Vocês aceitam Pix?',resposta:'Aceitamos Pix na loja fictícia.',categoria:'procedimento',condicoes:'',responsavelId:'ficticio'}});
 expect(Object.keys(f.enviados[0].corpo).sort()).toEqual(['categoria','condicoes','pergunta','responsavelId','resposta','vigenteAte','vigenteDe']);
 expect(f.falhar).not.toHaveBeenCalled();
});

it('importa em lotes e mostra quais fontes foram recusadas e por quê',async()=>{
 const f=fixture(['consultar','conhecimento.visualizar','conhecimento.adicionar']);await f.conhecimento();
 const fontes=Array.from({length:30},(_,n)=>({pergunta:'Pergunta fictícia '+(n+1),resposta:'Resposta fictícia '+(n+1),categoria:'procedimento',rascunho:true}));
 fireEvent.change(screen.getByLabelText('Conteúdo'),{target:{value:JSON.stringify(fontes)}});
 expect(await screen.findByText('30 fontes prontas para importar.')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Importar como pendentes'}));
 expect(await screen.findByText('Importação concluída: 28 novas, 0 já existiam e 2 recusadas.')).toBeTruthy();
 expect(f.enviados.map(e=>(e.corpo.itens as unknown[]).length)).toEqual([25,5]);
 expect(f.enviados.every(e=>(e.corpo.itens as Record<string,unknown>[]).every(i=>!('rascunho' in i)))).toBe(true);
 expect(screen.getByText('Fonte 2 (Pergunta fictícia 2): tem telefone, e-mail ou CPF.')).toBeTruthy();
 expect(screen.getByText('Fonte 27 (Pergunta fictícia 27): tem telefone, e-mail ou CPF.')).toBeTruthy();
});

it('sem permissão de adicionar, o painel não oferece cadastro nem importação',async()=>{
 const f=fixture(['consultar','conhecimento.visualizar']);await f.conhecimento();
 expect(screen.queryByText('Nova fonte')).toBeNull();expect(screen.queryByText('Importar várias fontes')).toBeNull();
});

it('aprova as condições de entrega com a versão lida',async()=>{
 const f=fixture(['consultar','ia.visualizar','ia.editar','configurar']);const campo=await f.entrega();
 fireEvent.change(campo,{target:{value:'Entregas fictícias todos os dias na capital.'}});
 fireEvent.click(screen.getByLabelText('Conferi e aprovo estas condições para a Donatella usar'));
 fireEvent.click(screen.getByRole('button',{name:'Salvar condições'}));
 await waitFor(()=>expect(f.avisar).toHaveBeenCalledWith('Condições de entrega aprovadas. A Donatella usa este texto quando a habilidade Entrega estiver ligada.'));
 expect(f.enviados[0]).toMatchObject({caminho:'/agente/entrega/configurar',corpo:{texto:'Entregas fictícias todos os dias na capital.',aprovada:true,versao:3}});
});

it('sem permissão de editar a IA, as condições de entrega ficam só para leitura',async()=>{
 const f=fixture(['consultar','ia.visualizar']);const campo=await f.entrega();
 expect((campo as HTMLTextAreaElement).disabled).toBe(true);
 expect(screen.getByText('Editar exige as permissões de editar a IA e de configurar o atendimento no HUB.')).toBeTruthy();
});
