import {describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {parametrosAlertaApoio} from '../../src/lib/atendimento/operacao-alerta-apoio';
import {configuracaoAgenteParaCorte} from '../../src/lib/atendimento/operacao-agente-corte';
import type {ConfiguracaoAgente} from '../../src/lib/atendimento/repositorio-agente-pg';
describe('Aviso de plantão por template aprovado',()=>{
 const p={cliente:'Contato fictício',pedido:'123',motivo:'decisao_humana',resumo:'Preciso falar com atendente.'};
 it('preserva o template estático sem inventar parâmetros',()=>expect(parametrosAlertaApoio([{type:'BODY',text:'Plantão fictício.'}],p)).toEqual([]));
 it('suporta exatamente os três parâmetros legados e limita o resumo',()=>{const r=parametrosAlertaApoio([{type:'BODY',text:'{{1}} {{2}} {{3}}'}],{...p,resumo:'a'.repeat(500)});expect(r?.slice(0,2)).toEqual(['Contato fictício','123']);expect(r?.[2].length).toBe(300);});
 it('recusa formatos que precisam de parâmetros diferentes ou botões',()=>{expect(parametrosAlertaApoio([{type:'BODY',text:'{{1}}'}],p)).toBeNull();expect(parametrosAlertaApoio([{type:'BODY',text:'Olá'},{type:'BUTTONS',buttons:[]}],p)).toBeNull();});
 it('prepara PG antes do gate privado, preservando modelo e orçamento',()=>{
  const c:ConfiguracaoAgente={modo:'desligado',modelo:'claude-sonnet-4-5-20250929',maxTokens:512,equipeApoio:'apoio',limites:{maxChamadas:3,custoPorChamadaCentavos:1,maxCustoCentavos:10,maxDuracaoMs:5000,timeoutChamadaMs:1000},custoCentavosDia:100,autoridadeAutomatica:false,grupoExterno:'indisponivel'};
  const v=configuracaoAgenteParaCorte(c,{habilitar:true,modoServidor:'operacao',autoridade:'vps',enviosHabilitados:true,iaAutomatica:false,comandoExpresso:true});expect(v.modo).toBe('automatico');expect(v.custoCentavosDia).toBe(c.custoCentavosDia);expect(v.modelo).toBe(c.modelo);
  expect(()=>configuracaoAgenteParaCorte(c,{habilitar:true,modoServidor:'receber',autoridade:'vps',enviosHabilitados:true,iaAutomatica:false,comandoExpresso:true})).toThrow('AGENTE_AUTORIDADE_NAO_TRANSFERIDA');
 });
});
