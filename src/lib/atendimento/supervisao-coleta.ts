import { avaliarContinuidade, type AmostraContinuidade } from './observabilidade';
import { setTimeout as pausar } from 'node:timers/promises';

export const POLITICA_RETENTATIVAS = Object.freeze({ intervaloMs: 30_000, falhasParaAbrir: 5, circuitoMs: 15 * 60_000, pulsacaoMs: 15_000 });
export type FalhaColetaSegura = { codigo: string; codigoTecnico: string | null; rpc: 'ler_lote' | 'snapshot' | 'confirmar' | null; http: number | null };
export type ControleRetentativas = { versao: 1; fase: 'aguardando' | 'circuito_aberto' | 'intervencao'; falhasConsecutivas: number; proximaTentativaEm: string | null; ultimaFalhaEm: string | null; motivo: string | null };
const data = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null;
const objeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const codigoSeguro = (v: unknown) => typeof v === 'string' && /^[A-Z_]{3,80}$/.test(v) ? v : null;

/** Nunca transporta mensagem privada, URL, cause, cabeçalhos ou payload de erro. */
export function resumirFalhaColeta(falha: unknown): FalhaColetaSegura {
  const erro = objeto(falha) ? falha : {};
  return { codigo: codigoSeguro(erro.message) ?? 'COLETA_INTERROMPIDA',
    codigoTecnico: typeof erro.code === 'string' && /^[A-Z0-9_]{2,32}$/.test(erro.code) ? erro.code : null,
    rpc: erro.rpc === 'ler_lote' || erro.rpc === 'snapshot' || erro.rpc === 'confirmar' ? erro.rpc : null,
    http: Number.isSafeInteger(erro.http) && Number(erro.http) >= 100 && Number(erro.http) <= 599 ? Number(erro.http) : null };
}
const exigeIntervencao = (falha: FalhaColetaSegura) =>
  [400,401,403,404,405,413].includes(falha.http ?? 0) ||
  ['COLETA_NAO_PREPARADA','BACKUP_DESTINO_AUSENTE','ESPACO_INSUFICIENTE','LOTE_INVALIDO','LOTE_MUITO_GRANDE',
    'RESPOSTA_ORIGEM_INVALIDA','CONFIRMACAO_INVALIDA','RETOMADA_DIVERGENTE','DIARIO_CONFIRMAR_DIVERGENTE',
    'ARQUIVOS_INCREMENTAIS_REQUEREM_PRESERVACAO','ARQUIVO_INDICE_DESTINO_DIVERGENTE',
    'METRICAS_COLETOR_INDISPONIVEIS','PULSACAO_COLETOR_INTERROMPIDA'].includes(falha.codigo);

/** A espera local é curta e pode ser interrompida por SIGTERM, mesmo com circuito aberto. */
export async function esperarIntervaloSupervisao(ms: number, signal: AbortSignal) {
  if (!Number.isSafeInteger(ms) || ms < 1 || ms > POLITICA_RETENTATIVAS.intervaloMs) throw Error('SUPERVISAO_INTERVALO_INVALIDO');
  try { await pausar(ms,undefined,{signal}); }
  catch (erro) { if (!signal.aborted || !(erro instanceof Error) || erro.name !== 'AbortError') throw erro; }
}

