import {describe,it,expect} from 'vitest';
import {conferirHorarioAgente,type HorariosAgente} from '../../src/lib/atendimento/operacao-horarios';
const base:HorariosAgente={timezone:'America/Sao_Paulo',inicio:'09:00',fim:'18:00',dias:[1,2,3,4,5],equipes:[],feriados:[],respostaForaHorario:'Retornaremos {{horario}}.',cooldownMinutos:360};
describe('horários efetivos do agente, sem restringir os humanos',()=>{
 it('usa o fuso do negócio, fecha no fim e calcula a próxima abertura',()=>{
  expect(conferirHorarioAgente(base,null,new Date('2026-10-09T20:59:00Z')).aberto).toBe(true);
  const fechado=conferirHorarioAgente(base,null,new Date('2026-10-09T21:00:00Z'));
  expect(fechado.aberto).toBe(false);expect(fechado.resposta).toBe('Retornaremos 12/10/2026 às 09:00.');
 });
 it('aplica horário da equipe antes do fallback global',()=>{
  const c={...base,equipes:[{equipeId:'producao',dia:6,aberto:true,inicio:'08:00',fim:'20:00'}]};
  expect(conferirHorarioAgente(c,'producao',new Date('2026-10-10T15:00:00Z')).aberto).toBe(true);
  expect(conferirHorarioAgente(c,'comercial',new Date('2026-10-10T15:00:00Z')).aberto).toBe(false);
 });
 it('feriado da equipe prevalece sobre feriado global e dia normal',()=>{
  const c={...base,feriados:[{equipeId:null,data:'2026-10-12',aberto:false,inicio:null,fim:null},{equipeId:'producao',data:'2026-10-12',aberto:true,inicio:'10:00',fim:'14:00'}]};
  expect(conferirHorarioAgente(c,'producao',new Date('2026-10-12T15:00:00Z')).aberto).toBe(true);
  expect(conferirHorarioAgente(c,'comercial',new Date('2026-10-12T15:00:00Z')).resposta).toBe('Retornaremos 13/10/2026 às 09:00.');
 });
 it('não inventa retorno se configuração estiver inválida ou sem abertura',()=>{
  expect(conferirHorarioAgente({...base,timezone:'fuso-invalido'},null).valido).toBe(false);
  const c={...base,dias:[]};expect(conferirHorarioAgente(c,null).resposta).toBe('');
  expect(conferirHorarioAgente({...base,inicio:'18:00',fim:'09:00'},null).valido).toBe(false);
 });
});
