import 'server-only';
import type {PoolClient} from 'pg';
import type {ConfiguracaoPrivadaAgente} from './operacao-agente';
import type {ConfiguracaoAgente,ConfiguracaoSkillsAgente,TomAgente} from './repositorio-agente-pg';
import {hashConfiguracaoAgente,invalidarConfiguracaoAgenteTx,validarConfiguracaoAgente,perfilEstiloAgente,skillPermiteAgente,temaPergunta} from './repositorio-agente-pg';
import {hashOperacao,type RepositorioOperacaoPg} from './operacao-repositorio-pg';
import type {IdentidadeOperacao} from './operacao-tipos';
import {objetoOperacao,validarIdOperacao,validarTextoOperacao,validarVersaoOperacao} from './operacao-tipos';
import {orquestrarIA,type FonteIA,type TarefaIA,type DecisaoIA,type RepositorioIA} from './ia-orquestrador';
import {criarProvedorEvidenciasDireto} from './ia-orquestrador-direto';
import type {ObservacaoConsumoIA} from './ia-direta';
import {conferirHorarioAgente,type HorariosAgente} from './operacao-horarios';
import {AVISO_ENSAIO_DONATELLA,fontesFerramentaEnsaio,fontesConhecimentoEnsaio} from './operacao-agente-ensaio';

type DependenciasPainel={operacao:RepositorioOperacaoPg;privada:ConfiguracaoPrivadaAgente;autorizada:(c:ConfiguracaoAgente)=>boolean};
export type ResultadoTesteDonatella={estado:'concluido'|'apoio'|'falha'|'incerto';texto:string;motivo?:string;fontes:{id:string;versao:number}[];provedor:string;modelo:string;versao:number;enviosReais:false;reservaCentavos:number;consumo?:ObservacaoConsumoIA['consumo']};
export type PedidoSalvarAgente={conteudo:ConfiguracaoAgente;versao:number;idempotencia:string};
export type PedidoControleAgente={acao:'ligar'|'pausar';versao:number;idempotencia:string};
export type PedidoReconciliacaoAgente={tipo:'salvar';pedido:PedidoSalvarAgente}|{tipo:'controle';pedido:PedidoControleAgente};
export type ResultadoReconciliacaoAgente={estado:'confirmada'|'nao_registrada';versao:number|null};
const testeAutorizado=(p:ConfiguracaoPrivadaAgente)=>p.testesAutorizados===true&&p.creditoApiConfirmado===true&&Number.isSafeInteger(p.orcamentoTestesTotalCentavos)&&p.orcamentoTestesTotalCentavos!>0;
const amanhaUTC=()=>{const d=new Date();d.setUTCHours(24,0,0,0);return d.toISOString();};

/** Reserva é teto conservador, não fatura. Mantém também o consumo histórico;
 * uma chamada incerta nunca libera verba nem é repetida automaticamente. */
