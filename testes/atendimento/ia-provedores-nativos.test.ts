import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {responderIADireta,continuarPedidoIADireta,FalhaProvedorIA,type PedidoIADireta,type ProvedorIA} from '../../src/lib/atendimento/ia-direta';
const modelos={anthropic:'claude-sonnet-4-5',google:'gemini-3-flash-preview',openai:'gpt-5.4'};
const pedido=(provedor:ProvedorIA):PedidoIADireta=>({provedor,chave:'credencial-somente-ficticia',modelo:modelos[provedor],sistema:'Política fictícia preservada',maxTokens:100,mensagens:[{role:'user',content:'Pergunta fictícia com catálogo'}],ferramentas:[{type:'function',function:{name:'search_products',description:'Catálogo autorizado',parameters:{type:'object',properties:{query:{type:'string'}},required:['query']}}}]});
const respostaOpenAI=(output:unknown[],extra:Record<string,unknown>={})=>Response.json({id:'resp_ficticia',model:'gpt-5.4-2026-03-05',status:'completed',output,usage:{input_tokens:17,output_tokens:9,total_tokens:26,input_tokens_details:{cached_tokens:4},output_tokens_details:{reasoning_tokens:3}},...extra},{headers:{'x-request-id':'req_ficticia'}});
const respostaGoogle=(parts:unknown[],extra:Record<string,unknown>={})=>Response.json({responseId:'gemini_ficticia',modelVersion:'gemini-3-flash-preview',candidates:[{finishReason:'STOP',content:{role:'model',parts}}],usageMetadata:{promptTokenCount:20,candidatesTokenCount:8,totalTokenCount:31,cachedContentTokenCount:2,thoughtsTokenCount:3,toolUsePromptTokenCount:1},...extra});
beforeEach(()=>vi.stubEnv('ATENDIMENTO_IA_HABILITADA','true'));afterEach(()=>vi.unstubAllEnvs());
describe('adaptadores nativos, sem chamadas externas',()=>{
 it('OpenAI usa Responses com instruções e imagem inline, sem chave em URL ou armazenamento',async()=>{
  const p={...pedido('openai'),imagem:{mime:'image/png' as const,base64:'AQID'}};
  const f=vi.fn<typeof fetch>(async(url,o)=>{expect(url).toBe('https://api.openai.com/v1/responses');expect(new Headers(o?.headers).get('authorization')).toBe('Bearer '+p.chave);expect(o?.redirect).toBe('error');const b=JSON.parse(String(o?.body));expect(b.instructions).toBe(p.sistema);expect(b.store).toBe(false);expect(b.max_output_tokens).toBe(100);expect(b.tools[0]).toMatchObject({type:'function',name:'search_products',strict:false});expect(b.input[0].content[1].image_url).toBe('data:image/png;base64,AQID');return respostaOpenAI([{type:'message',role:'assistant',content:[{type:'output_text',text:'Resposta fictícia'}]}]);});
  const r=await responderIADireta(p,f);expect(r.provedor).toBe('openai');expect(r.consumo).toMatchObject({observado:true,tokensEntrada:17,tokensSaida:9,tokensTotal:26,tokensCacheLeitura:4,tokensRaciocinio:3,requisicaoId:'req_ficticia'});expect(f).toHaveBeenCalledTimes(1);
 });
 it('OpenAI conserva reasoning opaco, chamada e resposta de ferramenta junto com a imagem anterior',async()=>{
  const p={...pedido('openai'),imagem:{mime:'image/png' as const,base64:'AQID'}},reasoning={id:'rs_ficticio',type:'reasoning',encrypted_content:'conteudo-opaco-ficticio',summary:[]},call={type:'function_call',call_id:'call_catalogo',name:'search_products',arguments:'{"query":"fictício"}',status:'completed'};
  const r=await responderIADireta(p,async()=>respostaOpenAI([reasoning,call]));const continuado=continuarPedidoIADireta(p,r,[{id:r.chamadas[0].id,conteudo:'{"produtos":[]}'}]);
  await responderIADireta(continuado,async(_url,o)=>{const b=JSON.parse(String(o?.body));expect(b.input).toContainEqual(reasoning);expect(b.input).toContainEqual(call);expect(b.input).toContainEqual({type:'function_call_output',call_id:'call_catalogo',output:'{"produtos":[]}'});expect(b.input[0].content[1].image_url).toBe('data:image/png;base64,AQID');return respostaOpenAI([{type:'message',role:'assistant',content:[{type:'output_text',text:'Sem produto fictício'}]}]);});
 });
 it('Gemini usa chave em header, parâmetros JSON nativos e imagem sem URL remota',async()=>{
  const p={...pedido('google'),imagem:{mime:'image/jpeg' as const,base64:'AQID'}};
  const r=await responderIADireta(p,async(url,o)=>{expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent');expect(String(url)).not.toContain(p.chave);expect(new Headers(o?.headers).get('x-goog-api-key')).toBe(p.chave);const b=JSON.parse(String(o?.body));expect(b.systemInstruction.parts[0].text).toBe(p.sistema);expect(b.contents[0].parts[0].inlineData).toEqual({mimeType:'image/jpeg',data:'AQID'});expect(b.tools[0].functionDeclarations[0].parametersJsonSchema).toEqual(p.ferramentas![0].function.parameters);expect(b.generationConfig).toEqual({candidateCount:1,maxOutputTokens:100});return respostaGoogle([{text:'Resposta fictícia'}]);});
  expect(r.provedor).toBe('google');expect(r.consumo).toMatchObject({observado:true,tokensEntrada:20,tokensSaida:8,tokensTotal:31,tokensRaciocinio:3,tokensCacheLeitura:2,tokensFerramentas:1});
 });
 it('Gemini preserva thought signatures e resultados paralelos na ordem das chamadas',async()=>{
  const p=pedido('google'),parts=[{text:'Pensamento privado fictício',thought:true},{functionCall:{name:'search_products',args:{query:'A'}},thoughtSignature:'assinatura-opaca-ficticia'},{functionCall:{name:'search_products',args:{query:'B'}}}];
  const r=await responderIADireta(p,async()=>respostaGoogle(parts));expect(r.conteudo).toBe('');expect(r.chamadas.length).toBe(2);
  const proximo=continuarPedidoIADireta(p,r,[{id:r.chamadas[1].id,conteudo:'Resultado B'},{id:r.chamadas[0].id,conteudo:'{"produto":"A"}'}]);
  await responderIADireta(proximo,async(_url,o)=>{const b=JSON.parse(String(o?.body));expect(b.contents[1].parts).toEqual(parts);expect(b.contents[2].parts).toEqual([{functionResponse:{name:'search_products',response:{produto:'A'}}},{functionResponse:{name:'search_products',response:{output:'Resultado B'}}}]);return respostaGoogle([{text:'Final fictício'}]);});
 });
 it('Gemini preserva ID nativo quando presente',async()=>{
  const p=pedido('google'),r=await responderIADireta(p,async()=>respostaGoogle([{functionCall:{id:'call_google',name:'search_products',args:{query:'A'}},thoughtSignature:'sig'}]));expect(r.chamadas[0].id).toBe('call_google');
  await responderIADireta(continuarPedidoIADireta(p,r,[{id:'call_google',conteudo:'Resultado'}]),async(_url,o)=>{const b=JSON.parse(String(o?.body));expect(b.contents[2].parts[0].functionResponse.id).toBe('call_google');return respostaGoogle([{text:'Final'}]);});
 });
 it('Anthropic permanece disponível com ferramentas e consumo próprios',async()=>{
  const r=await responderIADireta(pedido('anthropic'),async()=>Response.json({id:'msg_ficticia',model:'claude-sonnet-4-5-20250929',content:[{type:'text',text:'Fictícia'}],stop_reason:'end_turn',usage:{input_tokens:12,output_tokens:8,cache_read_input_tokens:6,cache_creation_input_tokens:3}}));expect(r.provedor).toBe('anthropic');expect(r.consumo).toMatchObject({observado:true,tokensEntrada:12,tokensSaida:8,tokensCacheLeitura:6,tokensCacheGravacao:3});
 });
 it.each<ProvedorIA>(['anthropic','google','openai'])('%s sem chave não usa outro fornecedor',async provedor=>{
  const f=vi.fn<typeof fetch>();await expect(responderIADireta({...pedido(provedor),chave:''},f)).rejects.toThrow('IA_PROVEDOR_NAO_CONFIGURADO');expect(f).not.toHaveBeenCalled();
 });
 it.each<ProvedorIA>(['anthropic','google','openai'])('%s timeout após POST é incerto e não é repetido',async provedor=>{
  const f=vi.fn<typeof fetch>(async()=>{throw Error('erro privado com credencial fictícia');});const erro=await responderIADireta(pedido(provedor),f).catch(e=>e);expect(erro).toBeInstanceOf(FalhaProvedorIA);expect(erro).toMatchObject({message:'IA_INDISPONIVEL',provedor,resultado:'incerto'});expect(String(erro)).not.toContain('credencial');expect(f).toHaveBeenCalledTimes(1);
 });
 it('recusa HTTP 401 sem ecoar corpo ou repetir e mantém HTTP 503 incerto',async()=>{
  for(const [status,resultado] of [[401,'recusado'],[503,'incerto']] as const){const f=vi.fn<typeof fetch>(async()=>Response.json({erro:'conteúdo privado'},{status})),e=await responderIADireta(pedido('openai'),f).catch(e=>e);expect(e.resultado).toBe(resultado);expect(String(e)).not.toContain('privado');expect(f).toHaveBeenCalledTimes(1);}
 });
 it('não aceita ferramenta não oferecida, duplicada, saída remota ou função arbitrária',async()=>{
  for(const output of [[{type:'function_call',call_id:'id',name:'enviar_whatsapp',arguments:'{}'}],[{type:'function_call',call_id:'id',name:'search_products',arguments:'{}'},{type:'function_call',call_id:'id',name:'search_products',arguments:'{}'}],[{type:'web_search_call',id:'busca-nao-oferecida'}]])await expect(responderIADireta(pedido('openai'),async()=>respostaOpenAI(output))).rejects.toThrow('IA_INDISPONIVEL');
  await expect(responderIADireta(pedido('google'),async()=>respostaGoogle([{functionCall:{name:'enviar_whatsapp',args:{}}}]))).rejects.toThrow('IA_INDISPONIVEL');
 });
 it('truncamento é explícito, inclusive quando só raciocínio foi retornado',async()=>{
  const o=await responderIADireta(pedido('openai'),async()=>respostaOpenAI([{type:'reasoning',summary:[],encrypted_content:'sig'}],{status:'incomplete',incomplete_details:{reason:'max_output_tokens'}}));expect(o.truncada).toBe(true);expect(o.conteudo).toBe('');
  const g=await responderIADireta(pedido('google'),async()=>respostaGoogle([{text:'Pensamento',thought:true}],{candidates:[{finishReason:'MAX_TOKENS',content:{role:'model',parts:[{text:'Pensamento',thought:true}]}}]}));expect(g.truncada).toBe(true);
 });
 it('não confunde ausência de usage com zero observado',async()=>{
  const r=await responderIADireta(pedido('google'),async()=>respostaGoogle([{text:'Fictícia'}],{usageMetadata:undefined}));expect(r.consumo.observado).toBe(false);expect(r.consumo.tokensEntrada).toBeUndefined();
 });
 it('chave e modelo incompatíveis, tool result inválido e GIF no Gemini não iniciam POST',async()=>{
  const f=vi.fn<typeof fetch>();for(const p of [{...pedido('openai'),modelo:'claude-sonnet-4-5'},{...pedido('google'),imagem:{mime:'image/gif' as const,base64:'AQID'}},{...pedido('openai'),mensagens:[{role:'tool' as const,tool_call_id:'ausente',content:'Texto'}]}])await expect(responderIADireta(p,f)).rejects.toThrow();expect(f).not.toHaveBeenCalled();
 });
 it('continuação não troca provedor/modelo, não perde assinatura e não aceita resultado parcial',async()=>{
  const p=pedido('google'),r=await responderIADireta(p,async()=>respostaGoogle([{functionCall:{name:'search_products',args:{query:'A'}},thoughtSignature:'sig'}]));
  expect(()=>continuarPedidoIADireta({...p,provedor:'openai'},r,[{id:r.chamadas[0].id,conteudo:'x'}])).toThrow('IA_CONTINUIDADE_INVALIDA');expect(()=>continuarPedidoIADireta(p,r,[])).toThrow('IA_CONTINUIDADE_INVALIDA');
  const proximo=continuarPedidoIADireta(p,r,[{id:r.chamadas[0].id,conteudo:'x'}]);proximo.mensagens[1].continuidade=undefined;const f=vi.fn<typeof fetch>();await expect(responderIADireta(proximo,f)).rejects.toThrow('IA_CONTINUIDADE_OBRIGATORIA');expect(f).not.toHaveBeenCalled();
 });
 it('resposta excessiva e usage malformado falham sem nova tentativa',async()=>{
  const f=vi.fn<typeof fetch>(async()=>new Response('x'.repeat(2*1024*1024+1)));await expect(responderIADireta(pedido('openai'),f)).rejects.toThrow('IA_INDISPONIVEL');expect(f).toHaveBeenCalledTimes(1);
  await expect(responderIADireta(pedido('google'),async()=>respostaGoogle([{text:'Texto'}],{usageMetadata:{promptTokenCount:-1,candidatesTokenCount:1}}))).rejects.toThrow('IA_INDISPONIVEL');
 });
 it('falha na saída mantém o consumo já observado, sem aceitar ferramentas proibidas',async()=>{
  const f=vi.fn<typeof fetch>(async()=>respostaOpenAI([{type:'web_search_call',id:'nao-autorizado'}]));
  const e=await responderIADireta(pedido('openai'),f).catch(e=>e);
  expect(e).toMatchObject({resultado:'incerto',consumo:{observado:true,tokensEntrada:17,tokensSaida:9,tokensRaciocinio:3,requisicaoId:'req_ficticia'}});expect(f).toHaveBeenCalledTimes(1);
 });
 it('Anthropic não aceita argumento retornado maior que o contrato64KB',async()=>{
  const f=vi.fn<typeof fetch>(async()=>Response.json({content:[{type:'tool_use',id:'call',name:'search_products',input:{query:'x'.repeat(64001)}}],stop_reason:'tool_use',usage:{input_tokens:12,output_tokens:8}}));
  const e=await responderIADireta(pedido('anthropic'),f).catch(e=>e);
  expect(e).toMatchObject({resultado:'incerto',consumo:{observado:true,tokensEntrada:12,tokensSaida:8}});expect(f).toHaveBeenCalledTimes(1);
 });
});
