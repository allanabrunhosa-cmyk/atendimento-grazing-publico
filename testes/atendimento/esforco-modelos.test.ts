import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {responderIADireta,type PedidoIADireta} from '../../src/lib/atendimento/ia-direta';
import {validarConfiguracaoAgente,type ConfiguracaoAgente} from '../../src/lib/atendimento/repositorio-agente-pg';
import {configuracaoAgenteParaCorte} from '../../src/lib/atendimento/operacao-agente-corte';
import {aceitaEsforcoIA} from '../../src/lib/atendimento/ia-modelos';

const config:ConfiguracaoAgente={modo:'rascunho',modelo:'claude-sonnet-5-5',maxTokens:512,equipeApoio:'apoio',limites:{maxChamadas:3,custoPorChamadaCentavos:1,maxCustoCentavos:10,maxDuracaoMs:10000,timeoutChamadaMs:2000},custoCentavosDia:100,autoridadeAutomatica:false,grupoExterno:'indisponivel'};
const pedido=(modelo:string,extra:Partial<PedidoIADireta>={}):PedidoIADireta=>({provedor:'anthropic',chave:'credencial-somente-ficticia',modelo,sistema:'Base fictícia',maxTokens:512,mensagens:[{role:'user',content:'Pergunta fictícia'}],esquema:{type:'object'},...extra});
async function corpo(p:PedidoIADireta,conteudo:unknown[]=[{type:'text',text:'Resposta fictícia'}]){
 let enviado:Record<string,unknown>={};
 const r=await responderIADireta(p,async(_u,o)=>{enviado=JSON.parse(String(o?.body));return Response.json({content:conteudo,stop_reason:'end_turn'});});
 return {enviado,r};
}
beforeEach(()=>vi.stubEnv('ATENDIMENTO_IA_HABILITADA','true'));afterEach(()=>vi.unstubAllEnvs());

describe('esforço na configuração',()=>{
 it('aceita nos modelos novos e recusa no Sonnet 4.5, em outro provedor e fora da lista',()=>{
  for(const modelo of ['claude-sonnet-5-5','claude-haiku-5-5'])for(const esforco of ['baixo','medio','alto'] as const)expect(()=>validarConfiguracaoAgente({...config,modelo,esforco})).not.toThrow();
  expect(()=>validarConfiguracaoAgente({...config,modelo:'claude-sonnet-4-5-20250929'})).not.toThrow();
  expect(()=>validarConfiguracaoAgente({...config,modelo:'claude-sonnet-4-5-20250929',esforco:'medio'})).toThrow('AGENTE_CONFIGURACAO_INVALIDA');
  expect(()=>validarConfiguracaoAgente({...config,esforco:'maximo' as never})).toThrow('AGENTE_CONFIGURACAO_INVALIDA');
  expect(()=>validarConfiguracaoAgente({...config,provedor:'openai',modelo:'gpt-5.4',esforco:'medio'})).toThrow('AGENTE_CONFIGURACAO_INVALIDA');
  expect(aceitaEsforcoIA('anthropic','constructor')).toBe(false);
 });
});

describe('chamada à Anthropic por modelo',()=>{
 it('Sonnet 5.5 desliga o pensamento com between_tools e manda o esforço junto do formato',async()=>{
  const {enviado}=await corpo(pedido('claude-sonnet-5-5',{esforco:'medio'}));
  expect(enviado.thinking).toEqual({type:'between_tools'});
  expect(enviado.output_config).toEqual({format:{type:'json_schema',schema:{type:'object'}},effort:'medium'});
  expect(enviado).not.toHaveProperty('temperature');
 });
 it('Haiku 5.5 desliga o pensamento com disabled; sem esforço salvo, fica o padrão do modelo',async()=>{
  const {enviado}=await corpo(pedido('claude-haiku-5-5'));
  expect(enviado.thinking).toEqual({type:'disabled'});
  expect(enviado.output_config).toEqual({format:{type:'json_schema',schema:{type:'object'}}});
 });
 it('Sonnet 4.5 continua igual: sem pensamento nem esforço, mesmo se vier um',async()=>{
  const {enviado}=await corpo(pedido('claude-sonnet-4-5-20250929',{esforco:'alto'}));
  expect(enviado).not.toHaveProperty('thinking');expect(enviado).not.toHaveProperty('output_config');
 });
 it('ignora notas de pensamento na resposta dos modelos novos e lê só o texto',async()=>{
  const {r}=await corpo(pedido('claude-sonnet-5-5'),[{type:'thinking',thinking:'nota fictícia',signature:'assinatura-ficticia'},{type:'text',text:'{"ok":true}'}]);
  expect(r.conteudo).toBe('{"ok":true}');
  await expect(corpo(pedido('claude-sonnet-4-5-20250929'),[{type:'thinking',thinking:'nota',signature:'x'},{type:'text',text:'oi'}])).rejects.toThrow();
 });
 it('recusa esforço fora da lista antes de chamar',async()=>{
  const transporte=vi.fn<typeof fetch>();
  await expect(responderIADireta(pedido('claude-sonnet-5-5',{esforco:'max' as never}),transporte)).rejects.toThrow('IA_PEDIDO_INVALIDO');
  expect(transporte).not.toHaveBeenCalled();
 });
});

describe('ligar em produção com o modelo novo',()=>{
 const p={habilitar:true,modoServidor:'operacao',autoridade:'vps',enviosHabilitados:true,iaAutomatica:true,comandoExpresso:true};
 it('aceita Sonnet 5.5 e Haiku 5.5, guardando o esforço, e segue recusando modelo sem reserva revisada',()=>{
  for(const modelo of ['claude-sonnet-5-5','claude-haiku-5-5'])expect(configuracaoAgenteParaCorte({...config,modelo,esforco:'medio'},p)).toMatchObject({modelo,esforco:'medio',modo:'automatico',limites:{custoPorChamadaCentavos:50}});
  expect(()=>configuracaoAgenteParaCorte({...config,modelo:'claude-opus-5-5'},p)).toThrow('RESERVA_MODELO_REQUER_REVISAO');
 });
});
