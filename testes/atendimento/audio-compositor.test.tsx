// @vitest-environment jsdom
import React from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import GravarAudioCompositor,{formatoGravacaoSuportado} from '../../apps/atendimento-chat-consulta/GravarAudioCompositor';

class Gravador {
 static isTypeSupported=vi.fn((mime:string)=>mime==='audio/mp4;codecs=mp4a.40.2');
 static ultimo:Gravador;
 mimeType:string;state='inactive';ondataavailable:((e:{data:Blob})=>void)|null=null;onstop:(()=>void)|null=null;onerror:(()=>void)|null=null;
 constructor(_stream:MediaStream,opcoes:MediaRecorderOptions){this.mimeType=opcoes.mimeType!;Gravador.ultimo=this;}
 start(){this.state='recording';}
 stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['audio-ficticio'],{type:this.mimeType})});this.onstop?.();}
}
let parar:ReturnType<typeof vi.fn>,pedir:ReturnType<typeof vi.fn>;
beforeEach(()=>{parar=vi.fn();pedir=vi.fn().mockResolvedValue({getTracks:()=>[{stop:parar,onended:null}]});vi.stubGlobal('MediaRecorder',Gravador);Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:pedir},configurable:true});});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});
const montar=(disabled=false)=>{const arquivo=vi.fn(),atividade=vi.fn();const tela=render(<GravarAudioCompositor disabled={disabled} onArquivo={arquivo} onAtividade={atividade}/>);return {arquivo,atividade,...tela};};
async function gravar(){fireEvent.click(screen.getByRole('button',{name:'Gravar áudio'}));await screen.findByText('Gravando 0:00');}
it('negocia apenas Ogg/Opus ou MP4/AAC, sem renomear WebM',()=>{
 expect(formatoGravacaoSuportado({isTypeSupported:m=>m==='audio/ogg;codecs=opus'})).toBe('audio/ogg;codecs=opus');
 expect(formatoGravacaoSuportado(Gravador)).toBe('audio/mp4;codecs=mp4a.40.2');
 expect(formatoGravacaoSuportado({isTypeSupported:m=>m==='audio/webm;codecs=opus'})).toBeUndefined();
 expect(formatoGravacaoSuportado(undefined)).toBeUndefined();
});
it('pede apenas áudio, conclui em M4A e libera o microfone sem enviar mensagem',async()=>{
 const f=montar();await gravar();expect(pedir).toHaveBeenCalledWith({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true},video:false});expect(f.arquivo).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Parar gravação'}));expect(f.arquivo).toHaveBeenCalledOnce();const audio=f.arquivo.mock.calls[0][0] as File;expect(audio.type).toBe('audio/mp4');expect(audio.name).toMatch(/\.m4a$/);expect(audio.size).toBeGreaterThan(0);expect(parar).toHaveBeenCalled();expect(f.atividade).toHaveBeenLastCalledWith(false);
});
it('cancelar descarta o áudio e interrompe a captura',async()=>{const f=montar();await gravar();fireEvent.click(screen.getByRole('button',{name:'Cancelar gravação'}));expect(f.arquivo).not.toHaveBeenCalled();expect(parar).toHaveBeenCalled();});
it('desmontar descarta a gravação e libera o microfone',async()=>{const f=montar();await gravar();f.unmount();expect(f.arquivo).not.toHaveBeenCalled();expect(parar).toHaveBeenCalled();});
it('cancelar antes de permitir o microfone também libera a resposta tardia',async()=>{let concluir:(v:unknown)=>void=()=>{};pedir.mockImplementation(()=>new Promise(r=>concluir=r));const f=montar();fireEvent.click(screen.getByRole('button',{name:'Gravar áudio'}));fireEvent.click(screen.getByRole('button',{name:'Cancelar gravação'}));await act(async()=>concluir({getTracks:()=>[{stop:parar}]}));expect(parar).toHaveBeenCalled();expect(f.arquivo).not.toHaveBeenCalled();});
it('explica a permissão negada e permite tentar novamente sem upload',async()=>{pedir.mockRejectedValue(new DOMException('negado','NotAllowedError'));const f=montar();fireEvent.click(screen.getByRole('button',{name:'Gravar áudio'}));expect(await screen.findByRole('alert')).toHaveProperty('textContent',expect.stringContaining('Permita o uso do microfone'));expect(f.arquivo).not.toHaveBeenCalled();expect(f.atividade).toHaveBeenLastCalledWith(false);});
it('não pede microfone nem cria arquivo quando o controle está bloqueado',()=>{const f=montar(true);fireEvent.click(screen.getByRole('button',{name:'Gravar áudio'}));expect(pedir).not.toHaveBeenCalled();expect(f.arquivo).not.toHaveBeenCalled();});
it('falha do gravador descarta partes e libera o microfone',async()=>{const f=montar();await gravar();act(()=>Gravador.ultimo.onerror?.());expect(await screen.findByRole('alert')).toHaveProperty('textContent',expect.stringContaining('Não foi possível concluir'));expect(f.arquivo).not.toHaveBeenCalled();expect(parar).toHaveBeenCalled();});
it('perder permissão de envio interrompe e descarta a captura',async()=>{const f=montar();await gravar();f.rerender(<GravarAudioCompositor disabled onArquivo={f.arquivo} onAtividade={f.atividade}/>);await waitFor(()=>expect(parar).toHaveBeenCalled());expect(f.arquivo).not.toHaveBeenCalled();});
it('encerra no limite de cinco minutos sem continuar a capturar',async()=>{const f=montar();await gravar();vi.useFakeTimers(); // O intervalo já foi criado; limite é coberto com timer real substituído antes de iniciar na próxima gravação.
 fireEvent.click(screen.getByRole('button',{name:'Cancelar gravação'}));fireEvent.click(screen.getByRole('button',{name:'Gravar áudio'}));await act(async()=>{await Promise.resolve();});act(()=>vi.advanceTimersByTime(300000));expect(f.arquivo).toHaveBeenCalledOnce();expect(Gravador.ultimo.state).toBe('inactive');expect(parar).toHaveBeenCalled();});
