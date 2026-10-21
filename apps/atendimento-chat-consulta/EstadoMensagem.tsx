import {Check,CheckCheck,CircleAlert} from 'lucide-react';
import type {MensagemOperacao} from './operacao-api';
import {motivoFalhaOperacao} from '../../src/lib/atendimento/operacao-falhas';

export default function EstadoMensagem({mensagem:m}:{mensagem:MensagemOperacao}){
 const falhou=['recusado','failed','falha','erro','cancelado','cancelled'].includes(m.estado),incerto=m.estado==='incerto';
 if(falhou||incerto){const motivo=motivoFalhaOperacao(m.falhaCodigo,incerto),rotulo=incerto?'Envio sem confirmação':'Não enviada';return <span className={'estado-mensagem mensagem-nao-enviada'+(incerto?' envio-incerto':'')} tabIndex={0} role="img" aria-label={rotulo+'. '+motivo} title={motivo}><CircleAlert size={18}/><small>{rotulo}</small></span>;}
 const entregue=['entregue','lido','delivered','read'].includes(m.estado),lida=['lido','read'].includes(m.estado);
 return <span className={'estado-mensagem'+(lida?' lida':'')} title={m.estado} aria-label={'Estado da mensagem: '+m.estado}>{entregue?<CheckCheck size={15}/>:['aceito','sent','aceito_simulado'].includes(m.estado)?<Check size={15}/>:m.estado==='recebido'?null:<small>{m.estado}</small>}</span>;
}
