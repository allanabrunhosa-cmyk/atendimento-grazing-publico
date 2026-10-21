import 'server-only';
import {createHash,randomUUID} from 'node:crypto';
import {hashWoo} from './operacao-woocommerce-automacoes';

type RegraOrigem=Record<string,unknown>;
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export type BaselineRegrasWoo={versao:1;empresaId:string;id:string;capturadaEm:string;regras:RegraOrigem[];hash:string;quantidadeAtivas:number;ativasHash:string};
export type MarcoFinalWoo={t0:string;idCopiaFinal:string;manutencaoExecucao:string;verificadaEm:string;materializadaEm:string;emissoresSuspensos:true;quantidadeRegrasAtivasOriginais:number;regrasAtivasOriginaisHash:string};
/** Não inclui os timestamps técnicos que a manutenção pode atualizar. */
export function semanticaRegraWoo(r:RegraOrigem):RegraOrigem{
 if(typeof r.id!=='string'||!uuid.test(r.id)||typeof r.active!=='boolean'||typeof r.trigger_topic!=='string'||typeof r.action_type!=='string')throw Error('WOO_BASELINE_REGRA_INVALIDA');
 return Object.fromEntries(['id','active','trigger_topic','action_type','delay_minutes','cooldown_hours','cancel_if_changed','filters','action_config'].map(k=>[k,r[k]??null]));
}
export function hashAtivasWoo(regras:RegraOrigem[]){const ids=regras.filter(r=>r.active===true).map(r=>String(r.id).toLowerCase()).sort();return {quantidadeAtivas:ids.length,ativasHash:createHash('md5').update(ids.map(id=>id+':true').join(',')).digest('hex')};}
export function criarBaselineWoo(empresaId:string,regras:RegraOrigem[],agora=new Date()):BaselineRegrasWoo{
 const normalizadas=regras.map(semanticaRegraWoo).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
 if(new Set(normalizadas.map(r=>r.id)).size!==normalizadas.length)throw Error('WOO_BASELINE_IDS_DUPLICADOS');
 return {versao:1,empresaId,id:randomUUID(),capturadaEm:agora.toISOString(),regras:normalizadas,hash:hashWoo({empresaId,regras:normalizadas}),...hashAtivasWoo(normalizadas)};
}
export function conferirBaselineWoo(b:BaselineRegrasWoo,empresaId:string){
 if(!b||b.versao!==1||b.empresaId!==empresaId||!uuid.test(b.id)||!Number.isFinite(Date.parse(b.capturadaEm))||!Array.isArray(b.regras))throw Error('WOO_BASELINE_INVALIDO');
 const atual=criarBaselineWoo(empresaId,b.regras),ativas=hashAtivasWoo(b.regras);
 if(atual.hash!==b.hash||ativas.ativasHash!==b.ativasHash||ativas.quantidadeAtivas!==b.quantidadeAtivas)throw Error('WOO_BASELINE_DIVERGENTE');
}
/** A configuração original só é recuperada quando o recibo da manutenção e a
 * cópia final materializada vinculam a mesma linha de tempo e os mesmos IDs. */
export function reconciliarRegrasCongeladasWoo(regras:RegraOrigem[],b:BaselineRegrasWoo,m:MarcoFinalWoo,empresaId:string):RegraOrigem[]{
 conferirBaselineWoo(b,empresaId);
 if(!m||!uuid.test(m.idCopiaFinal)||!uuid.test(m.manutencaoExecucao)||m.idCopiaFinal===m.manutencaoExecucao||m.emissoresSuspensos!==true||![m.t0,m.verificadaEm,m.materializadaEm].every(v=>typeof v==='string'&&Number.isFinite(Date.parse(v)))||Date.parse(b.capturadaEm)>Date.parse(m.t0)||Date.parse(m.verificadaEm)<Date.parse(m.t0)||Date.parse(m.materializadaEm)<Date.parse(m.t0)||m.quantidadeRegrasAtivasOriginais!==b.quantidadeAtivas||m.regrasAtivasOriginaisHash!==b.ativasHash)throw Error('WOO_MARCO_FINAL_DIVERGENTE');
 const ids=new Map(b.regras.map(r=>[String(r.id),r]));
 if(regras.length!==ids.size||new Set(regras.map(r=>r.id)).size!==ids.size)throw Error('WOO_REGRAS_CONGELADAS_DIVERGENTES');
 return regras.map(r=>{const original=ids.get(String(r.id));if(!original||r.active!==false||hashWoo(semanticaRegraWoo({...r,active:original.active}))!==hashWoo(original))throw Error('WOO_REGRAS_CONGELADAS_DIVERGENTES');return {...r,active:original.active};});
}
