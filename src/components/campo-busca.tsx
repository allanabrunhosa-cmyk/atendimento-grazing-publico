"use client";

import {useRef,type ComponentProps} from 'react';
import {Search,X} from 'lucide-react';
import {cn} from 'cn';
import {Input} from './ui/input';
type Props=Omit<ComponentProps<typeof Input>,'value'|'onChange'> & {value:string;onChange:(valor:string)=>void;containerClassName?:string;formato?:'padrao'|'arredondado'};
/** Mesmo contrato do campo de busca compartilhado do HUB, com limpeza rápida. */
export function CampoBusca({value,onChange,className,containerClassName,formato='padrao',...props}:Props){
 const campo=useRef<HTMLInputElement|null>(null);
 return <div data-slot="campo-busca" data-formato={formato} className={cn('campo-busca',containerClassName)}>
  <Search size={18} aria-hidden="true"/>
  <Input {...props} ref={campo} value={value} onChange={e=>onChange(e.target.value)} className={className}/>
  {value&&<button className="campo-busca-limpar" type="button" aria-label="Limpar busca" title="Limpar busca" disabled={props.disabled} onClick={()=>{onChange('');campo.current?.focus();}}><X size={15} aria-hidden="true"/></button>}
 </div>;
}
