import 'server-only';
import {FalhaProvedorIA,type ConsumoIA,type PedidoIADireta,type ProvedorIA,type ChamadaIA,type ImagemIA} from './ia-provedor-tipos';
export const ferramentasConhecidasIA=new Set(['create_appointment','reschedule_appointment','cancel_appointment','request_human_handoff','search_products']);
export const identificadorIA=/^[A-Za-z0-9_-]{1,200}$/;
export const objetoIA=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function falharRespostaIA():never{throw Error('IA_RESPOSTA_INVALIDA');}
export function modeloCompativelIA(provedor:ProvedorIA,modelo:string){return typeof modelo==='string'&&modelo.length<=100&&(provedor==='anthropic'?/^claude-[a-z0-9-]{1,80}$/.test(modelo):provedor==='google'?/^gemini-[a-z0-9._-]{1,80}$/.test(modelo):/^(?:gpt-[a-z0-9._-]+|o[1-9](?:-[a-z0-9._-]+)?)$/.test(modelo));}
function validarImagemIA(i:ImagemIA){if(!['image/jpeg','image/png','image/webp','image/gif'].includes(i.mime)||typeof i.base64!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(i.base64)||i.base64.length%4!==0||Buffer.byteLength(i.base64,'base64')>2*1024*1024||!i.base64)falharRespostaIA();}
export function validarPedidoIA(p:PedidoIADireta,provedor:ProvedorIA){
 if(process.env.ATENDIMENTO_IA_HABILITADA!=='true')throw Error('IA_DESABILITADA');
 if(typeof p.chave!=='string'||!p.chave.trim())throw Error('IA_PROVEDOR_NAO_CONFIGURADO');
 if(p.chave.length>512||/[\r\n]/.test(p.chave)||!modeloCompativelIA(provedor,p.modelo)||!Number.isInteger(p.maxTokens)||p.maxTokens<1||p.maxTokens>8192||typeof p.sistema!=='string'||p.sistema.length>128000||!Array.isArray(p.mensagens)||!p.mensagens.length||p.mensagens.length>100)throw Error('IA_PEDIDO_INVALIDO');
 if(p.signal?.aborted)throw Error('IA_PROCESSAMENTO_CANCELADO');
 try{
  const nomes=new Set<string>();for(const f of p.ferramentas??[]){if(f.type!=='function'||!objetoIA(f.function)||!ferramentasConhecidasIA.has(f.function.name)||nomes.has(f.function.name)||typeof f.function.description!=='string'||f.function.description.length>8000||!objetoIA(f.function.parameters)||f.function.parameters.type!=='object')falharRespostaIA();nomes.add(f.function.name);}if(nomes.size>5)falharRespostaIA();
  const pendentes=new Set<string>(),vistos=new Set<string>();
  for(const m of p.mensagens){
   if(!['user','assistant','tool'].includes(m.role)||m.content!==null&&(typeof m.content!=='string'||m.content.length>64000))falharRespostaIA();
   if(m.continuidade&&(m.role!=='assistant'||m.continuidade.provedor!==provedor||m.continuidade.modelo!==p.modelo||!Array.isArray(m.continuidade.itens)||!m.continuidade.itens.length||m.continuidade.itens.some(v=>!objetoIA(v))))falharRespostaIA();
   if(m.imagem){if(m.role!=='user')falharRespostaIA();validarImagemIA(m.imagem);}
   if(m.role==='tool'){if(!m.tool_call_id||!pendentes.delete(m.tool_call_id)||m.content===null||m.tool_calls||m.continuidade)falharRespostaIA();continue;}
   if(pendentes.size||m.role==='user'&&(m.tool_calls||m.continuidade)||!m.content&&!m.tool_calls?.length)falharRespostaIA();
   if(m.tool_calls){if(m.role!=='assistant'||m.tool_calls.length>5)falharRespostaIA();for(const c of m.tool_calls){if(c.type!=='function'||!identificadorIA.test(c.id)||vistos.has(c.id)||!ferramentasConhecidasIA.has(c.function.name)||typeof c.function.arguments!=='string'||c.function.arguments.length>64000||!objetoIA(JSON.parse(c.function.arguments)))falharRespostaIA();vistos.add(c.id);pendentes.add(c.id);}}
  }
  if(pendentes.size||p.mensagens[0].role!=='user')falharRespostaIA();
  if(p.imagem){validarImagemIA(p.imagem);if(p.mensagens.at(-1)?.role!=='user'||p.mensagens.at(-1)?.imagem)falharRespostaIA();}
 }catch{throw Error('IA_PEDIDO_INVALIDO');}
}
export function conferirChamadaRespostaIA(p:PedidoIADireta,c:ChamadaIA,ids:Set<string>){
 if(!identificadorIA.test(c.id)||ids.has(c.id)||!p.ferramentas?.some(f=>f.function.name===c.function.name)||typeof c.function.arguments!=='string'||c.function.arguments.length>64000||!objetoIA(JSON.parse(c.function.arguments)))falharRespostaIA();ids.add(c.id);
}
export function mesmoJsonIA(a:unknown,b:unknown){const canon=(v:unknown):unknown=>Array.isArray(v)?v.map(canon):objetoIA(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canon(v[k])])):v;return JSON.stringify(canon(a))===JSON.stringify(canon(b));}
export function numeroConsumoIA(v:unknown){if(v===undefined)return undefined;if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0||v>100000000)falharRespostaIA();return v;}
export function idConsumoIA(v:unknown){return typeof v==='string'&&/^[A-Za-z0-9._:/-]{1,200}$/.test(v)?v:undefined;}
export function lerConsumoIA(provedor:ProvedorIA,v:Record<string,unknown>,requestId?:string):ConsumoIA{
 const u=objetoIA(provedor==='google'?v.usageMetadata:v.usage)?(provedor==='google'?v.usageMetadata:v.usage) as Record<string,unknown>:null;
 const entrada=numeroConsumoIA(provedor==='google'?u?.promptTokenCount:u?.input_tokens),saida=numeroConsumoIA(provedor==='google'?u?.candidatesTokenCount:u?.output_tokens);
 const total=numeroConsumoIA(provedor==='google'?u?.totalTokenCount:u?.total_tokens);
 const cache=numeroConsumoIA(provedor==='anthropic'?u?.cache_read_input_tokens:provedor==='google'?u?.cachedContentTokenCount:objetoIA(u?.input_tokens_details)?u.input_tokens_details.cached_tokens:undefined);
 const cacheGravacao=numeroConsumoIA(provedor==='anthropic'?u?.cache_creation_input_tokens:undefined);
 const raciocinio=numeroConsumoIA(provedor==='google'?u?.thoughtsTokenCount:provedor==='openai'&&objetoIA(u?.output_tokens_details)?u.output_tokens_details.reasoning_tokens:undefined);
 const ferramentas=numeroConsumoIA(provedor==='google'?u?.toolUsePromptTokenCount:undefined);
 return completarConsumoIA({observado:entrada!==undefined&&saida!==undefined,...(entrada!==undefined?{tokensEntrada:entrada}:{}),...(saida!==undefined?{tokensSaida:saida}:{}),...(total!==undefined?{tokensTotal:total}:{}),...(cache!==undefined?{tokensCacheLeitura:cache}:{}),...(cacheGravacao!==undefined?{tokensCacheGravacao:cacheGravacao}:{}),...(raciocinio!==undefined?{tokensRaciocinio:raciocinio}:{}),...(ferramentas!==undefined?{tokensFerramentas:ferramentas}:{})},provedor==='google'?v.modelVersion:v.model,provedor==='google'?v.responseId:v.id,requestId);
}
/** Uma única tentativa, sem retry ou fallback. Após o POST, timeout/rede/5xx,
 * corpo inválido e truncamento de transporte são resultados incertos. */
