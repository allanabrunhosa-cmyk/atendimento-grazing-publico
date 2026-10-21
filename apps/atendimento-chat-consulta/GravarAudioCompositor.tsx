import {useCallback,useEffect,useRef,useState} from 'react';
import {Mic,Square,X} from 'lucide-react';
import {Button} from '../../src/components/ui/button';

export const limiteGravacaoSegundos=300;
/** Somente formatos aceitos pelo canal. Nunca renomear WebM como Ogg/MP4. */
export function formatoGravacaoSuportado(recorder:Pick<typeof MediaRecorder,'isTypeSupported'>|undefined){
 return ['audio/ogg;codecs=opus','audio/mp4;codecs=mp4a.40.2','audio/mp4'].find(mime=>recorder?.isTypeSupported(mime));
}
export default function GravarAudioCompositor({disabled,onArquivo,onAtividade}:{disabled:boolean;onArquivo:(arquivo:File)=>void;onAtividade:(ativa:boolean)=>void}){
 const [estado,setEstado]=useState<'pronto'|'solicitando'|'gravando'>('pronto'),[segundos,setSegundos]=useState(0),[erro,setErro]=useState('');
 const sessao=useRef<{id:number;stream?:MediaStream;recorder?:MediaRecorder;timer?:ReturnType<typeof setInterval>;cancelada:boolean;partes:Blob[];bytes:number}>({id:0,cancelada:false,partes:[],bytes:0});
 const callbacks=useRef({onArquivo,onAtividade});callbacks.current={onArquivo,onAtividade};
 const liberar=useCallback(()=>{const s=sessao.current;if(s.timer)clearInterval(s.timer);s.stream?.getTracks().forEach(t=>{t.onended=null;t.stop();});},[]);
 const cancelar=useCallback(()=>{const s=sessao.current;s.cancelada=true;s.id++;if(s.recorder?.state==='recording')s.recorder.stop();liberar();callbacks.current.onAtividade(false);setEstado('pronto');},[liberar]);
 useEffect(()=>()=>{const s=sessao.current;s.cancelada=true;s.id++;if(s.recorder?.state==='recording')s.recorder.stop();liberar();callbacks.current.onAtividade(false);},[liberar]);
 useEffect(()=>{if(disabled&&sessao.current.id>0&&!sessao.current.cancelada){cancelar();}},[disabled,cancelar]); // Encerrar se o acesso ou a conversa deixar de permitir envio.
 async function iniciar(){
  if(disabled||estado!=='pronto')return;
  setErro('');
  const mime=formatoGravacaoSuportado(globalThis.MediaRecorder);
  if(!navigator.mediaDevices?.getUserMedia||!mime){setErro('Este navegador não permite gravar em um formato compatível. Atualize o navegador ou anexe um áudio MP3, M4A ou Ogg/Opus.');return;}
  const s={id:sessao.current.id+1,cancelada:false,partes:[] as Blob[],bytes:0} as typeof sessao.current;sessao.current=s;
  setEstado('solicitando');callbacks.current.onAtividade(true);
  try{
   const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true},video:false});
   if(s.cancelada||sessao.current!==s){stream.getTracks().forEach(t=>t.stop());return;}
   s.stream=stream;
   const recorder=new MediaRecorder(stream,{mimeType:mime,audioBitsPerSecond:64000});s.recorder=recorder;
   recorder.ondataavailable=e=>{if(s.cancelada||!e.data.size)return;s.bytes+=e.data.size;if(s.bytes>16*1024*1024){setErro('O áudio excedeu 16 MB. Grave uma mensagem mais curta.');cancelar();return;}s.partes.push(e.data);};
   recorder.onerror=()=>{if(s.cancelada)return;setErro('Não foi possível concluir a gravação. Confira o microfone e tente novamente.');cancelar();};
   recorder.onstop=()=>{
    if(s.cancelada||sessao.current!==s)return;
    liberar();callbacks.current.onAtividade(false);setEstado('pronto');
    if(!s.bytes){setErro('A gravação ficou vazia. Grave novamente.');return;}
    const real=recorder.mimeType.toLowerCase();
    const tipo=real==='audio/ogg;codecs=opus'||real==='audio/ogg; codecs=opus'?'audio/ogg':/^audio\/mp4(?:;\s*codecs="?mp4a\.40\.2"?)?$/.test(real)?'audio/mp4':null;
    if(!tipo){setErro('O navegador gerou um formato incompatível. Anexe um áudio MP3, M4A ou Ogg/Opus.');return;}
    callbacks.current.onArquivo(new File(s.partes,['audio-',new Date().toISOString().replace(/[:.]/g,'-'),tipo==='audio/ogg'?'.ogg':'.m4a'].join(''),{type:tipo}));
   };
   stream.getTracks().forEach(t=>{t.onended=()=>{if(!s.cancelada){setErro('O microfone foi desconectado. Grave novamente.');cancelar();}};});
   recorder.start(1000);setEstado('gravando');setSegundos(0);
   let decorrido=0;s.timer=setInterval(()=>{decorrido++;setSegundos(decorrido);if(decorrido>=limiteGravacaoSegundos&&recorder.state==='recording')recorder.stop();},1000);
  }catch(e){if(s.cancelada||sessao.current!==s)return;liberar();callbacks.current.onAtividade(false);setEstado('pronto');setErro(e instanceof DOMException&&e.name==='NotAllowedError'?'Permita o uso do microfone neste site para gravar áudio.':'Não foi possível acessar o microfone. Confira a conexão e a permissão do navegador.');}
 }
 return <div className="gravacao-compositor">
  {estado==='pronto'?<Button type="button" variant="ghost" size="icon" className="btn icon" aria-label="Gravar áudio" title="Gravar áudio" disabled={disabled} onClick={()=>void iniciar()}><Mic size={18}/></Button>:<div className="gravacao-controles" role="group" aria-label="Gravação de áudio">
   <span role="status">{estado==='solicitando'?'Aguardando microfone…':`Gravando ${Math.floor(segundos/60)}:${String(segundos%60).padStart(2,'0')}`}</span>
   <Button type="button" variant="outline" className="btn" disabled={estado==='solicitando'} onClick={()=>sessao.current.recorder?.stop()}><Square size={16}/>Parar gravação</Button>
   <Button type="button" variant="ghost" size="icon" className="close-icon" aria-label="Cancelar gravação" onClick={cancelar}><X size={16}/></Button>
  </div>}
  {erro&&<p role="alert" className="aviso gravacao-erro">{erro}</p>}
 </div>;
}
