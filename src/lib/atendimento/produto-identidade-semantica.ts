/** Identidade comercial determinística. Complementos editoriais podem variar;
 * ingredientes, restrições, quantidade, tamanho e versão continuam na chave. */
const entidades:Record<string,string>={amp:'&',quot:'"',apos:"'",nbsp:' ',ndash:' ',mdash:' ',hellip:' ',reg:' ',trade:' ',copy:' ',aacute:'á',atilde:'ã',acirc:'â',agrave:'à',eacute:'é',ecirc:'ê',iacute:'í',oacute:'ó',otilde:'õ',ocirc:'ô',uacute:'ú',ccedil:'ç'};
const equivalentes:Record<string,string>={individual:'1',um:'1',uma:'1',dois:'2',duas:'2',tres:'3',quatro:'4',cinco:'5',seis:'6',sete:'7',oito:'8',nove:'9',dez:'10',vegetariana:'vegetariano',veganas:'vegano',veganos:'vegano',vegana:'vegano',pequena:'pequeno',media:'medio',grandes:'grande',pequenos:'pequeno',pequenas:'pequeno'};
const gramaticais=new Set('a o as os de da do das dos e para com ao aos em no na nos nas por pessoa pessoas porcao porcoes'.split(' '));

function limpar(v:string){
 return v.replace(/<[^>]*>/g,' ').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(_,e:string)=>{
  if(e.startsWith('#')){const n=e[1]?.toLowerCase()==='x'?parseInt(e.slice(2),16):parseInt(e.slice(1),10);return n>0&&n<=0x10ffff&&!Number.isNaN(n)?String.fromCodePoint(n):' ';}
  return entidades[e.toLowerCase()]??e;
 }).normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('pt-BR').replace(/[\x00-\x1f\x7f]/g,' ');
}

export function identidadeProdutoSemantica(nome:string):{chave:string;ancora:string}|null{
 if(typeof nome!=='string'||nome.length>500||!nome.trim())return null;
 let normal=limpar(nome);
 // "Tábua de frios" descreve o anúncio Grazing; sozinho é o produto inteiro.
 const semComplemento=normal.replace(/\btabuas?\s+de\s+(?:frios(?:\s+e\s+queijos)?|queijos\s+e\s+frios)\b/g,' ');
 if(semComplemento.match(/[a-z]{3,}/))normal=semComplemento;
 // Separador com três casas pode significar decimal ou milhar. Não adivinhar.
 if(/\d+[.,]\d{3}\s*(?:kg|quilos?|quilogramas?|g|gr|gramas?|ml|l|litros?)\b/.test(normal))return null;
 let unidadeInvalida=false;
 normal=normal.replace(/(^|[^a-z0-9.,])(\d+(?:[.,]\d+)?|[.,]\d+)\s*(kg|quilos?|quilogramas?|g|gr|gramas?|ml|l|litros?)\b/g,(_,inicio:string,n:string,u:string)=>{
  const valor=Number(n.replace(',','.')),massa=/^(?:kg|quilo)/.test(u),litro=/^(?:l|litros?)$/.test(u);
  if(!Number.isFinite(valor)||valor<=0||valor>1000000)unidadeInvalida=true;
  return inicio+String(valor*(massa||litro?1000:1))+(massa||/^(?:g|gr)/.test(u)?'gramas':'mililitros');
 });
 if(unidadeInvalida)return null;
 normal=normal.replace(/(\d)[.,](\d)/g,'$1decimal$2');
 const tokens=(normal.match(/[a-z0-9]+/g)??[]).map(t=>equivalentes[t]??t).filter(t=>!gramaticais.has(t));
 const ancora=tokens.find(t=>/^[a-z]{3,}$/.test(t)&&!['sem','zero','kit','mini','vegano','vegetariano','pequeno','medio','grande'].includes(t));
 if(!ancora||!tokens.length||tokens.length>40)return null;
 // A ordem editorial não diferencia produtos. Repetições numéricas são mantidas.
 return {chave:[...tokens].sort().join('|'),ancora};
}

export function produtosSemanticamenteEquivalentes(nomeHub:string,nomeWoo:string){
 const hub=identidadeProdutoSemantica(nomeHub),woo=identidadeProdutoSemantica(nomeWoo);
 return !!hub&&!!woo&&hub.chave===woo.chave;
}
