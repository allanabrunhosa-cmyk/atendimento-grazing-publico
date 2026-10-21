import {useLayoutEffect,useRef,type ComponentProps} from 'react';
import {Input} from '../../src/components/ui/input';
import {cursorTelefoneFormatado,formatarTelefoneContatoDigitado} from './telefone-contato-mascara';

type Props=Omit<ComponentProps<typeof Input>,'type'|'value'|'onChange'|'onPaste'|'onKeyDown'|'maxLength'|'ref'> & {value:string;alterar:(valor:string)=>void};
export default function CampoTelefoneContato({value,alterar,...props}:Props){
 const campo=useRef<HTMLInputElement>(null),posicao=useRef<number|null>(null);
 useLayoutEffect(()=>{if(posicao.current!==null&&campo.current){campo.current.setSelectionRange(posicao.current,posicao.current);posicao.current=null;}},[value]);
 function aplicar(bruto:string,cursor:number,ddiSemSinal=false){
  const formatado=formatarTelefoneContatoDigitado(bruto,ddiSemSinal);
  if(formatado===null)return false;
  const novaPosicao=cursorTelefoneFormatado(bruto,formatado,cursor);
  posicao.current=novaPosicao;
  if(campo.current){campo.current.value=formatado;campo.current.setSelectionRange(novaPosicao,novaPosicao);}
  if(formatado!==value)alterar(formatado);else posicao.current=null;
  return true;
 }
 function proposta(texto:string){const el=campo.current,inicio=el?.selectionStart??value.length,fim=el?.selectionEnd??inicio;return {texto:value.slice(0,inicio)+texto+value.slice(fim),cursor:inicio+texto.length,todo:inicio===0&&fim===value.length};}
 function apagarSeparador(tecla:'Backspace'|'Delete'){
  const el=campo.current;if(!el||el.selectionStart!==el.selectionEnd)return false;
  const inicio=el.selectionStart??0,passo=tecla==='Backspace'?-1:1;let indice=tecla==='Backspace'?inicio-1:inicio;
  if(!/[(). -]/.test(value[indice]??''))return false;
  while(indice>=0&&indice<value.length&&/[(). -]/.test(value[indice]))indice+=passo;
  if(indice<0||indice>=value.length||!/\d/.test(value[indice]))return false;
  return aplicar(value.slice(0,indice)+value.slice(indice+1),tecla==='Backspace'?indice:inicio);
 }
 return <Input {...props} ref={campo} type="tel" maxLength={19} value={value}
  onChange={e=>{const cursor=e.currentTarget.selectionStart??e.currentTarget.value.length;if(!aplicar(e.currentTarget.value,cursor))e.currentTarget.value=value;}}
  onPaste={e=>{e.preventDefault();const p=proposta(e.clipboardData.getData('text'));aplicar(p.texto,p.cursor,p.todo);}}
  onKeyDown={e=>{if(e.ctrlKey||e.metaKey||e.altKey)return;if((e.key==='Backspace'||e.key==='Delete')&&apagarSeparador(e.key)){e.preventDefault();return;}if(e.key.length===1&&formatarTelefoneContatoDigitado(proposta(e.key).texto)===null)e.preventDefault();}}
  onBeforeInput={e=>{const evento=e.nativeEvent as InputEvent;if(evento.inputType==='deleteContentBackward'&&apagarSeparador('Backspace')||evento.inputType==='deleteContentForward'&&apagarSeparador('Delete')){e.preventDefault();return;}if(evento.data&&formatarTelefoneContatoDigitado(proposta(evento.data).texto)===null)e.preventDefault();}}
 />;
}
