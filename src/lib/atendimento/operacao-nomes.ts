const preposicoes = new Set(['de','da','das','do','dos','e','em','na','nas','no','nos','para','por','com','a','ao','aos','à','às','della','del','di','du','van','von']);

/** Apenas nomes obtidos automaticamente. A edição humana tem precedência. */
export function nomeContatoOperacao(nome:unknown,manual:unknown=false):string {
 if(typeof nome!=='string')return '';
 if(manual===true)return nome;
 return nome.trim().replace(/\s+/g,' ').toLocaleLowerCase('pt-BR').split(' ').map(parte=>
  preposicoes.has(parte)?parte:parte.replace(/(^|[-'’])(\p{L})/gu,(_,separador:string,letra:string)=>separador+letra.toLocaleUpperCase('pt-BR'))
 ).join(' ');
}
