import 'server-only';
import type {CredenciaisWoo} from './operacao-ferramentas';
import {normalizarTelefoneWoo} from './operacao-woocommerce-automacoes';
import {identidadeProdutoSemantica,produtosSemanticamenteEquivalentes} from './produto-identidade-semantica';

type Objeto=Record<string,unknown>;
type CandidatoProduto={id:number;nome:string};
type ConsultaCompartilhada<T>={controlador:AbortController;consumidores:number;promessa:Promise<T>};
const objeto=(v:unknown):v is Objeto=>!!v&&typeof v==='object'&&!Array.isArray(v);
const inteiro=(v:unknown,min=1):v is number=>Number.isSafeInteger(v)&&Number(v)>=min;
const texto=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length<=max&&!/[\x00-\x1f\x7f]/.test(v);
const limpar=(v:string,max:number)=>v.replace(/<[^>]*>/g,'').replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,max);
const decimal=(v:unknown):v is string=>typeof v==='string'&&/^\d{1,10}(?:\.\d{1,4})?$/.test(v);
const camposProduto='id,parent_id,name,type,status,catalog_visibility,sku,permalink,images,price,purchasable,stock_status,variations';
const camposVariacao='id,parent_id,status,sku,permalink,image,price,purchasable,stock_status';
const camposCandidato='id,parent_id,name,type,status,catalog_visibility';
// A loja instalada projeta billing.phone/country, mas omite arrays quando
// _fields usa line_items.name ou shipping_lines.method_id. Esses dois arrays
// são lidos no servidor e reduzidos imediatamente; metadata nunca sai daqui.
const camposPedido='id,number,date_created_gmt,status,customer_id,billing.phone,billing.country,line_items,shipping_lines';
const rotulosStatus:Record<string,string>={pending:'Pendente de pagamento',processing:'Processando na loja','on-hold':'Em espera na loja',completed:'Concluído na loja',cancelled:'Cancelado',refunded:'Reembolsado',failed:'Falha na loja','checkout-draft':'Rascunho na loja',trash:'Na lixeira da loja'};

export type VinculoOfertaWoo={hubProdutoId:string;produtoWooId?:number;variacaoWooId?:number;sku?:string;permitirOculto?:true};
export type ProdutoHubParaAssociar={hubProdutoId:string;nome:string;especificacao?:string};
export type OfertaWooConsultada={hubProdutoId:string;produtoWooId:number;variacaoWooId:number|null;sku:string;nomeAnuncio:string;url:string;imagemUrl:string|null;tipo:'simples'|'variavel'|'variacao';preco:{valor:string;moeda:string;tipo:'fixo'|'a_partir'}|null;compravel:true;disponibilidade:'instock'|'onbackorder';consultadoEm:string;avisos:string[]};
export type IdentidadePedidoWoo={telefoneCanonico:string;clienteWooId?:number};
export type PedidoWooAutorizado={pedidoWooId:number;numeroVisivel:string;data:string;estadoBruto:string;rotulo:string;interpretacao:null;itens:{nome:string;quantidade:number;produtoWooId:number;variacaoWooId:number|null}[];modalidadeEntrega:'entrega'|'retirada'|'nao_informada';metodosEntrega:string[];agendamento:null;rastreio:null;consultadoEm:string;avisos:string[]};
export type BuscaPedidosWoo={pedidos:PedidoWooAutorizado[];limitacao:string|null};
export type ConfiguracaoConsultasWoo=CredenciaisWoo&{/** Somente moeda já conferida pelo servidor na própria loja. */moeda?:string};

