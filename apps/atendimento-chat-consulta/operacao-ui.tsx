import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../src/components/ui/select';

/** Geometria aprovada do Atendimento sobre a seleção oficial da Central. */
export function Escolha({value,onChange,options,label,id,disabled=false}:{value:string;onChange:(s:string)=>void;options:readonly (string|{valor:string;rotulo:string})[];label:string;id?:string;disabled?:boolean}){
 const itens=options.map(o=>typeof o==='string'?{valor:o,rotulo:o}:o);
 return <Select disabled={disabled} value={value} onValueChange={v=>{if(!disabled&&typeof v==='string')onChange(v);}}><SelectTrigger id={id} className="field select-field" aria-label={label}><SelectValue>{itens.find(o=>o.valor===value)?.rotulo||value}</SelectValue></SelectTrigger><SelectContent className="select-popup">{itens.map(o=><SelectItem key={o.valor} className="select-option" value={o.valor}>{o.rotulo}</SelectItem>)}</SelectContent></Select>;
}
