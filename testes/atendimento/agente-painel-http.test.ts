import {describe,it,expect,vi,beforeEach} from 'vitest';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {ServicoAgenteOperacional,ConfiguracaoPrivadaAgente} from '../../src/lib/atendimento/operacao-agente';
import type {ConfiguracaoAgente} from '../../src/lib/atendimento/repositorio-agente-pg';
vi.mock('server-only',()=>({}));
import {criarExtensaoAgenteOperacional} from '../../src/lib/atendimento/operacao-agente-http';
import {pendenciasPainel} from '../../src/lib/atendimento/operacao-agente-painel';
const identidade={id:'ficticio',nome:'Pessoa Fictícia',perfilId:'fixture',sessaoVersao:1,permissoes:[]};
const controlar=vi.fn(async()=>({modo:'desligado'})),testar=vi.fn(async()=>({enviosReais:false}));
const agente={duvidas:()=>({}),controlar,testar} as unknown as ServicoAgenteOperacional;
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