export async function consumoPainelTx(tx:PoolClient,empresaId:string){
 const r=await tx.query<{dia:string;total:string;testes:string}>(`SELECT
  coalesce((SELECT reservado_centavos FROM atendimento_operacao.agente_orcamento WHERE empresa_id=$1 AND dia=(now() AT TIME ZONE 'UTC')::date),0)::text dia,
  coalesce((SELECT sum(reservado_centavos) FROM atendimento_operacao.agente_orcamento WHERE empresa_id=$1),0)::text total,
  coalesce((SELECT sum(reserva_centavos) FROM atendimento_operacao.agente_teste WHERE empresa_id=$1),0)::text testes`,[empresaId]);
 const v=r.rows[0];return {dia:Number(v?.dia??0),historico:Number(v?.total??0),testes:Number(v?.testes??0)};
}
export function pendenciasPainel(c:ConfiguracaoAgente,p:ConfiguracaoPrivadaAgente,autorizada:boolean){
 const r:string[]=[];
 if(p.painelHabilitado!==true||p.inferenciaHabilitada!==true||!p.autoridadeAutomatica)r.push('Capacidade de operação pelo painel não preparada no servidor.');
 if(!autorizada||!c.modelo||c.custoCentavosDia<1||c.limites.custoPorChamadaCentavos<1||c.limites.maxCustoCentavos<c.limites.custoPorChamadaCentavos)r.push('Modelo, credencial ou reserva de consumo incompatível com o limite autorizado.');
 const cap=p.capacidadesProvedores?.find(v=>v.id===(c.provedor??'anthropic'))?.modelos.find(v=>v.id===c.modelo);
 if(!cap?.disponivel||!cap.testado)r.push('Modelo sem prova de resposta disponível para esta configuração.');
 if(p.consumoOperacaoAutorizado!==true)r.push('Autorização de consumo da API para operação não confirmada.');
 if(p.creditoApiConfirmado!==true)r.push('Crédito ou faturamento disponível da API não confirmado.');
 return r;
}
async function horarioPainelTx(tx:PoolClient){
 const horarios=(await tx.query<{chave:string;conteudo:{horarios?:HorariosAgente}}>("SELECT chave,conteudo FROM atendimento_operacao.configuracao WHERE chave IN ('agente_legado','atendimento')")).rows;
 const legado=horarios.find(v=>v.chave==='agente_legado')?.conteudo.horarios,web=horarios.find(v=>v.chave==='atendimento')?.conteudo.horarios;
 const horario=legado?{...legado,inicio:web?.inicio??legado.inicio,fim:web?.fim??legado.fim,dias:web?.dias??legado.dias}:null;
 let valido=false;try{valido=!!horario&&conferirHorarioAgente(horario,null).valido===true;}catch{/* Configuração incompleta impede ativação. */}
 return {horario:horario?{inicio:horario.inicio,fim:horario.fim,dias:horario.dias,timezone:horario.timezone,respostaForaHorario:horario.respostaForaHorario}:null,valido};
}
export async function estadoPainel(d:DependenciasPainel,c:ConfiguracaoAgente){
 return d.operacao.transacao(async tx=>{
  const controle=(await tx.query<{ativada_em:Date|null}>('SELECT ativada_em FROM atendimento_operacao.agente_controle WHERE empresa_id=$1',[d.privada.empresaId])).rows[0];
  const {horario,valido}=await horarioPainelTx(tx);
  const n=await consumoPainelTx(tx,d.privada.empresaId),pendencias=pendenciasPainel(c,d.privada,d.autorizada(c));
  if(!valido)pendencias.push('Horário de atendimento ausente ou inválido.');
  if(c.modo==='automatico'&&!c.autoridadeAutomatica)pendencias.push('Modo automático salvo sem autorização de envio da agente.');
  if(c.modo==='automatico'&&!controle?.ativada_em)pendencias.push('Marco de ativação não registrado. O atendimento automático permanece bloqueado.');
  const testesPendentes:string[]=[];
  if(!testeAutorizado(d.privada))testesPendentes.push('Teste pago requer autorização e crédito da API confirmados.');
  if(!d.autorizada({...c,modo:'rascunho',autoridadeAutomatica:false}))testesPendentes.push('Modelo ou credencial indisponível.');
  const reservado=n.testes+(d.privada.reservaHistoricaTestesCentavos??0),limite=d.privada.orcamentoTestesTotalCentavos??0;
  if(reservado+c.limites.custoPorChamadaCentavos>limite)testesPendentes.push('Orçamento total de testes insuficiente. As reservas anteriores foram preservadas.');
  const estadoEfetivo=c.modo!=='automatico'?'desligada' as const:pendencias.length?'bloqueada' as const:'ligada' as const;
  return {idioma:'pt-BR',fusoHorario:horario?.timezone??'America/Sao_Paulo',horario,estadoEfetivo,enviosHumanosHabilitados:d.privada.enviosHumanosHabilitados===true,prontoParaLigar:pendencias.length===0,pendencias,controle:{habilitada:c.modo==='automatico'&&c.autoridadeAutomatica,ativadaEm:controle?.ativada_em?.toISOString()??null},consumo:{moeda:'USD' as const,reservaDiaCentavos:n.dia,totalReservadoCentavos:n.historico,limiteDiaCentavos:c.custoCentavosDia,reiniciaDiaEm:amanhaUTC(),cobrancaConciliada:false as const},teste:{disponivel:!testesPendentes.length,pendencias:testesPendentes,limiteTotalCentavos:limite,reservadoCentavos:reservado}};
 });
}
/** Consulta o recibo exato, sem repetir o comando. A trava compartilhada com a
 * gravação aguarda seu commit/rollback antes de concluir que não há registro.
 * Pedidos de outros autores ou com outro hash têm a mesma resposta de ausência. */
