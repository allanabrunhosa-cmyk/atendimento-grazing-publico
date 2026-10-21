import { afterEach,beforeEach,expect,it,vi } from 'vitest';
vi.mock('server-only',()=>({}));
import { responderIADireta } from '@/lib/atendimento/ia-direta';
const pedido={chave:'chave-exclusivamente-ficticia',modelo:'claude-sonnet-4-5',sistema:'Prompt fictício',maxTokens:100,
  mensagens:[{role:'user' as const,content:'Pergunta fictícia'}],
  ferramentas:[{type:'function' as const,function:{name:'search_products',description:'Buscar catálogo',parameters:{type:'object'}}}]};
beforeEach(()=>vi.stubEnv('ATENDIMENTO_IA_HABILITADA','true'));afterEach(()=>vi.unstubAllEnvs());
it('usa endpoint nativo, prompt separado e ferramentas sem gateway Lovable',async()=>{
 const fetcher=vi.fn(async(url: unknown,opcoes?:RequestInit)=>{
   expect(url).toBe('https://api.anthropic.com/v1/messages');const body=JSON.parse(String(opcoes?.body));
   expect(body.system).toBe(pedido.sistema);expect(body.messages[0].role).toBe('user');expect(body.tools[0].input_schema.type).toBe('object');
   expect(opcoes?.redirect).toBe('error');return Response.json({content:[{type:'tool_use',id:'tool_1',name:'search_products',input:{query:'fictício'}}],stop_reason:'tool_use'});
 });
 const r=await responderIADireta(pedido,fetcher);expect(r.chamadas[0].function.name).toBe('search_products');expect(r.truncada).toBe(false);
});
it('preserva vínculo entre chamada anterior e resultado sem executar ferramenta',async()=>{
 const mensagens=[...pedido.mensagens,{role:'assistant' as const,content:null,tool_calls:[{id:'tool_1',type:'function' as const,function:{name:'search_products',arguments:'{"query":"fictício"}'}}]},
   {role:'tool' as const,tool_call_id:'tool_1',content:'Resultado fictício'}];
 await responderIADireta({...pedido,mensagens},async(_url,opts)=>{
   const body=JSON.parse(String(opts?.body));expect(body.messages[2].content[0]).toEqual({type:'tool_result',tool_use_id:'tool_1',content:'Resultado fictício'});
   return Response.json({content:[{type:'text',text:'Resposta fictícia'}],stop_reason:'end_turn'});
 });
});
it('flag desligada e histórico/ferramenta inválidos impedem transporte',async()=>{
 const f=vi.fn();vi.stubEnv('ATENDIMENTO_IA_HABILITADA','false');await expect(responderIADireta(pedido,f)).rejects.toThrow('IA_DESABILITADA');
 vi.stubEnv('ATENDIMENTO_IA_HABILITADA','true');
 await expect(responderIADireta({...pedido,mensagens:[{role:'tool',tool_call_id:'inexistente',content:'resultado'}]},f)).rejects.toThrow('IA_PEDIDO_INVALIDO');
 await expect(responderIADireta({...pedido,ferramentas:[{type:'function',function:{name:'enviar_whatsapp',description:'não permitido',parameters:{type:'object'}}}]},f)).rejects.toThrow('IA_PEDIDO_INVALIDO');
 expect(f).not.toHaveBeenCalled();
});
it('não ecoa erro privado, recusa ferramenta não oferecida e resposta excessiva',async()=>{
 for(const r of [Response.json({erro:pedido.chave},{status:401}),Response.json({content:[{type:'tool_use',id:'x',name:'enviar_whatsapp',input:{}}],stop_reason:'tool_use'}),new Response('x'.repeat(2*1024*1024+1))])
   await expect(responderIADireta(pedido,async()=>r)).rejects.toThrow('IA_INDISPONIVEL');
});
it('truncamento é explícito para impedir tratar resposta parcial como pronta',async()=>{
 const r=await responderIADireta(pedido,async()=>Response.json({content:[{type:'text',text:'Parcial'}],stop_reason:'max_tokens'}));expect(r.truncada).toBe(true);
});
