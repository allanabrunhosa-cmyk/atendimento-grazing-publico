import {Smile} from 'lucide-react';
import {Popover,PopoverTrigger,PopoverContent,PopoverClose} from '../../src/components/ui/popover';

const emojis=[['😀','Rosto sorridente'],['😊','Sorriso gentil'],['🙂','Sorriso'],['😂','Riso'],['😍','Encantado'],['🥰','Carinho'],['😉','Piscadinha'],['😎','Óculos escuros'],['🤔','Pensando'],['😔','Triste'],['👍','Positivo'],['👏','Palmas'],['🙌','Celebração'],['🙏','Agradecimento'],['👋','Aceno'],['💜','Coração roxo'],['❤️','Coração vermelho'],['💙','Coração azul'],['✨','Brilho'],['🎉','Festa'],['✅','Confirmado'],['📍','Localização'],['🧀','Queijo'],['🎁','Presente']] as const;
export default function EmojiCompositor({disabled,inserir}:{disabled:boolean;inserir:(emoji:string)=>void}){
 return <Popover><PopoverTrigger className="btn icon" type="button" title="Inserir emoji" aria-label="Emojis" disabled={disabled}><Smile size={18}/></PopoverTrigger>
  <PopoverContent className="chat-acoes-popup chat-emojis-popup" align="end"><strong>Emojis</strong><div className="emojis-opcoes" role="group" aria-label="Escolher emoji">{emojis.map(([emoji,nome])=><PopoverClose className="emoji-opcao" type="button" key={emoji} aria-label={nome+' '+emoji} title={nome} onClick={()=>inserir(emoji)}>{emoji}</PopoverClose>)}</div><small>Você também pode colar emojis ou usar o teclado do seu dispositivo.</small></PopoverContent>
 </Popover>;
}
