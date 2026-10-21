import {CircleCheck,RotateCw,Clock3} from 'lucide-react';
import type {MensagemOperacao} from './operacao-api';

export default function EventoHistorico({registro}:{registro:MensagemOperacao}) {
 const titulo=registro.evento==='encerramento'?'Conversa encerrada':registro.evento==='reabertura'?'Conversa reaberta':'Atendimento iniciado';
 const Icone=registro.evento==='encerramento'?CircleCheck:registro.evento==='reabertura'?RotateCw:Clock3;
 return <div className="historico-evento" data-evento={registro.evento} role="note" aria-label={titulo}>
  <Icone size={16} aria-hidden="true"/>
  <div><strong>{titulo}</strong><span>{registro.autorNome?'Por '+registro.autorNome:'Responsável não registrado'}</span>
   <time dateTime={registro.criadaEm}>{new Date(registro.criadaEm).toLocaleString('pt-BR')}</time>
  </div>
 </div>;
}
