import {useEffect,useRef} from 'react';
import {FileText,X} from 'lucide-react';
import {tamanhoArquivoCompositor} from './compositor-arquivos';
export type AnexoRascunho={id:string;nome:string;mime:string;tamanho:number;arquivo?:File};
export default function AnexoCompositor({anexo,remover,disabled}:{anexo:AnexoRascunho;remover:()=>void;disabled:boolean}){
 const audioRef=useRef<HTMLAudioElement>(null);
 const imagemRef=useRef<HTMLImageElement>(null),visual=!!anexo.arquivo&&['image/png','image/jpeg'].includes(anexo.mime);
 useEffect(()=>{const imagem=imagemRef.current;if(!imagem||!anexo.arquivo||!visual)return;const u=URL.createObjectURL(new Blob([anexo.arquivo],{type:anexo.mime}));imagem.src=u;return()=>{imagem.removeAttribute('src');URL.revokeObjectURL(u);};},[anexo.arquivo,anexo.mime,visual]);
 useEffect(()=>{const audio=audioRef.current;if(!audio||!anexo.arquivo||!anexo.mime.startsWith('audio/'))return;const u=URL.createObjectURL(anexo.arquivo);audio.src=u;return()=>{audio.pause();audio.removeAttribute('src');URL.revokeObjectURL(u);};},[anexo.arquivo,anexo.mime]);
 return <div className="anexo-rascunho" role="group" aria-label="Arquivo anexado ao rascunho">{visual?<img ref={imagemRef} alt={'Prévia do anexo '+anexo.nome}/>:<FileText size={28} aria-hidden="true"/>}<div><strong>{anexo.nome}</strong>{anexo.arquivo&&anexo.mime.startsWith('audio/')&&<audio ref={audioRef} controls preload="metadata" aria-label="Ouvir áudio antes de enviar"/>}<small>{tamanhoArquivoCompositor(anexo.tamanho)} · Será enviado ao clicar em Enviar.</small></div><button className="close-icon" type="button" aria-label="Remover anexo do rascunho" title="Remover anexo" disabled={disabled} onClick={remover}><X size={16}/></button></div>;
}
