import {describe,it,expect,vi,beforeEach} from 'vitest';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {ServicoAgenteOperacional,ConfiguracaoPrivadaAgente} from '../../src/lib/atendimento/operacao-agente';
import type {ConfiguracaoAgente} from '../../src/lib/atendimento/repositorio-agente-pg';
vi.mock('server-only',()=>({}));
import {criarExtensaoAgenteOperacional} from '../../src/lib/atendimento/operacao-agente-http';
import {pendenciasPainel} from '../../src/lib/atendimento/operacao-agente-painel';
import {validarCondicoesEntrega} from '../../src/lib/atendimento/operacao-agente';
const identidade={id:'ficticio',nome:'Pessoa Fictícia',perfilId:'fixture',sessaoVersao:1,permissoes:[]};
const controlar=vi.fn(async()=>({modo:'desligado'})),testar=vi.fn(async()=>({enviosReais:false}));
const cadastrarConhecimento=vi.fn(async()=>({id:'k'})),importarConhecimentos=vi.fn(async()=>({resultados:[]})),entrega=vi.fn(async()=>({versao:3,texto:'',aprovada:false})),configurarEntrega=vi.fn(async()=>({versao:4}));
const agente={duvidas:()=>({cadastrarConhecimento,importarConhecimentos}),controlar,testar,entrega,configurarEntrega} as unknown as ServicoAgenteOperacional;
const extensao=criarExtensaoAgenteOperacional(agente,'grazing');
function resposta(){return {writeHead:vi.fn(),end:vi.fn()} as unknown as ServerResponse;}
const pedido=(path:string,method='POST')=>({url:'/api/atendimento/operacao'+path,method}) as IncomingMessage;
const modelo='claude-sonnet-4-5-20250929';
const configuracao:ConfiguracaoAgente={modo:'desligado',modelo,maxTokens:512,equipeApoio:'apoio',limites:{maxChamadas:3,custoPorChamadaCentavos:50,maxCustoCentavos:150,maxDuracaoMs:45000,timeoutChamadaMs:15000},custoCentavosDia:500,autoridadeAutomatica:false,grupoExterno:'indisponivel'};
const privada:ConfiguracaoPrivadaAgente={empresaId:'grazing',anthropic:{chave:'ficticia',modelo,maxTokens:512},custoVozCentavos:0,orcamentoMaximoCentavosDia:500,autoridadeAutomatica:true,inferenciaHabilitada:true,painelHabilitado:true,consumoOperacaoAutorizado:true,creditoApiConfirmado:true,capacidadesProvedores:[{id:'anthropic',disponivel:true,modelos:[{id:modelo,nome:modelo,disponivel:true,testado:true}]}]};
beforeEach(()=>vi.clearAllMocks());
describe('contrato do painel Donatella',()=>{
 it('encaminha identidade já autenticada e somente os três campos do controle',async()=>{const corpo={acao:'pausar',versao:2,idempotencia:'fixture'},r=resposta();expect(await extensao(pedido('/agente/controle'),r,identidade,corpo)).toBe(true);expect(controlar).toHaveBeenCalledExactlyOnceWith(identidade,corpo);expect(r.writeHead).toHaveBeenCalledWith(200,expect.any(Object));});
 it('teste não recebe identidade de contato, telefone, modelo ou credenciais do navegador',async()=>{for(const extra of ['telefone','contatoId','conversaId','chave','modelo','configuracao'])await expect(extensao(pedido('/agente/testar'),resposta(),identidade,{pergunta:'Ensaio fictício',versao:2,idempotencia:'fixture',[extra]:'proibido'})).rejects.toThrow('OPERACAO_ENTRADA_INVALIDA');expect(testar).not.toHaveBeenCalled();});
 it('teste encaminha apenas pergunta fictícia, versão e idempotência',async()=>{const p={pergunta:'Ensaio fictício',versao:2,idempotencia:'fixture'};await extensao(pedido('/agente/testar'),resposta(),identidade,p);expect(testar).toHaveBeenCalledExactlyOnceWith(identidade,p);});
 it.each(['/agente/controle','/agente/testar'])('GET %s não altera estado nem faz chamada paga',async path=>{const r=resposta();await extensao(pedido(path,'GET'),r,identidade);expect(r.writeHead).toHaveBeenCalledWith(405,expect.any(Object));expect(controlar).not.toHaveBeenCalled();expect(testar).not.toHaveBeenCalled();});
 it('prontidão exige configuração privada, prova de modelo, autorização e crédito',()=>{expect(pendenciasPainel(configuracao,privada,true)).toEqual([]);for(const p of [{...privada,painelHabilitado:false},{...privada,creditoApiConfirmado:false},{...privada,consumoOperacaoAutorizado:false},{...privada,capacidadesProvedores:[]}])expect(pendenciasPainel(configuracao,p,true).length).toBeGreaterThan(0);expect(pendenciasPainel(configuracao,privada,false).length).toBeGreaterThan(0);});
});

