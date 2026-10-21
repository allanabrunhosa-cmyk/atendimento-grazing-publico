type Objeto=Record<string,unknown>;
export type ComponenteEnvioModeloOperacao={type:'header'|'body'|'button';sub_type?:'quick_reply';index?:string;parameters:({type:'text';text:string}|{type:'payload';payload:string})[]};
type Plano={variaveis:string[];cabecalho:string[];corpo:string[];botoes:{indice:number;payload:string}[]};
const objeto=(v:unknown):v is Objeto=>!!v&&typeof v==='object'&&!Array.isArray(v);
const texto=(v:unknown,max:number):v is string=>typeof v==='string'&&!!v.trim()&&v.length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v);
function parametros(v:string,max:number):string[]|null{
 const n=[...new Set([...v.matchAll(/\{\{([1-9]\d*)\}\}/g)].map(x=>Number(x[1])))].sort((a,b)=>a-b);
 return n.length<=max&&n.every((x,k)=>x===k+1)&&!/\{\{|\}\}/.test(v.replace(/\{\{([1-9]\d*)\}\}/g,''))?n.map(String):null;
}
function analisar(componentes:unknown):Plano|null{
 if(!Array.isArray(componentes)||componentes.length>4||componentes.some(v=>!objeto(v)))return null;
 const tipos=componentes.map(v=>v.type);if(new Set(tipos).size!==tipos.length||tipos.filter(v=>v==='BODY').length!==1)return null;
 const plano:Plano={variaveis:[],cabecalho:[],corpo:[],botoes:[]};
 for(const c of componentes as Objeto[]){
  if(c.type==='BODY'||c.type==='HEADER'){
   if(c.type==='HEADER'&&c.format!=='TEXT'||!texto(c.text,c.type==='HEADER'?60:32768))return null;
   const vars=parametros(c.text,c.type==='HEADER'?1:20);if(vars===null)return null;
   if(c.type==='HEADER')plano.cabecalho=vars;else plano.corpo=vars;
  }else if(c.type==='FOOTER'){
   if(!texto(c.text,60)||/\{\{|\}\}/.test(c.text))return null;
  }else if(c.type==='BUTTONS'){
   if(!Array.isArray(c.buttons)||c.buttons.length<1||c.buttons.length>10)return null;
   for(const [indice,b]of c.buttons.entries()){
    if(!objeto(b)||!texto(b.text,25))return null;
    if(b.type==='URL'){
     if(!texto(b.url,2048)||/\{\{|\}\}/.test(b.url))return null;
     try{const u=new URL(b.url);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)return null;}catch{return null;}
    }else if(b.type==='QUICK_REPLY'){
     // Preserva um retorno oficial pré-definido; sem customização, retorna o
     // próprio texto aprovado. O recebimento não interpreta isso como comando.
     const payload=b.payload??b.text;if(!texto(payload,256))return null;
     plano.botoes.push({indice,payload});
    }else return null;
   }
  }else return null;
 }
 plano.variaveis=[...plano.cabecalho.map(v=>'header:'+v),...plano.corpo];
 return plano.variaveis.length<=20?plano:null;
}
export function variaveisModeloOperacao(componentes:unknown):string[]{return analisar(componentes)?.variaveis??[];}
export function modeloTextoSuportadoOperacao(componentes:unknown):boolean{return analisar(componentes)!==null;}
/** Orçamento restante do campo, incluindo prefixos e variáveis repetidas. */
export function limiteVariavelModeloOperacao(componentes:unknown,chave:string,valores:Record<string,string>={}):number{
 const header=chave.startsWith('header:'),limite=header?60:Array.isArray(componentes)&&componentes.length===1?32768:1024;
 const parte=Array.isArray(componentes)?componentes.find(c=>objeto(c)&&c.type===(header?'HEADER':'BODY')):null;
 if(!objeto(parte)||typeof parte.text!=='string')return limite;
 let repeticoes=0;
 const restante=parte.text.replace(/\{\{([1-9]\d*)\}\}/g,(_,n)=>{
  const id=header?'header:'+n:n;if(id===chave){repeticoes++;return '';}
  return valores[id]??'';
 });
 return repeticoes?Math.max(0,Math.floor((limite-restante.length)/repeticoes)):limite;
}
export function componentesModeloOperacao(componentes:unknown,valores:string[]):ComponenteEnvioModeloOperacao[]|null{
 const p=analisar(componentes);if(!p||!Array.isArray(valores)||valores.length!==p.variaveis.length||valores.some(v=>!texto(v,32768)))return null;
 const partes=componentes as Objeto[],substituir=(c:Objeto)=>String(c.text).replace(/\{\{([1-9]\d*)\}\}/g,(_,n)=>valores[p.variaveis.indexOf(c.type==='HEADER'?'header:'+n:n)]??'');
 const limiteCorpo=partes.length===1?32768:1024;
 if(partes.some(c=>(c.type==='BODY'||c.type==='HEADER')&&substituir(c).length>(c.type==='HEADER'?60:limiteCorpo)))return null;
 const r:ComponenteEnvioModeloOperacao[]=[];
 if(p.cabecalho.length)r.push({type:'header',parameters:p.cabecalho.map((_,n)=>({type:'text',text:valores[n]}))});
 if(p.corpo.length)r.push({type:'body',parameters:p.corpo.map((_,n)=>({type:'text',text:valores[p.cabecalho.length+n]}))});
 for(const b of p.botoes)r.push({type:'button',sub_type:'quick_reply',index:String(b.indice),parameters:[{type:'payload',payload:b.payload}]});
 return r;
}
function canonico(v:unknown):unknown{if(Array.isArray(v))return v.map(canonico);if(objeto(v))return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonico(v[k])]));return v;}
/** Serialização explícita para congelar o contrato aprovado na intenção,
 * independente da ordem das chaves JSONB. Não inclui segredos nem destinatário. */
export function contratoModeloOperacao(m:{nome:string;idioma:string;componentes:unknown}){return {nome:m.nome,idioma:m.idioma,componentes:canonico(m.componentes)};}

/** Texto apresentado no Chat; o transporte continua usando o contrato oficial. */
export function previaTemplateOperacao(componentes:unknown,valores:Record<string,string>={}):string {
 if(!Array.isArray(componentes))return '';
 return componentes.filter(objeto).flatMap(c=>{
  if(['HEADER','BODY','FOOTER'].includes(String(c.type))&&typeof c.text==='string')return [c.text.replace(/\{\{([1-9]\d*)\}\}/g,(original,n)=>valores[c.type==='HEADER'?'header:'+n:n]?.trim()||original)];
  if(c.type==='BUTTONS'&&Array.isArray(c.buttons))return c.buttons.filter(objeto).map(b=>typeof b.text==='string'?b.text:'').filter(Boolean);
  if(c.type==='HEADER')return ['['+({IMAGE:'Imagem',VIDEO:'Vídeo',DOCUMENT:'Documento'}[String(c.format)]??'Cabeçalho')+']'];
  return [];
 }).join('\n\n');
}
export function textoTemplateEnviadoOperacao(m:{nome:string;componentes:unknown},valores:string[]):string {
 const vars=variaveisModeloOperacao(m.componentes);
 return previaTemplateOperacao(m.componentes,Object.fromEntries(vars.map((v,n)=>[v,valores[n]??''])))||'Template: '+m.nome;
}
