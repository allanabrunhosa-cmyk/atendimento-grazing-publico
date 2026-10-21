// @vitest-environment jsdom
import React,{useRef,type ComponentProps} from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import FimListaConversas from '../../apps/atendimento-chat-consulta/FimListaConversas';

type Opcoes=Omit<ComponentProps<typeof FimListaConversas>,'raiz'>;
const padrao=():Opcoes=>({mais:true,carregando:false,erro:false,quantidade:30,carregar:vi.fn(async()=>{}),repetir:vi.fn()});
function Ambiente(props:Opcoes){
 const raiz=useRef<HTMLElement|null>(null);
 return <section ref={raiz} aria-label="Conversas fictícias"><FimListaConversas {...props} raiz={raiz}/></section>;
}
function observar(){
 const instancias:{opcoes:IntersectionObserverInit|undefined;observar:ReturnType<typeof vi.fn>;desconectar:ReturnType<typeof vi.fn>;avisar:(visiveis:boolean[])=>void}[]=[];
 vi.stubGlobal('IntersectionObserver',class{
  observe=vi.fn();disconnect=vi.fn();
  constructor(retorno:IntersectionObserverCallback,opcoes?:IntersectionObserverInit){
   instancias.push({opcoes,observar:this.observe,desconectar:this.disconnect,avisar:visiveis=>retorno(visiveis.map(isIntersecting=>({isIntersecting})) as IntersectionObserverEntry[],this as unknown as IntersectionObserver)});
  }
 });
 return instancias;
}
afterEach(()=>{cleanup();vi.unstubAllGlobals();});

it('observa o fim da própria lista e antecipa o próximo bloco em 120 pixels',()=>{
 const instancias=observar(),props=padrao();render(<Ambiente {...props}/>);
 expect(instancias).toHaveLength(1);
 expect(instancias[0].opcoes).toEqual({root:screen.getByRole('region',{name:'Conversas fictícias'}),rootMargin:'0px 0px 120px 0px'});
 expect(instancias[0].observar).toHaveBeenCalledExactlyOnceWith(screen.getByLabelText('Carregamento de conversas'));
 act(()=>instancias[0].avisar([false,false]));expect(props.carregar).not.toHaveBeenCalled();
 act(()=>instancias[0].avisar([false,true]));expect(props.carregar).toHaveBeenCalledOnce();
 expect(screen.getByRole('status').textContent).toBe('30 conversas carregadas.');
 expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');
});

it.each([
 ['carregamento em curso',{carregando:true}],
 ['falha pendente de nova tentativa',{erro:true}],
 ['último bloco recebido',{mais:false}],
] as const)('não cria observador com %s',(_,mudanca)=>{
 const instancias=observar();render(<Ambiente {...padrao()} {...mudanca}/>);expect(instancias).toHaveLength(0);
});

it('desliga a observação durante o carregamento, retoma ao concluir e limpa ao desmontar',()=>{
 const instancias=observar(),props=padrao(),tela=render(<Ambiente {...props}/>);
 tela.rerender(<Ambiente {...props} carregando/>);
 expect(instancias[0].desconectar).toHaveBeenCalledOnce();expect(instancias).toHaveLength(1);
 expect(screen.getByRole('status').textContent).toBe('Carregando mais conversas…');
 tela.rerender(<Ambiente {...props} quantidade={60}/>);
 expect(instancias).toHaveLength(2);expect(screen.getByRole('status').textContent).toBe('60 conversas carregadas.');
 tela.unmount();expect(instancias[1].desconectar).toHaveBeenCalledOnce();
});

it('oferece nova tentativa após falha e informa quando não há mais conversas',()=>{
 const instancias=observar(),props=padrao(),tela=render(<Ambiente {...props} erro/>);
 expect(screen.getByText('Não foi possível carregar as conversas.')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Tentar novamente'}));expect(props.repetir).toHaveBeenCalledOnce();
 expect(props.carregar).not.toHaveBeenCalled();expect(instancias).toHaveLength(0);
 tela.rerender(<Ambiente {...props} mais={false} quantidade={67}/>);
 expect(screen.getByRole('status').textContent).toBe('67 conversas carregadas. Fim da lista.');
 expect(screen.queryByRole('button',{name:'Tentar novamente'})).toBeNull();
});

it('mantém o estado legível sem IntersectionObserver e permite tentar novamente após falha',()=>{
 vi.stubGlobal('IntersectionObserver',undefined);const props=padrao(),tela=render(<Ambiente {...props}/>);
 expect(screen.getByRole('status').textContent).toBe('30 conversas carregadas.');expect(props.carregar).not.toHaveBeenCalled();
 tela.rerender(<Ambiente {...props} erro/>);
 fireEvent.click(screen.getByRole('button',{name:'Tentar novamente'}));expect(props.repetir).toHaveBeenCalledOnce();
});
