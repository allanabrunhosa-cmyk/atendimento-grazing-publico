import {normalizarMimeMidiaOperacao,tipoMidiaOperacao,limiteTipoMidiaOperacao} from '../../src/lib/atendimento/operacao-midia-contrato';

const extensoes:Record<string,string>={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',pdf:'application/pdf',txt:'text/plain',doc:'application/msword',xls:'application/vnd.ms-excel',ppt:'application/vnd.ms-powerpoint',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',mp3:'audio/mpeg',aac:'audio/aac',amr:'audio/amr',ogg:'audio/ogg',m4a:'audio/mp4',mp4:'video/mp4'};
export const formatosAnexoCompositor=Object.values(extensoes).join(',');
export const ajudaAnexoCompositor='Imagens JPG/PNG: até 5 MB. Documentos: até 20 MB. Áudio e vídeo: até 16 MB. Um arquivo por mensagem.';
export function tamanhoArquivoCompositor(bytes:number){const divisor=bytes<1024?1:bytes<1024*1024?1024:1024*1024;return (bytes/divisor).toLocaleString('pt-BR',{maximumFractionDigits:2})+' '+(divisor===1?'B':divisor===1024?'KB':'MB');}
export class ErroArquivoCompositor extends Error {}
/** Inferir MIME pela extensão só ajuda navegadores que omitem o tipo. O servidor
 * continua conferindo bytes, tamanho, formato, permissão e vínculo da conversa. */
export function conferirArquivoCompositor(arquivo:File){
 const mime=normalizarMimeMidiaOperacao(!arquivo.type||arquivo.type==='application/octet-stream'?extensoes[arquivo.name.split('.').at(-1)?.toLowerCase()??'']??'':arquivo.type),tipo=tipoMidiaOperacao(mime);
 if(!tipo)throw new ErroArquivoCompositor('Formato não suportado. Use JPG/PNG, PDF, texto ou arquivos do Office; áudio e vídeo devem usar um formato aceito pelo WhatsApp.');
 if(!arquivo.size)throw new ErroArquivoCompositor('O arquivo está vazio. Selecione outro arquivo.');
 const limite=limiteTipoMidiaOperacao(tipo);
 if(arquivo.size>limite)throw new ErroArquivoCompositor('O arquivo excede o limite de '+(tipo==='sticker'?'500 KB para figurinha.':Math.round(limite/1024/1024)+' MB para '+(tipo==='image'?'imagem':tipo==='document'?'documento':tipo==='audio'?'áudio':'vídeo')+'.'));
 return {mime,tipo,limite};
}
/** Não cortar um emoji, modificador de pele ou sequência familiar ao limitar texto. */
export function limitarTextoCompositor(texto:string,limite:number){
 const limpo=texto.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'');if(limpo.length<=limite)return limpo;
 let resultado='';for(const {segment} of new Intl.Segmenter('pt-BR',{granularity:'grapheme'}).segment(limpo)){if(resultado.length+segment.length>limite)break;resultado+=segment;}return resultado;
}