export async function postJsonIA<T>(p:PedidoIADireta,provedor:ProvedorIA,url:string,headers:Record<string,string>,payload:unknown,fetchImpl:typeof fetch,parse:(v:Record<string,unknown>,requestId?:string)=>T):Promise<T>{
 let body:string;try{body=JSON.stringify(payload);if(Buffer.byteLength(body)>(p.imagem||p.mensagens.some(m=>m.imagem)?4*1024*1024:512*1024))throw Error();}catch{throw Error('IA_PEDIDO_INVALIDO');}
 if(p.signal?.aborted)throw Error('IA_PROCESSAMENTO_CANCELADO');
 let requestId:string|undefined,consumo:ConsumoIA={observado:false};
 try{
  const r=await fetchImpl(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body,redirect:'error',signal:p.signal?AbortSignal.any([p.signal,AbortSignal.timeout(45000)]):AbortSignal.timeout(45000),cache:'no-store'});
  requestId=idConsumoIA(r.headers.get('x-request-id')??r.headers.get('request-id'));
  if(!r.ok){await r.body?.cancel().catch(()=>undefined);throw new FalhaProvedorIA(provedor,p.modelo,r.status>=400&&r.status<500&&r.status!==408?'recusado':'incerto',{observado:false,...(requestId?{requisicaoId:requestId}:{})});}
  if(!r.body)throw Error();const reader=r.body.getReader(),partes:Uint8Array[]=[];let tamanho=0;
  try{for(;;){const q=await reader.read();if(q.done)break;tamanho+=q.value.byteLength;if(tamanho>2*1024*1024){await reader.cancel();throw Error();}partes.push(q.value);}}finally{reader.releaseLock();}
  const v:unknown=JSON.parse(Buffer.concat(partes).toString('utf8'));if(!objetoIA(v))falharRespostaIA();consumo=lerConsumoIA(provedor,v,requestId);return parse(v,requestId);
 }catch(e){if(e instanceof FalhaProvedorIA)throw e;throw new FalhaProvedorIA(provedor,p.modelo,'incerto',{...consumo,...(requestId?{requisicaoId:requestId}:{})});}
}
export function completarConsumoIA(base:ConsumoIA,modelo:unknown,id:unknown,requestId?:string):ConsumoIA{return {...base,...(idConsumoIA(modelo)?{modeloObservado:idConsumoIA(modelo)}:{}),...(idConsumoIA(id)?{respostaId:idConsumoIA(id)}:{}),...(requestId?{requisicaoId:requestId}:{})};}
