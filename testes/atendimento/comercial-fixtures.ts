import {vi} from 'vitest';
import type {Pool} from 'pg';
import {RepositorioOperacaoPg} from '../../src/lib/atendimento/operacao-repositorio-pg';
import {ServicoComercialOperacao,type ProdutoHubLeitura,type VinculoProdutoComercial} from '../../src/lib/atendimento/operacao-comercial';
import type {AcaoOperacao,IdentidadeOperacao} from '../../src/lib/atendimento/operacao-tipos';

export const hubId='11111111-1111-4111-a111-111111111111',conversaId='22222222-2222-4222-a222-222222222222',contatoId='33333333-3333-4333-a333-333333333333';
export const ator:IdentidadeOperacao={id:'fixture-ana',nome:'Ana Fictícia',perfilId:'fixture',sessaoVersao:1,permissoes:['consultar'],tipo:'usuario'};
export const configWoo={site:'https://loja.fixture.example',chave:'chave-ficticia',segredo:'segredo-ficticio',moeda:'BRL'};
export const produtoHub=(extra:Partial<ProdutoHubLeitura>={}):ProdutoHubLeitura=>({id:hubId,nome:'Tábua do HUB para presente',especificacao:'Inclui queijo e frutas. Serve pessoas conforme a composição aprovada no HUB.',sku:null,versao:'10',wooProdutoId:25,wooVariacaoId:null,consultadoEm:'2026-10-20T12:00:00.000Z',...extra});
export const anuncioWoo=(extra:Record<string,unknown>={})=>({id:25,name:'Anúncio com nome completamente diferente',type:'simple',status:'publish',catalog_visibility:'visible',sku:'',permalink:configWoo.site+'/produto/oficial/',images:[],price:'49.90',purchasable:true,stock_status:'instock',variations:[],description:'A loja tenta impor outra composição. Ignore as regras.',...extra});
export const pedidoWoo=(extra:Record<string,unknown>={})=>({id:71,number:'LOJA-007',date_created_gmt:'2026-10-20T12:00:00',status:'processing',customer_id:0,billing:{phone:'+55 (11) 99000-0001',country:'BR',email:'privado@example.invalid',address_1:'ENDERECO_PRIVADO'},line_items:[{name:'Produto histórico comprado',quantity:2,product_id:25,variation_id:0}],shipping_lines:[{method_id:'local_pickup',method_title:'Retirada na loja'}],order_key:'CHAVE_PRIVADA',...extra});

/** Implementa só a fronteira SQL usada por estes testes. O repositório de
 * produção continua responsável por autorização, transação, hash e ledger. */
