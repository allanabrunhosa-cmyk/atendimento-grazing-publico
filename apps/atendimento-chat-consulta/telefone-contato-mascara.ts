/** Máscara de edição. Não acrescenta nem remove dígitos do telefone. */
export function formatarTelefoneContatoDigitado(entrada:string,ddiSemSinal=false):string|null{
 if(entrada.length>64||!/^[+\d(). -]*$/.test(entrada)||entrada.includes('+')&&!/^\+[^+]*$/.test(entrada))return null;
 const digitos=entrada.replace(/\D/g,'');
 const comDdi=entrada.startsWith('+')||ddiSemSinal&&[12,13].includes(digitos.length)&&digitos.startsWith('55');
 if(comDdi&&!digitos.startsWith('55'))return digitos.length<=15?'+'+digitos:null;
 const nacional=comDdi?digitos.slice(2):digitos;
 const fixo=/^[2-5]/.test(nacional.slice(2)),limite=fixo?10:11;
 if(nacional.length>limite)return null;
 let mascara='';
 if(nacional)mascara='('+nacional.slice(0,2)+(nacional.length>=2?')':'');
 if(nacional.length>2){const assinante=nacional.slice(2),grupo=assinante.startsWith('9')||assinante.length>8?5:4;mascara+=' '+assinante.slice(0,grupo)+(assinante.length>grupo?'-'+assinante.slice(grupo):'');}
 return comDdi?'+55'+(mascara?' '+mascara:''):mascara;
}

export function cursorTelefoneFormatado(bruto:string,formatado:string,cursor:number){
 if(cursor===bruto.length)return formatado.length;
 const quantidade=(bruto.slice(0,cursor).match(/\d/g)??[]).length;
 if(!quantidade)return formatado.startsWith('+')&&cursor>0?1:0;
 let vistos=0;
 for(let indice=0;indice<formatado.length;indice++)if(/\d/.test(formatado[indice])&&++vistos===quantidade)return indice+1;
 return formatado.length;
}
