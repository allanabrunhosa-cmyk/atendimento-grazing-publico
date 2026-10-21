import {useEffect,useRef,type RefObject} from 'react';
import {Button} from '../../src/components/ui/button';

type Props={raiz:RefObject<HTMLElement|null>;mais:boolean;carregando:boolean;erro:boolean;quantidade:number;carregar:()=>Promise<void>;repetir:()=>void};
export default function FimListaConversas({raiz,mais,carregando,erro,quantidade,carregar,repetir}:Props){
 const sentinela=useRef<HTMLDivElement|null>(null);
 useEffect(()=>{
  if(!mais||carregando||erro||!raiz.current||!sentinela.current||typeof IntersectionObserver==='undefined')return;
  const observador=new IntersectionObserver(entradas=>{if(entradas.some(e=>e.isIntersecting))void carregar();},{root:raiz.current,rootMargin:'0px 0px 120px 0px'});
  observador.observe(sentinela.current);return()=>observador.disconnect();
 },[raiz,mais,carregando,erro,carregar]);
 return <div ref={sentinela} className="lista-conversas-fim" aria-label="Carregamento de conversas">
  {erro?<><p>Não foi possível carregar as conversas.</p><Button type="button" variant="outline" size="sm" className="btn" onClick={repetir}>Tentar novamente</Button></>:
   <p role="status" aria-live="polite">{carregando?'Carregando mais conversas…':quantidade+(quantidade===1?' conversa carregada.':' conversas carregadas.')+(mais?'':' Fim da lista.')}</p>}
 </div>;
}
