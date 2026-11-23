import { useEffect, useMemo, useState } from 'react';
import { Escolha } from './operacao-ui';
import { limparTextoOperacao, type CategoriaFonteOficial, type ClienteOperacao, type SessaoOperacao } from './operacao-api';
import { dividirLotesImportacao, explicarRecusaImportacao, lerImportacaoConhecimento } from './importacao-conhecimento';

type Props = {cliente:ClienteOperacao;sessao:SessaoOperacao;falhar:(e:unknown)=>void;avisar:(s:string)=>void;atualizar:()=>Promise<void>;alteracoes?:(id:string,ativo:boolean)=>void};
/** "1 fonte nova", "2 fontes novas". */
const contar=(n:number,um:string,varios:string)=>`${n} ${n===1?um:varios}`;
type Resumo = {total:number;enviadas:number;criadas:number;existentes:number;recusadas:{numero:number;pergunta:string;motivo:string}[]};
const CATEGORIAS = [{valor:'procedimento',rotulo:'Procedimento'},{valor:'produto',rotulo:'Produto'},{valor:'politica',rotulo:'Política'}];
const paraLocal = (d:Date)=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
const emUmAno = ()=>{const d=new Date();d.setFullYear(d.getFullYear()+1);return paraLocal(d);};

/** Fonte oficial escrita direto no painel. Entra pendente, como as propostas de casos. */
export function NovaFonteConhecimento({cliente,sessao,falhar,avisar,atualizar,alteracoes}:Props) {
 const [pergunta,setPergunta]=useState(''),[resposta,setResposta]=useState(''),[categoria,setCategoria]=useState<CategoriaFonteOficial>('procedimento'),[condicoes,setCondicoes]=useState(''),[vigenteAte,setVigenteAte]=useState(emUmAno),[ocupado,setOcupado]=useState(false);
 const [agora]=useState(()=>Date.now()),fim=new Date(vigenteAte),valido=!!pergunta.trim()&&!!resposta.trim()&&Number.isFinite(fim.getTime())&&fim.getTime()>agora;
 const dirty=!!(pergunta||resposta||condicoes);
 useEffect(()=>{alteracoes?.('conhecimento-nova-fonte',dirty);return()=>alteracoes?.('conhecimento-nova-fonte',false);},[alteracoes,dirty]);
 async function salvar(){
  if(!valido)return;setOcupado(true);
  try{await cliente.cadastrarConhecimento({pergunta,resposta,categoria,condicoes,vigenteDe:new Date().toISOString(),vigenteAte:fim.toISOString(),responsavelId:sessao.usuario.id});setPergunta('');setResposta('');setCondicoes('');avisar('Fonte registrada como pendente. Ela só orienta a Donatella depois de aprovada.');await atualizar();}
  catch(e){falhar(e);}finally{setOcupado(false);}
 }
 return <details className="conhecimento-substituir"><summary>Nova fonte</summary>
  <label>Pergunta do cliente<input className="field" maxLength={2000} value={pergunta} disabled={ocupado} onChange={e=>setPergunta(limparTextoOperacao(e.target.value,2000))}/></label>
  <label>Resposta aprovada<textarea className="field" maxLength={6000} value={resposta} disabled={ocupado} onChange={e=>setResposta(limparTextoOperacao(e.target.value,6000))}/></label>
  <label htmlFor="nova-fonte-categoria">Categoria<Escolha id="nova-fonte-categoria" label="Categoria da fonte" disabled={ocupado} value={categoria} options={CATEGORIAS} onChange={v=>setCategoria(v as CategoriaFonteOficial)}/></label>
  <label>Condições de uso (opcional)<textarea className="field" maxLength={2000} value={condicoes} disabled={ocupado} onChange={e=>setCondicoes(limparTextoOperacao(e.target.value,2000))}/></label>
  <label>Vigente até<input className="field" type="datetime-local" value={vigenteAte} disabled={ocupado} onChange={e=>setVigenteAte(e.target.value)}/></label>
  <p className="muted">Sem telefone, e-mail ou CPF: o servidor recusa. A fonte fica pendente até alguém com permissão de editar o conhecimento aprovar.</p>
  <button className="btn primary" disabled={ocupado||!valido} onClick={()=>void salvar()}>Registrar como pendente</button>
 </details>;
}

/** Várias fontes de um arquivo JSON, enviadas em lotes. Todas entram pendentes;
 * importar de novo não duplica fontes repetidas. */
