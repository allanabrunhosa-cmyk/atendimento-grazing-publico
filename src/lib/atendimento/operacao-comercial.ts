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
const palavrasVazias=new Set('para com uma umas uns dos das que qual quais quero queria gostaria preciso poderia favor tenho tem pode voce voces por favor produto produtos opcao opcoes pessoa pessoas reais comprar link mandar enviar este esta esse essa isso algo recomenda recomendar recomendacao sugere sugerir sugestao indicacao indica indicar ideal melhor seria somos um de do da dos das em no na nos nas ao aos os as se eu meu minha meus minhas vai vou ser sera algo alguma algum tipo'.split(' '));
/** Saudação, caminho da compra e escolha entre opções ("oi, quero fazer um pedido",
 * "prefiro por aqui", "me manda o link", "a segunda") não descrevem produto: como
 * termo obrigatório, eliminavam o catálogo inteiro. */
const palavrasCompra=new Set('oi ola opa tudo bem obrigado obrigada valeu sim nao ok certo beleza fazer faco faz fazendo feito pedido pedidos pedir peco encomenda encomendar encomendo compra compras compro compraria fechar fecha fecho finalizar orcamento orcamentos cotacao site whatsapp zap aqui ali la mesmo por pelo pela pra pro pras pros me mim nos lhe te sobre ate entre manda mande envia envie passa passe mostra mostrar ver prefiro prefere posso podemos como quando quanto quantos quantas preco precos valor valores custa custam hoje amanha dia dias segunda terca quarta quinta sexta sabado domingo primeira primeiro terceira terceiro ultima ultimo outra outras outro outros mais tambem ja so agora ter sei saber gosto gostei adorei amei muito muita muitos muitas alguns algumas quase cerca mas entao porque gente turma montar monta incluir servir sirva ajuda ajudar'.split(' '));
export function termosComerciais(busca:string){return [...new Set(normalizar(busca).replace(/\b(?:bom dia|boa tarde|boa noite)\b/g,' ').match(/\d{1,4}|[\p{L}][\p{L}\p{N}-]{2,40}/gu)??[])].filter(v=>!palavrasVazias.has(v)&&!palavrasCompra.has(v)).slice(-12);}
/** Ocasião contada na qualificação ("é para um aniversário"). Raramente está na
 * especificação do HUB: só ordena as opções e nunca elimina todas. */
const palavrasOcasiao=new Set('aniversario aniversarios casamento casamentos noivado festa festas comemoracao comemorar confraternizacao celebracao celebrar cha bebe revelacao panela happy hour reuniao jantar almoco piquenique ocasiao convidado convidados familia amigos natal pascoa namorados maes pais formatura batizado'.split(' '));
/** Consulta enviada ao HUB: quantidade e termos do produto, sem a ocasião. */
export function consultaHubComercial(busca:string){
 const termos=termosComerciais(busca).filter(t=>!palavrasOcasiao.has(t)),quantidade=quantidadeComercial(busca);
 return [...(quantidade?[String(quantidade),...Object.keys(numerosPessoas).filter(n=>numerosPessoas[n]===quantidade)]:[]),...termos].filter((v,i,a)=>a.indexOf(v)===i).slice(0,6).join(' ').slice(0,160);
}
/** Palavra inteira, sem plural nem gênero: "vi" não é "sauvignon", e "tábuas" é "tábua". */
const raiz=(t:string)=>{const s=t.replace(/(?:oes|aes)$/,'ao').replace(/s$/,'');return s.length>4?s.replace(/[aoe]$/,''):s;};
const raizes=(v:string)=>new Set((normalizar(v).match(/[\p{L}\p{N}]+/gu)??[]).map(raiz));
const notaHub=(p:ProdutoHubLeitura,lista:readonly string[])=>{if(!lista.length)return 0;const nome=raizes(p.nome),texto=raizes(p.especificacao);return lista.reduce((n,t)=>n+(nome.has(raiz(t))?3:texto.has(raiz(t))?1:0),0);};
/** Escolha só com fatos do HUB: capacidade compatível com a quantidade, termos
 * do produto e ocasião como desempate. Termo que nenhum produto tem é conversa
 * ("uns aperitivos gostosos"): com quantidade ou ocasião, não elimina o catálogo. */
