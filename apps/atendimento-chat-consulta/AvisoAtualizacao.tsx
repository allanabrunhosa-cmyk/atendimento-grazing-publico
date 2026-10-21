import {useEffect,useState} from 'react';
import {RefreshCw} from 'lucide-react';

export default function AvisoAtualizacao({podeAtualizar,atualizar}:{podeAtualizar:()=>boolean;atualizar:()=>void}){
 const [disponivel,setDisponivel]=useState(false),[protegido,setProtegido]=useState(false);
 useEffect(()=>{
  const atual=document.querySelector<HTMLScriptElement>('script[src^="/operacao/assets/"]')?.getAttribute('src');
  if(!atual)return;
  let vivo=true,consultando=false;
  const controller=new AbortController();
  const conferir=async()=>{
   if(consultando||document.visibilityState==='hidden')return;
   consultando=true;
   try{
    const r=await fetch('/operacao/agente',{method:'HEAD',credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal});
    const publicada=r.headers.get('X-Atendimento-Interface');
    if(vivo&&r.ok&&publicada&&/^\/operacao\/assets\/index-[A-Za-z0-9_-]+\.js$/.test(publicada)&&publicada!==atual)setDisponivel(true);
   }catch{/* Falha de consulta não altera a operação nem os rascunhos. */}
   finally{consultando=false;}
  };
  void conferir();
  const timer=setInterval(()=>void conferir(),60000);
  const aoVoltar=()=>void conferir();
  window.addEventListener('focus',aoVoltar);document.addEventListener('visibilitychange',aoVoltar);
  return()=>{vivo=false;controller.abort();clearInterval(timer);window.removeEventListener('focus',aoVoltar);document.removeEventListener('visibilitychange',aoVoltar);};
 },[]);
 if(!disponivel)return null;
 return <div className="aviso" role="status"><span>A aplicação foi atualizada. Atualize esta aba para usar os controles atuais.{protegido&&' Conclua ou descarte as alterações e confira operações pendentes antes de atualizar.'}</span><button className="btn" onClick={()=>{if(!podeAtualizar()){setProtegido(true);return;}atualizar();}}><RefreshCw size={16}/>Atualizar aplicação</button></div>;
}