/** Estado persistido impede que um reinício transforme falhas em nova rajada. */
export function restaurarControleRetentativas(estado: Record<string, unknown>, agora: number): ControleRetentativas {
  if (!Number.isFinite(agora)) throw Error('SUPERVISAO_INSTANTE_INVALIDO');
  if (!objeto(estado)) throw Error('SUPERVISAO_ESTADO_INVALIDO');
  const salvo = estado.controleRetentativas;
  if (salvo !== undefined) {
    if (!objeto(salvo) || salvo.versao !== 1 || !['aguardando','circuito_aberto','intervencao'].includes(String(salvo.fase)) ||
      !Number.isSafeInteger(salvo.falhasConsecutivas) || Number(salvo.falhasConsecutivas) < 0 ||
      !(salvo.proximaTentativaEm === null || data(salvo.proximaTentativaEm) !== null) ||
      !(salvo.ultimaFalhaEm === null || data(salvo.ultimaFalhaEm) !== null) ||
      !(salvo.motivo === null || codigoSeguro(salvo.motivo)) ||
      (salvo.fase === 'intervencao') !== (salvo.proximaTentativaEm === null)) throw Error('SUPERVISAO_ESTADO_INVALIDO');
    return { ...salvo } as ControleRetentativas;
  }
  const falhas = Number.isSafeInteger(estado.falhasConsecutivas) && Number(estado.falhasConsecutivas) > 0 ? Number(estado.falhasConsecutivas) : 0;
  const motivo = codigoSeguro(estado.falha);
  // Estado antigo com falha entra em espera a partir deste início, nunca tenta imediatamente.
  if (falhas || motivo) return controleAposFalha({ versao: 1, fase: 'aguardando', falhasConsecutivas: Math.max(0,falhas - 1), proximaTentativaEm: new Date(agora).toISOString(), ultimaFalhaEm: null, motivo: null },
    resumirFalhaColeta({ message: motivo ?? 'COLETA_INTERROMPIDA', http: estado.http, code: estado.codigoTecnico }), agora);
  return { versao: 1, fase: 'aguardando', falhasConsecutivas: 0, proximaTentativaEm: new Date(agora).toISOString(), ultimaFalhaEm: null, motivo: null };
}
export function controleAposFalha(anterior: ControleRetentativas, falha: FalhaColetaSegura, agora: number): ControleRetentativas {
  const falhasConsecutivas = Math.min(Number.MAX_SAFE_INTEGER, anterior.falhasConsecutivas + 1);
  const intervencao = exigeIntervencao(falha), circuito = falhasConsecutivas >= POLITICA_RETENTATIVAS.falhasParaAbrir;
  const esperaMs = circuito ? POLITICA_RETENTATIVAS.circuitoMs : POLITICA_RETENTATIVAS.intervaloMs * 2 ** (falhasConsecutivas - 1);
  return { versao: 1, fase: intervencao ? 'intervencao' : circuito ? 'circuito_aberto' : 'aguardando', falhasConsecutivas,
    proximaTentativaEm: intervencao ? null : new Date(agora + esperaMs).toISOString(), ultimaFalhaEm: new Date(agora).toISOString(), motivo: falha.codigo };
}

/** Executa uma única sonda ao vencer a espera; não acumula chamadas vencidas. */
export function criarSupervisorRetentativas(estado: Record<string, unknown>, relogio: () => number = Date.now, antesDeExecutar?: (controle: ControleRetentativas) => Promise<void>) {
  let controle = restaurarControleRetentativas(estado,relogio()), executando = false;
  return {
    estado: () => ({ ...controle }),
    interromper(falha: unknown) { controle = controleAposFalha(controle,resumirFalhaColeta(falha),relogio()); return { ...controle }; },
    async tentar<T>(executar: () => Promise<T>) {
      const agora = relogio();
      if (executando || controle.proximaTentativaEm === null || agora < Date.parse(controle.proximaTentativaEm)) return { tipo: 'aguardando' as const, controle: { ...controle } };
      executando = true;
      try {
        // Reserva a próxima janela antes de qualquer rede. Queda durante uma sonda
        // não libera outra sonda imediata ao reiniciar o processo.
        controle = { ...controle, proximaTentativaEm: new Date(agora + (controle.fase === 'circuito_aberto' ? POLITICA_RETENTATIVAS.circuitoMs : POLITICA_RETENTATIVAS.intervaloMs)).toISOString() };
        await antesDeExecutar?.({ ...controle });
        const resultado = await executar();
        controle = { versao: 1, fase: 'aguardando', falhasConsecutivas: 0, proximaTentativaEm: new Date(relogio() + POLITICA_RETENTATIVAS.intervaloMs).toISOString(), ultimaFalhaEm: controle.ultimaFalhaEm, motivo: null };
        return { tipo: 'sucesso' as const, resultado, controle: { ...controle } };
      } catch (erro) {
        const falha = resumirFalhaColeta(erro);
        controle = controleAposFalha(controle,falha,relogio());
        return { tipo: 'falha' as const, falha, controle: { ...controle } };
      } finally { executando = false; }
    },
  };
}

/** Pulsação recente prova atividade do processo; jamais prova sincronização. */
export function avaliarSaudeColetor(estado: AmostraContinuidade & { controleRetentativas?: unknown }, pulsacao: unknown, agora: number, pidAtivo: (pid: number) => boolean) {
  const pulso = objeto(pulsacao) ? pulsacao : {}, instante = data(pulso.atualizadoEm);
  const pulsacaoRecente = instante !== null && instante <= agora && agora - instante <= POLITICA_RETENTATIVAS.pulsacaoMs * 3;
  const processoAtivo = pulsacaoRecente && pulso.fase === 'ativo' && Number.isSafeInteger(pulso.pid) && Number(pulso.pid) > 0 && pidAtivo(Number(pulso.pid));
  const continuidade = avaliarContinuidade(estado,agora), controle = objeto(estado.controleRetentativas) ? estado.controleRetentativas : null;
  const fase = controle?.versao === 1 && ['aguardando','circuito_aberto','intervencao'].includes(String(controle.fase)) ? String(controle.fase) : 'nao_informado';
  return { processoAtivo, pulsacaoRecente, coletaSaudavel: processoAtivo && continuidade.coletaSaudavel && fase === 'aguardando',
    atrasoColetaSegundos: continuidade.atrasoColetaSegundos, controle: fase };
}