describe('rotas de conhecimento e entrega do painel',()=>{
 const fonte={pergunta:'Aceita Pix?',resposta:'Aceitamos Pix fictício.',categoria:'politica',condicoes:'',vigenteDe:'2026-10-01T00:00:00.000Z',vigenteAte:'2027-10-01T00:00:00.000Z',responsavelId:'ficticio'};
 it('cadastro marca a origem no servidor e recusa campos de escopo vindos do navegador',async()=>{
  await extensao(pedido('/conhecimento/cadastrar'),resposta(),identidade,fonte);
  expect(cadastrarConhecimento).toHaveBeenCalledWith({id:'ficticio',empresaId:'grazing',versaoSessao:1},{...fonte,origem:'manual'});
  for(const extra of ['origem','escopo','clienteId','casoId'])await expect(extensao(pedido('/conhecimento/cadastrar'),resposta(),identidade,{...fonte,[extra]:'x'})).rejects.toThrow('OPERACAO_ENTRADA_INVALIDA');
  expect(cadastrarConhecimento).toHaveBeenCalledOnce();
 });
 it('importação encaminha só itens, vigência e responsável',async()=>{
  const corpo={itens:[{pergunta:'A',resposta:'B',categoria:'procedimento'}],vigenteDe:fonte.vigenteDe,vigenteAte:fonte.vigenteAte,responsavelId:'ficticio'};
  await extensao(pedido('/conhecimento/importar'),resposta(),identidade,corpo);
  expect(importarConhecimentos).toHaveBeenCalledWith(expect.any(Object),corpo);
  await expect(extensao(pedido('/conhecimento/importar'),resposta(),identidade,{...corpo,origem:'manual'})).rejects.toThrow('OPERACAO_ENTRADA_INVALIDA');
 });
 it('entrega lê por GET e grava só texto, aprovação, versão e idempotência',async()=>{
  const r=resposta();await extensao(pedido('/agente/entrega','GET'),r,identidade);expect(entrega).toHaveBeenCalledWith(identidade);
  const corpo={texto:'Entregas fictícias todos os dias.',aprovada:true,versao:3,idempotencia:'fixture'};
  await extensao(pedido('/agente/entrega/configurar'),resposta(),identidade,corpo);
  expect(configurarEntrega).toHaveBeenCalledWith(identidade,corpo);
  await expect(extensao(pedido('/agente/entrega/configurar'),resposta(),identidade,{...corpo,chave:'atendimento'})).rejects.toThrow('OPERACAO_ENTRADA_INVALIDA');
  const get=resposta();await extensao(pedido('/agente/entrega/configurar','GET'),get,identidade);expect(get.writeHead).toHaveBeenCalledWith(405,expect.any(Object));
 });
 it('condições de entrega aprovadas precisam de texto e não aceitam contato pessoal',()=>{
  expect(()=>validarCondicoesEntrega({texto:'Entregas fictícias na capital.',aprovada:true})).not.toThrow();
  expect(()=>validarCondicoesEntrega({texto:'',aprovada:false})).not.toThrow();
  expect(()=>validarCondicoesEntrega({texto:'   ',aprovada:true})).toThrow('AGENTE_ENTREGA_INVALIDA');
  expect(()=>validarCondicoesEntrega({texto:'x'.repeat(3001),aprovada:false})).toThrow('AGENTE_ENTREGA_INVALIDA');
  expect(()=>validarCondicoesEntrega({texto:'Texto',aprovada:'sim'})).toThrow('AGENTE_ENTREGA_INVALIDA');
  expect(()=>validarCondicoesEntrega({texto:'Dúvidas: (11) 91234-5678',aprovada:true})).toThrow('AGENTE_ENTREGA_DADOS_PESSOAIS');
 });
});