function lojaValida(c:ConfiguracaoConsultasWoo){
 try{const u=new URL(c.site);if(c.site.trim()!==c.site||u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.port||u.pathname!=='/'||!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(u.hostname)||/\.(?:localhost|local|internal)$/i.test(u.hostname)||!texto(c.chave,512)||!c.chave||c.chave.includes(':')||!texto(c.segredo,512)||!c.segredo||c.moeda!==undefined&&!/^[A-Z]{3}$/.test(c.moeda))throw Error();return u;}catch{throw Error('WOO_CONFIGURACAO_INVALIDA');}
}
function identidadeValida(i:IdentidadePedidoWoo){if(!objeto(i)||!texto(i.telefoneCanonico,15)||!/^[1-9]\d{7,14}$/.test(i.telefoneCanonico)||i.clienteWooId!==undefined&&!inteiro(i.clienteWooId,0))throw Error('WOO_PEDIDO_NAO_VINCULADO');}
function numeroValido(v:unknown):v is string{return texto(v,40)&&/^[\p{L}\p{N}_.\/-]{1,40}$/u.test(v);}
async function jsonLimitado(r:Response){
 if(!r.ok||!r.body||!r.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw Error();
 if(Number(r.headers.get('content-length'))>256*1024){await r.body.cancel();throw Error();}
 const leitor=r.body.getReader(),partes:Uint8Array[]=[];let tamanho=0;
 try{for(;;){const p=await leitor.read();if(p.done)break;tamanho+=p.value.byteLength;if(tamanho>256*1024){await leitor.cancel();throw Error();}partes.push(p.value);}}finally{leitor.releaseLock();}
 return JSON.parse(Buffer.concat(partes).toString('utf8')) as unknown;
}
async function aguardarCompartilhada<T>(consulta:ConsultaCompartilhada<T>,signal:AbortSignal,aoEsvaziar:()=>void){
 consulta.consumidores++;let aoCancelar:()=>void=()=>{};
 const cancelamento=new Promise<never>((_resolver,rejeitar)=>{aoCancelar=()=>rejeitar(Error('WOO_LEITURA_INDISPONIVEL'));signal.addEventListener('abort',aoCancelar,{once:true});if(signal.aborted)aoCancelar();});
 try{const resultado=await Promise.race([consulta.promessa,cancelamento]);if(signal.aborted)throw Error('WOO_LEITURA_INDISPONIVEL');return resultado;}
 finally{signal.removeEventListener('abort',aoCancelar);consulta.consumidores--;if(consulta.consumidores===0){aoEsvaziar();consulta.controlador.abort();}}
}

/** Fronteira REST de leitura. O chamador deriva os vínculos e a identidade no
 * servidor. Nenhum método aceita uma URL, filtro HTTP ou comando da IA. */
export function criarConsultasWoo(config:ConfiguracaoConsultasWoo,transporte:typeof fetch=fetch){
 const loja=lojaValida(config),base=new URL('/wp-json/wc/v3/',loja),agora=()=>new Date().toISOString();
 let destinoAte=0,confirmacao:ConsultaCompartilhada<void>|null=null,moedaAte=0,moedaCache:string|null=config.moeda??null;
 const candidatosCache=new Map<string,{ate:number;produtos:CandidatoProduto[]}>(),candidatosEmCurso=new Map<string,ConsultaCompartilhada<CandidatoProduto[]>>();
 const sinal=(signal:AbortSignal)=>AbortSignal.any([signal,AbortSignal.timeout(10000)]);
 async function confirmarDestino(signal:AbortSignal){
  if(signal.aborted)throw Error('WOO_LEITURA_INDISPONIVEL');
  if(destinoAte>Date.now())return;
  if(!confirmacao){
   const controlador=new AbortController(),nova:ConsultaCompartilhada<void>={controlador,consumidores:0,promessa:Promise.resolve()};
   nova.promessa=(async()=>{try{const r=await transporte(loja.href,{method:'HEAD',redirect:'error',cache:'no-store',signal:sinal(controlador.signal)});await r.body?.cancel();if(controlador.signal.aborted||!r.ok||r.redirected||r.url&&new URL(r.url).origin!==loja.origin)throw Error();destinoAte=Date.now()+60000;}catch{throw Error('WOO_DESTINO_NAO_CONFIRMADO');}})().finally(()=>{if(confirmacao===nova)confirmacao=null;});
   confirmacao=nova;
  }
  const consulta=confirmacao;await aguardarCompartilhada(consulta,signal,()=>{if(confirmacao===consulta)confirmacao=null;});
 }
 async function get(caminho:string,query:Record<string,string>,signal:AbortSignal,autenticar=true,conferirCabecalhos?:(h:Headers)=>void){
  await confirmarDestino(signal);
  if(signal.aborted)throw Error('WOO_LEITURA_INDISPONIVEL');
  const url=new URL(caminho,base);if(url.origin!==loja.origin)throw Error('WOO_DESTINO_NAO_CONFIRMADO');url.search=new URLSearchParams(query).toString();
  try{const r=await transporte(url.href,{method:'GET',headers:{Accept:'application/json',...(autenticar?{Authorization:'Basic '+Buffer.from(config.chave+':'+config.segredo).toString('base64')}:{})},redirect:'error',cache:'no-store',signal:sinal(signal)});if(r.redirected||r.url&&new URL(r.url).origin!==loja.origin)throw Error();if(r.status===404&&/^orders\/[1-9]\d*$/.test(caminho)){await r.body?.cancel();throw Error('WOO_PEDIDO_NAO_ENCONTRADO');}conferirCabecalhos?.(r.headers);return await jsonLimitado(r);}catch(e){if(e instanceof Error&&e.message==='WOO_PEDIDO_NAO_ENCONTRADO')throw e;throw Error('WOO_LEITURA_INDISPONIVEL');}
 }
 function urlOficial(v:unknown,imagem=false):string|null{
  if(!texto(v,2048)||!v||/[\\\s]/.test(v))return null;
  try{const u=new URL(v);if(u.protocol!=='https:'||u.origin!==loja.origin||u.username||u.password||u.hash||u.port)return null;const path=decodeURIComponent(u.pathname).toLowerCase();if(/(?:^|\/)(?:wp-admin|wp-json|wp-login\.php|xmlrpc\.php|cart|carrinho|checkout|finalizar-compra)(?:\/|$)/.test(path))return null;
   if(u.search)return null;
   if(!imagem&&(u.pathname==='/'||u.pathname.endsWith('.php')))return null;
   return u.href;
  }catch{return null;}
 }
 async function moeda(signal:AbortSignal){
  if(config.moeda)return config.moeda;if(moedaAte>Date.now())return moedaCache;
  try{const d=await get('settings/general/woocommerce_currency',{_fields:'id,value'},signal);if(objeto(d)&&d.id==='woocommerce_currency'&&typeof d.value==='string'&&/^[A-Z]{3}$/.test(d.value))moedaCache=d.value;}catch{/* Leitura pública limitada evita ampliar a permissão da chave. */}
  if(!moedaCache)try{const d=await get('/wp-json/wc/store/v1/products',{per_page:'1',_fields:'prices.currency_code'},signal,false);const p=Array.isArray(d)&&d.length===1&&objeto(d[0])&&objeto(d[0].prices)?d[0].prices:null;if(p&&typeof p.currency_code==='string'&&/^[A-Z]{3}$/.test(p.currency_code))moedaCache=p.currency_code;}catch{/* Sem moeda confirmada, o preço não é apresentado. */}
  moedaAte=Date.now()+60000;return moedaCache;
 }
 async function oferta(v:VinculoOfertaWoo,signal:AbortSignal):Promise<OfertaWooConsultada>{
  signal=AbortSignal.any([signal,AbortSignal.timeout(12000)]);
  if(!objeto(v)||!texto(v.hubProdutoId,128)||!/^[A-Za-z0-9_.:-]{1,128}$/.test(v.hubProdutoId)||v.produtoWooId!==undefined&&!inteiro(v.produtoWooId)||v.variacaoWooId!==undefined&&(!inteiro(v.variacaoWooId)||!v.produtoWooId)||v.sku!==undefined&&(!texto(v.sku,100)||!v.sku.trim()||v.sku.trim()!==v.sku||v.sku.includes(','))||!v.produtoWooId&&!v.sku||v.permitirOculto!==undefined&&v.permitirOculto!==true)throw Error('WOO_VINCULO_PRODUTO_INVALIDO');
  let p:unknown;
  if(v.produtoWooId)p=await get('products/'+v.produtoWooId,{_fields:camposProduto},signal);
  else{const encontrados=await get('products',{sku:v.sku!,per_page:'2',status:'publish',_fields:camposProduto},signal);if(!Array.isArray(encontrados)||encontrados.length!==1||!objeto(encontrados[0])||encontrados[0].sku!==v.sku)throw Error('WOO_VINCULO_PRODUTO_AMBIGUO');p=encontrados[0];}
  if(!objeto(p)||!inteiro(p.id)||v.produtoWooId!==undefined&&p.id!==v.produtoWooId||p.status!=='publish'||!['simple','variable'].includes(String(p.type))||!['visible','catalog','search','hidden'].includes(String(p.catalog_visibility))||p.catalog_visibility==='hidden'&&v.permitirOculto!==true)throw Error('WOO_OFERTA_INDISPONIVEL');
  const pai=p;let alvo=p,variacaoId:number|null=null;
  if(v.variacaoWooId){if(p.type!=='variable'||!Array.isArray(p.variations)||p.variations.length>1000||!p.variations.includes(v.variacaoWooId))throw Error('WOO_VARIACAO_DIVERGENTE');const d=await get('products/'+p.id+'/variations/'+v.variacaoWooId,{_fields:camposVariacao},signal);if(!objeto(d)||d.id!==v.variacaoWooId||d.parent_id!==undefined&&d.parent_id!==p.id||d.status!=='publish')throw Error('WOO_VARIACAO_DIVERGENTE');alvo=d;variacaoId=v.variacaoWooId;}
  if(!texto(alvo.sku,100)||v.sku!==undefined&&alvo.sku!==v.sku)throw Error('WOO_VINCULO_PRODUTO_DIVERGENTE');
  if(pai.purchasable!==true||alvo.purchasable!==true||!['instock','onbackorder'].includes(String(pai.stock_status))||!['instock','onbackorder'].includes(String(alvo.stock_status)))throw Error('WOO_OFERTA_INDISPONIVEL');
  const url=urlOficial(pai.permalink);if(!url)throw Error('WOO_LINK_NAO_OFICIAL');
  if(!texto(pai.name,500)||!limpar(pai.name,200))throw Error('WOO_OFERTA_INVALIDA');
  const imagem=objeto(alvo.image)?alvo.image:Array.isArray(pai.images)&&objeto(pai.images[0])?pai.images[0]:null,imagemUrl=imagem?urlOficial(imagem.src,true):null;
  const avisos:string[]=[];let preco:OfertaWooConsultada['preco']=null;
  if(pai.type==='variable'&&!variacaoId)avisos.push('ESCOLHER_OPCOES_NO_SITE');
  else if(decimal(alvo.price)){const m=await moeda(signal);if(m)preco={valor:alvo.price,moeda:m,tipo:'fixo'};else avisos.push('MOEDA_NAO_CONFIRMADA');}else if(alvo.price!==''&&alvo.price!==null&&alvo.price!==undefined)throw Error('WOO_PRECO_INVALIDO');
  if(alvo.stock_status==='onbackorder')avisos.push('ENCOMENDA_SUJEITA_A_CONFIRMACAO');
  return {hubProdutoId:v.hubProdutoId,produtoWooId:Number(pai.id),variacaoWooId:variacaoId,sku:alvo.sku,nomeAnuncio:limpar(pai.name,200),url,imagemUrl,tipo:variacaoId?'variacao':pai.type==='variable'?'variavel':'simples',preco,compravel:true,disponibilidade:alvo.stock_status as 'instock'|'onbackorder',consultadoEm:agora(),avisos};
 }
 async function candidatosSemanticos(ancora:string,signal:AbortSignal){
  if(signal.aborted)throw Error('WOO_LEITURA_INDISPONIVEL');
  const cache=candidatosCache.get(ancora);if(cache&&cache.ate>Date.now())return cache.produtos;
  let consulta=candidatosEmCurso.get(ancora);
  if(!consulta){
   if(candidatosEmCurso.size>=100)throw Error('WOO_LEITURA_INDISPONIVEL');
   const controlador=new AbortController(),nova:ConsultaCompartilhada<CandidatoProduto[]>={controlador,consumidores:0,promessa:Promise.resolve([])};
   // Uma consulta atende produtos da mesma família. O cancelamento pertence
   // aos consumidores; o transporte só é cancelado quando nenhum deles espera.
   nova.promessa=lerCandidatosSemanticos(ancora,AbortSignal.any([controlador.signal,AbortSignal.timeout(12000)])).finally(()=>{if(candidatosEmCurso.get(ancora)===nova)candidatosEmCurso.delete(ancora);});
   candidatosEmCurso.set(ancora,nova);consulta=nova;
  }
  const atual=consulta;return aguardarCompartilhada(atual,signal,()=>{if(candidatosEmCurso.get(ancora)===atual)candidatosEmCurso.delete(ancora);});
 }
 async function lerCandidatosSemanticos(ancora:string,signal:AbortSignal){
  const produtos:CandidatoProduto[]=[],ids=new Set<number>();let totalAnterior:number|null=null;
  for(let pagina=1;pagina<=3;pagina++){
   let total:number|null=null;
   const dados=await get('products',{search:ancora,status:'publish',per_page:'50',page:String(pagina),orderby:'id',order:'asc',_fields:camposCandidato},signal,true,h=>{const v=h.get('x-wp-totalpages');if(v!==null)total=/^\d{1,6}$/.test(v)?Number(v):-1;});
   if(signal.aborted)throw Error('WOO_LEITURA_INDISPONIVEL');
   if(!Array.isArray(dados)||dados.length>50||total!==null&&(total<0||total>3||totalAnterior!==null&&total!==totalAnterior||total===0&&dados.length>0))throw Error('WOO_IDENTIDADE_SEMANTICA_AMBIGUA');
   if(total!==null)totalAnterior=total;
   for(const p of dados){
    if(!objeto(p)||!inteiro(p.id)||ids.has(p.id)||!texto(p.name,500)||!p.name.trim()||p.status!=='publish'||!['simple','variable','variation'].includes(String(p.type))||!['visible','catalog','search','hidden'].includes(String(p.catalog_visibility))||p.parent_id!==undefined&&!inteiro(p.parent_id,0))throw Error('WOO_IDENTIDADE_SEMANTICA_AMBIGUA');
    ids.add(p.id);
    // Variação não é intercambiável com o anúncio pai; ocultos não viram links.
    if(p.catalog_visibility!=='hidden'&&p.type!=='variation'&&(!p.parent_id||p.parent_id===0))produtos.push({id:p.id,nome:p.name});
   }
   const totalConferido=total??totalAnterior,completa=totalConferido!==null?pagina===totalConferido||totalConferido===0:dados.length<50;
   if(completa){if(candidatosCache.size>=100&&!candidatosCache.has(ancora))candidatosCache.delete(candidatosCache.keys().next().value!);candidatosCache.set(ancora,{ate:Date.now()+60000,produtos});return produtos;}
   // Página curta contraditória não prova que todos os equivalentes foram lidos.
   if(dados.length<50)throw Error('WOO_IDENTIDADE_SEMANTICA_AMBIGUA');
  }
  throw Error('WOO_IDENTIDADE_SEMANTICA_AMBIGUA');
 }
 async function resolverOfertaSemantica(v:ProdutoHubParaAssociar,signal:AbortSignal):Promise<OfertaWooConsultada>{
  signal=AbortSignal.any([signal,AbortSignal.timeout(12000)]);
  if(!objeto(v)||!texto(v.hubProdutoId,128)||!/^[A-Za-z0-9_.:-]{1,128}$/.test(v.hubProdutoId)||!texto(v.nome,500)||v.especificacao!==undefined&&(typeof v.especificacao!=='string'||v.especificacao.length>20000))throw Error('WOO_VINCULO_PRODUTO_INVALIDO');
  if(signal.aborted)throw Error('WOO_LEITURA_INDISPONIVEL');
  const identidade=identidadeProdutoSemantica(v.nome);if(!identidade)throw Error('WOO_IDENTIDADE_SEM_CORRESPONDENCIA');
  const candidatos=await candidatosSemanticos(identidade.ancora,signal),equivalentes=candidatos.filter(p=>produtosSemanticamenteEquivalentes(v.nome,p.nome));
  if(equivalentes.length>1)throw Error('WOO_IDENTIDADE_SEMANTICA_AMBIGUA');
  if(!equivalentes.length)throw Error('WOO_IDENTIDADE_SEM_CORRESPONDENCIA');
  // O cache guarda candidatos, nunca preço ou disponibilidade. A oferta atual
  // passa pela mesma validação de URL, estoque e variação dos vínculos explícitos.
  const atual=await oferta({hubProdutoId:v.hubProdutoId,produtoWooId:equivalentes[0].id},signal);
  if(!produtosSemanticamenteEquivalentes(v.nome,atual.nomeAnuncio)){candidatosCache.delete(identidade.ancora);throw Error('WOO_IDENTIDADE_SEM_CORRESPONDENCIA');}
  return atual;
 }
 function autorizarPedido(p:unknown,i:IdentidadePedidoWoo,pedidoId?:number):p is Objeto{
  return objeto(p)&&inteiro(p.id)&&(pedidoId===undefined||p.id===pedidoId)&&inteiro(p.customer_id,0)&&(i.clienteWooId===undefined||p.customer_id===i.clienteWooId)&&objeto(p.billing)&&normalizarTelefoneWoo(p.billing.phone,typeof p.billing.country==='string'?p.billing.country:'')===i.telefoneCanonico;
 }
 function projetarPedido(p:Objeto):PedidoWooAutorizado{
  if(!numeroValido(p.number)||!texto(p.status,60)||!/^[a-z0-9-]{1,60}$/.test(p.status)||!texto(p.date_created_gmt,30)||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:Z)?$/.test(p.date_created_gmt)||!Array.isArray(p.line_items)||p.line_items.length>100||!Array.isArray(p.shipping_lines)||p.shipping_lines.length>10)throw Error('WOO_PEDIDO_INVALIDO');
  const data=new Date(p.date_created_gmt.replace(/Z$/,'')+'Z');if(!Number.isFinite(data.getTime())||data.toISOString().slice(0,19)!==p.date_created_gmt.replace(/Z$/,''))throw Error('WOO_PEDIDO_INVALIDO');
  const itens=p.line_items.map(l=>{if(!objeto(l)||!texto(l.name,500)||!limpar(l.name,200)||!inteiro(l.quantity)||l.quantity>10000||!inteiro(l.product_id,0)||!inteiro(l.variation_id,0))throw Error('WOO_PEDIDO_INVALIDO');return {nome:limpar(l.name,200),quantidade:l.quantity,produtoWooId:l.product_id,variacaoWooId:l.variation_id||null};});
  const linhas=p.shipping_lines.map(s=>{if(!objeto(s)||!texto(s.method_id,80)||!texto(s.method_title,200))throw Error('WOO_PEDIDO_INVALIDO');return {id:s.method_id,nome:limpar(s.method_title,120)};});
  const retirada=linhas.length>0&&linhas.every(s=>s.id==='local_pickup'),entrega=linhas.length>0&&linhas.every(s=>['flat_rate','free_shipping'].includes(s.id));
  return {pedidoWooId:Number(p.id),numeroVisivel:p.number,data:data.toISOString(),estadoBruto:p.status,rotulo:rotulosStatus[p.status]??p.status,interpretacao:null,itens,modalidadeEntrega:retirada?'retirada':entrega?'entrega':'nao_informada',metodosEntrega:linhas.map(s=>s.nome).filter(Boolean),agendamento:null,rastreio:null,consultadoEm:agora(),avisos:[...(rotulosStatus[p.status]?[]:['STATUS_NAO_MAPEADO']),'STATUS_NAO_COMPROVA_PREPARO_OU_ENTREGA']};
 }
 async function pedidoAutorizado(v:IdentidadePedidoWoo&{pedidoWooId:number},signal:AbortSignal){signal=AbortSignal.any([signal,AbortSignal.timeout(12000)]);identidadeValida(v);if(!inteiro(v.pedidoWooId))throw Error('WOO_PEDIDO_NAO_VINCULADO');const p=await get('orders/'+v.pedidoWooId,{_fields:camposPedido},signal);if(!autorizarPedido(p,v,v.pedidoWooId))throw Error('WOO_PEDIDO_ESCOPO_RECUSADO');return projetarPedido(p);}
 async function buscarPedidosDaIdentidade(i:IdentidadePedidoWoo&{numeroVisivel?:string},signal:AbortSignal):Promise<BuscaPedidosWoo>{
  signal=AbortSignal.any([signal,AbortSignal.timeout(12000)]);
  identidadeValida(i);if(i.numeroVisivel!==undefined&&!numeroValido(i.numeroVisivel))throw Error('WOO_PEDIDO_NAO_VINCULADO');
  if(!(i.clienteWooId!==undefined&&i.clienteWooId>0)&&!i.numeroVisivel)return {pedidos:[],limitacao:'BUSCA_POR_TELEFONE_NAO_SUPORTADA'};
  const pedidos:PedidoWooAutorizado[]=[];let paginaCompleta=false;
  for(let pagina=1;pagina<=2;pagina++){const query:Record<string,string>={per_page:'10',page:String(pagina),orderby:'date',order:'desc',_fields:camposPedido};if(i.clienteWooId!==undefined&&i.clienteWooId>0)query.customer=String(i.clienteWooId);if(i.numeroVisivel)query.search=i.numeroVisivel;const dados=await get('orders',query,signal);if(!Array.isArray(dados)||dados.length>10)throw Error('WOO_PEDIDO_INVALIDO');for(const p of dados)if(autorizarPedido(p,i)&&(!i.numeroVisivel||p.number===i.numeroVisivel))pedidos.push(projetarPedido(p));paginaCompleta=dados.length===10;if(!paginaCompleta||i.numeroVisivel&&pedidos.length)break;}
  if(i.numeroVisivel&&pedidos.length>1)return {pedidos:[],limitacao:'NUMERO_PEDIDO_AMBIGUO'};
  return {pedidos,limitacao:paginaCompleta?'CONSULTA_LIMITADA_A_PEDIDOS_RECENTES':!pedidos.length?'SEM_PEDIDO_AUTORIZADO_NA_CONSULTA_LIMITADA':null};
 }
 return {oferta,resolverOfertaSemantica,pedidoAutorizado,buscarPedidosDaIdentidade,confirmarDestino};
}
