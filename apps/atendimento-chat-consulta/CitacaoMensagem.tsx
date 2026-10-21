import {AudioLines,FileText,Image,Video,Sticker} from 'lucide-react';
import type {MensagemOperacao,CitacaoOperacao,EquipeOperacao,SessaoOperacao} from './operacao-api';

export function nomeAutorChat(m:Pick<MensagemOperacao,'autor'|'autorId'|'autorNome'>,contato:string,equipe:EquipeOperacao,sessao:SessaoOperacao){
 return m.autor==='cliente'?contato:m.autor==='ia'?(m.autorNome||'Donatella'):m.autor==='automacao'?'Automação de pedido':m.autorNome||equipe.usuarios.find(u=>u.id===m.autorId)?.nome||(m.autorId===sessao.usuario.id?sessao.usuario.nome:'Autoria não identificada');
}
export default function CitacaoMensagem({mensagem,nome,ausente=false}:{mensagem?:Pick<CitacaoOperacao,'conteudo'|'tipo'>;nome?:string;ausente?:boolean}){
 const Icone=mensagem?.tipo==='audio'?AudioLines:mensagem?.tipo==='image'?Image:mensagem?.tipo==='video'?Video:mensagem?.tipo==='sticker'?Sticker:FileText;
 const tipo=({audio:'Mensagem de voz',image:'Imagem',video:'Vídeo',sticker:'Figurinha',document:'Documento'} as Record<string,string>)[mensagem?.tipo??''];
 return <blockquote className="citacao-mensagem" aria-label="Mensagem respondida">
  {nome&&<strong>{nome}</strong>}
  {ausente?<span>Mensagem original indisponível no histórico.</span>:<span>{tipo&&<><Icone size={14} aria-hidden="true"/>{tipo}{mensagem?.conteudo?' · ':''}</>}{mensagem?.conteudo||(!tipo?'Mensagem sem texto':'')}</span>}
 </blockquote>;
}
