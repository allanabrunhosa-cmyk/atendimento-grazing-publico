/** Nome confiável da sessão, congelado na intenção. Nunca vem do navegador. */
export function assinaturaHumanaOperacao(nome:string){
 const seguro=nome.normalize('NFC').replace(/[\x00-\x1f\x7f*_~`<>\u202a-\u202e\u2066-\u2069]/g,' ').replace(/\s+/g,' ').trim();
 if(!seguro||seguro.length>200)throw Error('OPERACAO_NOME_ATENDENTE_INVALIDO');
 return seguro;
}
export function textoAssinadoOperacao(p:{autor:string;tipo:string;texto?:string;assinaturaHumana?:string}){
 const texto=p.texto??'';
 if(p.autor!=='humano'||!p.assinaturaHumana||!['text','image','video','document'].includes(p.tipo))return texto;
 const assinado='*'+assinaturaHumanaOperacao(p.assinaturaHumana)+'*'+(texto?'\n'+texto:'');
 if(assinado.length>(p.tipo==='text'?4096:1024))throw Error(p.tipo==='text'?'OPERACAO_TEXTO_ASSINADO_GRANDE':'OPERACAO_LEGENDA_GRANDE');
 return assinado;
}
export function limiteTextoHumanoOperacao(nome:string,tipo:string){
 if(!['text','image','video','document'].includes(tipo))return 4096;
 return (tipo==='text'?4096:1024)-assinaturaHumanaOperacao(nome).length-3;
}