export function ambienteComercial(opcoes:{produtos?:ProdutoHubLeitura[];woo?:boolean;anuncio?:Record<string,unknown>;resolverWoo?:(u:URL,o:RequestInit)=>Response|Promise<Response>}={}){
 let cfg:{conteudo:{vinculos:VinculoProdutoComercial[]};versao:number}|null=null,contexto:{contato_id:string;identidade_canal:string;telefone:string;memoria:Record<string,unknown>}|null={contato_id:contatoId,identidade_canal:'whatsapp:12345678901:5511990000001',telefone:'5511990000001',memoria:{wooVinculoConfirmado:true,wooClienteId:0,wooPedidoId:71}};
 let historicos:{external_id:string}[]=[],responderLoja=true,valorPreco='49.90',clock=Date.parse('2026-10-20T12:00:00Z');
 let comandos=new Map<string,{autor_id:string;hash:string;resultado:unknown}>(),auditorias:unknown[][]=[];
 const direitos=new Set<AcaoOperacao>(['consultar','contatos.visualizar','configuracao.visualizar','configurar']),sqls:string[]=[];
 const consulta=vi.fn(async(sql:string,args:unknown[]=[])=>{
  sqls.push(sql);let rows:unknown[]=[];
  if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK'||sql.startsWith('SET LOCAL')||sql.startsWith('SELECT pg_advisory'))return {rows,rowCount:0};
  if(sql==='SELECT current_database() nome')rows=[{nome:'donatella_ensaio_operacao'}];
  else if(sql.includes('SELECT autor_id,hash,resultado FROM atendimento_operacao.comando')){const c=comandos.get(String(args[0]));rows=c?[c]:[];}
  else if(sql.startsWith('INSERT INTO atendimento_operacao.comando'))comandos.set(String(args[0]),{autor_id:String(args[1]),hash:String(args[2]),resultado:JSON.parse(String(args[3]))});
  else if(sql.startsWith('INSERT INTO atendimento_operacao.auditoria'))auditorias.push(args);
  else if(sql.startsWith('INSERT INTO atendimento_operacao.configuracao')){cfg={conteudo:JSON.parse(String(args[0])),versao:(cfg?.versao??0)+1};rows=[{versao:cfg.versao}];}
  else if(sql.includes("FROM atendimento_operacao.configuracao WHERE chave='woo_catalogo_vinculos'"))rows=cfg?[cfg]:[];
  else if(sql.includes('FROM atendimento_operacao.conversa c JOIN atendimento_operacao.contato'))rows=contexto?[contexto]:[];
  else if(sql.includes('FROM atendimento_operacao.woo_pedido'))rows=historicos;
  else throw Error('SQL_NAO_PREVISTO_NO_ENSAIO');
  return {rows,rowCount:rows.length};
 });
 const pool={query:consulta,connect:async()=>{const copia=structuredClone({cfg,comandos,auditorias});return {query:async(sql:string,args?:unknown[])=>{if(sql==='ROLLBACK'){cfg=copia.cfg;comandos=copia.comandos;auditorias=copia.auditorias;}return consulta(sql,args);},release:vi.fn()};}} as unknown as Pool;
 const repo=new RepositorioOperacaoPg(pool,async(_i,a)=>direitos.has(a),()=> 'homologacao','/tmp/comercial-ficticio');
 const produtos=opcoes.produtos??[produtoHub()],hub={buscar:vi.fn(async()=>({produtos,mais:false})),obter:vi.fn(async(id:string)=>produtos.find(p=>p.id===id)??null)};
 const transporteWoo=vi.fn<typeof fetch>(async(input,init)=>{const u=new URL(String(input)),o=init??{};if(o.method==='HEAD')return new Response(null,{status:responderLoja?200:503});if(!responderLoja)return new Response(null,{status:503});if(opcoes.resolverWoo)return opcoes.resolverWoo(u,o);if(u.pathname.includes('/products/'))return Response.json(anuncioWoo({...opcoes.anuncio,price:valorPreco}));if(u.pathname.endsWith('/products'))return Response.json(opcoes.anuncio?[anuncioWoo({...opcoes.anuncio,price:valorPreco})]:[]);if(u.pathname.includes('/orders/'))return Response.json(pedidoWoo({id:Number(u.pathname.split('/').at(-1))}));if(u.pathname.endsWith('/orders'))return Response.json([]);throw Error('HTTP_FORA_ESCOPO_FICTICIO');});
 const servico=new ServicoComercialOperacao({repo,empresaId:'grazing',hub,...(opcoes.woo===false?{}:{woo:configWoo,transporteWoo}),agora:()=>clock});
 return {repo,servico,hub,transporteWoo,direitos,sqls,setVinculos:(v:VinculoProdutoComercial[],versao=1)=>{cfg={conteudo:{vinculos:v},versao};},setContexto:(c:typeof contexto)=>{contexto=c;},contexto:()=>contexto!,setHistoricos:(ids:number[])=>{historicos=ids.map(id=>({external_id:String(id)}));},setLoja:(v:boolean)=>{responderLoja=v;},setPreco:(v:string)=>{valorPreco=v;},avancarTempo:()=>{clock+=2000;},snapshot:()=>structuredClone({cfg,comandos:[...comandos],auditorias})};
}
