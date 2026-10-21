/** Limites do Chat e da API oficial. Documentos mantêm o teto interno de 20 MiB.
 * Inspeção de assinatura não substitui a validação de codecs feita pela Meta. */
export type TipoMidiaOperacao='image'|'audio'|'video'|'sticker'|'document';
export const limiteMidiaChat=20*1024*1024;
/** Sem grupos repetidos: a expressão anterior esgotava a pilha em anexos de 4 MB.
 * Teto, alfabeto, grupos de quatro e padding continuam estritos. */
export function base64MidiaValida(valor:unknown):valor is string{return typeof valor==='string'&&valor.length>0&&valor.length<=4*Math.ceil(limiteMidiaChat/3)&&valor.length%4===0&&/^[A-Za-z0-9+/]*={0,2}$/.test(valor);}
const formatos:Record<string,TipoMidiaOperacao>={
 'image/jpeg':'image','image/png':'image','image/webp':'sticker',
 'audio/aac':'audio','audio/mp4':'audio','audio/mpeg':'audio','audio/amr':'audio','audio/ogg':'audio',
 'video/mp4':'video',
 'application/pdf':'document','text/plain':'document','application/msword':'document',
 'application/vnd.ms-excel':'document','application/vnd.ms-powerpoint':'document',
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'document',
 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'document',
 'application/vnd.openxmlformats-officedocument.presentationml.presentation':'document',
};
/** RFC 7845: a indicação explícita de Opus é equivalente ao MIME Ogg aceito.
 * Parâmetros desconhecidos não são removidos para contornar a lista permitida. */
export function normalizarMimeMidiaOperacao(mime:string){if(typeof mime!=='string')return '';const m=mime.trim().toLowerCase();return /^audio\/ogg\s*;\s*codecs\s*=\s*(?:opus|"opus")$/.test(m)?'audio/ogg':m;}
export function tipoMidiaOperacao(mime:string):TipoMidiaOperacao|undefined{mime=normalizarMimeMidiaOperacao(mime);return Object.hasOwn(formatos,mime)?formatos[mime]:undefined;}
export function limiteTipoMidiaOperacao(tipo:TipoMidiaOperacao){return tipo==='image'?5*1024*1024:tipo==='sticker'?500*1024:tipo==='document'?limiteMidiaChat:16*1024*1024;}
export function validarMetadadosMidiaOperacao(tipo:string,mime:string,tamanho:number){
 if(tipoMidiaOperacao(mime)!==tipo)throw Error('OPERACAO_MIDIA_TIPO_DIVERGENTE');
 const limite=limiteTipoMidiaOperacao(tipo as TipoMidiaOperacao);
 if(!Number.isSafeInteger(tamanho)||tamanho<1||tamanho>limite)throw Error('OPERACAO_MIDIA_GRANDE');
}
export function mimeBytesCompativeis(mime:string,b:Buffer){
 mime=normalizarMimeMidiaOperacao(mime);
 if(mime==='application/pdf')return b.subarray(0,5).toString()==='%PDF-';
 if(mime==='image/png')return b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 if(mime==='image/jpeg')return b[0]===255&&b[1]===216&&b[2]===255;
 if(mime==='image/webp')return b.length>=12&&b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP';
 if(mime==='audio/ogg')return b.subarray(0,4).toString()==='OggS';
 if(mime==='audio/amr')return b.subarray(0,6).toString()==='#!AMR\n';
 if(mime==='audio/mpeg')return b.subarray(0,3).toString()==='ID3'||b[0]===255&&(b[1]&224)===224;
 if(['audio/mp4','video/mp4'].includes(mime))return b.length>=12&&b.subarray(4,8).toString()==='ftyp';
 if(mime==='audio/aac')return b[0]===255&&(b[1]&246)===240;
 if(mime.startsWith('application/vnd.openxmlformats-officedocument.'))return b[0]===80&&b[1]===75&&b[2]===3&&b[3]===4;
 if(['application/msword','application/vnd.ms-excel','application/vnd.ms-powerpoint'].includes(mime))return b.subarray(0,8).equals(Buffer.from([208,207,17,224,161,177,26,225]));
 if(mime==='text/plain'){try{new TextDecoder('utf-8',{fatal:true}).decode(b);return !b.includes(0);}catch{return false;}}
 return false;
}
export function informacaoStickerWebp(b:Buffer){
 if(!mimeBytesCompativeis('image/webp',b)||b.readUInt32LE(4)!==b.length-8)return null;
 let largura=0,altura=0,animado=false,animacao=false,quadro=false;
 for(let offset=12;offset<b.length;){
  if(offset+8>b.length)return null;
  const tipo=b.subarray(offset,offset+4).toString(),n=b.readUInt32LE(offset+4),inicio=offset+8,fim=inicio+n;
  if(fim>b.length)return null;
  if(tipo==='VP8X'&&n===10){animado=(b[inicio]&2)!==0;largura=1+b.readUIntLE(inicio+4,3);altura=1+b.readUIntLE(inicio+7,3);}
  if(tipo==='VP8 '&&n>=10&&!largura&&b.subarray(inicio+3,inicio+6).equals(Buffer.from([157,1,42]))){largura=b.readUInt16LE(inicio+6)&16383;altura=b.readUInt16LE(inicio+8)&16383;}
  if(tipo==='VP8L'&&n>=5&&!largura&&b[inicio]===47){const dimensoes=b.readUInt32LE(inicio+1);largura=1+(dimensoes&16383);altura=1+((dimensoes>>>14)&16383);}
  if(tipo==='ANIM'&&n===6)animacao=true;
  if(tipo==='ANMF'&&n>=16||tipo==='VP8 '||tipo==='VP8L')quadro=true;
  offset=fim+(n%2);if(offset>b.length)return null;
 }
 if(!largura||!altura||!quadro||animado!==animacao)return null;
 return {largura,altura,animado};
}
export function validarBytesMidiaOperacao(tipo:string,mime:string,bytes:Buffer){
 mime=normalizarMimeMidiaOperacao(mime);
 validarMetadadosMidiaOperacao(tipo,mime,bytes.length);
 if(!mimeBytesCompativeis(mime,bytes))throw Error('OPERACAO_MIDIA_INVALIDA');
 if(tipo==='sticker'){
  const sticker=informacaoStickerWebp(bytes);
  if(!sticker||sticker.largura!==512||sticker.altura!==512)throw Error('OPERACAO_STICKER_INVALIDO');
  if(bytes.length>(sticker.animado?500:100)*1024)throw Error('OPERACAO_MIDIA_GRANDE');
 }
 if(mime==='audio/ogg'){
  // Primeiro pacote Ogg deve declarar Opus; Ogg/Vorbis não é aceito pela Cloud API.
  const inicio=27+(bytes[26]??0);
  if(bytes.length<inicio+8||bytes[4]!==0||bytes.subarray(inicio,inicio+8).toString()!=='OpusHead')throw Error('OPERACAO_AUDIO_CODEC_RECUSADO');
 }
}
