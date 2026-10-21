import 'server-only';
import {createHash} from 'node:crypto';
import type {RepositorioOperacaoPg} from './operacao-repositorio-pg';
import {hashOperacao} from './operacao-repositorio-pg';
import type {IdentidadeOperacao} from './operacao-tipos';
import {validarIdOperacao,validarTextoOperacao} from './operacao-tipos';
import type {FonteIA,TarefaIA} from './ia-orquestrador';
import type {ProdutosComerciaisResposta,PedidosComerciaisResposta,StatusComercial,ProdutoComercial,PedidoSiteComercial} from './comercial-tipos';
import {criarConsultasWoo,type ConfiguracaoConsultasWoo} from './operacao-woo-consultas';

export type ProdutoHubLeitura={id:string;nome:string;especificacao:string;sku:string|null;versao:string|null;wooProdutoId:number|null;wooVariacaoId:number|null;consultadoEm:string};
export type CatalogoHubComercial={buscar:(busca:string,signal:AbortSignal)=>Promise<{produtos:ProdutoHubLeitura[];mais:boolean}>;obter?:(id:string,signal:AbortSignal)=>Promise<ProdutoHubLeitura|null>;contar?:(signal?:AbortSignal)=>Promise<number>};
export type VinculoProdutoComercial={hubId:string;produtoWooId:number;variacaoWooId:number|null;sku:string|null;conferidoEm:string};
type Dependencias={repo:RepositorioOperacaoPg;empresaId:string;hub?:CatalogoHubComercial;woo?:ConfiguracaoConsultasWoo;transporteWoo?:typeof fetch;agora?:()=>number};
type ContextoPedido={contatoId:string;telefone:string;clienteWooId?:number;candidatos:number[]};
const objeto=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const numeroId=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>0;
const normalizar=(v:string)=>v.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('pt-BR');
const palavrasVazias=new Set('para com uma umas uns dos das que qual quais quero queria gostaria preciso poderia favor tenho tem pode voce voces por favor produto produtos opcao opcoes pessoa pessoas reais comprar link mandar enviar este esta esse essa isso algo recomenda recomendar recomendacao sugere sugerir sugestao indicacao indica indicar ideal melhor seria somos'.split(' '));
export function termosComerciais(busca:string){return [...new Set(normalizar(busca).match(/\d{1,4}|[\p{L}][\p{L}\p{N}-]{1,40}/gu)??[])].filter(v=>!palavrasVazias.has(v)).slice(-12);}
const numerosPessoas:Record<string,number>={um:1,uma:1,dois:2,duas:2,tres:3,quatro:4,cinco:5,seis:6,sete:7,oito:8,nove:9,dez:10};
const numeroPessoas=(v:string)=>numerosPessoas[v]??Number(v);
export function quantidadeComercial(busca:string):number|null{
 const texto=normalizar(busca),numeros='\\d{1,3}|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez';
 if(new RegExp(`\\b(?:${numeros})\\s+ou\\s+(?:${numeros})\\s+(?:pessoas?|convidados?|adultos?)\\b`).test(texto))return null;
 const achados=[...texto.matchAll(new RegExp(`\\b(${numeros})\\s+(?:pessoas?|convidados?|adultos?)\\b|\\b(?:grazing|tabua)\\s+para\\s+(${numeros})\\b|\\bpara\\s+(${numeros})\\s*(?=[?!.,]|$)`,'g'))].filter(v=>!/(?:\bnao|\bnem|\bnunca)\s+(?:para\s+)?$/.test(texto.slice(Math.max(0,v.index-24),v.index)));
 if(achados.length>1&&/\bou\b/.test(texto.slice(achados.at(-2)!.index+achados.at(-2)![0].length,achados.at(-1)!.index)))return null;
 const ultimo=achados.at(-1),n=ultimo?numeroPessoas(ultimo[1]??ultimo[2]??ultimo[3]):NaN;return Number.isSafeInteger(n)&&n>0&&n<=500?n:null;
}
function capacidadeHub(p:ProdutoHubLeitura):[number,number]|null{
 const numero='(\\d{1,3}|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)',nome=normalizar(p.nome),texto=normalizar(p.especificacao);
 const titulo=new RegExp(`\\b(?:grazing|tabua)\\s+para\\s+${numero}\\b`).exec(nome);
 if(titulo){const n=numeroPessoas(titulo[1]);return [n,n];}
 const faixa=new RegExp(`(?:serve|rende|atende|ideal para|porcao para)\\s+(?:de\\s+)?${numero}\\s*(?:a|ate|-)\\s*${numero}\\s+pessoas?\\b`).exec(texto);
 if(faixa)return [numeroPessoas(faixa[1]),numeroPessoas(faixa[2])];
 const unica=new RegExp(`(?:serve|rende|atende|ideal para|porcao para)\\s+(?:ate\\s+)?${numero}\\s+pessoas?\\b`).exec(texto);
 if(unica){const n=numeroPessoas(unica[1]);return /(?:serve|rende|atende)\s+ate\s/.test(unica[0])?[1,n]:[n,n];}return null;
}
export function numeroPedidoNaPergunta(pergunta:string){
 const valor=pergunta.trim();if(/^#?\d{1,20}$/.test(valor))return valor.replace(/^#/,'');
 const candidatos=[...valor.matchAll(/(?:pedido(?:\s+(?:n[uú]mero|n[º°o.]?))?\s*[:#-]?\s*|#\s*)([A-Za-z0-9][A-Za-z0-9_-]{0,39})\b/gi)];
 return candidatos.map(v=>v[1]).find(v=>/\d/.test(v))??'';
}
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest();
function fonte(t:TarefaIA,chave:string,conteudo:string,valor:unknown,agora:number):FonteIA{
 return {id:chave,versao:hash(valor).readUInt32BE(0)+1,empresaId:t.empresaId,clienteId:t.clienteId,tema:t.tema,origem:'ferramenta',estado:'aprovado',inicio:agora,fim:agora+60000,conteudo:conteudo.slice(0,4000)};
}
/** Projeção factual compartilhada pela operação e pelo ensaio fictício. */
export function fontesProdutosComerciais(t:TarefaIA,produtos:ProdutoComercial[],agora:number):FonteIA[]{
 return produtos.map(p=>{
  const o=p.oferta,preco=o?.preco,precoLocal=preco?new Intl.NumberFormat('pt-BR',{style:'currency',currency:preco.moeda,maximumFractionDigits:4}).format(Number(preco.valor)):'';
  const comercial=o?`Link oficial de compra: ${o.url}. ${preco?`Preço no site: ${preco.tipo==='a_partir'?'a partir de ':''}${preco.valor} ${preco.moeda} (${precoLocal}${preco.moeda==='BRL'?'; valor em reais':''}). `:''}Compra no site: ${o.disponibilidade??'consulte as opções na página'}. ${o.tipo==='variavel'?'Escolha as opções na página do produto. ':''}Disponibilidade para compra não garante entrega em uma data ou CEP.`:`Link e dados comerciais não confirmados. ${p.vinculo.motivo} Pode explicar as informações confirmadas do HUB. Não invente link, preço ou disponibilidade. Peça apoio humano somente se o dado comercial ausente for necessário para atender ao pedido do cliente.`;
  const conteudo=`Produto do HUB: ${p.nome}. ${p.especificacao.slice(0,2400)}\n${comercial}\nUse a necessidade já informada para selecionar até três opções. Se faltar apenas preferência, ocasião ou orçamento, pergunte ao cliente o detalhe necessário; isso não exige apoio humano. Dúvida material, conflito de identidade, alergia ou condição sem fonte exige apoio.`;
  const valor={hubId:p.hubId,nome:p.nome,especificacao:p.especificacao,versao:p.fonteHub.versao,oferta:o?{produto:o.produtoId,variacao:o.variacaoId,url:o.url,preco:o.preco,compravel:o.compravel,disponibilidade:o.disponibilidade}:null};
  return fonte(t,'hub_comercial_'+hash(p.hubId).toString('hex').slice(0,24),conteudo,valor,agora);
 });
}
/** Catálogo permanece no HUB. Esta camada só associa identidades e projeta
 * leituras da loja. Nenhuma função de pedido possui transporte de escrita. */
export class ServicoComercialOperacao{
 private readonly woo:ReturnType<typeof criarConsultasWoo>|undefined;
 private readonly agora:()=>number;
 private tentativa:string|null=null;
 private sucesso:string|null=null;
 private falha:string|null=null;
 private readonly conhecidos=new Map<string,boolean>();
 constructor(private readonly d:Dependencias){this.agora=d.agora??Date.now;this.woo=d.woo?criarConsultasWoo(d.woo,d.transporteWoo):undefined;}
 private async autorizar(i:IdentidadeOperacao,pedido=false){
  if(!await this.d.repo.autorizar(i,'consultar')||pedido&&!await this.d.repo.autorizar(i,'contatos.visualizar'))throw Error('OPERACAO_ACESSO_NEGADO');
 }
 async status(i:IdentidadeOperacao):Promise<StatusComercial>{
  await this.autorizar(i);const config=await this.vinculos(),ids=new Set([...config.vinculos.map(v=>v.hubId),...[...this.conhecidos].filter(([,ok])=>ok).map(([id])=>id)]);
  let total=this.conhecidos.size,hubFalhou=false;try{total=await this.d.hub?.contar?.(AbortSignal.timeout(3000))??total;}catch{hubFalhou=true;}
  const salvo=config.vinculos.map(v=>v.conferidoEm).sort().at(-1)??null,ultimoSucessoEm=this.sucesso??salvo,recente=ultimoSucessoEm!==null&&this.agora()-Date.parse(ultimoSucessoEm)<300000;
  return {estado:!this.woo?'nao_configurado':this.falha||hubFalhou?'indisponivel':recente?'conectado':'parcial',ultimoSucessoEm,ultimaTentativaEm:this.tentativa??salvo,produtosVinculados:ids.size,vinculosPendentes:Math.max(0,total-ids.size),detalhe:!this.d.hub||hubFalhou?'A leitura comercial do HUB ainda não está disponível.':this.falha?'A loja não respondeu à última consulta. As especificações continuam no HUB.':'Associação automática por nome e significado, com conferência de quantidade e versão. Produtos ainda não consultados serão conferidos sob demanda. Apoio humano somente para dúvidas importantes. Nenhuma notificação comercial será enviada.'};
 }
 private async vinculos(){
  const r=await this.d.repo.pool.query<{conteudo:unknown;versao:string}>("SELECT conteudo,versao FROM atendimento_operacao.configuracao WHERE chave='woo_catalogo_vinculos'");
  const c=r.rows[0]?.conteudo;const lista=objeto(c)&&Array.isArray(c.vinculos)?c.vinculos:[];
  return {versao:Number(r.rows[0]?.versao??0),vinculos:lista.filter((v):v is VinculoProdutoComercial=>objeto(v)&&typeof v.hubId==='string'&&numeroId(v.produtoWooId)&&(v.variacaoWooId===null||numeroId(v.variacaoWooId))&&(v.sku===null||typeof v.sku==='string')&&typeof v.conferidoEm==='string').slice(0,1000)};
 }
 async configuracao(i:IdentidadeOperacao){if(!await this.d.repo.autorizar(i,'configuracao.visualizar'))throw Error('OPERACAO_ACESSO_NEGADO');return this.vinculos();}
 async salvarVinculo(i:IdentidadeOperacao,p:{hubId:string;produtoWooId:number;variacaoWooId:number|null;versao:number;idempotencia:string},signal:AbortSignal){
  validarIdOperacao(p.hubId);validarIdOperacao(p.idempotencia);
  if(!numeroId(p.produtoWooId)||p.variacaoWooId!==null&&!numeroId(p.variacaoWooId)||!Number.isSafeInteger(p.versao)||p.versao<0)throw Error('COMERCIAL_VINCULO_INVALIDO');
  if(!await this.d.repo.autorizar(i,'configurar'))throw Error('OPERACAO_ACESSO_NEGADO');
  const recibo=await this.d.repo.transacao(async tx=>{
   await this.d.repo.exigir(tx,i,'configurar');await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`comando:${p.idempotencia}`]);
   const r=(await tx.query<{autor_id:string;hash:string;resultado:{versao:number;vinculo:VinculoProdutoComercial}}>('SELECT autor_id,hash,resultado FROM atendimento_operacao.comando WHERE id=$1',[p.idempotencia])).rows[0];
   if(r&&(r.autor_id!==i.id||r.hash!==hashOperacao([i.id,{acao:'vincular_produto_woo',...p}])))throw Error('OPERACAO_IDEMPOTENCIA_DIVERGENTE');return r?.resultado;
  });
  if(recibo)return recibo;
  const produto=await this.d.hub?.obter?.(p.hubId,signal);if(!produto||!this.woo)throw Error('COMERCIAL_VINCULO_INVALIDO');
  const oferta=await this.woo.oferta({hubProdutoId:p.hubId,produtoWooId:p.produtoWooId,...(p.variacaoWooId?{variacaoWooId:p.variacaoWooId}:{})},signal);
  return this.d.repo.transacao(async tx=>{
   await this.d.repo.exigir(tx,i,'configurar');return this.d.repo.comando(tx,i,p.idempotencia,{acao:'vincular_produto_woo',...p},async()=>{
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('config:woo_catalogo_vinculos',0))");
    const atual=(await tx.query<{conteudo:{vinculos:VinculoProdutoComercial[]};versao:string}>("SELECT conteudo,versao FROM atendimento_operacao.configuracao WHERE chave='woo_catalogo_vinculos' FOR UPDATE")).rows[0];
    if(Number(atual?.versao??0)!==p.versao)throw Error('OPERACAO_CONFLITO');
    const vinculos=atual?.conteudo?.vinculos??[];if(!Array.isArray(vinculos)||vinculos.length>999)throw Error('COMERCIAL_VINCULOS_EXCESSIVOS');
    const vinculo:VinculoProdutoComercial={hubId:p.hubId,produtoWooId:p.produtoWooId,variacaoWooId:p.variacaoWooId,sku:oferta.sku||null,conferidoEm:oferta.consultadoEm};
    const dados={vinculos:[...vinculos.filter(v=>v.hubId!==p.hubId),vinculo]};
    const r=await tx.query("INSERT INTO atendimento_operacao.configuracao(chave,conteudo) VALUES('woo_catalogo_vinculos',$1::jsonb) ON CONFLICT(chave) DO UPDATE SET conteudo=excluded.conteudo,versao=atendimento_operacao.configuracao.versao+1,atualizada_em=now() RETURNING versao",[JSON.stringify(dados)]);
    await this.d.repo.auditar(tx,i,'woo_catalogo_vinculos','vincular_produto_woo',Number(r.rows[0].versao));return {versao:Number(r.rows[0].versao),vinculo};
   },()=>this.d.repo.exigir(tx,i,'configurar'));
  });
 }
 async produtos(i:IdentidadeOperacao,busca:string,signal:AbortSignal):Promise<ProdutosComerciaisResposta>{await this.autorizar(i);return this.buscar(busca,signal);}
 async buscar(busca:string,signal:AbortSignal):Promise<ProdutosComerciaisResposta>{
  validarTextoOperacao(busca,1000,true);if(signal.aborted)throw Error('COMERCIAL_CONSULTA_CANCELADA');
  if(!this.d.hub)throw Error('HUB_CATALOGO_INDISPONIVEL');
  const termos=termosComerciais(busca),quantidade=quantidadeComercial(busca),consulta=[...(quantidade?[String(quantidade),...Object.keys(numerosPessoas).filter(n=>numerosPessoas[n]===quantidade)]:[]),...termos].filter((v,i,a)=>a.indexOf(v)===i).slice(0,6).join(' ').slice(0,160),hub=await this.d.hub.buscar(consulta,signal),vinculos=(await this.vinculos()).vinculos;
  // A classificação usa somente fatos do HUB. Nomes da loja não selecionam produto.
  const pontuar=(p:ProdutoHubLeitura)=>termos.reduce((n,t)=>n+(normalizar(p.nome).includes(t)?3:normalizar(p.especificacao).includes(t)?1:0),0)+(quantidade&&capacidadeHub(p)?20:0);
  const candidatas=hub.produtos.filter(p=>p.especificacao.trim()).filter(p=>{const c=capacidadeHub(p);return !quantidade||!c||quantidade>=c[0]&&quantidade<=c[1];}).map(p=>({p,nota:pontuar(p)})).filter(v=>!termos.length||v.nota>0).sort((a,b)=>b.nota-a.nota||a.p.nome.localeCompare(b.p.nome)).slice(0,3);
  const avisos:string[]=[];
  const produtos=await Promise.all(candidatas.map(async({p}):Promise<ProdutoComercial>=>{
   const m=vinculos.filter(v=>v.hubId===p.id),manual=m.length===1?m[0]:undefined;
   const r:ProdutoComercial={hubId:p.id,nome:p.nome,especificacao:p.especificacao,motivo:'Informações do HUB: '+p.especificacao.slice(0,260),fonteHub:{id:p.id,versao:p.versao,consultadoEm:p.consultadoEm},vinculo:{estado:m.length>1?'ambiguo':'pendente',motivo:m.length>1?'Há mais de uma associação. A equipe precisa conferir.':'Não há associação segura com um anúncio da loja.'},oferta:null};
   if(m.length>1||!this.woo){this.conhecer(p.id,false);return r;}
   const produtoWooId=manual?.produtoWooId??p.wooProdutoId,variacaoWooId=manual?.variacaoWooId??p.wooVariacaoId,sku=manual?.sku??p.sku;
   this.tentativa=new Date(this.agora()).toISOString();
   try{
    const o=produtoWooId||sku?await this.woo.oferta({hubProdutoId:p.id,...(produtoWooId?{produtoWooId}:{}),...(variacaoWooId?{variacaoWooId}:{}),...(sku?{sku}:{})},signal):await this.woo.resolverOfertaSemantica({hubProdutoId:p.id,nome:p.nome,especificacao:p.especificacao},signal);
    r.oferta={produtoId:o.produtoWooId,variacaoId:o.variacaoWooId,sku:o.sku,url:o.url,imagemUrl:o.imagemUrl,tipo:o.tipo,preco:o.preco,compravel:o.compravel,disponibilidade:o.disponibilidade,consultadoEm:o.consultadoEm};
    r.vinculo={estado:'confirmado',motivo:null};this.conhecer(p.id,true);this.sucesso=o.consultadoEm;this.falha=null;avisos.push(...o.avisos);
   }catch(e){
    const codigo=e instanceof Error?e.message:'';r.vinculo={estado:/AMBIGU/.test(codigo)?'ambiguo':codigo==='WOO_IDENTIDADE_SEM_CORRESPONDENCIA'?'pendente':/DIVERG|IDENTIDADE|SKU/.test(codigo)?'divergente':'pendente',motivo:/LEITURA|CONEXAO|CONFIGURACAO|DESTINO/.test(codigo)?'A loja está indisponível. Use a especificação do HUB e peça apoio para o link.':codigo==='WOO_IDENTIDADE_SEM_CORRESPONDENCIA'?'Não há anúncio com identidade compatível nesta consulta. As informações confirmadas do HUB continuam disponíveis.':'O anúncio precisa de conferência antes de compartilhar.'};
    if(/LEITURA|CONEXAO|DESTINO/.test(codigo))this.falha='WOO_LEITURA_INDISPONIVEL';this.conhecer(p.id,false);
   }
   return r;
  }));
  return {produtos,consultadoEm:new Date(this.agora()).toISOString(),mais:hub.mais||hub.produtos.length>3,avisos:[...new Set(avisos)].slice(0,10)};
 }
 private conhecer(id:string,confirmado:boolean){if(this.conhecidos.size>=1000&&!this.conhecidos.has(id))this.conhecidos.delete(this.conhecidos.keys().next().value!);this.conhecidos.set(id,confirmado);}
 private async contextoPedido(i:IdentidadeOperacao,conversaId:string,clienteId?:string):Promise<ContextoPedido|null>{
  validarIdOperacao(conversaId);
  return this.d.repo.transacao(async tx=>{
   await this.d.repo.exigir(tx,i,'consultar');if(i.tipo!=='ia')await this.d.repo.exigir(tx,i,'contatos.visualizar');
   const c=(await tx.query<{contato_id:string;identidade_canal:string;telefone:string;memoria:unknown}>(`SELECT c.contato_id,t.identidade_canal,t.telefone,t.memoria FROM atendimento_operacao.conversa c JOIN atendimento_operacao.contato t ON t.id=c.contato_id WHERE c.id=$1`,[conversaId])).rows[0];
   if(!c||clienteId&&c.contato_id!==clienteId)return null;
   const identidade=c.identidade_canal?.match(/^whatsapp:[0-9]{5,25}:([1-9]\d{7,14})$/)?.[1];
   // O canal comprova quem fala. Cadastro editável ou números finais não bastam.
   const telefone=typeof c.telefone==='string'&&/^[+\d().\-\s]+$/.test(c.telefone)?c.telefone.replace(/\D/g,''):null;
   if(!identidade||!telefone||!/^[1-9]\d{7,14}$/.test(telefone)||telefone!==identidade)return null;
   const memoria=objeto(c.memoria)?c.memoria:{},confiavel=memoria.wooVinculoConfirmado===true,clienteWooId=confiavel&&Number.isSafeInteger(memoria.wooClienteId)&&Number(memoria.wooClienteId)>=0?Number(memoria.wooClienteId):undefined;
   const historicos=await tx.query<{external_id:string}>('SELECT external_id FROM atendimento_operacao.woo_pedido WHERE empresa_id=$1 AND contato_id=$2 ORDER BY atualizado_em DESC LIMIT 3',[this.d.empresaId,c.contato_id]);
   const candidatos=[...(confiavel&&numeroId(memoria.wooPedidoId)?[memoria.wooPedidoId]:[]),...historicos.rows.map(v=>Number(v.external_id)).filter(numeroId)];
   return {contatoId:c.contato_id,telefone,...(clienteWooId!==undefined?{clienteWooId}:{}),candidatos:[...new Set(candidatos)].slice(0,3)};
  });
 }
 async pedidos(i:IdentidadeOperacao,conversaId:string,numero:string,signal:AbortSignal,clienteId?:string):Promise<PedidosComerciaisResposta>{
  if(i.tipo!=='ia')await this.autorizar(i,true);validarTextoOperacao(numero,40,true);if(numero&&!/^[A-Za-z0-9#_-]+$/.test(numero))throw Error('COMERCIAL_PEDIDO_INVALIDO');
  const contexto=await this.contextoPedido(i,conversaId,clienteId);
  const verificar=():PedidosComerciaisResposta=>({estado:'verificacao_necessaria',pedidos:[],consultadoEm:null,mensagem:'Não foi possível confirmar um pedido do site para este contato. Peça apoio à equipe. Pedidos de outros canais podem existir.'});
  if(!contexto)return verificar();if(!this.woo)return {estado:'indisponivel',pedidos:[],consultadoEm:null,mensagem:'A consulta da loja não está configurada. O atendimento humano continua disponível.'};
  this.tentativa=new Date(this.agora()).toISOString();
  try{
   const confirmados:Awaited<ReturnType<typeof this.woo.pedidoAutorizado>>[]=[];
   for(const id of contexto.candidatos){
    try{const p=await this.woo.pedidoAutorizado({pedidoWooId:id,telefoneCanonico:contexto.telefone,...(contexto.clienteWooId!==undefined?{clienteWooId:contexto.clienteWooId}:{})},signal);if(!numero||p.numeroVisivel===numero.replace(/^#/,''))confirmados.push(p);}catch(e){if(!(e instanceof Error)||!/ESCOPO|NAO_VINCULADO|NAO_ENCONTRADO/.test(e.message))throw e;}
   }
   if(!confirmados.length){const leitura=await this.woo.buscarPedidosDaIdentidade({telefoneCanonico:contexto.telefone,...(contexto.clienteWooId!==undefined?{clienteWooId:contexto.clienteWooId}:{}),...(numero?{numeroVisivel:numero.replace(/^#/,'')}:{})},signal);confirmados.push(...leitura.pedidos);}
   if(!confirmados.length||numero&&confirmados.length!==1)return verificar();
   const consultadoEm=new Date(this.agora()).toISOString();this.sucesso=consultadoEm;this.falha=null;
   const pedidos:PedidoSiteComercial[]=confirmados.slice(0,3).map(p=>({numero:p.numeroVisivel,data:p.data,status:{codigo:p.estadoBruto,rotulo:p.rotulo,interpretacao:p.interpretacao},itens:p.itens.map(v=>({nome:v.nome,quantidade:v.quantidade})),modalidadeEntrega:p.modalidadeEntrega,agendamento:p.agendamento,rastreio:p.rastreio,consultadoEm:p.consultadoEm}));
   return {estado:'consultado',pedidos,consultadoEm,mensagem:'Situação consultada na loja. Em processamento não comprova preparo físico; concluído não comprova recebimento da entrega.'};
  }catch{this.falha='WOO_LEITURA_INDISPONIVEL';return {estado:'indisponivel',pedidos:[],consultadoEm:null,mensagem:'Não foi possível consultar a situação atual na loja. Tente novamente ou peça apoio à equipe.'};}
 }
 async fontesProdutos(t:TarefaIA,signal:AbortSignal,contexto:string[]=[]):Promise<FonteIA[]>{
  const r=await this.buscar([...contexto.slice(-4).map(v=>v.slice(0,180)),t.pergunta].join(' ').slice(-1000),signal),agora=this.agora();
  return fontesProdutosComerciais(t,r.produtos,agora);
 }
 async fontesPedido(i:IdentidadeOperacao,t:TarefaIA,signal:AbortSignal):Promise<FonteIA[]>{
  const r=await this.pedidos(i,t.conversaId,numeroPedidoNaPergunta(t.pergunta),signal,t.clienteId);if(r.estado!=='consultado')throw Error('WOO_PEDIDO_NAO_VINCULADO');
  return r.pedidos.map(p=>fonte(t,'woo_pedido_'+hash(p.numero).toString('hex').slice(0,24),`Pedido #${p.numero}, feito em ${p.data}: ${p.status.rotulo}. Itens comprados: ${p.itens.map(v=>`${v.quantidade} × ${v.nome}`).join('; ')}. Modalidade: ${p.modalidadeEntrega}. ${p.agendamento??'Agendamento não informado.'} ${p.rastreio??'Rastreio não informado.'} ${r.mensagem}`,{numero:p.numero,data:p.data,status:p.status,itens:p.itens,modalidade:p.modalidadeEntrega,agendamento:p.agendamento,rastreio:p.rastreio},this.agora()));
 }
}