export function escolherProdutosHub(busca:string,produtos:readonly ProdutoHubLeitura[],limite=3):ProdutoHubLeitura[]{
 const todos=termosComerciais(busca),termos=todos.filter(t=>!palavrasOcasiao.has(t)&&!/^\d+$/.test(t)),ocasiao=todos.filter(t=>palavrasOcasiao.has(t)),numeros=todos.filter(t=>/^\d+$/.test(t)),quantidade=quantidadeComercial(busca);
 const validos=produtos.filter(p=>p.especificacao.trim()),exige=termos.length>0&&(validos.some(p=>notaHub(p,termos)>0)||!quantidade&&!ocasiao.length);
 return validos.filter(p=>{const c=capacidadeHub(p);return !quantidade||(c?quantidade>=c[0]&&quantidade<=c[1]:exige);})
  .map(p=>({p,tem:!!capacidadeHub(p),busca:notaHub(p,termos),total:notaHub(p,termos)+notaHub(p,numeros)+notaHub(p,ocasiao)}))
  .filter((v,_i,todas)=>(!exige||v.busca>0)&&(!quantidade||v.tem||!todas.some(o=>o.tem&&(!exige||o.busca>0))))
  // Sem produto pedido, as tábuas (com capacidade) vêm antes de bebida e acessório.
  .map(v=>({...v,total:v.total+(quantidade&&v.tem?20:!termos.length&&v.tem?2:0)})).sort((a,b)=>b.total-a.total||a.p.nome.localeCompare(b.p.nome)).slice(0,limite).map(v=>v.p);
}
/** Grupo sem opção exata: tamanhos vizinhos, do que pede menos unidades e sobra
 * menos. Entre dois tamanhos vai um produto de cada; acima de todos, os maiores. */
