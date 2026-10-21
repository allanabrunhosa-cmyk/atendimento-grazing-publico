import 'server-only';
import {validarPedidoIA,postJsonIA,objetoIA,falharRespostaIA,conferirChamadaRespostaIA,mesmoJsonIA,lerConsumoIA} from './ia-provedor-comum';
import type {PedidoIADireta,RespostaIADireta,ChamadaIA} from './ia-provedor-tipos';

function lerItens(p:PedidoIADireta,itens:unknown){
 if(!Array.isArray(itens)||itens.length>30)falharRespostaIA();
 const textos:string[]=[],chamadas:ChamadaIA[]=[],ids=new Set<string>();
 for(const item of itens){
  if(!objetoIA(item))falharRespostaIA();
  if(item.type==='message'){
   if(item.role!=='assistant'||!Array.isArray(item.content))falharRespostaIA();
   for(const bloco of item.content){if(!objetoIA(bloco)||bloco.type!=='output_text'||typeof bloco.text!=='string'||bloco.text.length>64000)falharRespostaIA();textos.push(bloco.text);}
  }else if(item.type==='function_call'){
   if(typeof item.call_id!=='string'||typeof item.name!=='string'||typeof item.arguments!=='string'||item.status!==undefined&&item.status!=='completed')falharRespostaIA();
   const c:ChamadaIA={id:item.call_id,type:'function',function:{name:item.name,arguments:item.arguments}};conferirChamadaRespostaIA(p,c,ids);chamadas.push(c);
  }else if(item.type==='reasoning'){
   if(item.encrypted_content!==undefined&&(typeof item.encrypted_content!=='string'||item.encrypted_content.length>1500000)||item.summary!==undefined&&!Array.isArray(item.summary))falharRespostaIA();
   // O conteúdo de reasoning é opaco e só volta à Responses API. Nunca é
   // convertido em texto para cliente ou instruções comerciais.
  }else falharRespostaIA();
 }
 if(chamadas.length>5||textos.join('\n').length>64000)falharRespostaIA();
 return {conteudo:textos.join('\n'),chamadas,itens:itens as Record<string,unknown>[]};
}
function converterInput(p:PedidoIADireta){
 const input:Record<string,unknown>[]=[];
 for(const m of p.mensagens){
  if(m.role==='tool'){input.push({type:'function_call_output',call_id:m.tool_call_id,output:m.content});continue;}
  if(m.continuidade){const n=lerItens(p,m.continuidade.itens);if(n.conteudo!==(m.content??'')||!mesmoJsonIA(n.chamadas,m.tool_calls??[]))falharRespostaIA();input.push(...structuredClone(n.itens));continue;}
  if(m.content)input.push({role:m.role,content:m.imagem?[{type:'input_text',text:m.content},{type:'input_image',image_url:`data:${m.imagem.mime};base64,${m.imagem.base64}`,detail:'auto'}]:m.content});
  for(const c of m.tool_calls??[])input.push({type:'function_call',call_id:c.id,name:c.function.name,arguments:c.function.arguments});
 }
 if(p.imagem){const ultima=input.at(-1);if(!ultima||ultima.role!=='user'||typeof ultima.content!=='string')falharRespostaIA();ultima.content=[{type:'input_text',text:ultima.content},{type:'input_image',image_url:`data:${p.imagem.mime};base64,${p.imagem.base64}`,detail:'auto'}];}
 return input;
}
/** Responses nativa, sem armazenamento de conversa e sem gateway/fallback. */
export async function responderOpenAIIA(p:PedidoIADireta,fetchImpl:typeof fetch=fetch):Promise<RespostaIADireta>{
 validarPedidoIA(p,'openai');let input:Record<string,unknown>[];
 try{input=converterInput(p);}catch{throw Error('IA_PEDIDO_INVALIDO');}
 const tools=p.ferramentas?.map(f=>({type:'function',name:f.function.name,description:f.function.description,parameters:f.function.parameters,strict:false}));
 return postJsonIA<RespostaIADireta>(p,'openai','https://api.openai.com/v1/responses',{Authorization:'Bearer '+p.chave},{model:p.modelo,instructions:p.sistema,input,max_output_tokens:p.maxTokens,store:false,include:['reasoning.encrypted_content'],...(tools?.length?{tools}:{})},fetchImpl,(v,requestId)=>{
  if(!['completed','incomplete'].includes(String(v.status))||v.status==='incomplete'&&(!objetoIA(v.incomplete_details)||v.incomplete_details.reason!=='max_output_tokens'))falharRespostaIA();
  const n=lerItens(p,v.output),truncada=v.status==='incomplete';if(!truncada&&!n.conteudo&&!n.chamadas.length)falharRespostaIA();
  const consumo=lerConsumoIA('openai',v,requestId);
  return {conteudo:n.conteudo,chamadas:n.chamadas,truncada,modelo:p.modelo,provedor:'openai',consumo,continuidade:{provedor:'openai',modelo:p.modelo,itens:structuredClone(n.itens)}};
 });
}
