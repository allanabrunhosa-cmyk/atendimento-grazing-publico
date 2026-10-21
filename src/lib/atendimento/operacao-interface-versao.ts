/** Identifica somente o arquivo público da interface. Não expõe configuração. */
export function interfacePublicadaAtendimento(html:string){
 const src=html.match(/<script\b[^>]*\bsrc=["'](\/operacao\/assets\/index-[A-Za-z0-9_-]+\.js)["']/)?.[1];
 if(!src)throw Error('INTERFACE_PUBLICADA_INVALIDA');
 return src;
}
