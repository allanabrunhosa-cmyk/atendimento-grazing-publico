import 'server-only';
import type {ServicoAgenteOperacional} from './operacao-agente';
import {validarConfiguracaoAgente,type ConfiguracaoAgente} from './repositorio-agente-pg';
import type {IdentidadeOperacao} from './operacao-tipos';
export function configuracaoAgenteParaCorte(c:ConfiguracaoAgente,p:{habilitar:boolean;modoServidor:string;autoridade:string;enviosHabilitados:boolean;iaAutomatica:boolean;comandoExpresso:boolean}):ConfiguracaoAgente{
 if(!p.comandoExpresso)throw Error('AGENTE_CORTE_NAO_AUTORIZADO');
 // Preparar o registro PG antecede a liberação do gate privado. Essa gravação
 // não autoriza o worker a inferir/enviar enquanto o gate permanecer false.
 if(p.habilitar&&(p.modoServidor!=='operacao'||p.autoridade!=='vps'||!p.enviosHabilitados))throw Error('AGENTE_AUTORIDADE_NAO_TRANSFERIDA');
 if(p.habilitar&&((c.provedor??'anthropic')!=='anthropic'||(c.moedaOrcamento??'USD')!=='USD'||!['claude-sonnet-4-5','claude-sonnet-4-5-20250929'].includes(c.modelo)||c.maxTokens>512))throw Error('AGENTE_RESERVA_MODELO_REQUER_REVISAO');
 // Preparação futura autorizada: reserva conservadora, em centavos USD, para
 // o payload textual de 64 KiB e saída de até 512 tokens. Não muda o teto
 // privado nem promete faturamento máximo (voz/plano exigem controle externo).
 const limites=p.habilitar?{...c.limites,maxChamadas:Math.min(c.limites.maxChamadas,3),custoPorChamadaCentavos:50,maxCustoCentavos:150}:c.limites;
 const nova={...c,limites,modo:p.habilitar?'automatico' as const:'desligado' as const,autoridadeAutomatica:p.habilitar};
 validarConfiguracaoAgente(nova);return nova;
}
/** Mantém teto/modelo e prepara reservas conservadoras. Não cria credenciais, não altera
 * webhook e não infere. Exige principal HUB autorizado pelo serviço real. */
export async function executarComandoAgenteCorte(s:ServicoAgenteOperacional,i:IdentidadeOperacao,p:Parameters<typeof configuracaoAgenteParaCorte>[1]&{idempotencia:string}){
 return s.configurarModoCorte(i,p);
}
