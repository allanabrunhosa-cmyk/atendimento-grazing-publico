export type FaixaHorarioAgente={aberto:boolean;inicio:string|null;fim:string|null};
export type HorariosAgente={timezone:string;inicio:string;fim:string;dias:number[];equipes:{equipeId:string;dia:number;aberto:boolean;inicio:string|null;fim:string|null}[];feriados:{equipeId:string|null;data:string;aberto:boolean;inicio:string|null;fim:string|null}[];respostaForaHorario:string;cooldownMinutos:number};
const hora=/^([01]\d|2[0-3]):[0-5]\d$/;
const wk:Record<string,number>={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
/** Mesma precedência da origem: feriado da equipe/global, dia da equipe,
 * fallback global. Não restringe atendimento humano nem a janela da Meta. */
export function conferirHorarioAgente(c:HorariosAgente,equipeId:string|null,agora=new Date()) {
 let partes:Intl.DateTimeFormatPart[];
 try {partes=new Intl.DateTimeFormat('en-US',{timeZone:c.timezone,weekday:'short',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(agora);}catch{return {aberto:false,proximo:'',resposta:'',valido:false};}
 const p=(tipo:string)=>partes.find(v=>v.type===tipo)?.value??'';
 const data=`${p('year')}-${p('month')}-${p('day')}`,dia=wk[p('weekday')],hhmm=`${p('hour')}:${p('minute')}`;
 if(dia===undefined||!hora.test(c.inicio)||!hora.test(c.fim)||c.inicio>=c.fim||!Array.isArray(c.dias)||c.dias.some(d=>!Number.isInteger(d)||d<0||d>6))return {aberto:false,proximo:'',resposta:'',valido:false};
 const faixa=(ymd:string,d:number):FaixaHorarioAgente=>{
  const f=c.feriados.find(v=>v.data===ymd&&v.equipeId===equipeId)||c.feriados.find(v=>v.data===ymd&&v.equipeId===null);
  if(f)return f;
  const e=equipeId?c.equipes.find(v=>v.equipeId===equipeId&&v.dia===d):undefined;
  return e??{aberto:c.dias.includes(d),inicio:c.inicio,fim:c.fim};
 };
 const valida=(f:FaixaHorarioAgente)=>f.aberto&&!!f.inicio&&!!f.fim&&hora.test(f.inicio)&&hora.test(f.fim)&&f.inicio<f.fim;
 const atual=faixa(data,dia),aberto=valida(atual)&&hhmm>=atual.inicio!&&hhmm<atual.fim!;
 let proximo='';
 if(!aberto)for(let n=0;n<=14;n++){
  const d=new Date(data+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);const ymd=d.toISOString().slice(0,10),f=faixa(ymd,(dia+n)%7);
  if(valida(f)&&(n>0||hhmm<f.inicio!)){proximo=`${n===0?'hoje':ymd.split('-').reverse().join('/')} às ${f.inicio}`;break;}
 }
 const texto=typeof c.respostaForaHorario==='string'?c.respostaForaHorario:'';
 // Se não houver próxima abertura, não inventar a substituição do template.
 const resposta=texto.includes('{{horario}}')&&!proximo?'':texto.replaceAll('{{horario}}',proximo);
 return {aberto,proximo,resposta:resposta.length<=4000&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(resposta)?resposta:'',valido:true};
}