export function ImportarFontesConhecimento({cliente,sessao,falhar,avisar,atualizar,alteracoes}:Props) {
 const [texto,setTexto]=useState(''),[vigenteAte,setVigenteAte]=useState(emUmAno),[ocupado,setOcupado]=useState(false),[progresso,setProgresso]=useState(''),[resumo,setResumo]=useState<Resumo|null>(null),[erroArquivo,setErroArquivo]=useState('');
 const [agora]=useState(()=>Date.now()),fim=new Date(vigenteAte),fimValido=Number.isFinite(fim.getTime())&&fim.getTime()>agora;
 const leitura=useMemo(()=>{if(!texto.trim())return {itens:null,erro:''};try{return {itens:lerImportacaoConhecimento(texto),erro:''};}catch(e){return {itens:null,erro:e instanceof Error?e.message:'Conteúdo inválido.'};}},[texto]);
 useEffect(()=>{alteracoes?.('conhecimento-importacao',!!texto||ocupado);return()=>alteracoes?.('conhecimento-importacao',false);},[alteracoes,texto,ocupado]);
 async function abrir(arquivo:File|undefined){
  setErroArquivo('');if(!arquivo)return;
  if(arquivo.size>2_000_000){setErroArquivo('O arquivo passa de 2 MB. Divida em arquivos menores.');return;}
  try{setTexto(await arquivo.text());}catch{setErroArquivo('Não foi possível ler o arquivo.');}
 }
 async function importar(){
  const itens=leitura.itens;if(!itens||!fimValido)return;
  const lotes=dividirLotesImportacao(itens.map((item,indice)=>({item,indice})));
  const parcial:Resumo={total:itens.length,enviadas:0,criadas:0,existentes:0,recusadas:[]};
  setOcupado(true);setResumo(null);
  try{
   for(const [n,lote] of lotes.entries()){
    setProgresso(`Enviando lote ${n+1} de ${lotes.length}…`);
    const resultados=await cliente.importarConhecimentos({itens:lote.map(v=>v.item),vigenteDe:new Date().toISOString(),vigenteAte:fim.toISOString(),responsavelId:sessao.usuario.id});
    for(const r of resultados){const original=lote[r.indice];if(!original)continue;if(r.estado==='criado')parcial.criadas++;else if(r.estado==='existente')parcial.existentes++;else parcial.recusadas.push({numero:original.indice+1,pergunta:original.item.pergunta,motivo:explicarRecusaImportacao(r.codigo)});}
    parcial.enviadas+=lote.length;
   }
   setTexto('');avisar(parcial.criadas?`${contar(parcial.criadas,'fonte nova registrada como pendente','fontes novas registradas como pendentes')}. Revise e aprove cada uma antes de a Donatella usar.`:'Nenhuma fonte nova registrada.');
  }catch(e){falhar(e);}
  finally{setResumo({...parcial,recusadas:[...parcial.recusadas]});setProgresso('');setOcupado(false);await atualizar();}
 }
 return <details className="conhecimento-substituir"><summary>Importar várias fontes</summary>
  <p className="muted">Abra ou cole um JSON com uma lista de fontes: pergunta, resposta e categoria (procedimento, produto ou política). Todas entram pendentes, para revisão. Importar de novo não duplica fontes repetidas.</p>
  <label>Arquivo JSON<input className="field" type="file" accept="application/json,.json" disabled={ocupado} onChange={e=>void abrir(e.target.files?.[0])}/></label>
  {erroArquivo&&<p role="alert">{erroArquivo}</p>}
  <label>Conteúdo<textarea className="field" rows={6} value={texto} disabled={ocupado} placeholder='[{"pergunta": "…", "resposta": "…", "categoria": "procedimento"}]' onChange={e=>setTexto(e.target.value)}/></label>
  {leitura.erro&&<p role="alert">{leitura.erro}</p>}
  {leitura.itens&&<p className="muted">{leitura.itens.length} fontes prontas para importar.</p>}
  <label>Vigentes até<input className="field" type="datetime-local" value={vigenteAte} disabled={ocupado} onChange={e=>setVigenteAte(e.target.value)}/></label>
  <button className="btn primary" disabled={ocupado||!leitura.itens||!fimValido} onClick={()=>void importar()}>Importar como pendentes</button>
  {progresso&&<p role="status">{progresso}</p>}
  {resumo&&<div role="status"><p>{resumo.enviadas<resumo.total?`Importação interrompida: ${resumo.enviadas} de ${resumo.total} fontes enviadas. Importe de novo para completar; as já enviadas não duplicam.`:`Importação concluída: ${contar(resumo.criadas,'nova','novas')}, ${contar(resumo.existentes,'já existia','já existiam')} e ${contar(resumo.recusadas.length,'recusada','recusadas')}.`}</p>{resumo.recusadas.length>0&&<ul>{resumo.recusadas.map(r=><li key={r.numero}>Fonte {r.numero} ({r.pergunta}): {r.motivo}.</li>)}</ul>}</div>}
 </details>;
}
