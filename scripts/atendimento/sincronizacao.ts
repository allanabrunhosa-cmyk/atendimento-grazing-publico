// Estado técnico de retomada: nenhuma chave de registro/cursor/payload aqui.
export const ALVOS = [
  "auth.users", "storage.buckets", "storage.objects",
  ...["appointments","automation_executions","automation_logs","automation_rules","automation_scheduled","contact_cooldowns","contacts","conversation_activities","conversation_states","conversations","deal_activities","deals","message_grouping_queue","message_processing_queue","messages","nina_processing_queue","nina_settings","notifications","orders","pipeline_stages","product_catalog_audit","profiles","send_queue","support_cases","system_settings","tag_definitions","team_business_hours","team_functions","team_holidays","team_members","teams","user_roles","webhook_events","whatsapp_templates"].map(t=>`public.${t}`),
] as const;
type Pagina = { documento:string; registros:number; fim:boolean };
type Lote = { transacoes:number; eventos:number; confirmadas:number };
export type EstadoSincronizacao = { versao:1; execucao:string; tabelas:Record<string,{ documento:string|null; registros:number; paginas:number; fim:boolean }> };
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function conferirEstado(estado:EstadoSincronizacao,execucao:string) {
  if (!uuid.test(execucao) || estado.versao!==1 || estado.execucao!==execucao || !estado.tabelas || Array.isArray(estado.tabelas) || Object.keys(estado.tabelas).length!==ALVOS.length) throw new Error("RETOMADA_INVALIDA");
  for (const alvo of ALVOS) {
    const p=estado.tabelas[alvo];
    if (!p || (p.documento!==null && !uuid.test(p.documento)) || !Number.isSafeInteger(p.registros) || p.registros<0 || !Number.isSafeInteger(p.paginas) || p.paginas<0 || typeof p.fim!=="boolean" || (p.documento===null && (p.fim || p.paginas || p.registros)) || (p.documento!==null && !p.paginas)) throw new Error("RETOMADA_INVALIDA");
  }
}
export function estadoInicial(execucao:string):EstadoSincronizacao {
  const estado:EstadoSincronizacao={versao:1,execucao,tabelas:Object.fromEntries(ALVOS.map(t=>[t,{documento:null,registros:0,paginas:0,fim:false}]))};
  conferirEstado(estado,execucao);return estado;
}
export async function sincronizar(estado:EstadoSincronizacao, maxPaginas:number, deps:{
  pagina:(alvo:string, anterior:string|null)=>Promise<Pagina>;
  lote:()=>Promise<Lote>;
  salvar:(estado:EstadoSincronizacao)=>Promise<void>;
  progresso:(alvo:string,pagina:Pagina)=>void;
}) {
  conferirEstado(estado,estado.execucao);
  if (!Number.isInteger(maxPaginas) || maxPaginas<1 || maxPaginas>500) throw new Error("LIMITE_INVALIDO");
  let paginas=0,transacoes=0,eventos=0;
  const incremental=async()=>{ const lote=await deps.lote();transacoes+=lote.transacoes;eventos+=lote.eventos; };
  await incremental(); // Inclusive em retomada de snapshot já concluído.
  for (const alvo of ALVOS) {
    while (!estado.tabelas[alvo].fim && paginas<maxPaginas) {
      const anterior=estado.tabelas[alvo];
      const pagina=await deps.pagina(alvo,anterior.documento);
      if (!uuid.test(pagina.documento) || pagina.documento===anterior.documento || !Number.isInteger(pagina.registros) || pagina.registros<0 || pagina.registros>500 || typeof pagina.fim!=="boolean" || (!pagina.fim && pagina.registros===0)) throw new Error("PAGINA_INVALIDA");
      // O adaptador só retorna após arquivo cifrado sincronizado e commit do destino.
      estado.tabelas[alvo]={documento:pagina.documento,registros:anterior.registros+pagina.registros,paginas:anterior.paginas+1,fim:pagina.fim};
      await deps.salvar(estado);paginas++;deps.progresso(alvo,pagina);
      await incremental(); // Falha interrompe imediatamente, sem avançar outra página.
    }
    if (paginas>=maxPaginas) break;
  }
  return { paginas,transacoes,eventos,tabelasConcluidas:ALVOS.filter(t=>estado.tabelas[t].fim).length,snapshotCompleto:ALVOS.every(t=>estado.tabelas[t].fim) };
}
