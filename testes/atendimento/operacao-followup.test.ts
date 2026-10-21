import {describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {validarConfiguracaoFollowup,hashConfiguracaoFollowup} from '../../src/lib/atendimento/operacao-followup';
import {configuracaoAgenteParaCorte} from '../../src/lib/atendimento/operacao-agente-corte';
import type {ConfiguracaoAgente} from '../../src/lib/atendimento/repositorio-agente-pg';
const config:ConfiguracaoAgente={modo:'rascunho',modelo:'claude-sonnet-4-5-20250929',maxTokens:512,equipeApoio:'apoio',limites:{maxChamadas:3,custoPorChamadaCentavos:1,maxCustoCentavos:10,maxDuracaoMs:10000,timeoutChamadaMs:2000},custoCentavosDia:100,autoridadeAutomatica:false,grupoExterno:'indisponivel'};
describe('follow-up e controle de autoridade da agente',()=>{
 it('valida campos, caracteres, prazo mínimo e janela máxima sem truncar texto',()=>{
  expect(()=>validarConfiguracaoFollowup({habilitado:true,minutos:5,texto:'Mensagem fictícia'})).not.toThrow();
  for(const v of [{habilitado:true,minutos:4,texto:'texto'},{habilitado:true,minutos:1441,texto:'texto'},{habilitado:true,minutos:60,texto:''},{habilitado:true,minutos:60,texto:'x'.repeat(4097)},{habilitado:true,minutos:60,texto:'x\u0000'},{habilitado:true,minutos:60,texto:'x',token:'indevido'}])expect(()=>validarConfiguracaoFollowup(v)).toThrow('FOLLOWUP_CONFIGURACAO_INVALIDA');
 });
 it('hash independe da ordem JSONB e registra qualquer mudança de mensagem/prazo',()=>{
  const a={habilitado:true,minutos:60,texto:'Mensagem fictícia'},b={texto:'Mensagem fictícia',minutos:60,habilitado:true};
  expect(hashConfiguracaoFollowup(a)).toBe(hashConfiguracaoFollowup(b));expect(hashConfiguracaoFollowup({...a,minutos:61})).not.toBe(hashConfiguracaoFollowup(a));expect(hashConfiguracaoFollowup({...a,texto:'Mensagem alterada'})).not.toBe(hashConfiguracaoFollowup(a));
 });
 it('não habilita por data, toggle ou comando sem autoridade transferida',()=>{
  const p={habilitar:true,modoServidor:'operacao',autoridade:'vps',enviosHabilitados:true,iaAutomatica:true,comandoExpresso:true};
  expect(()=>configuracaoAgenteParaCorte(config,{...p,comandoExpresso:false})).toThrow('CORTE_NAO_AUTORIZADO');
  for(const falha of [{modoServidor:'homologacao'},{modoServidor:'receber'},{autoridade:'origem'},{enviosHabilitados:false}])expect(()=>configuracaoAgenteParaCorte(config,{...p,...falha})).toThrow('AUTORIDADE_NAO_TRANSFERIDA');
  expect(configuracaoAgenteParaCorte(config,p)).toEqual({...config,limites:{...config.limites,custoPorChamadaCentavos:50,maxCustoCentavos:150},modo:'automatico',autoridadeAutomatica:true});
 });
 it('mantém teto/modelo preparados e exige orçamento válido antes de habilitar',()=>{
  const p={habilitar:true,modoServidor:'operacao',autoridade:'vps',enviosHabilitados:true,iaAutomatica:true,comandoExpresso:true};
  expect(()=>configuracaoAgenteParaCorte({...config,custoCentavosDia:0},p)).toThrow('ORCAMENTO_NAO_AUTORIZADO');
  expect(()=>configuracaoAgenteParaCorte({...config,custoCentavosDia:49},p)).toThrow('ORCAMENTO_NAO_AUTORIZADO');
  expect(()=>configuracaoAgenteParaCorte({...config,maxTokens:513},p)).toThrow('RESERVA_MODELO_REQUER_REVISAO');
  expect(()=>configuracaoAgenteParaCorte({...config,modelo:'claude-opus-4-5'},p)).toThrow('RESERVA_MODELO_REQUER_REVISAO');
  const desligado=configuracaoAgenteParaCorte({...config,modo:'automatico',autoridadeAutomatica:true},{...p,habilitar:false,autoridade:'origem'});expect(desligado.modo).toBe('desligado');expect(desligado.autoridadeAutomatica).toBe(false);expect(desligado.custoCentavosDia).toBe(config.custoCentavosDia);
 });
});
