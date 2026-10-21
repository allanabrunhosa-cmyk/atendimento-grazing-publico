// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {useSomNovasMensagens} from '../../apps/atendimento-chat-consulta/som-novas-mensagens';
import React from 'react';
let audio:AudioFicticio;
class AudioFicticio{
 state='running';currentTime=10;destination={};
 resume=vi.fn(async()=>{this.state='running';});suspend=vi.fn(async()=>{this.state='suspended';});close=vi.fn(async()=>{});
 createOscillator=vi.fn(()=>({type:'',frequency:{setValueAtTime:vi.fn()},connect:vi.fn(),disconnect:vi.fn(),start:vi.fn(),stop:vi.fn(),onended:null}));
 createGain=vi.fn(()=>({gain:{setValueAtTime:vi.fn(),linearRampToValueAtTime:vi.fn()},connect:vi.fn(),disconnect:vi.fn()}));
 constructor(){audio=this;}
}
function Exemplo({usuario='equipe-ficticia'}:{usuario?:string}){const som=useSomNovasMensagens(usuario);return <><button onClick={som.alternar} aria-pressed={som.ativo}>Som</button><button onClick={som.avisar}>Mensagem nova</button><p role="status">{som.erro}</p></>;}
afterEach(()=>{cleanup();localStorage.clear();vi.unstubAllGlobals();});
it('inicia desligado; persiste por atendente, não repete rajadas e deixa de tocar ao desligar',()=>{
 vi.stubGlobal('AudioContext',AudioFicticio);const r=render(<Exemplo/>);
 fireEvent.click(screen.getByText('Mensagem nova'));expect(screen.getByText('Som').getAttribute('aria-pressed')).toBe('false');
 fireEvent.click(screen.getByText('Som'));expect(localStorage.getItem('grazing.atendimento.som.equipe-ficticia')).toBe('ligado');
 expect(audio.createOscillator).not.toHaveBeenCalled();fireEvent.click(screen.getByText('Mensagem nova'));fireEvent.click(screen.getByText('Mensagem nova'));expect(audio.createOscillator).toHaveBeenCalledOnce();
 audio.currentTime+=2;fireEvent.click(screen.getByText('Mensagem nova'));expect(audio.createOscillator).toHaveBeenCalledTimes(2);
 fireEvent.click(screen.getByText('Som'));fireEvent.click(screen.getByText('Mensagem nova'));expect(audio.createOscillator).toHaveBeenCalledTimes(2);expect(audio.suspend).toHaveBeenCalledOnce();expect(localStorage.getItem('grazing.atendimento.som.equipe-ficticia')).toBe('desligado');
 r.unmount();expect(audio.close).toHaveBeenCalledOnce();
});
it('restaura a preferência, libera o áudio na primeira interação e separa usuários',()=>{
 vi.stubGlobal('AudioContext',AudioFicticio);localStorage.setItem('grazing.atendimento.som.equipe-ficticia','ligado');const r=render(<Exemplo/>);
 expect(screen.getByText('Som').getAttribute('aria-pressed')).toBe('true');fireEvent.pointerDown(window);fireEvent.click(screen.getByText('Mensagem nova'));expect(audio.createOscillator).toHaveBeenCalledOnce();
 r.rerender(<Exemplo usuario="outra-equipe-ficticia"/>);expect(screen.getByText('Som').getAttribute('aria-pressed')).toBe('false');
});
it('mantém desligado e explica quando o navegador não suporta áudio',async()=>{
 vi.stubGlobal('AudioContext',undefined);render(<Exemplo/>);await act(async()=>fireEvent.click(screen.getByText('Som')));expect(screen.getByText('Som').getAttribute('aria-pressed')).toBe('false');expect(screen.getByRole('status').textContent).toMatch(/não conseguiu ativar/);
});
it('destaca a chegada com dois toques distintos, mais fortes e sem sobreposição de rajadas',()=>{
 vi.stubGlobal('AudioContext',AudioFicticio);render(<Exemplo/>);fireEvent.click(screen.getByText('Som'));fireEvent.click(screen.getByText('Mensagem nova'));
 const nota=audio.createOscillator.mock.results[0].value,volume=audio.createGain.mock.results[0].value;
 const frequencias=nota.frequency.setValueAtTime.mock.calls as unknown as [number,number][];
 expect(nota.type).toBe('triangle');expect(frequencias).toHaveLength(2);expect(frequencias[1][0]).toBeGreaterThan(frequencias[0][0]);
 const rampas=volume.gain.linearRampToValueAtTime.mock.calls as unknown as [number,number][];
 const ataques=rampas.filter(([ganho])=>ganho>0),silencios=rampas.filter(([ganho])=>ganho===0);
 expect(ataques).toHaveLength(2);expect(ataques.every(([ganho])=>ganho>=0.24&&ganho<=0.5)).toBe(true);
 expect(silencios).toHaveLength(2);expect(ataques[1][1]-silencios[0][1]).toBeGreaterThan(0.08);
 expect(silencios[1][1]-audio.currentTime).toBeGreaterThan(0.6);
 fireEvent.click(screen.getByText('Mensagem nova'));expect(audio.createOscillator).toHaveBeenCalledOnce();
});