export function escolherProximosHub(busca:string,produtos:readonly ProdutoHubLeitura[],quantidade:number,limite=3):{produto:ProdutoHubLeitura;unidades:number;capacidade:number}[]{
 const termos=termosComerciais(busca).filter(t=>!palavrasOcasiao.has(t)&&!palavrasCategoria.has(t)&&!/^\d+$/.test(t));
 const validos=produtos.flatMap(p=>{const c=p.especificacao.trim()?capacidadeHub(p):null;return c?[{produto:p,capacidade:c[1],busca:notaHub(p,termos)}]:[];}),exige=validos.some(v=>v.busca>0),porTamanho=new Map<number,number>();
 const maximo=quantidade>Math.max(0,...validos.map(v=>v.capacidade))?limite:1;
 return validos.filter(v=>!exige||v.busca>0).map(v=>{const unidades=Math.ceil(quantidade/v.capacidade);return {...v,unidades,custo:unidades-1+(unidades*v.capacidade-quantidade)/quantidade};})
  .sort((a,b)=>a.custo-b.custo||a.produto.nome.localeCompare(b.produto.nome))
  .filter(v=>{const n=porTamanho.get(v.capacidade)??0;porTamanho.set(v.capacidade,n+1);return n<maximo;}).slice(0,limite).map(({produto,unidades,capacidade})=>({produto,unidades,capacidade}));
}
const palavrasBebida=new Set('vinho vinhos espumante espumantes champagne cerveja cervejas licor licores suco sucos bebida bebidas'.split(' '));
const palavrasCategoria=new Set('tabua tabuas mesa mesas grazing grazings cesta cestas caixa caixas box kit kits combo combos composicao composicoes aperitivo aperitivos salgado salgados doce doces comida comidas'.split(' '));
/** Tamanhos vizinhos para consultar o HUB, que busca por termo e não por faixa. */
export function consultaTamanhosHub(quantidade:number){
 const tamanhos=[1,2,3,4,5,6,8,10,12,15,20,25,30,40,50,60,80,100],abaixo=tamanhos.filter(t=>t<quantidade).slice(-5),acima=tamanhos.filter(t=>t>quantidade).slice(0,3);
 return [...acima,...abaixo.reverse()].join(' ');
}
export type ComposicaoGrupo={pessoas:number;itens:{quantidade:number;nome:string}[]};
/** Lê composições do conhecimento aprovado: "para 40 pessoas: 1× Item; 2× Item". */
export function composicoesAprovadas(textos:readonly string[]):ComposicaoGrupo[]{
 return textos.flatMap(texto=>{
  const marcas=[...texto.matchAll(/\bpara\s+(?:at[eé]\s+|cerca de\s+|umas\s+|uns\s+)?(\d{1,3})\s+(?:pessoas|convidados)\b/giu)];
  return marcas.flatMap((m,i)=>{
   const trecho=texto.slice(m.index+m[0].length,marcas[i+1]?.index??texto.length),vistos=new Set<string>();
   const itens=[...trecho.matchAll(/(?<![\p{L}\d])(\d{1,2})\s*[x×]\s+([^;\n]+?)(?=\s*(?:;|\n|$|,\s*\d{1,2}\s*[x×]\s|\s+e\s+\d{1,2}\s*[x×]\s|\.(?:\s|$)))/giu)].map(v=>({quantidade:Number(v[1]),nome:v[2].trim()})).filter(v=>v.quantidade>0&&v.nome.length<=160&&!vistos.has(normalizar(v.nome))&&vistos.add(normalizar(v.nome)));
   return itens.length>1?[{pessoas:Number(m[1]),itens}]:[];
  });
 });
}
/** Referência para o grupo: a menor que o comporta; senão, a maior que existir. */
export function composicaoParaGrupo(composicoes:readonly ComposicaoGrupo[],quantidade:number):ComposicaoGrupo|null{
 const ordem=[...composicoes].sort((a,b)=>a.pessoas-b.pessoas);
 return ordem.find(c=>c.pessoas>=quantidade)??ordem.at(-1)??null;
}
const palavrasNome=(v:string)=>(normalizar(v.replace(/\([^)]*\)/g,' ')).replace(/(\d+)\s*un(?:idades?)?\b/g,'$1 ').match(/[\p{L}\p{N}]+/gu)??[]).filter(p=>!['a','o','de','do','da','no','na','para','com','e'].includes(p));
/** Produto pelo nome: igual sem traço, parênteses e unidade, ou o único que contém
 * todas as palavras. Com dúvida entre dois, não escolhe. */
export function produtoPeloNome(nome:string,produtos:readonly ProdutoHubLeitura[]):ProdutoHubLeitura|null{
 const pedido=palavrasNome(nome);if(!pedido.length)return null;
 const achados=produtos.map(p=>({p,tem:palavrasNome(p.nome)})).filter(v=>pedido.every(t=>v.tem.includes(t))),iguais=achados.filter(v=>v.tem.length===pedido.length);
 return (iguais.length===1?iguais:achados.length===1?achados:[])[0]?.p??null;
}
export type EscolhaCatalogo={produto:ProdutoHubLeitura;grupo?:NonNullable<ProdutoComercial['grupo']>};
const MAX_ITENS_COMPOSICAO=8;
/** Catálogo para a resposta: opção exata; grupo maior que qualquer opção, a
 * composição aprovada mais próxima, item a item; senão, os tamanhos vizinhos. */
