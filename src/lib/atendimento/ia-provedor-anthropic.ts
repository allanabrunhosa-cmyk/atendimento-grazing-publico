import 'server-only';
import {validarPedidoIA,postJsonIA,lerConsumoIA,conferirChamadaRespostaIA} from './ia-provedor-comum';
import type {PedidoIADireta,RespostaIADireta,MensagemIA} from './ia-provedor-tipos';

type Chamada = {id: string;type: 'function';function: {name: string;arguments: string}};
export type ImagemIA = {mime: 'image/jpeg'|'image/png'|'image/webp'|'image/gif';base64: string};
type Bloco = {type: 'text';text: string}|{type: 'tool_use';id: string;name: string;input: Record<string,unknown>}|
  {type: 'tool_result';tool_use_id: string;content: string}|{type:'image';source:{type:'base64';media_type:ImagemIA['mime'];data:string}};
const ferramentasConhecidas=new Set(['create_appointment','reschedule_appointment','cancel_appointment','request_human_handoff','search_products']);
const identificador=/^[A-Za-z0-9_-]{1,200}$/;
const falhar=()=>{throw new Error('IA_RESPOSTA_INVALIDA');};
function converterMensagens(mensagens: MensagemIA[]) {
  const pendentes=new Set<string>();const vistos=new Set<string>();
  const saida: {role:'user'|'assistant';content: Bloco[]}[]=[];
  for(const m of mensagens) {
    if(m.content!==null&&(typeof m.content!=='string'||m.content.length>64000))falhar();
    if(m.role==='tool') {
      if(!m.tool_call_id||!pendentes.delete(m.tool_call_id)||m.content===null)falhar();
      const bloco: Bloco={type:'tool_result',tool_use_id:m.tool_call_id!,content:m.content!};
      const ultimo=saida.at(-1);
      if(ultimo?.role==='user'&&ultimo.content.every(b=>b.type==='tool_result'))ultimo.content.push(bloco);
      else saida.push({role:'user',content:[bloco]});
      continue;
    }
    if(pendentes.size||!['user','assistant'].includes(m.role))falhar();
    const blocos: Bloco[]=m.content?[{type:'text',text:m.content}]:[];
    if(m.imagem)blocos.unshift({type:'image',source:{type:'base64',media_type:m.imagem.mime,data:m.imagem.base64}});
    if(m.tool_calls) {
      if(m.role!=='assistant'||m.tool_calls.length>5)falhar();
      for(const c of m.tool_calls) {
        if(c.type!=='function'||!identificador.test(c.id)||vistos.has(c.id)||!ferramentasConhecidas.has(c.function.name)||c.function.arguments.length>64000)falhar();
        const input: unknown=JSON.parse(c.function.arguments);
        if(!input||typeof input!=='object'||Array.isArray(input))falhar();
        blocos.push({type:'tool_use',id:c.id,name:c.function.name,input:input as Record<string,unknown>});
        pendentes.add(c.id);vistos.add(c.id);
      }
    }
    if(!blocos.length)falhar();saida.push({role:m.role as 'user'|'assistant',content:blocos});
  }
  if(pendentes.size||!saida.length||saida[0].role!=='user')falhar();return saida;
}
/** Adaptador nativo Anthropic para o contrato de ferramentas da origem.
 * Não executa ferramentas, não grava mensagens, não chama WhatsApp e não registra conteúdo.
 * Habilitação separada; falha/truncamento devem ser tratados pelo processador sem bloquear humano.
 */
export async function responderAnthropicIA(pedido: PedidoIADireta,fetchImpl: typeof fetch=fetch):Promise<RespostaIADireta> {
  validarPedidoIA(pedido,'anthropic');
  if(pedido.mensagens.some(m=>m.continuidade))throw Error('IA_PEDIDO_INVALIDO');
  let body: string;
  try {
    const nomes=new Set<string>();
    const tools=pedido.ferramentas?.map(f=>{
      if(f.type!=='function'||!ferramentasConhecidas.has(f.function.name)||nomes.has(f.function.name)||
        f.function.description.length>8000||f.function.parameters.type!=='object')falhar();
      nomes.add(f.function.name);return {name:f.function.name,description:f.function.description,input_schema:f.function.parameters};
    });
    if(tools&&tools.length>5)falhar();
    const mensagens=converterMensagens(pedido.mensagens);
    if(pedido.imagem) {
      const i=pedido.imagem;
      if(!['image/jpeg','image/png','image/webp','image/gif'].includes(i.mime)||typeof i.base64!=='string'||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(i.base64)||i.base64.length%4!==0||Buffer.byteLength(i.base64,'base64')>2*1024*1024)falhar();
      const ultima=mensagens.at(-1);
      if(!ultima)throw Error('IA_RESPOSTA_INVALIDA');
      if(ultima.role!=='user'||ultima.content.some(b=>b.type!=='text'))falhar();
      // Apenas bytes previamente autorizados/preservados; não há fetch de URL
      // fornecida pelo cliente nem acesso do provedor aos buckets autenticados.
      ultima.content=[{type:'image',source:{type:'base64',media_type:i.mime,data:i.base64}},...ultima.content];
    }
    body=JSON.stringify({model:pedido.modelo,max_tokens:pedido.maxTokens,system:pedido.sistema,
      messages:mensagens,...(tools?.length?{tools}: {})});
    if(Buffer.byteLength(body)>(pedido.imagem||pedido.mensagens.some(m=>m.imagem)?4*1024*1024:512*1024))falhar();
  } catch {throw new Error('IA_PEDIDO_INVALIDO');}
  return postJsonIA<RespostaIADireta>(pedido,'anthropic','https://api.anthropic.com/v1/messages',{'x-api-key':pedido.chave,'anthropic-version':'2023-06-01'},JSON.parse(body),fetchImpl,(resposta,requestId)=>{
    if(!resposta||typeof resposta!=='object'||!('content' in resposta)||!Array.isArray(resposta.content))falhar();
    const nativa=resposta as {content: unknown[];stop_reason?: unknown};
    if(!['end_turn','tool_use','max_tokens'].includes(String(nativa.stop_reason)))falhar();
    const textos: string[]=[];const chamadas: Chamada[]=[];const ids=new Set<string>();
    for(const b of nativa.content) {
      if(!b||typeof b!=='object'||!('type' in b))falhar();
      const bloco=b as Record<string,unknown>;
      if(bloco.type==='text'&&typeof bloco.text==='string')textos.push(bloco.text);
      else if(bloco.type==='tool_use'&&typeof bloco.id==='string'&&identificador.test(bloco.id)&&!ids.has(bloco.id)&&
        typeof bloco.name==='string'&&pedido.ferramentas?.some(f=>f.function.name===bloco.name)&&
        bloco.input&&typeof bloco.input==='object'&&!Array.isArray(bloco.input)) {
        const chamada:Chamada={id:bloco.id,type:'function',function:{name:bloco.name,arguments:JSON.stringify(bloco.input)}};
        conferirChamadaRespostaIA(pedido,chamada,ids);chamadas.push(chamada);
      } else falhar();
    }
    if(chamadas.length>5||(!textos.length&&!chamadas.length)||(nativa.stop_reason==='tool_use'&&!chamadas.length))falhar();
    const consumo=lerConsumoIA('anthropic',resposta,requestId);
    return {conteudo:textos.join('\n'),chamadas,truncada:nativa.stop_reason==='max_tokens',modelo:pedido.modelo,provedor:'anthropic',consumo};
  });
}
