import {useCallback,useEffect,useRef,useState} from 'react';

/** Preferência por atendente neste navegador. Nenhum áudio ou dado do cliente é armazenado. */
export function useSomNovasMensagens(usuarioId:string|undefined){
 const [ativo,setAtivo]=useState(false),[erro,setErro]=useState('');
 const ligado=useRef(false),contexto=useRef<AudioContext|null>(null),ultimoAlerta=useRef(-Infinity);
 const chave=usuarioId?'grazing.atendimento.som.'+usuarioId:null;
 const preparar=useCallback(()=>{
  contexto.current??=new AudioContext();
  if(contexto.current.state==='suspended')void contexto.current.resume().catch(()=>setErro('Não foi possível reproduzir o som de alerta.'));
  return contexto.current;
 },[]);
 useEffect(()=>{
  let salvo=false;try{salvo=!!chave&&localStorage.getItem(chave)==='ligado';}catch{/* A preferência funciona sem armazenamento. */}
  ligado.current=salvo;setAtivo(salvo);setErro('');ultimoAlerta.current=-Infinity;
  const liberar=()=>{if(ligado.current)try{preparar();}catch{setErro('Não foi possível reproduzir o som de alerta.');}};
  window.addEventListener('pointerdown',liberar);window.addEventListener('keydown',liberar);
  return()=>{window.removeEventListener('pointerdown',liberar);window.removeEventListener('keydown',liberar);ligado.current=false;void contexto.current?.close().catch(()=>{});contexto.current=null;};
 },[chave,preparar]);
 const alternar=useCallback(()=>{
  const proximo=!ligado.current;setErro('');
  if(proximo)try{preparar();}catch{setErro('Este navegador não conseguiu ativar o som de alerta.');return;}
  else void contexto.current?.suspend().catch(()=>{});
  ligado.current=proximo;setAtivo(proximo);
  try{if(chave)localStorage.setItem(chave,proximo?'ligado':'desligado');}catch{/* Mantém a escolha durante esta sessão. */}
 },[chave,preparar]);
 const avisar=useCallback(()=>{
  if(!ligado.current||!contexto.current||contexto.current.state!=='running')return;
  const audio=contexto.current,agora=audio.currentTime;
  if(agora-ultimoAlerta.current<0.9)return;ultimoAlerta.current=agora;
  // Dois toques ascendentes, com pausa e volume mais perceptível.
  const nota=audio.createOscillator(),volume=audio.createGain();nota.type='triangle';
  nota.frequency.setValueAtTime(1046.5,agora);nota.frequency.setValueAtTime(1318.5,agora+0.32);
  volume.gain.setValueAtTime(0,agora);
  volume.gain.linearRampToValueAtTime(0.3,agora+0.015);volume.gain.linearRampToValueAtTime(0,agora+0.23);
  volume.gain.setValueAtTime(0,agora+0.32);volume.gain.linearRampToValueAtTime(0.3,agora+0.335);volume.gain.linearRampToValueAtTime(0,agora+0.7);
  nota.connect(volume);volume.connect(audio.destination);nota.onended=()=>{nota.disconnect();volume.disconnect();};nota.start(agora);nota.stop(agora+0.72);
 },[]);
 return {ativo,alternar,avisar,erro};
}
