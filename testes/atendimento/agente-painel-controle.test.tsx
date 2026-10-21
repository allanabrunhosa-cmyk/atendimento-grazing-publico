// @vitest-environment jsdom
import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import PainelAgenteDonatella from '../../apps/atendimento-chat-consulta/AgenteDonatella';
import {criarClienteOperacao,type PermissaoOperacao,type SessaoOperacao} from '../../apps/atendimento-chat-consulta/operacao-api';
const em='2026-10-19T15:00:00.000Z';
const json=(d:unknown,status=200)=>new Response(JSON.stringify(d),{status,headers:{'Content-Type':'application/json'}});
function fixture(pendencias:string[]=[],permissoes:PermissaoOperacao[]=['consultar','ia.visualizar','ia.editar'],ligadaInicialmente=false){
 let habilitada=ligadaInicialmente,versao=4;const recibos=new Map<string,number>();
 const buscar=vi.fn<typeof fetch>(async(u,o)=>{const p=new URL(String(u),'https://ensaio.invalid').pathname.replace('/api/atendimento/operacao','');
  if(p==='/sessao')return json({usuario:{id:'ficticio',nome:'Pessoa fictícia',perfilId:'ficticio',permissoes},csrf:'csrf-ficticio',modo:'homologacao',escritasReais:false});
  if(p==='/agente')return json({provedor:'anthropic',modelo:'claude-ficticio',modo:habilitada?'automatico':'desligado',maxTokens:500,equipeApoio:'equipe',limites:{maxChamadas:2,custoPorChamadaCentavos:3,maxCustoCentavos:6,maxDuracaoMs:10000,timeoutChamadaMs:5000},custoCentavosDia:500,autoridadeAutomatica:habilitada,grupoExterno:'indisponivel',versao,moedaOrcamento:'USD',inferenciaHabilitada:true,credenciais:{anthropic:true,woo:false,voz:false},enviosReais:false,prontoParaLigar:!pendencias.length,pendencias,estadoEfetivo:habilitada?(pendencias.length?'bloqueada':'ligada'):'desligada',enviosHumanosHabilitados:true,horario:{inicio:'09:00',fim:'18:00',dias:[1,2,3,4,5],timezone:'America/Sao_Paulo',respostaForaHorario:'Nossa equipe continua o atendimento na próxima abertura.'},controle:{habilitada,ativadaEm:habilitada?em:null},consumo:{moeda:'USD',reservaDiaCentavos:12,totalReservadoCentavos:50,limiteDiaCentavos:500,limiteTotalCentavos:1000,reiniciaDiaEm:'2026-10-20T00:00:00.000Z',cobrancaConciliada:false},teste:{disponivel:!pendencias.length,pendencias,limiteTotalCentavos:1000,reservadoCentavos:50},observacao:{total:3,pendentes:1,apoio:1,rascunhos:1,ultima_atividade_em:em}});
  if(p==='/agente/opcoes')return json({principal:'anthropic',provedores:[{id:'anthropic',nome:'Anthropic',configurado:true,disponivel:true,testado:true,modelos:[{id:'claude-ficticio',nome:'Claude fictício',disponivel:true,testado:true},{id:'claude-alternativo',nome:'Claude alternativo',disponivel:true,testado:true}]}]});
  if(p==='/agente/controle'){const d=JSON.parse(String(o?.body));habilitada=d.acao==='ligar';versao++;recibos.set(d.idempotencia,versao);return json({versao,modo:habilitada?'automatico':'desligado',autoridadeAutomatica:habilitada,ativadaEm:habilitada?em:null,tarefasInvalidadas:1,intencoesCanceladas:1});}
  if(p==='/agente/configurar'){const d=JSON.parse(String(o?.body));recibos.set(d.idempotencia,++versao);return json({versao});}
  if(p==='/agente/reconciliar'){const d=JSON.parse(String(o?.body)),r=recibos.get(d.pedido.idempotencia);return json({estado:r?'confirmada':'nao_registrada',versao:r??null});}
  if(p==='/agente/testar')return json({estado:'concluido',texto:'Resposta real do adaptador fictício, sem transporte externo.',fontes:[{id:'fonte_ficticia',versao:2}],provedor:'anthropic',modelo:'claude-ficticio',versao,enviosReais:false,consumo:{observado:true,tokensEntrada:200,tokensSaida:30},reservaCentavos:3});
  throw Error('Endpoint de ensaio inexistente: '+p);
 });
 const cliente=criarClienteOperacao(buscar,'ensaio'),falhar=vi.fn(),avisar=vi.fn();
 return {buscar,cliente,falhar,avisar,async abrir(){const sessao=await cliente.sessao() as SessaoOperacao;render(<PainelAgenteDonatella cliente={cliente} sessao={sessao} falhar={falhar} avisar={avisar}/>);await screen.findByRole('button',{name:'Ligar Donatella'});}};
}
afterEach(()=>{cleanup();sessionStorage.clear();vi.restoreAllMocks();});
it('mantém desligada até confirmação expressa; pausar usa estado e versão confirmados',async()=>{
 const f=fixture();await f.abrir();expect(screen.getAllByText('Desligada').length).toBeGreaterThan(0);
 fireEvent.click(screen.getByRole('button',{name:'Ligar Donatella'}));await screen.findByRole('dialog');
 expect(f.buscar.mock.calls.some(([u])=>String(u).endsWith('/agente/controle'))).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'Cancelar'}));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 fireEvent.click(screen.getByRole('button',{name:'Ligar Donatella'}));fireEvent.click(await screen.findByRole('button',{name:'Confirmar e ligar Donatella'}));
 const pausar=await screen.findByRole('button',{name:'Pausar Donatella'});expect(f.buscar.mock.calls.filter(([u])=>String(u).endsWith('/agente/controle'))).toHaveLength(1);
 expect(JSON.parse(String(f.buscar.mock.calls.find(([u])=>String(u).endsWith('/agente/controle'))?.[1]?.body))).toMatchObject({acao:'ligar',versao:4});
 fireEvent.click(pausar);await screen.findByRole('button',{name:'Ligar Donatella'});
 expect(JSON.parse(String(f.buscar.mock.calls.filter(([u])=>String(u).endsWith('/agente/controle')).at(-1)?.[1]?.body))).toMatchObject({acao:'pausar',versao:5});
 expect(f.buscar.mock.calls.some(([u])=>String(u).includes('/mensagens/envio'))).toBe(false);
});
it('mostra pendência real e bloqueia ativação e teste sem crédito autorizado',async()=>{
 const f=fixture(['Crédito de API não confirmado.']);await f.abrir();expect(screen.getByRole('button',{name:'Ligar Donatella'})).toHaveProperty('disabled',true);expect(screen.getByRole('button',{name:'Testar Donatella'})).toHaveProperty('disabled',true);expect(screen.getAllByText('Crédito de API não confirmado.')).toHaveLength(2);expect(screen.getByText(/Claude Pro e API são produtos separados/)).toBeTruthy();expect(screen.getByText('Cobrança conciliada')).toBeTruthy();expect(screen.getByText('Não disponível')).toBeTruthy();
});
it('teste usa pergunta fictícia, versão, proteção CSRF e idempotência; preserva OFF e não cria envio Meta',async()=>{
 const f=fixture();await f.abrir();fireEvent.change(screen.getByRole('textbox',{name:'Pergunta fictícia'}),{target:{value:'Qual composição existe para presente?'}});fireEvent.click(screen.getByRole('button',{name:'Testar Donatella'}));
 expect(await screen.findByText('Resposta real do adaptador fictício, sem transporte externo.')).toBeTruthy();
 const chamada=f.buscar.mock.calls.find(([u])=>String(u).endsWith('/agente/testar'))!;expect(JSON.parse(String(chamada[1]?.body))).toMatchObject({pergunta:'Qual composição existe para presente?',versao:4});expect(chamada[1]?.headers).toMatchObject({'X-CSRF-Token':'csrf-ficticio','X-Atendimento-Ambiente':'ensaio'});
 expect(screen.getByRole('button',{name:'Ligar Donatella'})).toHaveProperty('disabled',false);fireEvent.click(screen.getByRole('button',{name:'Testar Donatella'}));await waitFor(()=>expect(f.buscar.mock.calls.filter(([u])=>String(u).endsWith('/agente/testar'))).toHaveLength(2));
 const pedidos=f.buscar.mock.calls.filter(([u])=>String(u).endsWith('/agente/testar'));expect(JSON.parse(String(pedidos[0][1]?.body)).idempotencia).toBe(JSON.parse(String(pedidos[1][1]?.body)).idempotencia);expect(f.buscar.mock.calls.some(([u])=>String(u).includes('/mensagens/envio')||String(u).endsWith('/agente/controle'))).toBe(false);
});
it('salvar modelo não altera modo nem autoridade de ativação e exige confirmação explícita',async()=>{
 const f=fixture();await f.abrir();fireEvent.click(screen.getByRole('combobox',{name:'Modelo da agente'}));const opcao=await screen.findByRole('option',{name:'Claude alternativo'});fireEvent.pointerDown(opcao,{pointerType:'mouse'});fireEvent.click(opcao);
 expect(f.buscar.mock.calls.some(([u])=>String(u).endsWith('/agente/configurar'))).toBe(false);expect(screen.getByRole('button',{name:'Ligar Donatella'})).toHaveProperty('disabled',true);fireEvent.click(screen.getByRole('button',{name:'Salvar configurações'}));
 await waitFor(()=>expect(f.buscar.mock.calls.some(([u])=>String(u).endsWith('/agente/configurar'))).toBe(true));const d=JSON.parse(String(f.buscar.mock.calls.find(([u])=>String(u).endsWith('/agente/configurar'))?.[1]?.body));expect(d).toMatchObject({conteudo:{modo:'desligado',autoridadeAutomatica:false,modelo:'claude-alternativo'}});expect(f.buscar.mock.calls.some(([u])=>String(u).endsWith('/agente/controle'))).toBe(false);
});
it('conta somente leitura não pode ligar, testar nem editar modelo',async()=>{
 const f=fixture([],['consultar','ia.visualizar']);await f.abrir();expect(screen.getByRole('button',{name:'Ligar Donatella'})).toHaveProperty('disabled',true);expect(screen.getByRole('button',{name:'Testar Donatella'})).toHaveProperty('disabled',true);expect(screen.getByRole('combobox',{name:'Modelo da agente'})).toHaveProperty('disabled',true);
});
it('oferece pausar quando a agente ligada apresenta uma pendência operacional',async()=>{
 const f=fixture(['Crédito precisa de conferência.'],['consultar','ia.visualizar','ia.editar'],true);const sessao=await f.cliente.sessao();render(<PainelAgenteDonatella cliente={f.cliente} sessao={sessao} falhar={f.falhar} avisar={f.avisar}/>);expect(await screen.findByRole('button',{name:'Pausar Donatella'})).toHaveProperty('disabled',false);expect(screen.queryByRole('button',{name:'Ligar Donatella'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Pausar Donatella'}));await screen.findByRole('button',{name:'Ligar Donatella'});
});
it('preserva resultado incerto sem inventar tokens de consumo',async()=>{
 const buscar=vi.fn<typeof fetch>(async(u)=>String(u).endsWith('/sessao')?json({usuario:{id:'ficticio',nome:'Fictício',perfilId:'ficticio',permissoes:['consultar']},csrf:'csrf-ficticio',modo:'homologacao',escritasReais:false}):json({estado:'incerto',texto:'Não foi possível confirmar a resposta.',provedor:'anthropic',modelo:'claude-ficticio',versao:1,fontes:[],enviosReais:false,reservaCentavos:3,consumo:{observado:false}}));const cliente=criarClienteOperacao(buscar,'ensaio');await cliente.sessao();await expect(cliente.testarAgente({pergunta:'Pergunta fictícia',versao:1,idempotencia:crypto.randomUUID()})).resolves.toMatchObject({estado:'incerto',reservaCentavos:3,consumo:{observado:false}});
});
it('rejeita resultado de teste que alegue envio real',async()=>{
 const buscar=vi.fn<typeof fetch>(async(u)=>String(u).endsWith('/sessao')?json({usuario:{id:'ficticio',nome:'Fictício',perfilId:'ficticio',permissoes:['consultar']},csrf:'csrf-ficticio',modo:'homologacao',escritasReais:false}):json({estado:'concluido',enviosReais:true}));const cliente=criarClienteOperacao(buscar,'ensaio');await cliente.sessao();await expect(cliente.testarAgente({pergunta:'Pergunta fictícia',versao:1,idempotencia:crypto.randomUUID()})).rejects.toMatchObject({codigo:'INVALIDO'});
});
