import {useEffect,useRef,useState} from 'react';
import {AudioLines,Download,Pause,Play,RotateCcw} from 'lucide-react';
import type {ClienteOperacao} from './operacao-api';

// A origem admite duas leituras simultâneas. A fila não aumenta esse limite.
const filas=new WeakMap<ClienteOperacao,{ativos:number;espera:(()=>void)[]}>();
async function carregar(cliente:ClienteOperacao,id:string,signal:AbortSignal){
 let fila=filas.get(cliente);if(!fila){fila={ativos:0,espera:[]};filas.set(cliente,fila);}
 const f=fila;
 await new Promise<void>((resolve,reject)=>{
  const abortar=()=>{const i=f.espera.indexOf(iniciar);if(i>=0)f.espera.splice(i,1);reject(new DOMException('Cancelado','AbortError'));};
  const iniciar=()=>{signal.removeEventListener('abort',abortar);if(signal.aborted){abortar();return;}f.ativos++;resolve();};
  if(signal.aborted){abortar();return;}signal.addEventListener('abort',abortar,{once:true});
  if(f.ativos<2)iniciar();else f.espera.push(iniciar);
 });
 try{return await cliente.arquivo(id,signal);}finally{f.ativos--;f.espera.shift()?.();}
}
const tempo=(segundos:number)=>{const s=Number.isFinite(segundos)?Math.floor(segundos):0;return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');};
function Voz({url}:{url:string}){
 const ref=useRef<HTMLAudioElement>(null),[tocando,setTocando]=useState(false),[duracao,setDuracao]=useState(0),[posicao,setPosicao]=useState(0),[velocidade,setVelocidade]=useState(1),[erro,setErro]=useState(false);
 async function alternar(){const audio=ref.current;if(!audio)return;if(!audio.paused){audio.pause();return;}try{await audio.play();setErro(false);}catch{setErro(true);}}
 return <div className="mensagem-voz"><audio ref={ref} src={url} preload="metadata" aria-label="Mensagem de voz" onLoadedMetadata={e=>setDuracao(e.currentTarget.duration)} onDurationChange={e=>setDuracao(e.currentTarget.duration)} onTimeUpdate={e=>setPosicao(e.currentTarget.currentTime)} onPlay={()=>setTocando(true)} onPause={()=>setTocando(false)} onEnded={()=>setTocando(false)} onError={()=>setErro(true)}><track kind="captions"/></audio><button className="voz-reproduzir" type="button" aria-label={tocando?'Pausar mensagem de voz':'Reproduzir mensagem de voz'} onClick={()=>void alternar()}>{tocando?<Pause size={20}/>:<Play size={20}/>}</button><AudioLines className="voz-icone" size={22} aria-hidden="true"/><div className="voz-progresso"><input type="range" aria-label="Posição da mensagem de voz" min={0} max={Number.isFinite(duracao)&&duracao>0?duracao:1} step={.1} value={posicao} disabled={!Number.isFinite(duracao)||duracao<=0} onChange={e=>{if(ref.current){ref.current.currentTime=Number(e.target.value);setPosicao(Number(e.target.value));}}}/><small>{tempo(tocando||posicao?posicao:duracao)}</small></div><button className="voz-velocidade" type="button" aria-label={'Velocidade da mensagem de voz: '+velocidade+' vezes'} onClick={()=>{const v=velocidade===1?1.5:velocidade===1.5?2:1;setVelocidade(v);if(ref.current)ref.current.playbackRate=v;}}>{velocidade}×</button>{erro&&<p role="status">Não foi possível reproduzir este áudio.</p>}</div>;
}
export default function MidiaMensagem({id,tipo,cliente,falhar}:{id:string;tipo:string;cliente:ClienteOperacao;falhar:(e:unknown)=>void}){
 const [midia,setMidia]=useState<{url:string;mime:string}|null>(null),[falhou,setFalhou]=useState(false),[tentativa,setTentativa]=useState(0),raiz=useRef<HTMLDivElement>(null);
 const visual=['image','sticker','audio','video'].includes(tipo);
 useEffect(()=>{
  if(!visual)return;const c=new AbortController();let url:string|null=null,iniciado=false;
  async function abrir(){if(iniciado||c.signal.aborted)return;iniciado=true;setFalhou(false);try{const arquivo=await carregar(cliente,id,c.signal);if(c.signal.aborted)return;url=URL.createObjectURL(arquivo);setMidia({url,mime:arquivo.type});}catch(e){if(!c.signal.aborted){setFalhou(true);falhar(e);}}}
  // Só carrega conteúdo próximo da janela visível; não baixa todo o histórico.
  const observer=typeof IntersectionObserver==='undefined'?null:new IntersectionObserver(es=>{if(es.some(e=>e.isIntersecting)){void abrir();observer?.disconnect();}},{root:raiz.current?.closest('.mensagens')??null,rootMargin:'200px'});
  if(observer&&raiz.current)observer.observe(raiz.current);else void abrir();
  return()=>{c.abort();observer?.disconnect();if(url)URL.revokeObjectURL(url);};
 },[id,tipo,cliente,visual,tentativa,falhar]);
 return <div ref={raiz} className={'operacao-anexo midia-'+tipo}>
  {visual&&!midia&&!falhou&&<div className="midia-carregando" role="status">{tipo==='audio'?<AudioLines size={20}/>:null}Carregando {tipo==='audio'?'mensagem de voz':'mídia'}…</div>}
  {falhou&&<button className="btn" type="button" onClick={()=>setTentativa(t=>t+1)}><RotateCcw size={16}/>Tentar carregar mídia novamente</button>}
  {midia&&(tipo==='audio'&&midia.mime.startsWith('audio/')?<Voz url={midia.url}/>:tipo==='video'&&midia.mime.startsWith('video/')?<video className="operacao-imagem" src={midia.url} controls preload="metadata" aria-label="Vídeo do atendimento"><track kind="captions"/></video>:midia.mime.startsWith('image/')?<a className="imagem-mensagem" href={midia.url} target="_blank" rel="noopener noreferrer" aria-label="Ampliar imagem"><img className="operacao-imagem" src={midia.url} alt="Imagem anexada ao atendimento"/></a>:<p role="status">Formato de mídia incompatível.</p>)}
  {!visual&&<a className="btn" href={cliente.anexo(id)} target="_blank" rel="noopener noreferrer"><Download size={16}/>Baixar documento</a>}
 </div>;
}