export async function reconciliarAgente(operacao:RepositorioOperacaoPg,i:IdentidadeOperacao,p:PedidoReconciliacaoAgente):Promise<ResultadoReconciliacaoAgente>{
 if(!objetoOperacao(p)||Object.keys(p).some(k=>!['tipo','pedido'].includes(k))||!['salvar','controle'].includes(p.tipo)||!objetoOperacao(p.pedido))throw Error('AGENTE_RECONCILIACAO_INVALIDA');
 const pedido=p.pedido;
 validarIdOperacao(pedido.idempotencia);validarVersaoOperacao(pedido.versao);
 if(p.tipo==='salvar'){
  if(Object.keys(pedido).some(k=>!['conteudo','versao','idempotencia'].includes(k)))throw Error('AGENTE_RECONCILIACAO_INVALIDA');
  validarConfiguracaoAgente(p.pedido.conteudo);
 }else if(Object.keys(pedido).some(k=>!['acao','versao','idempotencia'].includes(k))||!['ligar','pausar'].includes(p.pedido.acao))throw Error('AGENTE_RECONCILIACAO_INVALIDA');
 if(i.tipo!==undefined&&i.tipo!=='usuario')throw Error('OPERACAO_ACESSO_NEGADO');
 const conteudo=p.tipo==='salvar'?p.pedido:['agente_controle',p.pedido],hash=hashOperacao([i.id,conteudo]);
 return operacao.transacao(async tx=>{
  await operacao.exigir(tx,i,'ia.editar');
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['comando:'+pedido.idempotencia]);
  await operacao.exigir(tx,i,'ia.editar');
  const r=await tx.query<{resultado:{versao?:unknown}}>('SELECT resultado FROM atendimento_operacao.comando WHERE id=$1 AND autor_id=$2 AND hash=$3',[pedido.idempotencia,i.id,hash]);
  const versao=r.rows[0]?.resultado?.versao;
  return r.rowCount===1&&Number.isSafeInteger(versao)&&Number(versao)>0?{estado:'confirmada',versao:Number(versao)}:{estado:'nao_registrada',versao:null};
 });
}
export async function controlarAgente(d:DependenciasPainel,i:IdentidadeOperacao,p:{acao:'ligar'|'pausar';versao:number;idempotencia:string}){
 validarVersaoOperacao(p.versao);validarIdOperacao(p.idempotencia);
 if(!['ligar','pausar'].includes(p.acao))throw Error('AGENTE_CONTROLE_INVALIDO');
 if(i.tipo!==undefined&&i.tipo!=='usuario')throw Error('OPERACAO_ACESSO_NEGADO');
 return d.operacao.transacao(async tx=>{
  await d.operacao.exigir(tx,i,'ia.editar');
  return d.operacao.comando(tx,i,p.idempotencia,['agente_controle',p],async()=>{
   const atual=(await tx.query<{conteudo:ConfiguracaoAgente;versao:string}>("SELECT conteudo,versao FROM atendimento_operacao.configuracao WHERE chave='agente' FOR UPDATE")).rows[0];
   if(!atual||Number(atual.versao)!==p.versao)throw Error('OPERACAO_CONFLITO');
   const ligar=p.acao==='ligar',conteudo={...atual.conteudo,modo:ligar?'automatico' as const:'desligado' as const,autoridadeAutomatica:ligar};
   validarConfiguracaoAgente(conteudo);
   if(ligar&&(pendenciasPainel(conteudo,d.privada,d.autorizada(conteudo)).length||!(await horarioPainelTx(tx)).valido))throw Error('AGENTE_NAO_PRONTO_PARA_LIGAR');
   const versao=p.versao+1;
   await tx.query("UPDATE atendimento_operacao.configuracao SET conteudo=$1::jsonb,versao=versao+1,atualizada_em=now() WHERE chave='agente'",[JSON.stringify(conteudo)]);
   const marca=(await tx.query<{ativada_em:Date|null}>(`INSERT INTO atendimento_operacao.agente_controle(empresa_id,ativada_em,autor_id,configuracao_versao) VALUES($1,CASE WHEN $2 THEN clock_timestamp() ELSE NULL END,$3,$4) ON CONFLICT(empresa_id) DO UPDATE SET ativada_em=excluded.ativada_em,alterada_em=clock_timestamp(),autor_id=excluded.autor_id,configuracao_versao=excluded.configuracao_versao RETURNING ativada_em`,[d.privada.empresaId,ligar,i.id,versao])).rows[0];
   const invalidadas=await invalidarConfiguracaoAgenteTx(tx,d.privada.empresaId);
   await d.operacao.auditar(tx,i,'agente',ligar?'ligar_donatella':'pausar_donatella',versao);
   return {versao,modo:conteudo.modo,autoridadeAutomatica:ligar,ativadaEm:marca?.ativada_em?.toISOString()??null,...invalidadas};
  });
 });
}

