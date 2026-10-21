// @vitest-environment jsdom
import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import AvisoAtualizacao from '../../apps/atendimento-chat-consulta/AvisoAtualizacao';

afterEach(()=>{cleanup();document.querySelectorAll('script[data-prova-versao]').forEach(e=>e.remove());vi.unstubAllGlobals();});
function preparar(publicada='/operacao/assets/index-nova.js',status=200){
 const script=document.createElement('script');script.src='/operacao/assets/index-anterior.js';script.dataset.provaVersao='true';document.head.append(script);
 const buscar=vi.fn<typeof fetch>(async()=>new Response(null,{status,headers:{'X-Atendimento-Interface':publicada}}));vi.stubGlobal('fetch',buscar);
 return buscar;
}
it('avisa quando a aba mantém código antigo e nunca atualiza sem ação do usuário',async()=>{
 const buscar=preparar(),atualizar=vi.fn();let livre=false;
 render(<AvisoAtualizacao podeAtualizar={()=>livre} atualizar={atualizar}/>);
 const botao=await screen.findByRole('button',{name:'Atualizar aplicação'});
 expect(atualizar).not.toHaveBeenCalled();
 fireEvent.click(botao);expect(screen.getByText(/Conclua ou descarte/)).toBeTruthy();expect(atualizar).not.toHaveBeenCalled();
 livre=true;fireEvent.click(botao);expect(atualizar).toHaveBeenCalledTimes(1);
 expect(buscar.mock.calls[0][1]).toMatchObject({method:'HEAD',cache:'no-store',credentials:'same-origin',redirect:'error'});
 expect(buscar.mock.calls[0][1]?.body).toBeUndefined();
});
it('não informa atualização para a mesma versão nem transforma falha em atualização',async()=>{
 const buscar=preparar('/operacao/assets/index-anterior.js');
 render(<AvisoAtualizacao podeAtualizar={()=>true} atualizar={vi.fn()}/>);
 await waitFor(()=>expect(buscar).toHaveBeenCalledTimes(1));expect(screen.queryByRole('button',{name:'Atualizar aplicação'})).toBeNull();
 buscar.mockResolvedValueOnce(new Response(null,{status:503,headers:{'X-Atendimento-Interface':'/operacao/assets/index-nova.js'}}));
 fireEvent(window,new Event('focus'));await waitFor(()=>expect(buscar).toHaveBeenCalledTimes(2));expect(screen.queryByRole('button',{name:'Atualizar aplicação'})).toBeNull();
});