export async function escolherCatalogo(busca:string,buscarHub:(consulta:string)=>Promise<readonly ProdutoHubLeitura[]>,composicoes?:()=>Promise<readonly string[]>):Promise<EscolhaCatalogo[]>{
 const iniciais=await buscarHub(consultaHubComercial(busca)),quantidade=quantidadeComercial(busca),exatas=escolherProdutosHub(busca,iniciais);
 // "Vinho para 30 pessoas" pede um produto pelo nome: capacidade não entra.
 const pedido=termosComerciais(busca).filter(t=>!palavrasOcasiao.has(t)&&!palavrasCategoria.has(t)&&!/^\d+$/.test(t)),peloNome=exatas.some(p=>{const nome=raizes(p.nome);return pedido.some(t=>nome.has(raiz(t))||palavrasBebida.has(t));});
 if(!quantidade||peloNome||exatas.some(p=>capacidadeHub(p)))return exatas.map(produto=>({produto}));
 const conhecidos=new Map<string,ProdutoHubLeitura>([...iniciais,...await buscarHub(consultaTamanhosHub(quantidade))].map(p=>[p.id,p]));
 const maior=Math.max(0,...[...conhecidos.values()].map(p=>capacidadeHub(p)?.[1]??0));
 if(quantidade>maior&&composicoes){
  const referencia=composicaoParaGrupo(composicoesAprovadas(await composicoes()),quantidade);
  const itens:EscolhaCatalogo[]=[];
  for(const item of referencia?.itens.slice(0,MAX_ITENS_COMPOSICAO)??[]){
   const produto=produtoPeloNome(item.nome,[...await buscarHub(palavrasNome(item.nome).slice(0,6).join(' '))]);
   if(produto&&!itens.some(v=>v.produto.id===produto.id))itens.push({produto,grupo:{tipo:'composicao',pessoas:referencia!.pessoas,quantidade:item.quantidade}});
  }
  if(itens.length>1)return itens;
 }
 const proximas=escolherProximosHub(busca,[...conhecidos.values()],quantidade);
 return proximas.length?proximas.map(({produto,unidades,capacidade})=>({produto,grupo:{tipo:'proxima',unidades,capacidade}})):exatas.map(produto=>({produto}));
}
const numerosPessoas:Record<string,number>={um:1,uma:1,dois:2,duas:2,tres:3,quatro:4,cinco:5,seis:6,sete:7,oito:8,nove:9,dez:10};
const numeroPessoas=(v:string)=>numerosPessoas[v]??Number(v);
export function quantidadeComercial(busca:string):number|null{
 const texto=normalizar(busca),numeros='\\d{1,3}|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez';
 if(new RegExp(`\\b(?:${numeros})\\s+ou\\s+(?:${numeros})\\s+(?:pessoas?|convidados?|adultos?)\\b`).test(texto))return null;
 const achados=[...texto.matchAll(new RegExp(`\\b(${numeros})\\s+(?:pessoas?|convidados?|adultos?)\\b|\\b(?:grazing|tabua)\\s+para\\s+(${numeros})\\b|\\bpara\\s+(${numeros})\\s*(?=[?!.,]|$)|\\bsomos\\s+(?:em\\s+)?(\\d{1,3}|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\\b`,'g'))].filter(v=>!/(?:\bnao|\bnem|\bnunca)\s+(?:para\s+)?$/.test(texto.slice(Math.max(0,v.index-24),v.index)));
 if(achados.length>1&&/\bou\b/.test(texto.slice(achados.at(-2)!.index+achados.at(-2)![0].length,achados.at(-1)!.index)))return null;
 const ultimo=achados.at(-1),n=ultimo?numeroPessoas(ultimo[1]??ultimo[2]??ultimo[3]??ultimo[4]):NaN;return Number.isSafeInteger(n)&&n>0&&n<=500?n:null;
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
export function fontesProdutosComerciais(t:TarefaIA,produtos:ProdutoComercial[],agora:number,sugerir=false):FonteIA[]{
 return produtos.map(p=>{
  const o=p.oferta,preco=o?.preco,precoLocal=preco?new Intl.NumberFormat('pt-BR',{style:'currency',currency:preco.moeda,maximumFractionDigits:4}).format(Number(preco.valor)):'';
  const precoVisivel=preco&&preco.moeda==='BRL'?`${preco.tipo==='a_partir'?'a partir de ':''}${precoLocal.replace(/\s/gu,' ')}`:undefined;
  const comercial=o?`Link oficial de compra: ${o.url}. O cliente faz o pedido no site, por esse link. ${preco?`Preço no site: ${preco.tipo==='a_partir'?'a partir de ':''}${preco.valor} ${preco.moeda} (${precoLocal}${preco.moeda==='BRL'?'; valor em reais':''}). `:''}Compra no site: ${o.disponibilidade??'consulte as opções na página'}. ${o.tipo==='variavel'?'Escolha as opções na página do produto. ':''}Disponibilidade para compra não garante entrega em uma data ou CEP.`:`Link e dados comerciais não confirmados. ${p.vinculo.motivo} Pode explicar as informações confirmadas do HUB. Não invente link, preço ou disponibilidade. Peça apoio humano somente se o dado comercial ausente for necessário para atender ao pedido do cliente.`;
  const grupo=p.grupo?.tipo==='composicao'?`Item da composição de referência para ${p.grupo.pessoas} pessoas: ${p.grupo.quantidade}× ${p.nome}. Nenhuma opção única atende o grupo do cliente: se a composição ainda não foi enviada nesta conversa, liste todos os itens com a quantidade da referência, sem recalcular para o grupo, nome e preço, diga para quantas pessoas é a referência e que dá para ajustar. Não afirme que ela serve exatamente o grupo do cliente.\n`:p.grupo?.tipo==='proxima'?`Não há opção exata para o grupo do cliente; esta é uma das mais próximas. ${p.grupo.unidades<=4?`Capacidade: ${p.grupo.unidades}× ${p.nome} somam ${p.grupo.unidades*p.grupo.capacidade} pessoas. `:''}Diga que não é a medida exata.\n`:'';
  const conteudo=`Produto do HUB: ${p.nome}. ${p.especificacao.slice(0,p.grupo?.tipo==='composicao'?600:2400)}\n${comercial}\n${grupo}${p.grupo?.tipo==='composicao'?'':'Use a necessidade já informada para selecionar até três opções. '}Se ainda não sugeriu nesta conversa, sugira com nome e preço nesta resposta, sem esperar mais detalhes. Se já sugeriu, não repita a lista nem a pergunta: responda ao que o cliente disse e, se ele não pedir mudança, oriente uma vez a fazer o pedido no site pelos links enviados. Se já orientou o pedido, não repita a orientação: responda em uma frase curta. Se faltar apenas preferência, ocasião ou orçamento, pergunte uma vez, depois de sugerir; isso não exige apoio humano. Dúvida material, conflito de identidade, alergia ou condição sem fonte exige apoio.`;
  const valor={hubId:p.hubId,nome:p.nome,especificacao:p.especificacao,versao:p.fonteHub.versao,...(p.grupo?{grupo:p.grupo}:{}),oferta:o?{produto:o.produtoId,variacao:o.variacaoId,url:o.url,preco:o.preco,compravel:o.compravel,disponibilidade:o.disponibilidade}:null};
  return {...fonte(t,'hub_comercial_'+hash(p.hubId).toString('hex').slice(0,24),conteudo,valor,agora),...(o?{compra:{nome:p.nome,url:o.url,...(precoVisivel?{preco:precoVisivel}:{}),...(p.grupo?.tipo==='composicao'?{quantidade:p.grupo.quantidade,referencia:p.grupo.pessoas}:{}),...(sugerir?{sugerir:true as const}:{})}}:{})};
 });
}
/** Já dá para sugerir: o cliente disse para quantas pessoas é ou pediu um produto
 * pelo nome. "Quero uma tábua" ainda não diz o tamanho. */
export function podeSugerirProdutos(busca:string,produtos:readonly {nome:string}[]){
 if(quantidadeComercial(busca)!==null)return true;
 const pedido=termosComerciais(busca).filter(t=>!palavrasOcasiao.has(t)&&!palavrasCategoria.has(t)&&!/^\d+$/.test(t));
 return produtos.some(p=>{const nome=raizes(p.nome);return pedido.some(t=>nome.has(raiz(t)));});
}
/** Site da loja configurada no servidor. Acompanha o catálogo para o cliente ter
 * para onde ir quando nenhum produto serve ou o produto está sem anúncio. */
export function fonteSiteOficial(t:TarefaIA,site:string,agora:number):FonteIA{
 const url=new URL(site).origin;
 return fonte(t,'site_oficial',`Site oficial: ${url}. No site o cliente vê todas as opções, escolhe a data e o horário e faz o pedido. Prefira o link oficial do produto; use o site quando nenhum produto do catálogo servir ou o produto não tiver link.`,{url},agora);
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
 async buscar(busca:string,signal:AbortSignal,composicoes?:()=>Promise<readonly string[]>):Promise<ProdutosComerciaisResposta>{
  validarTextoOperacao(busca,1000,true);if(signal.aborted)throw Error('COMERCIAL_CONSULTA_CANCELADA');
  if(!this.d.hub)throw Error('HUB_CATALOGO_INDISPONIVEL');
  const hub=this.d.hub;let mais=false,encontrados=0;
  // A classificação usa somente fatos do HUB. Nomes da loja não selecionam produto.
  const candidatas=await escolherCatalogo(busca,async consulta=>{const r=await hub.buscar(consulta,signal);mais||=r.mais;encontrados=Math.max(encontrados,r.produtos.length);return r.produtos;},composicoes);
  const vinculos=(await this.vinculos()).vinculos;
  const avisos:string[]=[];
  const produtos=await Promise.all(candidatas.map(async({produto:p,grupo}):Promise<ProdutoComercial>=>{
   const m=vinculos.filter(v=>v.hubId===p.id),manual=m.length===1?m[0]:undefined;
   const r:ProdutoComercial={hubId:p.id,nome:p.nome,especificacao:p.especificacao,motivo:'Informações do HUB: '+p.especificacao.slice(0,260),fonteHub:{id:p.id,versao:p.versao,consultadoEm:p.consultadoEm},vinculo:{estado:m.length>1?'ambiguo':'pendente',motivo:m.length>1?'Há mais de uma associação. A equipe precisa conferir.':'Não há associação segura com um anúncio da loja.'},oferta:null,...(grupo?{grupo}:{})};
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
  return {produtos,consultadoEm:new Date(this.agora()).toISOString(),mais:mais||encontrados>3,avisos:[...new Set(avisos)].slice(0,10)};
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
 async fontesProdutos(t:TarefaIA,signal:AbortSignal,contexto:string[]=[],composicoes?:()=>Promise<readonly string[]>):Promise<FonteIA[]>{
  const busca=[...contexto.slice(-4).map(v=>v.slice(0,180)),t.pergunta].join(' ').slice(-1000),r=await this.buscar(busca,signal,composicoes),agora=this.agora();
  return [...fontesProdutosComerciais(t,r.produtos,agora,podeSugerirProdutos(busca,r.produtos)),...(this.d.woo?[fonteSiteOficial(t,this.d.woo.site,agora)]:[])];
 }
 async fontesPedido(i:IdentidadeOperacao,t:TarefaIA,signal:AbortSignal):Promise<FonteIA[]>{
  const r=await this.pedidos(i,t.conversaId,numeroPedidoNaPergunta(t.pergunta),signal,t.clienteId);if(r.estado!=='consultado')throw Error('WOO_PEDIDO_NAO_VINCULADO');
  return r.pedidos.map(p=>fonte(t,'woo_pedido_'+hash(p.numero).toString('hex').slice(0,24),`Pedido #${p.numero}, feito em ${p.data}: ${p.status.rotulo}. Itens comprados: ${p.itens.map(v=>`${v.quantidade} × ${v.nome}`).join('; ')}. Modalidade: ${p.modalidadeEntrega}. ${p.agendamento??'Agendamento não informado.'} ${p.rastreio??'Rastreio não informado.'} ${r.mensagem}`,{numero:p.numero,data:p.data,status:p.status,itens:p.itens,modalidade:p.modalidadeEntrega,agendamento:p.agendamento,rastreio:p.rastreio},this.agora()));
 }
}
