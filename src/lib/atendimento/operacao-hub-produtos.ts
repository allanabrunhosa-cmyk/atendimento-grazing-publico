import 'server-only';
import type {Pool,PoolClient} from 'pg';

/** Projeção comercial. Código interno do HUB não comprova SKU da loja. */
export type ProdutoHubLeitura={id:string;nome:string;especificacao:string;sku:string|null;versao:string|null;wooProdutoId:number|null;wooVariacaoId:number|null;consultadoEm:string};
export type PortCatalogoHub={buscar:(busca:string,signal:AbortSignal)=>Promise<{produtos:ProdutoHubLeitura[];mais:boolean}>;obter:(id:string,signal:AbortSignal)=>Promise<ProdutoHubLeitura|null>;contar:(signal?:AbortSignal)=>Promise<number>};
type Linha={id:unknown;nome:unknown;especificacao:unknown;descricao:unknown;versao:unknown;sku:unknown;woo_produto_id:unknown;woo_variacao_id:unknown};
type Opcoes={limite?:number;timeoutMs?:number;agora?:()=>Date};
const limpar=(s:string)=>s.replace(/<[^>]*>/g,' ').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,' ').replace(/[ \t]+/g,' ').trim();
const consulta=`SELECT id,nome,especificacao,descricao,versao,sku,woo_produto_id,woo_variacao_id
 FROM atendimento_integracao.produto_comercial p
 CROSS JOIN LATERAL (SELECT coalesce(sum(CASE
  WHEN termo ~ '^%[0-9]{1,3}%$' AND lower(p.nome) ~ ('(^|[^0-9])' || replace(termo,'%','') || '([^0-9]|$)') THEN 5
  WHEN termo ~ '^%(um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|[0-9]{1,3})%$'
   AND translate(lower(concat_ws(' ',p.especificacao,p.descricao)),'áàâãäéèêëíìîïóòôõöúùûüçñ','aaaaaeeeeiiiiooooouuuucn')
    ~ ('(serve|rende|atende|ideal para|porcao para)[[:space:]]+(ate[[:space:]]+)?' || replace(termo,'%','') || '[[:space:]]+pessoas?') THEN 4
  WHEN translate(lower(p.nome),'áàâãäéèêëíìîïóòôõöúùûüçñ','aaaaaeeeeiiiiooooouuuucn') LIKE termo ESCAPE '\\' THEN 3
  WHEN translate(lower(concat_ws(' ',p.nome,p.especificacao,p.descricao)),
   'áàâãäéèêëíìîïóòôõöúùûüçñ','aaaaaeeeeiiiiooooouuuucn') LIKE termo ESCAPE '\\' THEN 1
  ELSE 0 END),0) relevancia FROM unnest($3::text[]) termo) r
 WHERE ($1::text IS NULL OR id=$1)
 AND ($2::text='' OR id=$2 OR r.relevancia>0)
 AND length(btrim(concat_ws(' ',especificacao,descricao)))>0
 ORDER BY CASE WHEN id=$2 OR lower(nome)=lower($2) THEN 0 ELSE 1 END,r.relevancia DESC,nome,id LIMIT $4`;
