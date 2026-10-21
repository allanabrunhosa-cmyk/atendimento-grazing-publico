import 'server-only';
import {randomUUID} from 'node:crypto';
import {validarPedidoIA,postJsonIA,objetoIA,falharRespostaIA,conferirChamadaRespostaIA,mesmoJsonIA,lerConsumoIA} from './ia-provedor-comum';
import type {PedidoIADireta,RespostaIADireta,ChamadaIA,MensagemIA} from './ia-provedor-tipos';

function lerPartes(p:PedidoIADireta,partes:unknown,anteriores?:ChamadaIA[]){
 if(!Array.isArray(partes)||partes.length>30)falharRespostaIA();const textos:string[]=[],chamadas:ChamadaIA[]=[],ids=new Set<string>();
 for(const bloco of partes){
  if(!objetoIA(bloco)||bloco.thoughtSignature!==undefined&&(typeof bloco.thoughtSignature!=='string'||bloco.thoughtSignature.length>1500000))falharRespostaIA();
  if(typeof bloco.text==='string'){if(bloco.text.length>64000||bloco.thought!==undefined&&typeof bloco.thought!=='boolean')falharRespostaIA();if(bloco.thought!==true)textos.push(bloco.text);}
  else if(objetoIA(bloco.functionCall)){
   const fn=bloco.functionCall;if(typeof fn.name!=='string'||!objetoIA(fn.args)||fn.id!==undefined&&typeof fn.id!=='string')falharRespostaIA();
   const c:ChamadaIA={id:typeof fn.id==='string'?fn.id:anteriores?.[chamadas.length]?.id??'gemini_'+randomUUID().replaceAll('-',''),type:'function',function:{name:fn.name,arguments:JSON.stringify(fn.args)}};conferirChamadaRespostaIA(p,c,ids);chamadas.push(c);
  }else falharRespostaIA();
 }
 if(chamadas.length>5||textos.join('\n').length>64000)falharRespostaIA();return {conteudo:textos.join('\n'),chamadas,partes:partes as Record<string,unknown>[]};
}
function converterContents(p:PedidoIADireta){
 const contents:{role:'user'|'model';parts:Record<string,unknown>[]}[]=[],pendentes=new Map<string,{name:string;id?:string}>();
 const adicionar=(role:'user'|'model',parts:Record<string,unknown>[])=>{contents.push({role,parts});};
 for(let indice=0;indice<p.mensagens.length;indice++){
  const m=p.mensagens[indice];
  if(m.role==='tool'){
   const resultados=new Map<string,MensagemIA>();for(;indice<p.mensagens.length&&p.mensagens[indice].role==='tool';indice++)resultados.set(p.mensagens[indice].tool_call_id!,p.mensagens[indice]);indice--;
   const parts:Record<string,unknown>[]=[];for(const [id,fn] of pendentes){const resultado=resultados.get(id);if(!resultado)falharRespostaIA();let valor:unknown;try{valor=JSON.parse(resultado.content!);}catch{valor=resultado.content;}
    // FunctionResponse precisa de um objeto; a saída textual permanece inteira
    // no campo output. A API nunca executa a função por conta deste adaptador.
    parts.push({functionResponse:{name:fn.name,...(fn.id?{id:fn.id}:{}),response:objetoIA(valor)?valor:{output:valor}}});
   }adicionar('user',parts);pendentes.clear();continue;
  }
  if(m.continuidade){
   const n=lerPartes(p,m.continuidade.itens,m.tool_calls);if(n.conteudo!==(m.content??'')||!mesmoJsonIA(n.chamadas.map(c=>({...c,function:{...c.function,arguments:JSON.parse(c.function.arguments)}})),(m.tool_calls??[]).map(c=>({...c,function:{...c.function,arguments:JSON.parse(c.function.arguments)}}))))falharRespostaIA();
   let i=0;for(const parte of n.partes)if(objetoIA(parte.functionCall)){const chamada=m.tool_calls?.[i++];if(!chamada)falharRespostaIA();pendentes.set(chamada.id,{name:chamada.function.name,...(typeof parte.functionCall.id==='string'?{id:parte.functionCall.id}:{})});}adicionar('model',structuredClone(n.partes));continue;
  }
  if(m.tool_calls?.length&&p.modelo.startsWith('gemini-3'))throw Error('IA_CONTINUIDADE_OBRIGATORIA');
  const parts:Record<string,unknown>[]=m.content?[{text:m.content}]:[];if(m.imagem)parts.unshift({inlineData:{mimeType:m.imagem.mime,data:m.imagem.base64}});for(const c of m.tool_calls??[]){parts.push({functionCall:{name:c.function.name,args:JSON.parse(c.function.arguments),id:c.id}});pendentes.set(c.id,{name:c.function.name,id:c.id});}adicionar(m.role==='assistant'?'model':'user',parts);
 }
 if(p.imagem){const ultima=contents.at(-1);if(!ultima||ultima.role!=='user')falharRespostaIA();ultima.parts=[{inlineData:{mimeType:p.imagem.mime,data:p.imagem.base64}},...ultima.parts];}
 return contents;
}
/** Gemini generateContent nativa. Pensamento/signaturas voltam intactos no
 * histórico servidor; áudio continua na cadeia STT/TTS separada. */
export async function responderGoogleIA(p:PedidoIADireta,fetchImpl:typeof fetch=fetch):Promise<RespostaIADireta>{
 validarPedidoIA(p,'google');if(p.imagem?.mime==='image/gif'||p.mensagens.some(m=>m.imagem?.mime==='image/gif'))throw Error('IA_IMAGEM_INCOMPATIVEL');let contents:ReturnType<typeof converterContents>;
 try{contents=converterContents(p);}catch(e){if(e instanceof Error&&e.message==='IA_CONTINUIDADE_OBRIGATORIA')throw e;throw Error('IA_PEDIDO_INVALIDO');}
 const declarations=p.ferramentas?.map(f=>({name:f.function.name,description:f.function.description,parametersJsonSchema:f.function.parameters}));
 return postJsonIA<RespostaIADireta>(p,'google',`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(p.modelo)}:generateContent`,{'x-goog-api-key':p.chave},{systemInstruction:{parts:[{text:p.sistema}]},contents,generationConfig:{candidateCount:1,maxOutputTokens:p.maxTokens},...(declarations?.length?{tools:[{functionDeclarations:declarations}]}:{})},fetchImpl,(v,requestId)=>{
  if(!Array.isArray(v.candidates)||v.candidates.length!==1||!objetoIA(v.candidates[0]))falharRespostaIA();const candidato=v.candidates[0];if(!['STOP','MAX_TOKENS'].includes(String(candidato.finishReason))||!objetoIA(candidato.content)||candidato.content.role!=='model')falharRespostaIA();
  const n=lerPartes(p,candidato.content.parts),truncada=candidato.finishReason==='MAX_TOKENS';if(!truncada&&!n.conteudo&&!n.chamadas.length)falharRespostaIA();
  const consumo=lerConsumoIA('google',v,requestId);
  return {conteudo:n.conteudo,chamadas:n.chamadas,truncada,modelo:p.modelo,provedor:'google',consumo,continuidade:{provedor:'google',modelo:p.modelo,itens:structuredClone(n.partes)}};
 });
}
