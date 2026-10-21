/** Contrato de prontidão da operação futura. Não executa backup nem trata preparação como recuperação. */
export const COBERTURA_BACKUP_OPERACAO = [
  'conversas_mensagens', 'filas_e_idempotencia_envio', 'webhooks', 'casos_respostas_apoio',
  'candidatos_versoes_conhecimento', 'auditoria', 'identidades_permissoes',
  'anexos_destino_bytes', 'configuracoes_cifradas', 'custodia_recuperavel', 'entrada_duravel_separada',
] as const;
type Cobertura = typeof COBERTURA_BACKUP_OPERACAO[number];
export type EvidenciaBackupOperacao = {
  proveniencia: 'operacao_real' | 'laboratorio_ficticio';
  banco: string;
  bancoEntrada: string;
  recuperacaoBancoEntradaComprovada: boolean;
  cobertura: readonly Cobertura[];
  backupExternoEm: string | null;
  recuperacaoRealEm: string | null;
  recuperacaoSomenteR2: boolean;
  ambienteRecuperacaoIsolado: boolean;
  duracaoRecuperacaoSegundos: number | null;
  rpoMetaSegundos: number;
  rtoMetaSegundos: number;
  protecaoConferidaEm: string | null;
  retencaoMinimaDias: number;
  credencialExpiraEm: string | null;
  alertaExternoConfigurado: boolean;
};
const instante=(valor:string|null)=>valor!==null&&Number.isFinite(Date.parse(valor))?Date.parse(valor):null;
export function avaliarProntidaoBackupOperacao(e:EvidenciaBackupOperacao,agora:number){
  if(!Number.isFinite(agora)||!Number.isSafeInteger(e.rpoMetaSegundos)||e.rpoMetaSegundos<1||!Number.isSafeInteger(e.rtoMetaSegundos)||e.rtoMetaSegundos<1)throw Error('BACKUP_META_INVALIDA');
  const faltas:string[]=[];
  if(e.proveniencia!=='operacao_real')faltas.push('PROVA_REAL_AUSENTE');
  if(e.banco!=='donatella_operacao')faltas.push('BANCO_OPERACAO_NAO_COBERTO');
  if(e.bancoEntrada!=='donatella_entrada')faltas.push('BANCO_ENTRADA_NAO_COBERTO');
  if(!e.recuperacaoBancoEntradaComprovada)faltas.push('RECUPERACAO_ENTRADA_NAO_COMPROVADA');
  const ausentes=COBERTURA_BACKUP_OPERACAO.filter(nome=>!e.cobertura.includes(nome));
  if(ausentes.length)faltas.push('COBERTURA_INCOMPLETA');
  const backup=instante(e.backupExternoEm),recuperacao=instante(e.recuperacaoRealEm),protecao=instante(e.protecaoConferidaEm),expira=instante(e.credencialExpiraEm);
  const idadeCopiaSegundos=backup===null||backup>agora?null:Math.floor((agora-backup)/1000);
  if(idadeCopiaSegundos===null)faltas.push('COPIA_EXTERNA_NAO_COMPROVADA');
  else if(idadeCopiaSegundos>e.rpoMetaSegundos)faltas.push('RPO_EXCEDIDO');
  if(recuperacao===null||recuperacao>agora||backup===null||recuperacao<backup||!e.recuperacaoSomenteR2||!e.ambienteRecuperacaoIsolado)faltas.push('RECUPERACAO_REAL_NAO_COMPROVADA');
  if(e.duracaoRecuperacaoSegundos===null||!Number.isFinite(e.duracaoRecuperacaoSegundos)||e.duracaoRecuperacaoSegundos<0)faltas.push('RTO_NAO_MEDIDO');
  else if(e.duracaoRecuperacaoSegundos>e.rtoMetaSegundos)faltas.push('RTO_EXCEDIDO');
  if(protecao===null||protecao>agora||e.retencaoMinimaDias<90)faltas.push('PROTECAO_NAO_COMPROVADA');
  if(expira===null)faltas.push('EXPIRACAO_CREDENCIAL_NAO_CONFERIDA');
  else if(expira<=agora)faltas.push('CREDENCIAL_EXPIRADA');
  else if(expira-agora<=7*86400*1000)faltas.push('RENOVACAO_CREDENCIAL_PROXIMA');
  if(!e.alertaExternoConfigurado)faltas.push('ALERTA_EXTERNO_AUSENTE');
  return {pronto:faltas.length===0,viradaBloqueada:faltas.length>0,faltas,coberturaAusente:ausentes,
    idadeCopiaSegundos,rpoMetaSegundos:e.rpoMetaSegundos,rtoMetaSegundos:e.rtoMetaSegundos,
    duracaoRecuperacaoSegundos:e.duracaoRecuperacaoSegundos};
}
