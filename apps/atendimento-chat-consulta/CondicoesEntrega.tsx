import {useCallback,useEffect,useState} from 'react';
import type {ClienteOperacao,EntregaOperacao,SessaoOperacao} from './operacao-api';
import {LIMITE_TEXTO_ENTREGA,limparTextoOperacao} from './operacao-api';

type Props={cliente:ClienteOperacao;sessao:SessaoOperacao;falhar:(e:unknown)=>void;avisar:(s:string)=>void;alteracoes?:(id:string,ativo:boolean)=>void};

/** Texto que a ferramenta delivery_conditions entrega à Donatella. Vale só
 * aprovado e com a habilidade Entrega ligada. */
export default function CondicoesEntregaDonatella({cliente,sessao,falhar,avisar,alteracoes}:Props){
 const [base,setBase]=useState<EntregaOperacao|null>(null),[texto,setTexto]=useState(''),[aprovada,setAprovada]=useState(false),[ocupado,setOcupado]=useState(false);
 const podeEditar=sessao.usuario.permissoes.includes('ia.editar')&&sessao.usuario.permissoes.includes('configurar');
 const carregar=useCallback(async()=>{await Promise.resolve();setOcupado(true);try{const e=await cliente.entrega();setBase(e);setTexto(e.texto);setAprovada(e.aprovada);}catch(e){falhar(e);}finally{setOcupado(false);}},[cliente,falhar]);
 useEffect(()=>{let vivo=true;queueMicrotask(()=>{if(vivo)void carregar();});return()=>{vivo=false;};},[carregar]);
 const dirty=!!base&&(texto!==base.texto||aprovada!==base.aprovada),valido=texto.length<=LIMITE_TEXTO_ENTREGA&&(!aprovada||!!texto.trim());
 useEffect(()=>{alteracoes?.('entrega-agente',dirty);return()=>alteracoes?.('entrega-agente',false);},[alteracoes,dirty]);
 async function salvar(){
  if(!base||!valido||!podeEditar)return;setOcupado(true);
  try{await cliente.configurarEntrega({texto,aprovada,versao:base.versao,idempotencia:crypto.randomUUID()});avisar(aprovada?'Condições de entrega aprovadas. A Donatella usa este texto quando a habilidade Entrega estiver ligada.':'Condições de entrega salvas sem aprovação. A Donatella não usa este texto.');await carregar();}
  catch(e){falhar(e);}finally{setOcupado(false);}
 }
 return <section className="panel operacao-form agente-entrega"><h2>Condições de entrega</h2>
  <p className="muted">Área atendida, taxa, dias e horários de entrega e de retirada. A Donatella só usa o texto aprovado, e só com a habilidade Entrega ligada. Ao mudar o texto, respostas pendentes baseadas na versão anterior deixam de ser enviadas.</p>
  {base?<>
   <label>Texto das condições<textarea className="field" rows={8} maxLength={LIMITE_TEXTO_ENTREGA} value={texto} disabled={ocupado||!podeEditar} onChange={e=>setTexto(limparTextoOperacao(e.target.value,LIMITE_TEXTO_ENTREGA))}/></label>
   <p className="muted">{texto.length.toLocaleString('pt-BR')} de {LIMITE_TEXTO_ENTREGA.toLocaleString('pt-BR')} caracteres. Sem telefone, e-mail ou CPF.</p>
   <label className="operacao-check"><input type="checkbox" checked={aprovada} disabled={ocupado||!podeEditar} onChange={e=>setAprovada(e.target.checked)}/>Conferi e aprovo estas condições para a Donatella usar</label>
   <div className="toolbar"><button className="btn primary" disabled={ocupado||!dirty||!valido||!podeEditar} onClick={()=>void salvar()}>Salvar condições</button><button className="btn" disabled={ocupado||dirty} onClick={()=>void carregar()}>Atualizar</button></div>
   {!podeEditar&&<p className="muted">Editar exige as permissões de editar a IA e de configurar o atendimento no HUB.</p>}
  </>:<p role="status">{ocupado?'Conferindo condições de entrega…':'Condições ainda não consultadas.'}</p>}
 </section>;
}
