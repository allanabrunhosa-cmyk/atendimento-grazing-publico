import {BellRing} from 'lucide-react';
import type {LembreteFollowupOperacao} from './operacao-api';
import {lembreteAtrasado} from './lembrete-followup-horario';

export default function IndicadorFollowup({lembrete,agora}:{lembrete?:LembreteFollowupOperacao|null;agora:number}){
 if(!lembrete)return null;
 const atrasado=lembreteAtrasado(lembrete,agora);
 const titulo=(atrasado?'Follow-up pendente':'Follow-up agendado')+' · '+new Date(lembrete.agendadoPara).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'})+' (Brasília)'+(lembrete.descricao?.trim()?' · '+lembrete.descricao:'');
 return <span className={'indicador-followup'+(atrasado?' atrasado':'')} role="img" aria-label={titulo} title={titulo}><BellRing size={16} aria-hidden="true"/></span>;
}
