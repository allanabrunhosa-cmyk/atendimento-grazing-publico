import {useState,type ComponentProps} from 'react';
import {Button} from '../../src/components/ui/button';
import type {ContatoCompartilhadoOperacao} from './operacao-api';
import CartaoContatoCompartilhado from './CartaoContatoCompartilhado';

type Props=Omit<ComponentProps<typeof CartaoContatoCompartilhado>,'contato'> & {contatos:ContatoCompartilhadoOperacao[]};
/** Mantém todos os contatos acessíveis sem montar um compartilhamento grande de uma vez. */
export default function ContatosCompartilhadosMensagem({contatos,...props}:Props){
 const [limite,setLimite]=useState(20);
 return <div className="contatos-compartilhados-grupo">{contatos.slice(0,limite).map((contato,i)=><CartaoContatoCompartilhado key={i} contato={contato} {...props}/>)}{contatos.length>limite&&<div className="contatos-compartilhados-mais"><p className="muted">{limite} de {contatos.length} contatos</p><Button type="button" variant="outline" size="sm" className="btn" onClick={()=>setLimite(v=>v+20)}>Mostrar mais contatos</Button></div>}</div>;
}
