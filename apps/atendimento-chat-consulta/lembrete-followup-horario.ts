import type {LembreteFollowupOperacao} from './operacao-api';

export const FUSO_LEMBRETE_FOLLOWUP='America/Sao_Paulo';
export const MINUTO_LEMBRETE=60_000;
export const DIA_LEMBRETE=86_400_000;
const formato=new Intl.DateTimeFormat('en-CA',{timeZone:FUSO_LEMBRETE_FOLLOWUP,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const partes=(instante:number)=>Object.fromEntries(formato.formatToParts(instante).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));

/** recebidoEm e monotonico usam performance.now(); o relógio do PC não altera o prazo conferido. */
export function agoraLembrete(lembrete:LembreteFollowupOperacao|null,monotonico=performance.now(),relogioLocal=Date.now()):number{
 if(!lembrete)return relogioLocal;
 const conferido=Date.parse(lembrete.conferidoEm);
 return Number.isFinite(conferido)&&Number.isFinite(lembrete.recebidoEm)?conferido+Math.max(0,monotonico-lembrete.recebidoEm):relogioLocal;
}
export function lembreteAtrasado(lembrete:LembreteFollowupOperacao|null,monotonico=performance.now()):boolean{
 return !!lembrete&&(lembrete.atrasado||Date.parse(lembrete.agendadoPara)<=agoraLembrete(lembrete,monotonico));
}
/** Valor de datetime-local em Brasília, independente do fuso do navegador. */
export function dataHoraLocalLembrete(iso:string|number):string{
 const instante=typeof iso==='number'?iso:Date.parse(iso);if(!Number.isFinite(instante))return '';
 const p=partes(instante);return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
/** Converte os componentes locais no fuso explícito e recusa datas inexistentes. */
export function instanteDataHoraLembrete(local:string):string|null{
 const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);if(!m)return null;
 const [ano,mes,dia,hora,minuto]=m.slice(1).map(Number);
 if(ano<1000||mes<1||mes>12||dia<1||dia>31||hora>23||minuto>59)return null;
 const desejado=Date.UTC(ano,mes-1,dia,hora,minuto),d=new Date(desejado);
 if(d.getUTCFullYear()!==ano||d.getUTCMonth()!==mes-1||d.getUTCDate()!==dia)return null;
 let instante=desejado;
 for(let tentativa=0;tentativa<4;tentativa++){
  const p=partes(instante),localUtc=Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),Number(p.hour),Number(p.minute)),diferenca=desejado-localUtc;
  if(!diferenca)break;instante+=diferenca;
 }
 return dataHoraLocalLembrete(instante)===local?new Date(instante).toISOString():null;
}
export function validarHorarioLembrete(local:string,agora=Date.now()):{instante:string|null;erro:string}{
 const instante=instanteDataHoraLembrete(local);
 if(!instante)return {instante:null,erro:'Informe uma data e uma hora válidas no horário de Brasília.'};
 const diferenca=Date.parse(instante)-agora;
 if(diferenca<MINUTO_LEMBRETE)return {instante:null,erro:'Escolha um horário com pelo menos 1 minuto de antecedência.'};
 if(diferenca>365*DIA_LEMBRETE)return {instante:null,erro:'Escolha uma data nos próximos 365 dias.'};
 return {instante,erro:''};
}
export function sugerirHorarioLembrete(horas:number,agora=Date.now()):string{
 return dataHoraLocalLembrete(Math.ceil((agora+horas*60*MINUTO_LEMBRETE)/MINUTO_LEMBRETE)*MINUTO_LEMBRETE);
}
export function horarioLembreteVisivel(iso:string):string{
 const instante=Date.parse(iso);return Number.isFinite(instante)?new Intl.DateTimeFormat('pt-BR',{timeZone:FUSO_LEMBRETE_FOLLOWUP,dateStyle:'short',timeStyle:'short'}).format(instante):'Horário indisponível';
}
