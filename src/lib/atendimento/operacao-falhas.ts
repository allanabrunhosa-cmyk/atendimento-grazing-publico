const motivos:Record<string,string>={
 ENVIO_DESABILITADO:'O envio de mensagens está desativado na configuração do serviço.',
 OPERACAO_JANELA_FECHADA:'A janela de 24 horas terminou. Use um template aprovado.',
 OPERACAO_CITACAO_INDISPONIVEL:'A mensagem citada não tem uma referência válida no WhatsApp.',
 ENVIO_CONTEXTO_ALTERADO:'As condições do atendimento impediram o envio. Confira o responsável, as permissões e a janela de 24 horas.',
 CONTEXTO_ALTERADO:'O envio foi cancelado porque o atendimento mudou.',
 CONTEXTO_OU_ACESSO_REVOGADO:'O envio foi interrompido porque o atendimento mudou ou a permissão de envio foi revogada.',
 ACESSO_REVOGADO:'A permissão de envio foi revogada.',
 MODELO_NAO_APROVADO:'O template não está aprovado para envio.',
 MODELO_CONTRATO_ALTERADO:'O template mudou depois do preenchimento. Abra a versão atual.',
 MODELO_PARAMETROS_INCOMPATIVEIS:'As variáveis não correspondem ao template ou ultrapassam seu limite.',
 META_UPLOAD_RECUSADO:'A Meta recusou o arquivo anexado.',
 META_ENVIO_RECUSADO:'A Meta recusou o envio sem registrar uma causa detalhada.',
 META_MIDIA_OU_MODELO_INDISPONIVEL:'O arquivo ou o template não estava disponível no momento do envio.',
};
const causasMeta:Record<string,string>={
 '190':'A credencial da Meta expirou ou ficou inválida.',
 '131026':'O WhatsApp não conseguiu entregar a mensagem. A Meta não informou a causa específica.',
 '131042':'A Meta identificou um problema no pagamento da conta comercial.',
 '131047':'A janela de 24 horas terminou. Use um template aprovado.',
 '131053':'O WhatsApp não conseguiu carregar o arquivo. Confira o formato e o tamanho.',
 '131049':'A Meta bloqueou a entrega desta mensagem de marketing.',
 '132000':'A quantidade de variáveis não corresponde ao template.',
 '132001':'O template não existe nesse idioma ou não está aprovado.',
 '132005':'O conteúdo preenchido ultrapassa o limite do template.',
 '132012':'O formato das variáveis não corresponde ao template.',
};
/** Não expõe payloads, destinatários, tokens ou texto livre de provedores. */
export function motivoFalhaOperacao(codigo:unknown,incerto=false):string {
 if(incerto)return 'Não houve confirmação do envio. Confira o histórico antes de tentar novamente para evitar duplicidade.';
 if(typeof codigo!=='string'||!/^[A-Z0-9_]{1,100}$/.test(codigo))return 'A mensagem não foi enviada. A causa não foi registrada pelo sistema.';
 const meta=codigo.match(/^META_(?:(?:CODIGO|STATUS|\d{3})_)?(\d{1,10})$/)?.[1];
 if(meta)return (causasMeta[meta]??'A Meta recusou a mensagem sem uma causa detalhada disponível.')+' Código Meta: '+meta+'.';
 return motivos[codigo]??'A mensagem não foi enviada. Causa registrada: '+codigo+'.';
}
export function codigoFalhaMetaOperacao(d:unknown):string {
 const erro=d&&typeof d==='object'&&!Array.isArray(d)?(d as Record<string,unknown>).error:null;
 const code=erro&&typeof erro==='object'&&!Array.isArray(erro)?(erro as Record<string,unknown>).code:null;
 return Number.isSafeInteger(code)&&Number(code)>0?'META_CODIGO_'+code:'META_ENVIO_RECUSADO';
}
