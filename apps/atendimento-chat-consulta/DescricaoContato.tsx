import {Building2} from 'lucide-react';

export default function DescricaoContato({descricao}:{descricao?:string}){
 if(!descricao?.trim())return null;
 return <p className="descricao-contato" title={descricao}><Building2 size={13} aria-hidden="true"/><span>{descricao}</span></p>;
}
