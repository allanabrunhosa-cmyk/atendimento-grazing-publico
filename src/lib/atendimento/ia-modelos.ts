/** Como cada modelo da Anthropic é chamado. Usado no servidor e no painel, por isso
 * não importa nada do servidor.
 *
 * Os modelos 5.5 pensam antes de responder por padrão. A Donatella responde em até
 * 512 tokens, então o pensamento fica desligado: no Sonnet 5.5 isso é feito com
 * `between_tools` (ele recusa `disabled`), no Haiku 5.5 com `disabled`. Os dois
 * aceitam o esforço; o Sonnet 4.5 não. */
export type EsforcoIA = 'baixo'|'medio'|'alto';
export const ESFORCOS_IA: readonly EsforcoIA[] = ['baixo', 'medio', 'alto'];
export const NOME_ESFORCO: Readonly<Record<EsforcoIA, string>> = { baixo: 'Baixo', medio: 'Médio', alto: 'Alto' };
/** Até `high`: acima disso a API recusa o pensamento desligado. */
export const ESFORCO_API: Readonly<Record<EsforcoIA, 'low'|'medium'|'high'>> = { baixo: 'low', medio: 'medium', alto: 'high' };

type PerfilModeloAnthropic = { pensamento: { type: 'between_tools'|'disabled' }; esforcoPadrao: EsforcoIA };
export const PERFIS_MODELO_ANTHROPIC: Readonly<Record<string, PerfilModeloAnthropic>> = {
 'claude-sonnet-5-5': { pensamento: { type: 'between_tools' }, esforcoPadrao: 'alto' },
 'claude-haiku-5-5': { pensamento: { type: 'disabled' }, esforcoPadrao: 'medio' },
};
export function perfilModeloIA(provedor: string|undefined, modelo: string): PerfilModeloAnthropic|undefined {
 return (provedor ?? 'anthropic') === 'anthropic' && Object.prototype.hasOwnProperty.call(PERFIS_MODELO_ANTHROPIC, modelo) ? PERFIS_MODELO_ANTHROPIC[modelo] : undefined;
}
export const aceitaEsforcoIA = (provedor: string|undefined, modelo: string) => !!perfilModeloIA(provedor, modelo);

/** Modelos com a reserva por chamada revisada para ligar em produção: 64 KiB de
 * entrada e até 512 tokens de saída cabem em 50 centavos. O Sonnet 5.5 (US$ 2/10
 * por milhão) e o Haiku 5.5 (US$ 0,10/0,50) custam menos que o Sonnet 4.5
 * (US$ 3/15), mesmo contando uns 30% a mais de tokens para o mesmo texto. */
export const MODELOS_RESERVA_REVISADA: readonly string[] = ['claude-sonnet-4-5', 'claude-sonnet-4-5-20250929', 'claude-sonnet-5-5', 'claude-haiku-5-5'];

/** Preço da API em US$ por milhão de tokens (entrada, saída). Serve para devolver
 * ao limite diário a parte da reserva de 50 centavos que a chamada não gastou.
 * Modelo fora da tabela mantém a reserva inteira. */
export const PRECO_MODELOS_IA: Readonly<Record<string, { entradaUsd: number; saidaUsd: number }>> = {
 'claude-sonnet-4-5': { entradaUsd: 3, saidaUsd: 15 },
 'claude-sonnet-4-5-20250929': { entradaUsd: 3, saidaUsd: 15 },
 'claude-sonnet-5-5': { entradaUsd: 2, saidaUsd: 10 },
 'claude-haiku-5-5': { entradaUsd: 0.1, saidaUsd: 0.5 },
};
type ConsumoTokens = { observado: boolean; tokensEntrada?: number; tokensSaida?: number; tokensCacheLeitura?: number; tokensCacheGravacao?: number };
/** Gasto de uma chamada em centavos de dólar, com folga: toda entrada conta como
 * gravação de cache (1,25× o preço de entrada) e o total leva mais 25%, arredondado
 * para cima. `null` quando não há base para estimar: outro provedor, modelo sem
 * preço ou tokens não informados pela API. */
export function gastoEstimadoCentavos(provedor: string | undefined, modelo: string, consumo: ConsumoTokens): number | null {
 if ((provedor ?? 'anthropic') !== 'anthropic' || !Object.prototype.hasOwnProperty.call(PRECO_MODELOS_IA, modelo) || !consumo.observado) return null;
 const inteiro = (v: number | undefined) => v === undefined || Number.isSafeInteger(v) && v >= 0;
 if (!Number.isSafeInteger(consumo.tokensEntrada) || !Number.isSafeInteger(consumo.tokensSaida) || !inteiro(consumo.tokensCacheLeitura) || !inteiro(consumo.tokensCacheGravacao)) return null;
 const preco = PRECO_MODELOS_IA[modelo], entrada = consumo.tokensEntrada! + (consumo.tokensCacheLeitura ?? 0) + (consumo.tokensCacheGravacao ?? 0);
 const usd = (entrada * preco.entradaUsd * 1.25 + consumo.tokensSaida! * preco.saidaUsd) / 1e6;
 return Math.max(1, Math.ceil(usd * 100 * 1.25));
}