function entrada(v:string,max:number){if(typeof v!=='string'||v.length>max||/[\x00-\x1f\x7f]/.test(v))throw Error('HUB_BUSCA_INVALIDA');return v.normalize('NFKC').trim();}
function cancelar(signal:AbortSignal){if(signal.aborted)throw Error('HUB_CONSULTA_CANCELADA');}
function produto(l:Linha,consultadoEm:string):ProdutoHubLeitura|null{
 if(typeof l.id!=='string'||!l.id||l.id.length>100||typeof l.nome!=='string'||!l.nome.trim()||l.nome.length>160||l.especificacao!==null&&typeof l.especificacao!=='string'||l.descricao!==null&&typeof l.descricao!=='string')throw Error('HUB_PRODUTO_INVALIDO');
 const base=typeof l.especificacao==='string'?l.especificacao:'',descricao=typeof l.descricao==='string'?l.descricao:'';
 if(base.length>300||descricao.length>3000||typeof l.versao!=='string'||!(/^[1-9]\d{0,15}$/.test(l.versao)))throw Error('HUB_PRODUTO_INVALIDO');
 // A view inicial não tem SKU nem associação Woo comprovada. Não herdar
 // identidade de outra origem, código interno ou número sugerido pelo modelo.
 if(l.sku!==null||l.woo_produto_id!==null||l.woo_variacao_id!==null)throw Error('HUB_VINCULO_NAO_CONFERIDO');
 const especificacao=[base,descricao].map(limpar).filter(Boolean).join('\n');
 return especificacao?{id:l.id,nome:limpar(l.nome),especificacao,sku:null,versao:l.versao,wooProdutoId:null,wooVariacaoId:null,consultadoEm}:null;
}
/** Usa o mesmo pool central. Só consulta a view comercial com SELECT; nunca
 * lê tabelas comerciais completas nem copia cadastro para o Atendimento.
 * O prazo SQL limita a leitura em curso; cancelamento descarta seu resultado. */
export function criarCatalogoHub(central:Pick<Pool,'connect'>,opcoes:Opcoes={}):PortCatalogoHub{
 const limite=opcoes.limite??10,timeout=opcoes.timeoutMs??3000;
 if(!Number.isSafeInteger(limite)||limite<1||limite>20||!Number.isSafeInteger(timeout)||timeout<100||timeout>10000)throw Error('HUB_CONFIGURACAO_INVALIDA');
 async function transacao<T>(signal:AbortSignal,executar:(tx:PoolClient)=>Promise<T>){
  cancelar(signal);
  let tx:PoolClient|undefined,aberta=false;
  try{
   tx=await central.connect();cancelar(signal);await tx.query('BEGIN READ ONLY');aberta=true;
   await tx.query("SELECT set_config('statement_timeout',$1,true)",[String(timeout)]);
   await tx.query("SELECT set_config('lock_timeout',$1,true)",[String(Math.min(timeout,1000))]);
   cancelar(signal);const resultado=await executar(tx);cancelar(signal);return resultado;
  }catch{
   cancelar(signal);throw Error('HUB_CATALOGO_INDISPONIVEL');
  }finally{
   if(tx){let descartar=false;try{if(aberta)await tx.query('ROLLBACK');}catch{descartar=true;}finally{tx.release(descartar);}}
  }
 }
 async function ler(busca:string,id:string|null,signal:AbortSignal){
  const termos=[...new Set(busca.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('pt-BR').split(/\s+/).filter(Boolean))].slice(0,8).map(t=>'%'+t.replace(/[\\%_]/g,'\\$&')+'%');
  return transacao(signal,async tx=>{
   const r=await tx.query<Linha>(consulta,[id,busca,termos,id?1:limite+1]);
   if(r.rows.length>(id?1:limite+1))throw Error('HUB_RESPOSTA_EXCESSIVA');
   const consultadoEm=(opcoes.agora?.()??new Date()).toISOString();
   const produtos=r.rows.slice(0,id?1:limite).map(l=>produto(l,consultadoEm)).filter((p):p is ProdutoHubLeitura=>p!==null);
   return {produtos,mais:!id&&r.rows.length>limite};
  });
 }
 return {
  buscar:async(busca,signal)=>ler(entrada(busca,160),null,signal),
  obter:async(id,signal)=>{const chave=entrada(id,100);if(!chave)throw Error('HUB_BUSCA_INVALIDA');return (await ler('',chave,signal)).produtos[0]??null;},
  contar:async(signal=new AbortController().signal)=>transacao(signal,async tx=>{const r=await tx.query<{total:string}>('SELECT count(*)::text total FROM atendimento_integracao.produto_comercial');const total=Number(r.rows[0]?.total);if(!Number.isSafeInteger(total)||total<0)throw Error('HUB_CONTAGEM_INVALIDA');return total;}),
 };
}
