import type {MensagemOperacao} from './operacao-api';

/** Controles e caracteres invisíveis isolados não preenchem um balão legível. */
export function temTextoMensagem(texto:unknown):texto is string{
 if(typeof texto!=='string')return false;
 const visivel=texto.replace(/[\s\x00-\x1f\x7f-\x9f\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u206f\u2800\u3164\ufe00-\ufe0f\ufeff\uffa0]/g,'').replace(/\udb40[\udc00-\udc7f\udd00-\uddef]/g,'');
 return visivel.length>0;
}
export function textoMensagemVisivel(mensagem:MensagemOperacao):string|null{
 const tipo=mensagem.tipo.trim().toLowerCase(),cartao=mensagem.contatosCompartilhados?.some(c=>temTextoMensagem(c.nome))??false;
 if(temTextoMensagem(mensagem.conteudo))return tipo==='contacts'&&cartao?null:mensagem.conteudo;
 if(tipo==='template')return 'Template enviado';
 if(temTextoMensagem(mensagem.anexoId)||cartao)return null;
 if(tipo==='contacts')return 'Contato compartilhado indisponível.';
 const origem=mensagem.autor==='cliente'?'recebida':'registrada';
 const midia=({audio:'áudio',image:'imagem',video:'vídeo',document:'documento',sticker:'figurinha'} as Record<string,string>)[tipo];
 if(midia)return `Mensagem de ${midia} ${origem}. O anexo não está disponível.`;
 if(tipo==='text')return `Mensagem ${origem}. O texto não está disponível.`;
 return `Mensagem ${origem} em formato não reconhecido. O conteúdo não está disponível.`;
}
/** Mensagens recebidas são texto React. Não interpretar conteúdo como HTML. */
export default function TextoMensagem({mensagem}:{mensagem:MensagemOperacao}){
 const texto=textoMensagemVisivel(mensagem);return texto===null?null:<p>{texto}</p>;
}
