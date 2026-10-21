import {objetoOperacao} from './operacao-tipos';

export type ContatoCompartilhadoOperacao={nome:string;telefones:{numero:string;tipo:string}[];emails:string[];empresa:string};
export type PedidoContatosCompartilhadosOperacao={wamid:string;waba:string;numero:string;remetente:string};
export type LeitorContatosCompartilhadosOperacao=(pedidos:PedidoContatosCompartilhadosOperacao[])=>Promise<Map<string,ContatoCompartilhadoOperacao[]>>;

/** Cartões são conteúdo recebido. Não confirmam identidade ou existência no WhatsApp. */
function texto(v:unknown,max:number){return typeof v==='string'?v.replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g,' ').replace(/\s+/g,' ').trim().slice(0,max).replace(/[\uD800-\uDBFF]$/,''):'';}
function lista(v:unknown){return Array.isArray(v)?v:[];}
export function normalizarContatosCompartilhadosOperacao(v:unknown,formato:'meta'|'dto'='meta'):ContatoCompartilhadoOperacao[]{
 const contatos:ContatoCompartilhadoOperacao[]=[];
 for(const bruto of lista(v)){
  if(!objetoOperacao(bruto))continue;
  const origemNome=objetoOperacao(bruto.name)?bruto.name:{},org=objetoOperacao(bruto.org)?bruto.org:{};
  const nome=texto(formato==='dto'?bruto.nome:origemNome.formatted_name,200)||texto([origemNome.first_name,origemNome.middle_name,origemNome.last_name].filter(v=>typeof v==='string').join(' '),200);
  const empresa=texto(formato==='dto'?bruto.empresa:org.company,200);
  const telefones:ContatoCompartilhadoOperacao['telefones']=[],numerosVistos=new Set<string>();
  for(const telefone of lista(formato==='dto'?bruto.telefones:bruto.phones)){
   if(!objetoOperacao(telefone))continue;
   const numeroBruto=formato==='dto'?telefone.numero:telefone.phone;
   // Não retirar letras, interpretar wa_id, acrescentar DDI ou mudar o nono dígito.
   if(typeof numeroBruto!=='string'||numeroBruto.length>80||/[\x00-\x1f\x7f-\x9f]/.test(numeroBruto))continue;
   const numero=numeroBruto.trim();if(!/^[+\d(). -]+$/.test(numero)||!/[0-9]/.test(numero)||numero.includes('+')&&!/^\+[^+]+$/.test(numero))continue;
   if(!numerosVistos.has(numero)){numerosVistos.add(numero);telefones.push({numero,tipo:texto(formato==='dto'?telefone.tipo:telefone.type,40)});}
  }
  const emails:string[]=[],emailsVistos=new Set<string>();
  for(const email of lista(bruto.emails)){
   const valor=formato==='dto'?email:objetoOperacao(email)?email.email:null;
   if(typeof valor!=='string'||valor.length>254||/[\x00-\x1f\x7f-\x9f]/.test(valor))continue;
   const endereco=valor.trim();if(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(endereco)&&!emailsVistos.has(endereco)){emailsVistos.add(endereco);emails.push(endereco);}
  }
  if(!nome&&!empresa&&!telefones.length&&!emails.length)continue;
  contatos.push({nome:nome||empresa||'Contato compartilhado',telefones,emails,empresa});
 }
 return contatos;
}
export function contatosCompartilhadosMensagemOperacao(v:Record<string,unknown>){return normalizarContatosCompartilhadosOperacao(objetoOperacao(v.metadados)?v.metadados.contatosCompartilhados:null,'dto');}
export const AVISO_CONTATOS_COMPARTILHADOS_GRANDE='Este compartilhamento de contatos é muito grande para exibir. Peça ao cliente para reenviar os contatos em partes.';
/** O recibo e os metadados permanecem completos; somente a projeção HTTP tem orçamento. */
export function projetarContatosCompartilhadosOperacao(v:Record<string,unknown>){
 const contatos=contatosCompartilhadosMensagemOperacao(v);
 if(!contatos.length&&v.tipo!=='contacts'&&(!objetoOperacao(v.metadados)||v.metadados.tipoOriginal!=='contacts'))return null;
 if(new TextEncoder().encode(JSON.stringify(contatos)).byteLength>512*1024)return {tipo:'unsupported',conteudo:AVISO_CONTATOS_COMPARTILHADOS_GRANDE,contatosCompartilhados:[] as ContatoCompartilhadoOperacao[]};
 return {tipo:contatos.length?'contacts':'unsupported',conteudo:resumoContatosCompartilhadosOperacao(contatos),contatosCompartilhados:contatos};
}
export function resumoContatosCompartilhadosOperacao(contatos:ContatoCompartilhadoOperacao[]){
 if(!contatos.length)return 'Contato compartilhado indisponível';
 const nomes=contatos.slice(0,3).map(c=>c.nome).join(', '),restantes=contatos.length-3;
 return `${contatos.length===1?'Contato compartilhado':'Contatos compartilhados'}: ${nomes}${restantes>0?` e mais ${restantes}`:''}`;
}
