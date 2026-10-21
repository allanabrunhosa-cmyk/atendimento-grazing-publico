/** Somente metadados. Não recebe payloads, identidades, credenciais ou consultas SQL. */
export type AmostraContinuidade = {
  atualizadoEm?: unknown;
  ultimaColetaBemSucedida?: unknown;
  ultimaConsultaOrigem?: unknown;
  falha?: unknown;
  pendenciasObservadas?: unknown;
  pendenciasExatas?: unknown;
};
const instante=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))?Date.parse(v):null;
export function avaliarContinuidade(amostra:AmostraContinuidade,agora:number,limiteAtualidadeSegundos=120){
  if(!Number.isFinite(agora)||!Number.isSafeInteger(limiteAtualidadeSegundos)||limiteAtualidadeSegundos<1)throw Error('METRICA_ARGUMENTO_INVALIDO');
  const coleta=instante(amostra.ultimaColetaBemSucedida),leitura=instante(amostra.ultimaConsultaOrigem);
  const idade=(v:number|null)=>v===null||v>agora?null:Math.floor((agora-v)/1000);
  const atrasoColetaSegundos=idade(coleta),idadeLeituraFilaSegundos=idade(leitura);
  const falhou=typeof amostra.falha==='string'&&amostra.falha.length>0;
  const leituraFilaAtual=idadeLeituraFilaSegundos!==null&&idadeLeituraFilaSegundos<=limiteAtualidadeSegundos&&!falhou;
  const quantidade=Number.isSafeInteger(amostra.pendenciasObservadas)&&Number(amostra.pendenciasObservadas)>=0?Number(amostra.pendenciasObservadas):null;
  return {
    coletaSaudavel:atrasoColetaSegundos!==null&&atrasoColetaSegundos<=limiteAtualidadeSegundos&&!falhou,
    atrasoColetaSegundos,idadeLeituraFilaSegundos,leituraFilaAtual,
    fila:{quantidade,observadaEm:leitura===null?null:new Date(leitura).toISOString(),
      atual:leituraFilaAtual,exataNaLeitura:quantidade!==null&&amostra.pendenciasExatas===true,
      exataAgora:leituraFilaAtual&&quantidade!==null&&amostra.pendenciasExatas===true},
    // A primeira observação de pendência não é a data do evento mais antigo.
    idadeEventoMaisAntigoSegundos:null,
  };
}
export type AmostraTaxas={escopo:string;instante:string;transacoesRegistradas:string;transacoesConfirmadas:string;armazenamentoBytes:string};
const inteiro=(v:string)=>/^(0|[1-9]\d{0,19})$/.test(v)?BigInt(v):null;
/** As duas amostras devem ser da mesma origem/execução, com contadores cumulativos reais. */
export function compararAmostrasContinuidade(anterior:AmostraTaxas,atual:AmostraTaxas){
  if(!/^[a-zA-Z0-9_-]{1,80}$/.test(anterior.escopo)||anterior.escopo!==atual.escopo)return {comparavel:false as const,motivo:'ESCOPO_INVALIDO_OU_DIFERENTE'};
  const inicio=instante(anterior.instante),fim=instante(atual.instante);
  if(inicio===null||fim===null||fim<=inicio)return {comparavel:false as const,motivo:'INTERVALO_INVALIDO'};
  const segundos=(fim-inicio)/1000;
  const comparar=(a:string,b:string,aceitarReducao=false)=>{
    const av=inteiro(a),bv=inteiro(b);
    if(av===null||bv===null||(!aceitarReducao&&bv<av))return null;
    const delta=bv-av;
    return {delta:String(delta),porSegundoAproximado:Number(delta)/segundos};
  };
  const chegada=comparar(anterior.transacoesRegistradas,atual.transacoesRegistradas);
  const processamento=comparar(anterior.transacoesConfirmadas,atual.transacoesConfirmadas);
  const armazenamento=comparar(anterior.armazenamentoBytes,atual.armazenamentoBytes,true);
  if(!chegada||!processamento||!armazenamento)return {comparavel:false as const,motivo:'CONTADOR_INVALIDO_OU_REINICIADO'};
  return {comparavel:true as const,intervaloSegundos:segundos,chegada,processamento,armazenamento};
}
