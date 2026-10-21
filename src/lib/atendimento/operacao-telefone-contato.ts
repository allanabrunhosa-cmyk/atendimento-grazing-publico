// Códigos nacionais da Anatel. Não adicionar ou remover o nono dígito.
// https://www.gov.br/anatel/pt-br/regulado/numeracao/codigos-nacionais
const dddsBrasil=new Set('11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99'.split(' '));
const internacional=/^[1-9]\d{7,14}$/;
/** O formulário recebe DDD+número no padrão brasileiro ou +DDI internacional.
 * Retorna dígitos canônicos. A validação não confirma a existência do WhatsApp. */
export function normalizarTelefoneContato(telefone:unknown,ddi:unknown='55'):string{
 if(typeof telefone!=='string'||telefone.length>32||/[\x00-\x1f\x7f]/.test(telefone)||typeof ddi!=='string'||!/^\+?[1-9]\d{0,2}$/.test(ddi))throw Error('OPERACAO_TELEFONE_INVALIDO');
 const entrada=telefone.trim();
 if(!entrada||!/^[+\d(). -]+$/.test(entrada)||entrada.includes('+')&&!/^\+[^+]+$/.test(entrada))throw Error('OPERACAO_TELEFONE_INVALIDO');
 const digitos=entrada.replace(/[(). -]/g,'').replace(/^\+/,'');
 const codigo=ddi.replace(/^\+/,'');
 let numero:string;
 if(entrada.startsWith('+'))numero=digitos;
 else if(codigo==='55'&&[12,13].includes(digitos.length)&&digitos.startsWith('55'))numero=digitos;
 else numero=codigo+digitos;
 if(!internacional.test(numero))throw Error('OPERACAO_TELEFONE_INVALIDO');
 if(numero.startsWith('55')){
  const nacional=numero.slice(2);
  const assinante=nacional.slice(2);
  if(!dddsBrasil.has(nacional.slice(0,2))||!(nacional.length===11&&/^9\d{8}$/.test(assinante)||nacional.length===10&&/^[2-5]\d{7}$/.test(assinante)))throw Error('OPERACAO_TELEFONE_INVALIDO');
 }
 return numero;
}
/** A identidade já recebida da Meta é preservada. Não ajustar números legados. */
export function validarDestinatarioWhatsAppExistente(numero:unknown):string{
 if(typeof numero!=='string'||!internacional.test(numero))throw Error('OPERACAO_TELEFONE_INVALIDO');
 return numero;
}
