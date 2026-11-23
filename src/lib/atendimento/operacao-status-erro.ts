/** Códigos com status fixo. Os demais seguem a regra por trecho do código. */
export const STATUS_ERROS_AGENTE:Record<string,number>={AGENTE_USE_CONTROLE_LIGAR_PAUSAR:409,AGENTE_NAO_PRONTO_PARA_LIGAR:409,AGENTE_CONFIGURACAO_NAO_AUTORIZADA:400,AGENTE_ORCAMENTO_NAO_AUTORIZADO:409,AGENTE_TESTE_CONSUMO_NAO_AUTORIZADO:409,AGENTE_TESTE_ORCAMENTO_ESGOTADO:409,AGENTE_TESTE_JA_RESERVADO:409,AGENTE_PERFIL_ESTILO_EXCESSIVO:400,AGENTE_ENTREGA_DADOS_PESSOAIS:400,CONHECIMENTO_DADOS_PESSOAIS:400,CONHECIMENTO_CONFIRMACAO_TRIVIAL:400};

/** Status HTTP de um erro das rotas da operação. O painel trata 503 em escrita
 * como resultado incerto, então erro de validação precisa sair como 4xx. */
export function statusErroOperacao(codigo:string){
 return STATUS_ERROS_AGENTE[codigo]??(codigo.includes('ACESSO')||codigo.includes('RECUSAD')||codigo.includes('SOMENTE_LEITURA')?403:codigo.includes('AUSENTE')?404:codigo.includes('CONFLITO')||codigo.includes('ALTERADO')||codigo.includes('IDEMPOTENCIA')||codigo==='OPERACAO_ASSUMIR_OBRIGATORIO'?409:codigo.includes('GRANDE')?413:codigo.includes('INVALID')||codigo.includes('JANELA')||codigo==='OPERACAO_MODELO_NAO_APROVADO'||codigo==='OPERACAO_CITACAO_INDISPONIVEL'?400:503);
}
