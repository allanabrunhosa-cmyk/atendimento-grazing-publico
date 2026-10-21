import {describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {criarBaselineWoo,hashAtivasWoo,reconciliarRegrasCongeladasWoo} from '../../src/lib/atendimento/operacao-woocommerce-baseline';
import {normalizarRegraCrmWoo} from '../../src/lib/atendimento/operacao-woocommerce-crm';
const regra={id:'fa340001-0000-4000-a000-000000000001',active:true,trigger_topic:'order.created',action_type:'crm_update',delay_minutes:0,cooldown_hours:0,cancel_if_changed:true,filters:{logic:'AND',conditions:[{field:'status',operator:'changed_to',value:'pending'}]},action_config:{move_deal_stage_id:'fa340002-0000-4000-a000-000000000002'}};
const baseline=()=>criarBaselineWoo('fixture',[regra,{...regra,id:'fa340003-0000-4000-a000-000000000003',active:false}],new Date('2026-10-10T00:00:00Z'));
const marco=()=>({t0:'2026-10-10T01:00:00Z',idCopiaFinal:'fa340004-0000-4000-a000-000000000004',manutencaoExecucao:'fa340005-0000-4000-a000-000000000005',verificadaEm:'2026-10-10T01:01:00Z',materializadaEm:'2026-10-10T01:02:00Z',emissoresSuspensos:true as const,quantidadeRegrasAtivasOriginais:1,regrasAtivasOriginaisHash:hashAtivasWoo([regra]).ativasHash});
describe('Woo CRM e baseline original',()=>{
 it('aceita somente as quatro formas comprovadas e nenhuma ação adicional',()=>{
  expect(normalizarRegraCrmWoo(regra).topic).toBe('order.created');
  for(const status of ['cancelled','retirado-entrega'])expect(normalizarRegraCrmWoo({...regra,trigger_topic:'order.updated',filters:{logic:'AND',conditions:[{field:'status',operator:'changed_to',value:status}]}}).estados).toEqual([status]);
  expect(normalizarRegraCrmWoo({...regra,trigger_topic:'order.updated',filters:{logic:'OR',conditions:['processing','completed'].map(value=>({field:'status',operator:'changed_to',value}))}}).estados.length).toBe(2);
  expect(()=>normalizarRegraCrmWoo({...regra,action_config:{...regra.action_config,add_tags:['Nova']}})).toThrow('WOO_CRM_REGRA_FORA_ESCOPO');
 });
 it('restaura a atividade original após freeze sem ativar a regra inativa',()=>{
  const b=baseline(),final=reconciliarRegrasCongeladasWoo(b.regras.map(r=>({...r,active:false,updated_at:'2026-10-10T01:00:00Z'})),b,marco(),'fixture');
  expect(final.map(r=>r.active)).toEqual([true,false]);
 });
 it('hash semântico é canônico e ignora somente timestamps técnicos',()=>{
  const a=criarBaselineWoo('fixture',[regra]),b=criarBaselineWoo('fixture',[{updated_at:'agora',created_at:'antes',...regra,action_config:{move_deal_stage_id:regra.action_config.move_deal_stage_id}}]);expect(a.hash).toBe(b.hash);
  expect(criarBaselineWoo('fixture',[{...regra,trigger_topic:'order.updated'}]).hash).not.toBe(a.hash);
 });
 it('recusa ID ativo novo, assinatura diferente e alteração real no congelamento',()=>{
  const b=baseline(),regras=b.regras.map(r=>({...r,active:false}));
  expect(()=>reconciliarRegrasCongeladasWoo(regras,b,{...marco(),quantidadeRegrasAtivasOriginais:2},'fixture')).toThrow('WOO_MARCO_FINAL_DIVERGENTE');
  expect(()=>reconciliarRegrasCongeladasWoo(regras,b,{...marco(),regrasAtivasOriginaisHash:'0'.repeat(32)},'fixture')).toThrow('WOO_MARCO_FINAL_DIVERGENTE');
  expect(()=>reconciliarRegrasCongeladasWoo([{...regras[0],delay_minutes:1},regras[1]],b,marco(),'fixture')).toThrow('WOO_REGRAS_CONGELADAS_DIVERGENTES');
  expect(()=>reconciliarRegrasCongeladasWoo([...regras,{...regra,id:'fa340006-0000-4000-a000-000000000006',active:false}],b,marco(),'fixture')).toThrow('WOO_REGRAS_CONGELADAS_DIVERGENTES');
 });
 it('recusa cópia sem T0, freeze sem suspensão e baseline adulterado',()=>{
  const b=baseline(),regras=b.regras.map(r=>({...r,active:false}));
  expect(()=>reconciliarRegrasCongeladasWoo(regras,b,{...marco(),emissoresSuspensos:false as unknown as true},'fixture')).toThrow('WOO_MARCO_FINAL_DIVERGENTE');
  expect(()=>reconciliarRegrasCongeladasWoo(regras,{...b,hash:'0'.repeat(64)},marco(),'fixture')).toThrow('WOO_BASELINE_DIVERGENTE');
  expect(()=>reconciliarRegrasCongeladasWoo(regras,b,{...marco(),t0:'invalido'},'fixture')).toThrow('WOO_MARCO_FINAL_DIVERGENTE');
 });
});
