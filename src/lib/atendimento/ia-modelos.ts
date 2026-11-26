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
