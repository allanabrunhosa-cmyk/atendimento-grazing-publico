import {useCallback,useEffect,useState} from 'react';
import {Check,FileText} from 'lucide-react';
import type {ClienteOperacao,PromptCentralOperacao,SessaoOperacao} from './operacao-api';
import {LIMITE_PROMPT_CENTRAL,limparTextoOperacao} from './operacao-api';

type Props={cliente:ClienteOperacao;sessao:SessaoOperacao;falhar:(e:unknown)=>void;avisar:(s:string)=>void;alteracoes?:(id:string,ativo:boolean)=>void};
/** Mesmo filtro do servidor: telefone, e-mail ou CPF não entram no prompt. */
const DADOS_PESSOAIS=/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|(?:\+?55\s*)?\(?\d{2}\)?[\s.-]*\d{4,5}[\s.-]*\d{4}|\d{3}\.?\d{3}\.?\d{3}-?\d{2}/;

/** Base de quem a Donatella é e de como ela atende e vende. Soma-se às skills e ao
 * tom. As regras fixas do sistema continuam valendo por cima dele. */
export default function PromptCentralDonatella({cliente,sessao,falhar,avisar,alteracoes}:Props){
 const podeEditar=sessao.usuario.permissoes.includes('ia.editar');
 const [base,setBase]=useState<PromptCentralOperacao|null>(null),[texto,setTexto]=useState(''),[ocupado,setOcupado]=useState(false);
 const carregar=useCallback(async()=>{await Promise.resolve();setOcupado(true);try{const p=await cliente.promptCentral();setBase(p);setTexto(p.texto);}catch(e){falhar(e);}finally{setOcupado(false);}},[cliente,falhar]);
 useEffect(()=>{let vivo=true;queueMicrotask(()=>{if(vivo)void carregar();});return()=>{vivo=false;};},[carregar]);
 const dirty=!!base&&texto.trim()!==base.texto.trim(),dadosPessoais=DADOS_PESSOAIS.test(texto),valido=texto.length<=LIMITE_PROMPT_CENTRAL&&!dadosPessoais;
 useEffect(()=>{alteracoes?.('prompt-agente',dirty);return()=>alteracoes?.('prompt-agente',false);},[alteracoes,dirty]);
 async function salvar(){
  if(!base||!dirty||!valido||!podeEditar)return;setOcupado(true);
  try{const r=await cliente.configurarPromptCentral({texto,versao:base.versao,idempotencia:crypto.randomUUID()}) as {versao?:number};avisar(`Prompt central salvo${r?.versao?` (versão ${r.versao})`:''}. As próximas respostas da Donatella já usam este texto; respostas pendentes feitas com a versão anterior não serão enviadas.`);await carregar();}
  catch(e){falhar(e);}finally{setOcupado(false);}
 }
 return <section className="panel operacao-form agente-prompt" aria-label="Prompt central da Donatella">
  <div className="toolbar"><FileText size={21}/><h2>Prompt central</h2></div>
  <p className="muted">A base de todas as respostas: quem a Donatella é, como atende e como vende. As skills somam a esta base, cada uma no seu assunto, e o tom de voz define o estilo.</p>
  <details><summary>Como cada resposta é montada</summary>
   <ol>
    <li><strong>Regras fixas do sistema.</strong> Fatos, preços e links só das fontes aprovadas, formato da resposta e quando chamar a equipe. Elas não mudam por esta tela.</li>
    <li><strong>Prompt central</strong>, este texto.</li>
    <li><strong>Skills</strong> ligadas para o assunto da mensagem.</li>
    <li><strong>Tom de voz.</strong></li>
    <li><strong>Fontes da pergunta:</strong> catálogo, conhecimento aprovado e condições de entrega.</li>
   </ol>
   <p className="muted">Se o prompt central pedir algo contra as regras fixas, valem as regras fixas. Um preço escrito aqui, por exemplo, só chega ao cliente se estiver no catálogo.</p>
  </details>
  {base?<>
   <label>Texto do prompt central<textarea className="field" rows={18} maxLength={LIMITE_PROMPT_CENTRAL} value={texto} disabled={ocupado||!podeEditar} placeholder="Ex.: Você é a Donatella, da Grazing. Atende com carinho e objetividade, orienta o pedido pelo site…" onChange={e=>setTexto(limparTextoOperacao(e.target.value,LIMITE_PROMPT_CENTRAL))}/></label>
   <p className="muted">{texto.length.toLocaleString('pt-BR')} de {LIMITE_PROMPT_CENTRAL.toLocaleString('pt-BR')} caracteres. Sem telefone, e-mail ou CPF. {base.versao?`Versão ${base.versao} salva.`:'Ainda não salvo.'}</p>
   {dadosPessoais&&<p role="status">Tire do texto o telefone, e-mail ou CPF antes de salvar. A Donatella repetiria esse dado a clientes.</p>}
   {!texto.trim()&&<p role="status">Sem prompt central, a Donatella responde só com as regras fixas, as skills e o tom de voz.</p>}
   <div className="toolbar"><button className="btn" disabled={ocupado||!dirty} onClick={()=>setTexto(base.texto)}>Descartar alterações</button><button className="btn primary" disabled={ocupado||!dirty||!valido||!podeEditar} onClick={()=>void salvar()}><Check size={16}/>Salvar prompt central</button></div>
   {!podeEditar&&<p className="muted">Editar exige a permissão de editar a IA no HUB.</p>}
  </>:<p role="status">{ocupado?'Conferindo o prompt central…':'Prompt central ainda não consultado.'}</p>}
 </section>;
}
