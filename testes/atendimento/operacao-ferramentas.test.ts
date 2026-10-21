import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only',()=>({}));
import { criarFerramentasWoo, criarLeituraFerramentas, criarVozDireta, fontesProdutos,buscaCatalogo } from '../../src/lib/atendimento/operacao-ferramentas';
import { criarProvedorEvidenciasDireto } from '../../src/lib/atendimento/ia-orquestrador-direto';
import { temaPergunta, validarConfiguracaoAgente,hashTarefaAgente } from '../../src/lib/atendimento/repositorio-agente-pg';
import type { TarefaIA } from '../../src/lib/atendimento/ia-orquestrador';
import { wavFicticio } from './voz-fixtures';
const tarefa:TarefaIA={id:'fixture-mensagem',atorId:'service:donatella-ia',empresaId:'fixture',conversaId:'fixture-conversa',clienteId:'fixture-cliente',versao:1,mensagemOrigemId:'fixture-mensagem',pergunta:'Tábua fictícia',tema:'produto'};
const config={site:'https://loja.fixture.example',chave:'chave-ficticia',segredo:'segredo-ficticio'};
const produto={id:25,name:'Tábua fictícia',price:'49.90',stock_status:'instock',stock_quantity:2,purchasable:true,status:'publish'};
afterEach(()=>vi.unstubAllEnvs());
it('hash canônico mantém todos os campos após ordenação JSONB, inclusive objetos internos',()=>{
 const a={...tarefa,midia:{tipo:'audio' as const,preservada:false,transcricaoConfiavel:false}};
 const b={...Object.fromEntries(Object.entries(tarefa).reverse()),midia:{transcricaoConfiavel:false,preservada:false,tipo:'audio' as const}} as TarefaIA;
 expect(hashTarefaAgente(a)).toBe(hashTarefaAgente(b));
 expect(hashTarefaAgente({...a,midia:{...a.midia,preservada:true}})).not.toBe(hashTarefaAgente(a));
});
describe('fronteira real de catálogo/pedido, transporte externo simulado',()=>{
 it('extrai busca de conversa natural e faz uma única leitura do catálogo genérico',async()=>{
  expect(buscaCatalogo('Qual é o preço da tábua clássica para 5 pessoas?')).toBe('tábua clássica');
  const f=vi.fn<typeof fetch>(async u=>{expect(String(u)).toBe('https://loja.fixture.example/wp-json/wc/v3/products?per_page=10&status=publish');return Response.json([produto]);});
  const ler=criarLeituraFerramentas({woo:criarFerramentasWoo(config,f),vinculoPedido:async()=>null,agenda:async()=>[],entrega:async()=>[]});
  expect(await ler('search_products',{...tarefa,pergunta:'Quais produtos vocês têm?'},new AbortController().signal)).toHaveLength(1);expect(f).toHaveBeenCalledTimes(1);
 });
 it('consulta Woo nativo sem chaves em URL e preserva preço decimal exato',async()=>{
  const transport=vi.fn(async(u,o)=>{expect(String(u)).toBe('https://loja.fixture.example/wp-json/wc/v3/products?search=T%C3%A1bua+fict%C3%ADcia&per_page=10&status=publish');expect(o!.redirect).toBe('error');expect(o!.headers).toHaveProperty('Authorization');return Response.json([produto]);});
  const p=await criarFerramentasWoo(config,transport).produtos(tarefa.pergunta,new AbortController().signal);
  expect(fontesProdutos(tarefa,p,100)[0]).toMatchObject({conteudo:'Tábua fictícia: R$ 49,90. Disponibilidade consultada agora: disponível.',fim:60100,origem:'ferramenta',tema:'produto'});
 });
 it('mudança de conteúdo muda versão, sem inferir estoque inexistente',()=>{
  const a=fontesProdutos(tarefa,[produto]),b=fontesProdutos(tarefa,[{...produto,price:'50.00',stock_quantity:null,stock_status:'onbackorder'}]);
  expect(b[0].versao).not.toBe(a[0].versao);expect(b[0].conteudo).toContain('sujeito à confirmação humana');expect(b[0].conteudo).not.toContain('null');
 });
 it.each(['http://loja.fixture.example','https://127.0.0.1','https://loja.fixture.example:8443','https://usuario:senha@loja.fixture.example','https://localhost'])('recusa destino não autorizado %s',site=>{expect(()=>criarFerramentasWoo({...config,site})).toThrow('WOO_CONFIGURACAO_INVALIDA');});
 it('pedido só acessa o cliente vinculado e não expõe o corpo do fornecedor',async()=>{
  const api=criarFerramentasWoo(config,async()=>Response.json({id:7,customer_id:19,status:'processing',billing:{email:'ficticio@example.invalid'}}));
  expect(await api.pedido({numero:7,clienteWooId:19},new AbortController().signal)).toEqual({numero:7,estado:'processing'});
  await expect(api.pedido({numero:7,clienteWooId:22},new AbortController().signal)).rejects.toThrow('WOO_PEDIDO_ESCOPO_RECUSADO');
 });
 it('recusa dados comerciais inválidos e respostas excessivas',async()=>{
  await expect(criarFerramentasWoo(config,async()=>Response.json([{...produto,price:'de graça'}])).produtos('tábua',new AbortController().signal)).rejects.toThrow('WOO_PRODUTO_INVALIDO');
  await expect(criarFerramentasWoo(config,async()=>new Response('x',{headers:{'content-length':'999999'}})).produtos('tábua',new AbortController().signal)).rejects.toThrow('WOO_LEITURA_INDISPONIVEL');
 });
 it('catálogo ausente não produz fato fictício; pedido sem vínculo não faz rede',async()=>{
  const fn=criarLeituraFerramentas({vinculoPedido:async()=>null,agenda:async()=>[],entrega:async()=>[]});
  await expect(fn('search_products',tarefa,new AbortController().signal)).rejects.toThrow('WOO_NAO_CONFIGURADO');
  await expect(fn('get_order',{...tarefa,tema:'pedido'},new AbortController().signal)).rejects.toThrow('WOO_PEDIDO_NAO_VINCULADO');
  expect(await fn('available_slots',{...tarefa,tema:'agenda'},new AbortController().signal)).toEqual([]);
 });
});
describe('voz e visão, contratos nativos sem inferência real',()=>{
 it('transcrição usa bytes preservados, Scribe direto e retorno bounded',async()=>{
  const audio=wavFicticio();const f=vi.fn(async(url,o)=>{expect(url).toBe('https://api.elevenlabs.io/v1/speech-to-text');const body=o!.body as FormData;expect(body.get('model_id')).toBe('scribe_v1');expect(body.get('language_code')).toBe('por');expect(body.get('use_multi_channel')).toBe('false');expect((body.get('file') as File).size).toBe(audio.length);return Response.json({text:'Pergunta fictícia sobre produto'});});
  expect(await criarVozDireta({chave:'ficticia'},f).transcrever(audio,'audio/wav',new AbortController().signal)).toMatchObject({texto:'Pergunta fictícia sobre produto',modelo:'scribe_v1'});
 });
 it('TTS exige voz configurada, envia texto literal e recebe bytes físicos',async()=>{
  await expect(criarVozDireta({chave:'fixture'}).sintetizar('Texto fictício',new AbortController().signal)).rejects.toThrow('VOZ_ID_NAO_CONFIGURADO');
  const f=vi.fn(async(u,o)=>{expect(u).toBe('https://api.elevenlabs.io/v1/text-to-speech/vozFixture');expect(JSON.parse(o!.body as string)).toEqual({text:'Texto fictício',model_id:'eleven_turbo_v2_5'});return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'audio/mpeg'}});});
  expect((await criarVozDireta({chave:'fixture',vozId:'vozFixture'},f).sintetizar('Texto fictício',new AbortController().signal)).bytes.length).toBe(3);
 });
 it('falha de voz não retorna transcrição inventada e não vaza resposta/chave',async()=>{
  await expect(criarVozDireta({chave:'fixture-secret'},async()=>new Response('token confidencial fixture',{status:401})).transcrever(wavFicticio(),'audio/wav',new AbortController().signal)).rejects.toThrow(/^VOZ_TRANSCRICAO_INDISPONIVEL$/);
 });
 it('cancelamento e MIME ativo recusam mídia sem chamar fornecedor',async()=>{
  const f=vi.fn();const api=criarVozDireta({chave:'fixture'},f),c=new AbortController();c.abort();
  await expect(api.transcrever(new Uint8Array([1]),'audio/ogg',c.signal)).rejects.toThrow('VOZ_AUDIO_INVALIDO');
  await expect(api.transcrever(new Uint8Array([1]),'text/html',new AbortController().signal)).rejects.toThrow('VOZ_AUDIO_INVALIDO');expect(f).not.toHaveBeenCalled();
 });
 it('modelo recebe imagem local e contexto como dados, separados do sistema',async()=>{
  vi.stubEnv('ATENDIMENTO_IA_HABILITADA','true');
  const f=vi.fn(async(_u,o)=>{const p=JSON.parse(o!.body as string);expect(p.messages[0].content[0]).toEqual({type:'image',source:{type:'base64',media_type:'image/png',data:'AQID'}});const dados=JSON.parse(p.messages[0].content[1].text);expect(dados.contextoRecenteNaoConfiavel).toEqual([{autor:'humano',texto:'Contexto fixture'}]);expect(p.system).not.toContain('Contexto fixture');return Response.json({content:[{type:'text',text:'{"selecoes":[],"pedirApoio":true}'}],stop_reason:'end_turn'});});
  expect(await criarProvedorEvidenciasDireto({chave:'fixture',modelo:'claude-sonnet-4-5',maxTokens:100},f)({sistema:'Sistema fixture',perguntaNaoConfiavel:'Pergunta fixture',fontes:[],contextoRecente:[{autor:'humano',texto:'Contexto fixture'}],imagem:{mime:'image/png',base64:'AQID'}},new AbortController().signal)).toEqual({selecoes:[],pedirApoio:true});
 });
});
it('configuração exige orçamento positivo e classificador não ignora revisão humana',()=>{
 expect(temaPergunta('Preciso de um reembolso')).toBe('excecao');expect(temaPergunta('Tenho alergia')).toBe('alergia');expect(temaPergunta('Quanto custa a tábua?')).toBe('preco');
 expect(()=>validarConfiguracaoAgente({modo:'automatico',modelo:'claude-sonnet-4-5',maxTokens:512,equipeApoio:'apoio',limites:{maxChamadas:3,custoPorChamadaCentavos:0,maxCustoCentavos:0,maxDuracaoMs:5000,timeoutChamadaMs:1000},custoCentavosDia:0,autoridadeAutomatica:false,grupoExterno:'indisponivel'})).toThrow('AGENTE_ORCAMENTO_NAO_AUTORIZADO');
});
