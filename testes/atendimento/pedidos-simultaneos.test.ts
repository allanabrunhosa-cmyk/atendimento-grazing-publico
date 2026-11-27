import {afterEach,expect,it,vi} from 'vitest';
import {criarClienteOperacao,ErroOperacao} from '../../apps/atendimento-chat-consulta/operacao-api';
const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json'}});
const caminho=(u:unknown)=>new URL(String(u),'https://ensaio.invalid').pathname.replace('/api/atendimento/operacao','');
const sessao={usuario:{id:'ficticio',nome:'Pessoa fictícia',perfilId:'perfil',permissoes:['consultar','ia.visualizar','ia.editar']},csrf:'csrf-ficticio',modo:'homologacao',escritasReais:false};
afterEach(()=>{vi.useRealTimers();});

it('manda no máximo três pedidos por vez e atende todos',async()=>{
 let ativos=0,maximo=0;
 const f=vi.fn<typeof fetch>(async()=>{ativos++;maximo=Math.max(maximo,ativos);await new Promise(r=>setTimeout(r,5));ativos--;return json({ok:true});});
 const c=criarClienteOperacao(f,'ensaio');
 const r=await Promise.all(Array.from({length:8},()=>c.consultarComercial('/comercial/status')));
 expect(r).toHaveLength(8);expect(f).toHaveBeenCalledTimes(8);expect(maximo).toBe(3);
});

it('repete até duas vezes a leitura recusada por sobrecarga',async()=>{
 vi.useFakeTimers();
 const respostas=[json({erro:'OPERACAO_FALHOU',referencia:'ficticia'},503),json({ok:true})];
 const f=vi.fn<typeof fetch>(async()=>respostas.shift()!);
 const lida=criarClienteOperacao(f,'ensaio').consultarComercial('/comercial/status');
 await vi.advanceTimersByTimeAsync(300);
 await expect(lida).resolves.toEqual({ok:true});expect(f).toHaveBeenCalledTimes(2);

 const g=vi.fn<typeof fetch>(async()=>json({erro:'SERVICO_OCUPADO'},503));
 const recusada=criarClienteOperacao(g,'ensaio').consultarComercial('/comercial/status').catch((e:unknown)=>e);
 await vi.advanceTimersByTimeAsync(1300);
 const e=await recusada;expect(e).toBeInstanceOf(ErroOperacao);expect(e).toMatchObject({codigo:'INDISPONIVEL',status:503});expect(g).toHaveBeenCalledTimes(3);
});

it('não repete 503 sem código de sobrecarga nem escrita',async()=>{
 const f=vi.fn<typeof fetch>(async()=>json({},503));
 await expect(criarClienteOperacao(f,'ensaio').consultarComercial('/comercial/status')).rejects.toMatchObject({codigo:'INDISPONIVEL',status:503});
 expect(f).toHaveBeenCalledTimes(1);

 const g=vi.fn<typeof fetch>(async u=>caminho(u)==='/sessao'?json(sessao):json({erro:'OPERACAO_FALHOU'},503));
 const c=criarClienteOperacao(g,'ensaio');await c.sessao();
 await expect(c.configurarPromptCentral({texto:'Base fictícia.',versao:0,idempotencia:'33333333-3333-4333-8333-333333333333'})).rejects.toMatchObject({codigo:'RESULTADO_INCERTO'});
 expect(g.mock.calls.map(([u])=>caminho(u))).toEqual(['/sessao','/agente/prompt/configurar']);
});

it('quem desiste na fila sai sem ocupar vaga',async()=>{
 const soltar:(()=>void)[]=[];
 const f=vi.fn<typeof fetch>(()=>new Promise<Response>(r=>soltar.push(()=>r(json({ok:true})))));
 const c=criarClienteOperacao(f,'ensaio');
 const presos=Array.from({length:3},()=>c.consultarComercial('/comercial/status'));
 const a=new AbortController(),desistente=c.consultarComercial('/comercial/pedidos',a.signal).catch((e:unknown)=>e);
 await vi.waitFor(()=>expect(f).toHaveBeenCalledTimes(3));
 a.abort();expect(await desistente).toMatchObject({name:'AbortError'});
 for(const s of soltar.splice(0))s();await Promise.all(presos);
 const depois=c.consultarComercial('/comercial/status');
 await vi.waitFor(()=>expect(f).toHaveBeenCalledTimes(4));soltar.shift()!();
 await expect(depois).resolves.toEqual({ok:true});
 expect(f.mock.calls.map(([u])=>caminho(u))).not.toContain('/comercial/pedidos');
});

it('teste da Donatella não espera na fila',async()=>{
 const soltar:(()=>void)[]=[];
 const f=vi.fn<typeof fetch>(async u=>caminho(u)==='/sessao'?json(sessao):caminho(u)==='/agente/testar'?json({},500):new Promise<Response>(r=>soltar.push(()=>r(json({ok:true})))));
 const c=criarClienteOperacao(f,'ensaio');await c.sessao();
 const presos=Array.from({length:3},()=>c.consultarComercial('/comercial/status'));
 await vi.waitFor(()=>expect(f).toHaveBeenCalledTimes(4));
 await expect(c.testarAgente({pergunta:'Pergunta fictícia',versao:1,idempotencia:'44444444-4444-4444-8444-444444444444'})).rejects.toBeInstanceOf(ErroOperacao);
 expect(caminho(f.mock.calls[4][0])).toBe('/agente/testar');
 for(const s of soltar.splice(0))s();await Promise.all(presos);
});