/** Usa a mesma política e o mesmo adaptador da operação, com contexto novo em
 * memória. Nunca cria contato, tarefa operacional, intenção ou mensagem Meta. */
export async function testarAgente(d:DependenciasPainel&{configuracao:()=>Promise<{configuracao:ConfiguracaoAgente;versao:number;tom:TomAgente;skills:ConfiguracaoSkillsAgente}>;chave:(c:ConfiguracaoAgente)=>string;transporte:typeof fetch},i:IdentidadeOperacao,p:{pergunta:string;versao:number;idempotencia:string}):Promise<ResultadoTesteDonatella>{
 validarVersaoOperacao(p.versao);validarIdOperacao(p.idempotencia);validarTextoOperacao(p.pergunta,4000);
 if(i.tipo!==undefined&&i.tipo!=='usuario')throw Error('OPERACAO_ACESSO_NEGADO');
 const cfg=await d.configuracao(),c=cfg.configuracao,provedor=c.provedor??'anthropic',hash=hashConfiguracaoAgente(p);
 const inicio=await d.operacao.transacao(async tx=>{
  await d.operacao.exigir(tx,i,'ia.editar');
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['agente_teste:'+d.privada.empresaId]);
  const anterior=(await tx.query<{autor_id:string;hash:string;resultado:ResultadoTesteDonatella|null}>('SELECT autor_id,hash,resultado FROM atendimento_operacao.agente_teste WHERE id=$1',[p.idempotencia])).rows[0];
  if(anterior){if(anterior.autor_id!==i.id||anterior.hash!==hash)throw Error('OPERACAO_IDEMPOTENCIA_CONFLITO');return {anterior:anterior.resultado??{estado:'incerto' as const,texto:'Teste em processamento ou sem resultado confirmado. Não foi repetido.',fontes:[],provedor,modelo:c.modelo,versao:p.versao,enviosReais:false as const,reservaCentavos:c.limites.custoPorChamadaCentavos}};}
  const atual=(await tx.query<{versao:string}>("SELECT versao FROM atendimento_operacao.configuracao WHERE chave='agente' FOR SHARE")).rows[0];
  if(cfg.versao!==p.versao||Number(atual?.versao)!==p.versao)throw Error('OPERACAO_CONFLITO');
  if(!testeAutorizado(d.privada)||!d.autorizada({...c,modo:'rascunho',autoridadeAutomatica:false})||c.limites.custoPorChamadaCentavos<1)throw Error('AGENTE_TESTE_CONSUMO_NAO_AUTORIZADO');
  await tx.query("INSERT INTO atendimento_operacao.agente_teste(id,empresa_id,autor_id,hash,configuracao_versao,estado,provedor,modelo,reserva_centavos) VALUES($1,$2,$3,$4,$5,'processando',$6,$7,0)",[p.idempotencia,d.privada.empresaId,i.id,hash,p.versao,provedor,c.modelo]);
  await d.operacao.auditar(tx,i,p.idempotencia,'testar_donatella',p.versao);return {anterior:undefined};
 });
 if(inicio.anterior)return inicio.anterior;
 const tarefa:TarefaIA={id:p.idempotencia,atorId:i.id,empresaId:d.privada.empresaId,conversaId:'ensaio_ficticio',clienteId:'cliente_ficticio',versao:1,mensagemOrigemId:'entrada_ficticia',pergunta:p.pergunta,tema:temaPergunta(p.pergunta)};
 let decisao:DecisaoIA|undefined,chamadas=0,observacao:ObservacaoConsumoIA|undefined,reservaCentavos=0;
 const contexto={empresaId:tarefa.empresaId,conversaId:tarefa.conversaId,clienteId:tarefa.clienteId,versao:1,estado:'ia' as const,modo:'rascunho' as const};
 const vigente=async()=>await d.operacao.autorizar(i,'ia.editar')&&(await d.configuracao()).versao===p.versao;
 const repositorio:RepositorioIA={contexto:async()=>await vigente()?contexto:null,reservar:async()=>({lease:p.idempotencia}),reservarChamada:async()=>++chamadas<=c.limites.maxChamadas,preservarApoio:async(_t,_l,v)=>v,concluir:async(_t,_l,v)=>{decisao=v;return v;}};
 const fontes=new Map<string,FonteIA>();
 const registrarFontes=(novas:FonteIA[])=>{novas.forEach(f=>fontes.set(f.id,f));return novas;};
 const modelo=criarProvedorEvidenciasDireto({chave:d.chave(c),modelo:c.modelo,provedor,maxTokens:c.maxTokens,respostaRedigida:true,estilo:perfilEstiloAgente(cfg.tom,cfg.skills,tarefa.tema),registrarConsumo:async o=>{observacao=o;await d.operacao.transacao(tx=>tx.query('UPDATE atendimento_operacao.agente_teste SET consumo=$2::jsonb WHERE id=$1',[p.idempotencia,JSON.stringify(o)]));}},d.transporte);
 let resultado:ResultadoTesteDonatella;
 try{
  const r=await orquestrarIA(tarefa,c.limites,{repositorio,respostaRedigida:true,autorizar:async()=>vigente(),conhecimento:async t=>registrarFontes(skillPermiteAgente(cfg.skills,t.tema,'consultar_conhecimento')?fontesConhecimentoEnsaio(t):[]),ferramenta:async(nome,t,sinal)=>{if(sinal.aborted||!skillPermiteAgente(cfg.skills,t.tema,nome))return [];return registrarFontes(fontesFerramentaEnsaio(nome,t));},provedor:async(pedido,sinal)=>{
   await d.operacao.transacao(async tx=>{await d.operacao.exigir(tx,i,'ia.editar');await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['agente_teste:'+d.privada.empresaId]);const atual=(await tx.query<{versao:string}>("SELECT versao FROM atendimento_operacao.configuracao WHERE chave='agente' FOR SHARE")).rows[0];if(Number(atual?.versao)!==p.versao)throw Error('OPERACAO_CONFLITO');const n=await consumoPainelTx(tx,d.privada.empresaId);if(n.testes+(d.privada.reservaHistoricaTestesCentavos??0)+c.limites.custoPorChamadaCentavos>d.privada.orcamentoTestesTotalCentavos!)throw Error('AGENTE_TESTE_ORCAMENTO_ESGOTADO');const reserva=await tx.query('UPDATE atendimento_operacao.agente_teste SET reserva_centavos=$2 WHERE id=$1 AND reserva_centavos=0',[p.idempotencia,c.limites.custoPorChamadaCentavos]);if(reserva.rowCount!==1)throw Error('AGENTE_TESTE_JA_RESERVADO');reservaCentavos=c.limites.custoPorChamadaCentavos;});
   return modelo(pedido,sinal);
  },revalidarFontes:async(_t,refs)=>await vigente()&&refs.every(r=>{const f=fontes.get(r.id);return f?.versao===r.versao&&f.fim>Date.now();}),solicitarApoio:async()=>({id:'apoio_ficticio'})});
  if(r.estado==='ocupado')throw Error('AGENTE_TESTE_OCUPADO');
  decisao=r;
  resultado={estado:r.estado==='rascunho'?'concluido':observacao?.resultado==='incerta'?'incerto':r.estado==='invalidado'?'falha':'apoio',texto:AVISO_ENSAIO_DONATELLA+'\n\n'+(r.texto??'A Donatella encaminharia esta questão para a equipe. Nenhuma mensagem foi enviada.'),...(r.motivo?{motivo:r.motivo}:{}),fontes:r.fontes,provedor,modelo:c.modelo,versao:p.versao,enviosReais:false,reservaCentavos,...(observacao?{consumo:observacao.consumo}:{})};
 }catch{resultado={estado:observacao?.resultado==='incerta'?'incerto':'falha',texto:'Não foi possível confirmar a resposta. O teste não foi repetido e não enviou WhatsApp.',motivo:decisao?.motivo??'PROVEDOR_OU_LIMITE_INDISPONIVEL',fontes:[],provedor,modelo:c.modelo,versao:p.versao,enviosReais:false,reservaCentavos,...(observacao?{consumo:observacao.consumo}:{})};}
 await d.operacao.transacao(tx=>tx.query('UPDATE atendimento_operacao.agente_teste SET estado=$2,resultado=$3::jsonb,concluida_em=now() WHERE id=$1 AND resultado IS NULL',[p.idempotencia,resultado.estado,JSON.stringify(resultado)]));
 return resultado;
}
