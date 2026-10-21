import 'server-only';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { ServicoDuvidas, type AtorDuvidas, type PermissaoDuvidas, type TransacaoDuvidas } from './duvidas-aprendizagem';
import { criarRepositorioDuvidasPg } from './repositorio-duvidas-pg';
import { contextoAtualIA, orquestrarIA, type FonteIA, type TarefaIA,type DecisaoIA,type FerramentaIA } from './ia-orquestrador';
import { criarProvedorEvidenciasDireto } from './ia-orquestrador-direto';
import { RepositorioAgentePg, validarConfiguracaoAgente,hashTarefaAgente,hashConfiguracaoAgente,normalizarConfiguracaoAgente,validarSkillsAgente,validarTomAgente,SKILLS_AGENTE_PADRAO,TOM_AGENTE_PADRAO,skillPermiteAgente,perfilEstiloAgente,comporTextoAgente,invalidarConfiguracaoAgenteTx,type ConfiguracaoAgente,type ConfiguracaoSkillsAgente,type TomAgente,type ProvedorAgente } from './repositorio-agente-pg';
import { criarFerramentasWoo, criarLeituraFerramentas, criarVozDireta, type CredenciaisVoz, type CredenciaisWoo } from './operacao-ferramentas';
import type { RepositorioOperacaoPg } from './operacao-repositorio-pg';
import type { IdentidadeOperacao,AcaoOperacao } from './operacao-tipos';
import type { ImagemIA } from './ia-direta';
import {conferirHorarioAgente,type HorariosAgente} from './operacao-horarios';
import type {IntencaoOperacao} from './operacao-envio';
import {agendarFollowupTx,configuracaoFollowupTx,processarFollowup,validarEnvioFollowupTx,validarConfiguracaoFollowup,type ConfiguracaoFollowup} from './operacao-followup';
import {configuracaoAgenteParaCorte} from './operacao-agente-corte';
import {processarAlertaApoio,registrarAlertaApoioTx,validarEnvioAlertaApoioTx,observarAlertaApoioTx} from './operacao-alerta-apoio';
import {estadoPainel,controlarAgente,testarAgente,reconciliarAgente,type PedidoReconciliacaoAgente} from './operacao-agente-painel';
import {MOTIVO_RESPOSTA_REDIGIDA,validarTextoRedigidoIA} from './ia-resposta-fundamentada';
import type {ServicoComercialOperacao} from './operacao-comercial';

export type ConfiguracaoPrivadaAgente = {
 empresaId:string; anthropic:{chave:string;modelo:string;maxTokens:number}; woo?:CredenciaisWoo; voz?:CredenciaisVoz;
 custoVozCentavos:number; orcamentoMaximoCentavosDia:number; autoridadeAutomatica:boolean;
 custoTranscricaoCentavos?:number;custoSinteseCentavos?:number;
 /** Respostas em texto por padrão. A autorização de síntese é independente
  * da credencial usada para transcrever áudios recebidos e do legado importado. */
 sinteseVozHabilitada?:boolean;
 inferenciaHabilitada?:boolean;
 /** Capacidades privadas. O modo persistido continua desligado até o comando
  * separado do proprietário; preparar o painel não autoriza qualquer envio. */
 painelHabilitado?:boolean;consumoOperacaoAutorizado?:boolean;creditoApiConfirmado?:boolean;
 testesAutorizados?:boolean;orcamentoTestesTotalCentavos?:number;reservaHistoricaTestesCentavos?:number;
 automacoesApoioHabilitadas?:boolean;
 /** Estado do transporte humano, independente da ativação da IA. */
 enviosHumanosHabilitados?:boolean;
 provedores?:Partial<Record<ProvedorAgente,{chave:string;modelos:string[];maxTokens:number;reservaMinimaCentavos?:number}>>;
 capacidadesProvedores?:CapacidadeProvedorAgente[];
};
export type CapacidadeProvedorAgente={id:ProvedorAgente;disponivel:boolean;modelos:{id:string;nome:string;disponivel:boolean;testado:boolean}[]};
export type MidiaAgente = {bytes:Uint8Array;mime:string;hash:string};
export type DependenciasAgenteOperacional = {
 operacao:RepositorioOperacaoPg; configuracao:ConfiguracaoPrivadaAgente;
 carregarMidia:(t:TarefaIA)=>Promise<MidiaAgente|null>;
 transporteModelo?:typeof fetch; transporteWoo?:typeof fetch; transporteVoz?:typeof fetch;
 comercial?:ServicoComercialOperacao;
};
export const IDENTIDADE_AGENTE:IdentidadeOperacao={id:'service:donatella-ia',nome:'Donatella',perfilId:'servico-donatella',sessaoVersao:1,permissoes:[],tipo:'ia'};
const atorDuvidas=(i:IdentidadeOperacao,empresaId:string):AtorDuvidas=>({id:i.id,empresaId,versaoSessao:i.sessaoVersao});
const siglaMotivo=(s:string)=>s==='HUMANO_SOLICITADO'||s==='REVISAO_HUMANA_OBRIGATORIA'?'decisao_humana':s==='FONTES_CONFLITANTES'?'conflito':s.includes('INDISPONIVEL')?'ferramenta_indisponivel':'fonte_insuficiente';
function hashId(s:string){const b=createHash('sha256').update(s).digest('hex');return `${b.slice(0,8)}-${b.slice(8,12)}-4${b.slice(13,16)}-a${b.slice(17,20)}-${b.slice(20,32)}`;}
const financeiro=/alerg|anafilax|intoler|reembol|estorno|desconto|fiscal|privil[eé]gio/i;
const temasDoAgente:TarefaIA['tema'][]=['produto','preco','estoque','frete','agenda','pedido','procedimento','alergia','excecao'];

/** Integra o serviço de dúvidas/conhecimento existente à identidade HUB real.
 * A origem não concede grants/perfis à aplicação. Grupo externo é indisponível. */
export function criarServicoDuvidasOperacional(operacao:RepositorioOperacaoPg,empresaId:string,i:IdentidadeOperacao) {
 const capacidades:Record<PermissaoDuvidas,AcaoOperacao>={'duvidas.visualizar':'duvidas.visualizar','duvidas.criar':'duvidas.adicionar','duvidas.responder':'duvidas.adicionar','duvidas.editar':'duvidas.editar','duvidas.aprovar_envio':'duvidas.editar','duvidas.administrar':'duvidas.editar','conhecimento.visualizar':'conhecimento.visualizar','conhecimento.listar':'conhecimento.visualizar','conhecimento.sugerir':'conhecimento.adicionar','conhecimento.aprovar':'conhecimento.editar','conhecimento.revogar':'conhecimento.excluir'};
 return new ServicoDuvidas({repositorio:criarRepositorioDuvidasPg(operacao.pool),
  autorizar:async(tx:TransacaoDuvidas,a:AtorDuvidas,p:PermissaoDuvidas,escopo)=>{
   if(a.id!==i.id||a.empresaId!==empresaId||escopo.empresaId!==empresaId||a.versaoSessao!==i.sessaoVersao||escopo.grupoId)return false;
   const conexao=tx.conexao as PoolClient;
   if(i.tipo==='ia') {
    if(i.id!==IDENTIDADE_AGENTE.id||!['duvidas.criar','duvidas.visualizar','conhecimento.visualizar'].includes(p)||!await operacao.autorizar(i,'atender',conexao))return false;
   } else if(!await operacao.autorizar(i,capacidades[p],conexao))return false;
   if(escopo.conversaId) {
    const c=await conexao.query<{ficticia:boolean;contato_id:string}>('SELECT ficticia,contato_id FROM atendimento_operacao.conversa WHERE id=$1 FOR SHARE',[escopo.conversaId]);if(!c.rows[0]||escopo.clienteId&&escopo.clienteId!==c.rows[0].contato_id)return false;
    if(!p.endsWith('visualizar')&&p!=='conhecimento.listar'&&operacao.modo()!=='operacao'&&!c.rows[0].ficticia)return false;
   }
   return true;
  },
  contextoConversa:async(tx,_empresaId,conversaId)=>{
   const r=await (tx.conexao as PoolClient).query<{estado:string;versao:string;contato_id:string;ultima_cliente_em:Date|null}>(`SELECT estado,versao,contato_id,ultima_cliente_em FROM atendimento_operacao.conversa WHERE id=$1 FOR SHARE`,[conversaId]);const c=r.rows[0];if(!c)return null;
   return {empresaId,conversaId,clienteId:c.contato_id,versao:Number(c.versao),estado:c.estado==='encerrada'?'encerrada':'aberta',autoridade:c.estado==='ia'?'ia':'humano',janelaClienteAte:new Date((c.ultima_cliente_em?.getTime()??0)+86400000).toISOString(),revisaoRegras:1};
  },
  enfileirarResposta:async(tx,_ator,caso)=>{
   if(!caso.respostaPreparada)throw Error('DUVIDAS_PREPARACAO_RECUSADA');
   // A revisão foi validada pelo core no contexto IA anterior. A ação explícita
   // de enfileirar a resposta humana toma o atendimento no mesmo commit, sem
   // dar ao pedido do navegador uma opção de ignorar a tomada do Chat.
   const p=caso.respostaPreparada,conexao=tx.conexao as PoolClient;
   const versao=await operacao.assumirRespostaRevisadaTx(conexao,i,caso.conversaId,p.revisaoConversa);
   const r=await operacao.enfileirarTx(conexao,i,{conversaId:caso.conversaId,versao,idempotencia:hashId('apoio-resposta:'+p.idempotencia),tipo:'text',texto:p.texto},'humano');return {intencaoId:r.id};
  },
 });
}

/** Mesmo orquestrador, PostgreSQL, fila e fornecedores usados na operação.
 * Só as fronteiras externas são injetáveis nos ensaios; nada usa fixtures do lab. */
export class ServicoAgenteOperacional {
 readonly repositorio:RepositorioAgentePg;
 constructor(private readonly d:DependenciasAgenteOperacional) {
  this.repositorio=new RepositorioAgentePg(d.operacao.pool,d.configuracao.empresaId);
  if(!Number.isSafeInteger(d.configuracao.orcamentoMaximoCentavosDia)||d.configuracao.orcamentoMaximoCentavosDia<0)throw Error('AGENTE_ORCAMENTO_INVALIDO');
 }
 duvidas(i:IdentidadeOperacao){return criarServicoDuvidasOperacional(this.d.operacao,this.d.configuracao.empresaId,i);}
 async followup(i:IdentidadeOperacao){return this.d.operacao.transacao(async tx=>{await this.d.operacao.exigir(tx,i,'followup.visualizar');return configuracaoFollowupTx(tx);});}
 async configurarFollowup(i:IdentidadeOperacao,p:{conteudo:ConfiguracaoFollowup;versao:number;idempotencia:string}){
  validarConfiguracaoFollowup(p.conteudo);
  return this.d.operacao.transacao(async tx=>{
   await this.d.operacao.exigir(tx,i,'followup.editar');return this.d.operacao.comando(tx,i,p.idempotencia,p,async()=>{
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('config:agente_followup',0))");
    const atual=await configuracaoFollowupTx(tx);if(atual.versao!==p.versao)throw Error('OPERACAO_CONFLITO');
    const r=await tx.query("INSERT INTO atendimento_operacao.configuracao(chave,conteudo) VALUES('agente_followup',$1::jsonb) ON CONFLICT(chave) DO UPDATE SET conteudo=excluded.conteudo,versao=atendimento_operacao.configuracao.versao+1,atualizada_em=now() RETURNING versao",[JSON.stringify(p.conteudo)]);
    await this.d.operacao.auditar(tx,i,'agente_followup','configurar_followup',Number(r.rows[0].versao));return {versao:Number(r.rows[0].versao)};
   });
  });
 }
 async estado(i:IdentidadeOperacao) {
  if(!await this.d.operacao.autorizar(i,'ia.visualizar'))throw Error('OPERACAO_ACESSO_NEGADO');
  const {configuracao,versao}=await this.repositorio.configuracao();
  const painel=await estadoPainel(this.painel(),configuracao);
  return {...configuracao,versao,...painel,inferenciaHabilitada:this.d.configuracao.inferenciaHabilitada===true,observacao:await this.repositorio.observar(),plantao:await this.d.operacao.transacao(tx=>observarAlertaApoioTx(tx,this.d.configuracao.empresaId)),credenciais:{anthropic:!!this.credencial('anthropic')?.chave,google:!!this.credencial('google')?.chave,openai:!!this.credencial('openai')?.chave,woo:!!this.d.configuracao.woo,voz:!!this.d.configuracao.voz},enviosReais:this.d.operacao.modo()==='operacao'&&painel.estadoEfetivo==='ligada'};
 }
 private painel(){return {operacao:this.d.operacao,privada:this.d.configuracao,autorizada:(c:ConfiguracaoAgente)=>this.configuracaoAutorizada(c)};}
 controlar(i:IdentidadeOperacao,p:{acao:'ligar'|'pausar';versao:number;idempotencia:string}){return controlarAgente(this.painel(),i,p);}
 reconciliar(i:IdentidadeOperacao,p:PedidoReconciliacaoAgente){return reconciliarAgente(this.d.operacao,i,p);}
 testar(i:IdentidadeOperacao,p:{pergunta:string;versao:number;idempotencia:string}){return testarAgente({...this.painel(),configuracao:()=>this.repositorio.configuracao(),chave:c=>this.credencial(c.provedor??'anthropic')?.chave??'',transporte:this.d.transporteModelo??fetch},i,p);}
 private credencial(provedor:ProvedorAgente){
  return this.d.configuracao.provedores?.[provedor]??(provedor==='anthropic'?{chave:this.d.configuracao.anthropic.chave,modelos:[this.d.configuracao.anthropic.modelo],maxTokens:this.d.configuracao.anthropic.maxTokens}:undefined);
 }
 private configuracaoAutorizada(c:ConfiguracaoAgente){
  const privada=this.credencial(c.provedor??'anthropic');
  if(this.d.configuracao.painelHabilitado&&c.modo==='automatico'&&(this.d.configuracao.consumoOperacaoAutorizado!==true||this.d.configuracao.creditoApiConfirmado!==true))return false;
  return c.custoCentavosDia<=this.d.configuracao.orcamentoMaximoCentavosDia&&(!c.autoridadeAutomatica||this.d.configuracao.autoridadeAutomatica)&&!!privada?.chave&&privada.modelos.includes(c.modelo)&&c.maxTokens<=privada.maxTokens&&c.limites.custoPorChamadaCentavos>=(privada.reservaMinimaCentavos??0);
 }
 async opcoes(i:IdentidadeOperacao){
  return this.d.operacao.transacao(async tx=>{await this.d.operacao.exigir(tx,i,'ia.visualizar');return {principal:'anthropic' as const,provedores:(['anthropic','google','openai'] as const).map(id=>{
   const cred=this.credencial(id),cap=this.d.configuracao.capacidadesProvedores?.find(c=>c.id===id),configurado=!!cred?.chave;
   const modelos=[...new Set([...(cred?.modelos??[]),...(cap?.modelos.map(m=>m.id)??[])])].filter(m=>/^[A-Za-z0-9][A-Za-z0-9._:-]{0,89}$/.test(m)).slice(0,100).map(m=>{const prova=cap?.modelos.find(v=>v.id===m),disponivel=configurado&&cap?.disponivel===true&&prova?.disponivel===true&&cred?.modelos.includes(m)===true;return {id:m,nome:prova?.nome?.slice(0,120)??m,disponivel,testado:disponivel&&prova?.testado===true};});
   return {id,nome:id==='anthropic'?'Anthropic / Claude':id==='google'?'Google / Gemini':'OpenAI',configurado,disponivel:modelos.some(m=>m.disponivel),testado:modelos.some(m=>m.testado),modelos};
  })};});
 }
 private async secao<T>(i:IdentidadeOperacao,chave:'agente_skills'|'agente_tom',padrao:T){return this.d.operacao.transacao(async tx=>{
  await this.d.operacao.exigir(tx,i,chave==='agente_skills'?'skills.visualizar':'tom.visualizar');const r=await tx.query<{conteudo:T;versao:string;versao_agente:string}>(`SELECT s.conteudo,s.versao,a.versao versao_agente FROM atendimento_operacao.configuracao a LEFT JOIN atendimento_operacao.configuracao s ON s.chave=$1 WHERE a.chave='agente'`,[chave]);if(!r.rows[0])throw Error('AGENTE_CONFIGURACAO_AUSENTE');return {conteudo:r.rows[0].conteudo??padrao,versao:Number(r.rows[0].versao??0),versaoAgente:Number(r.rows[0].versao_agente)};
 });}
 skills(i:IdentidadeOperacao){return this.secao(i,'agente_skills',SKILLS_AGENTE_PADRAO);}
 tom(i:IdentidadeOperacao){return this.secao(i,'agente_tom',TOM_AGENTE_PADRAO);}
 private async salvarSecao(i:IdentidadeOperacao,chave:'agente_skills'|'agente_tom',p:{conteudo:ConfiguracaoSkillsAgente|TomAgente;versao:number;idempotencia:string},guarda?:{modo:'desligado';versaoAgente:number}){
  if(!Number.isSafeInteger(p.versao)||p.versao<0)throw Error('OPERACAO_VERSAO_INVALIDA');
  if(chave==='agente_skills')validarSkillsAgente(p.conteudo as ConfiguracaoSkillsAgente);else validarTomAgente(p.conteudo as TomAgente);
  return this.d.operacao.transacao(async tx=>{await this.d.operacao.exigir(tx,i,chave==='agente_skills'?'skills.visualizar':'tom.editar');const resultado=await this.d.operacao.comando(tx,i,p.idempotencia,{chave,...p},async()=>{
    const globalTravada=await tx.query("SELECT versao FROM atendimento_operacao.configuracao WHERE chave='agente' FOR UPDATE");
    if(guarda){const atual=(await tx.query("SELECT conteudo->>'modo' modo FROM atendimento_operacao.configuracao WHERE chave='agente'")).rows[0];if(Number(globalTravada.rows[0]?.versao)!==guarda.versaoAgente||atual?.modo!==guarda.modo)throw Error('AGENTE_GUARDA_PUBLICACAO_ALTERADA');}
   const r=await tx.query<{conteudo:ConfiguracaoSkillsAgente|TomAgente;versao:string}>('SELECT conteudo,versao FROM atendimento_operacao.configuracao WHERE chave=$1 FOR UPDATE',[chave]);if(Number(r.rows[0]?.versao??0)!==p.versao)throw Error('OPERACAO_CONFLITO');
   let conteudo=p.conteudo;const requisitosAutorizacao:AcaoOperacao[]=[];
   if(chave==='agente_skills'){
    const anteriores=(r.rows[0]?.conteudo as ConfiguracaoSkillsAgente|undefined)?.skills??SKILLS_AGENTE_PADRAO.skills;
    const atuais=(p.conteudo as ConfiguracaoSkillsAgente).skills;
    if(atuais.some(s=>!anteriores.some(v=>v.id===s.id)))requisitosAutorizacao.push('skills.adicionar');
    if(anteriores.some(s=>!atuais.some(v=>v.id===s.id)))requisitosAutorizacao.push('skills.excluir');
    if(atuais.some(s=>{const antiga=anteriores.find(v=>v.id===s.id);return antiga&&hashConfiguracaoAgente(s)!==hashConfiguracaoAgente(antiga);}))requisitosAutorizacao.push('skills.editar');
    if(!requisitosAutorizacao.length)requisitosAutorizacao.push('skills.editar');
    for(const capacidade of requisitosAutorizacao)await this.d.operacao.exigir(tx,i,capacidade);
    conteudo={skills:(p.conteudo as ConfiguracaoSkillsAgente).skills.map(s=>{const antiga=anteriores.find(v=>v.id===s.id);if(antiga&&(s.versao!==antiga.versao||s.responsavelId!==antiga.responsavelId)||!antiga&&s.versao!==1)throw Error('OPERACAO_CONFLITO');
     const mudou=!antiga||hashConfiguracaoAgente(s)!==hashConfiguracaoAgente(antiga);return {...s,versao:antiga?antiga.versao+(mudou?1:0):1,responsavelId:mudou?i.id:antiga!.responsavelId};})};
   }
   const outra=(await tx.query<{conteudo:ConfiguracaoSkillsAgente|TomAgente}>('SELECT conteudo FROM atendimento_operacao.configuracao WHERE chave=$1',[chave==='agente_skills'?'agente_tom':'agente_skills'])).rows[0]?.conteudo;
   const skills=chave==='agente_skills'?conteudo as ConfiguracaoSkillsAgente:(outra as ConfiguracaoSkillsAgente??SKILLS_AGENTE_PADRAO),tom=chave==='agente_tom'?conteudo as TomAgente:(outra as TomAgente??TOM_AGENTE_PADRAO);
   if(temasDoAgente.some(t=>perfilEstiloAgente(tom,skills,t).length>8000))throw Error('AGENTE_PERFIL_ESTILO_EXCESSIVO');
   const s=await tx.query("INSERT INTO atendimento_operacao.configuracao(chave,conteudo) VALUES($1,$2::jsonb) ON CONFLICT(chave) DO UPDATE SET conteudo=excluded.conteudo,versao=atendimento_operacao.configuracao.versao+1,atualizada_em=now() RETURNING versao",[chave,JSON.stringify(conteudo)]);
   const global=await tx.query("UPDATE atendimento_operacao.configuracao SET versao=versao+1,atualizada_em=now() WHERE chave='agente' RETURNING versao");
   const invalidadas=await invalidarConfiguracaoAgenteTx(tx,this.d.configuracao.empresaId);await this.d.operacao.auditar(tx,i,chave,'configurar_'+chave,Number(s.rows[0].versao));return {conteudo,versao:Number(s.rows[0].versao),versaoAgente:Number(global.rows[0].versao),...invalidadas,requisitosAutorizacao};
  },async anterior=>{if(chave==='agente_skills'){const requisitos=anterior.requisitosAutorizacao??['skills.adicionar','skills.editar','skills.excluir'];for(const capacidade of requisitos)await this.d.operacao.exigir(tx,i,capacidade);}});const publico={...resultado};Reflect.deleteProperty(publico,'requisitosAutorizacao');return publico;});
 }
 configurarSkills(i:IdentidadeOperacao,p:{conteudo:ConfiguracaoSkillsAgente;versao:number;idempotencia:string},guarda?:{modo:'desligado';versaoAgente:number}){return this.salvarSecao(i,'agente_skills',p,guarda);}
 configurarTom(i:IdentidadeOperacao,p:{conteudo:TomAgente;versao:number;idempotencia:string}){return this.salvarSecao(i,'agente_tom',p);}
 async configurar(i:IdentidadeOperacao,p:{conteudo:ConfiguracaoAgente;versao:number;idempotencia:string}) {
  validarConfiguracaoAgente(p.conteudo);
  if(!Number.isSafeInteger(p.versao)||p.versao<1)throw Error('OPERACAO_VERSAO_INVALIDA');
  if(!this.configuracaoAutorizada(p.conteudo)&&p.conteudo.modo!=='desligado'||p.conteudo.custoCentavosDia>this.d.configuracao.orcamentoMaximoCentavosDia||p.conteudo.autoridadeAutomatica&&!this.d.configuracao.autoridadeAutomatica)throw Error('AGENTE_CONFIGURACAO_NAO_AUTORIZADA');
  return this.d.operacao.transacao(async tx=>{
   await this.d.operacao.exigir(tx,i,'ia.editar');return this.d.operacao.comando(tx,i,p.idempotencia,p,async()=>{
    const c=await tx.query<{versao:string;conteudo:ConfiguracaoAgente}>("SELECT versao,conteudo FROM atendimento_operacao.configuracao WHERE chave='agente' FOR UPDATE");if(Number(c.rows[0]?.versao)!==p.versao)throw Error('OPERACAO_CONFLITO');
    if(c.rows[0].conteudo.modo!==p.conteudo.modo||c.rows[0].conteudo.autoridadeAutomatica!==p.conteudo.autoridadeAutomatica)throw Error('AGENTE_USE_CONTROLE_LIGAR_PAUSAR');
    await tx.query("UPDATE atendimento_operacao.configuracao SET conteudo=$1::jsonb,versao=versao+1,atualizada_em=now() WHERE chave='agente'",[JSON.stringify(normalizarConfiguracaoAgente(p.conteudo))]);const invalidadas=await invalidarConfiguracaoAgenteTx(tx,this.d.configuracao.empresaId);await this.d.operacao.auditar(tx,i,'agente','configurar_agente',p.versao+1);return {versao:p.versao+1,...invalidadas};
   });
  });
 }
 async configurarModoCorte(i:IdentidadeOperacao,p:Parameters<typeof configuracaoAgenteParaCorte>[1]&{idempotencia:string}){
  if(!p.comandoExpresso)throw Error('AGENTE_CORTE_NAO_AUTORIZADO');
  return this.d.operacao.transacao(async tx=>{
   await this.d.operacao.exigir(tx,i,'ia.editar');return this.d.operacao.comando(tx,i,p.idempotencia,p,async()=>{
    const r=await tx.query<{conteudo:ConfiguracaoAgente;versao:string}>("SELECT conteudo,versao FROM atendimento_operacao.configuracao WHERE chave='agente' FOR UPDATE");const atual=r.rows[0];if(!atual)throw Error('AGENTE_CONFIGURACAO_AUSENTE');
    const conteudo=configuracaoAgenteParaCorte(atual.conteudo,p);
    if(p.habilitar&&!this.configuracaoAutorizada(conteudo))throw Error('AGENTE_CONFIGURACAO_NAO_AUTORIZADA');
    await tx.query("UPDATE atendimento_operacao.configuracao SET conteudo=$1::jsonb,versao=versao+1,atualizada_em=now() WHERE chave='agente'",[JSON.stringify(conteudo)]);
    const invalidadas=await invalidarConfiguracaoAgenteTx(tx,this.d.configuracao.empresaId);await this.d.operacao.auditar(tx,i,'agente',p.habilitar?'corte_habilitar_agente':'corte_desligar_agente',Number(atual.versao)+1);return {versao:Number(atual.versao)+1,...invalidadas};
   });
  });
 }
 private async autorizado(t:TarefaIA,versao?:number) {
  if(this.d.configuracao.inferenciaHabilitada!==true||t.atorId!==IDENTIDADE_AGENTE.id||t.empresaId!==this.d.configuracao.empresaId||!await this.d.operacao.autorizar(IDENTIDADE_AGENTE,'atender')||!await this.repositorio.configuracaoVigente(t,versao))return false;
  const c=await this.repositorio.configuracao();
  return c.configuracao.modo!=='desligado'&&this.configuracaoAutorizada(c.configuracao);
 }
 private async conhecimento(t:TarefaIA):Promise<FonteIA[]> {
  const ator=atorDuvidas(IDENTIDADE_AGENTE,t.empresaId);
  const termos=[...new Set([t.tema,...(t.pergunta.toLocaleLowerCase('pt-BR').match(/t[aá]buas?|presentes?|eventos?|personaliza[cç][aã]o|composi[cç][aã]o|atendimento|embalage[mn]s?|conserva[cç][aã]o|retirada/g)??[])])].slice(0,5);
  const consultas=await Promise.all(termos.map(tema=>this.duvidas(IDENTIDADE_AGENTE).consultarConhecimento(ator,{empresaId:t.empresaId,tema,clienteId:t.clienteId,conversaId:t.conversaId})));
  const encontrados=[...new Map(consultas.flat().map(f=>[f.id,f])).values()];
  const fontes:FonteIA[]=encontrados.slice(0,10).filter(f=>f.conteudo.length<=4000).map(f=>({id:f.id,versao:f.versao,empresaId:t.empresaId,clienteId:t.clienteId,tema:t.tema,origem:'conhecimento',estado:'aprovado',inicio:0,fim:Date.parse(f.vigenteAte),conteudo:f.conteudo}));
  // Saudação operacional não contém preço, prazo ou regra comercial presumida.
  if(t.tema==='procedimento'&&/^(ol[aá]|oi|bom dia|boa tarde|boa noite|obrigad[oa])(?:[!.,\s]*)$/i.test(t.pergunta.trim()))fontes.push({id:'donatella_saudacao_v1',versao:1,empresaId:t.empresaId,clienteId:t.clienteId,tema:t.tema,origem:'conhecimento',estado:'aprovado',inicio:0,fim:Date.now()+60000,conteudo:'Olá! Sou a Donatella, assistente da Grazing Table & Co. Como posso ajudar você hoje?'});
  return fontes;
 }
 private async prepararMidia(t:TarefaIA,signal:AbortSignal):Promise<{tarefa:TarefaIA;imagem?:ImagemIA}> {
  if(!t.midia)return {tarefa:t};
  let arquivo:MidiaAgente|null;try {arquivo=await this.d.carregarMidia(t);}catch{arquivo=null;}
  if(!arquivo||createHash('sha256').update(arquivo.bytes).digest('hex')!==arquivo.hash)return {tarefa:t};
  if(t.midia.tipo==='imagem') {
   if(!['image/jpeg','image/png','image/webp','image/gif'].includes(arquivo.mime)||!arquivo.bytes.length||arquivo.bytes.length>2*1024*1024)return {tarefa:t};
   const tarefa=await this.repositorio.prepararMidia(t,{pergunta:t.pergunta,midia:{tipo:'imagem',preservada:true}});
   return {tarefa,imagem:{mime:arquivo.mime as ImagemIA['mime'],base64:Buffer.from(arquivo.bytes).toString('base64')}};
  }
  if(t.midia.transcricaoConfiavel)return {tarefa:t};
  if(!this.d.configuracao.voz||!await this.repositorio.reservarMidia(t,this.d.configuracao.custoTranscricaoCentavos??this.d.configuracao.custoVozCentavos))return {tarefa:t};
  try {
   if(!await this.autorizado(t)||!contextoAtualIA(t,await this.repositorio.contexto(t)))throw Error('IA_PROCESSAMENTO_CANCELADO');
   const voz=criarVozDireta({...this.d.configuracao.voz,registrarConsumo:o=>this.repositorio.registrarConsumoVoz(t,o)},this.d.transporteVoz);const resposta=await voz.transcrever(arquivo.bytes,arquivo.mime,AbortSignal.any([signal,AbortSignal.timeout(20000)]));
   const tarefa=await this.repositorio.prepararMidia(t,{pergunta:resposta.texto,midia:{tipo:'audio',preservada:true,transcricaoConfiavel:true}});
   await this.repositorio.evento(t.id,'AUDIO_TRANSCRITO');return {tarefa};
  } catch {
   const tarefa=await this.repositorio.prepararMidia(t,{pergunta:t.pergunta,midia:{tipo:'audio',preservada:false,transcricaoConfiavel:false}});
   await this.repositorio.evento(t.id,'AUDIO_ENCAMINHADO_HUMANO');return {tarefa};
  }
 }
 private async prepararAudioResposta(t:TarefaIA,texto:string,signal:AbortSignal):Promise<string|undefined> {
  const privado=this.d.configuracao;
  const custoSintese=privado.custoSinteseCentavos??privado.custoVozCentavos;
  if(privado.sinteseVozHabilitada!==true||t.midia?.tipo!=='audio'||!privado.voz?.vozId)return;
  const comportamento=(await this.d.operacao.pool.query("SELECT conteudo->'comportamentos'->>'respostaAudio' ativo FROM atendimento_operacao.configuracao WHERE chave='agente_legado'")).rows[0]?.ativo;
  if(comportamento==='false')return;
  const anexoId=hashId('agente-audio:'+t.id);
  const reserva=await this.d.operacao.transacao(async tx=>{
   const c=(await tx.query<{conteudo:ConfiguracaoAgente;versao:string}>("SELECT conteudo,versao FROM atendimento_operacao.configuracao WHERE chave='agente' FOR SHARE")).rows[0];
   const a=(await tx.query<{resposta_audio_estado:string;resposta_anexo_id:string|null;configuracao_versao:string;custo_reservado_centavos:string}>(`SELECT resposta_audio_estado,resposta_anexo_id,configuracao_versao,custo_reservado_centavos FROM atendimento_operacao.agente_tarefa WHERE id=$1 FOR UPDATE`,[t.id])).rows[0];if(!c||a?.configuracao_versao!==c.versao)return {reservado:false};if(a?.resposta_anexo_id)return {id:a.resposta_anexo_id};
   // Reinício entre anexo durável e confirmação não sintetiza/consome novamente.
   const gravado=await tx.query('SELECT id FROM atendimento_operacao.anexo WHERE id=$1 AND conversa_id=$2',[anexoId,t.conversaId]);if(gravado.rowCount){await tx.query("UPDATE atendimento_operacao.agente_tarefa SET resposta_anexo_id=$2,resposta_audio_estado='concluida' WHERE id=$1",[t.id,anexoId]);return {id:anexoId};}
   if(a?.resposta_audio_estado!=='pendente'||!Number.isSafeInteger(custoSintese)||custoSintese<1||Number(a.custo_reservado_centavos)+custoSintese>c.conteudo.limites.maxCustoCentavos)return {reservado:false};
   const dia=new Date().toISOString().slice(0,10);await tx.query('INSERT INTO atendimento_operacao.agente_orcamento(empresa_id,dia) VALUES($1,$2) ON CONFLICT DO NOTHING',[t.empresaId,dia]);
   if(c.conteudo.modo!=='automatico'||!c.conteudo.autoridadeAutomatica)return {reservado:false};
   const b=await tx.query(`UPDATE atendimento_operacao.agente_orcamento SET reservado_centavos=reservado_centavos+$3 WHERE empresa_id=$1 AND dia=$2 AND reservado_centavos+$3<=$4 RETURNING dia`,[t.empresaId,dia,custoSintese,Math.min(c.conteudo.custoCentavosDia,privado.orcamentoMaximoCentavosDia)]);if(b.rowCount!==1)return {reservado:false};
   await tx.query("UPDATE atendimento_operacao.agente_tarefa SET resposta_audio_estado='processando',custo_reservado_centavos=custo_reservado_centavos+$2 WHERE id=$1",[t.id,custoSintese]);return {reservado:true};
  });
  if(reserva.id)return reserva.id;if(!reserva.reservado)return;
  try {
   if(!await this.autorizado(t)||!contextoAtualIA(t,await this.repositorio.contexto(t)))throw Error('IA_PROCESSAMENTO_CANCELADO');
   const r=await criarVozDireta({...privado.voz,registrarConsumo:o=>this.repositorio.registrarConsumoVoz(t,o)},this.d.transporteVoz).sintetizar(texto,AbortSignal.any([signal,AbortSignal.timeout(20000)]));
   if(!contextoAtualIA(t,await this.repositorio.contexto(t)))throw Error('IA_PROCESSAMENTO_CANCELADO');
   await this.d.operacao.salvarAnexo(IDENTIDADE_AGENTE,{conversaId:t.conversaId,nome:'resposta-donatella.mp3',mime:r.mime,base64:r.bytes.toString('base64'),idempotencia:anexoId});
   await this.d.operacao.transacao(tx=>tx.query("UPDATE atendimento_operacao.agente_tarefa SET resposta_anexo_id=$2,resposta_audio_estado='concluida' WHERE id=$1",[t.id,anexoId]));return anexoId;
  } catch {
   await this.d.operacao.transacao(tx=>tx.query("UPDATE atendimento_operacao.agente_tarefa SET resposta_audio_estado='indisponivel' WHERE id=$1 AND resposta_anexo_id IS NULL",[t.id]));await this.repositorio.evento(t.id,'AUDIO_RESPOSTA_FALLBACK_TEXTO');return;
  }
 }
 private async horario(t:TarefaIA,ignorarTarefaId?:string) {return this.d.operacao.transacao(async tx=>{
  const legado=(await tx.query<{conteudo:{horarios:HorariosAgente;promptReferencia?:string}}>("SELECT conteudo FROM atendimento_operacao.configuracao WHERE chave='agente_legado'")).rows[0]?.conteudo;
  const conversa=(await tx.query<{equipe_id:string|null;ficticia:boolean}>('SELECT equipe_id,ficticia FROM atendimento_operacao.conversa WHERE id=$1',[t.conversaId])).rows[0];
  if(!legado?.horarios)return {referencia:'',politica:conversa?.ficticia?undefined:{foraHorario:true as const,resposta:''}};
  const c={...legado.horarios};
  const web=(await tx.query<{conteudo:{horarios?:Pick<HorariosAgente,'inicio'|'fim'|'dias'>}}>("SELECT conteudo FROM atendimento_operacao.configuracao WHERE chave='atendimento'")).rows[0]?.conteudo.horarios;
  if(web){c.inicio=web.inicio;c.fim=web.fim;c.dias=web.dias;}
  const h=conferirHorarioAgente(c,conversa?.equipe_id??null);
  if(h.aberto)return {referencia:legado.promptReferencia??'',politica:undefined};
  const repetida=await tx.query(`SELECT 1 FROM atendimento_operacao.agente_tarefa WHERE conversa_id=$1 AND decisao->>'motivo'='FORA_HORARIO' AND intencao_id IS NOT NULL AND ($3::uuid IS NULL OR id<>$3::uuid) AND emitida_em>now()-($2::int*interval '1 minute') LIMIT 1`,[t.conversaId,Math.min(Math.max(c.cooldownMinutos,1),10080),ignorarTarefaId??null]);
  return {referencia:legado.promptReferencia??'',politica:{foraHorario:true as const,resposta:repetida.rowCount?'':h.resposta}};
 });}
 private ferramentas(){const legado=criarLeituraFerramentas({...(this.d.configuracao.woo?{woo:criarFerramentasWoo(this.d.configuracao.woo,this.d.transporteWoo)}:{}),
  vinculoPedido:async tarefa=>this.d.operacao.transacao(async tx=>{
   const v=(await tx.query<{memoria:Record<string,unknown>}>('SELECT memoria FROM atendimento_operacao.contato WHERE id=$1',[tarefa.clienteId])).rows[0]?.memoria;
   if(!v||v.wooVinculoConfirmado!==true||!Number.isSafeInteger(v.wooPedidoId)||!Number.isSafeInteger(v.wooClienteId))return null;
   return {numero:Number(v.wooPedidoId),clienteWooId:Number(v.wooClienteId)};
  }),
  agenda:async()=>this.d.operacao.transacao(async tx=>{
   const slots=(await tx.query<{conteudo:{slots?:unknown}}>("SELECT conteudo FROM atendimento_operacao.configuracao WHERE chave='horarios'")).rows[0]?.conteudo.slots;
   if(!Array.isArray(slots))return [];return slots.filter((s):s is string=>typeof s==='string'&&s.length<100&&/^\d{4}-\d{2}-\d{2}T/.test(s)&&Date.parse(s)>Date.now()).slice(0,5).map(s=>`Horário disponível para confirmar com a equipe: ${new Date(s).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}.`);
  }),
  entrega:async()=>this.d.operacao.transacao(async tx=>{
   const c=(await tx.query<{conteudo:{condicoesEntrega?:unknown;entregaAprovada?:unknown}}>("SELECT conteudo FROM atendimento_operacao.configuracao WHERE chave='atendimento'")).rows[0]?.conteudo;
   return c?.entregaAprovada===true&&typeof c.condicoesEntrega==='string'&&c.condicoesEntrega.length<=3000?[c.condicoesEntrega]:[];
  }),
 });
 return async(nome:FerramentaIA,t:TarefaIA,signal:AbortSignal)=>{
  if(this.d.comercial&&nome==='search_products'){
   const recente=await this.repositorio.contextoRecente(t);
   return this.d.comercial.fontesProdutos(t,signal,recente.filter(m=>m.autor==='cliente').map(m=>m.texto));
  }
  if(this.d.comercial&&nome==='get_order')return this.d.comercial.fontesPedido(IDENTIDADE_AGENTE,t,signal);
  return legado(nome,t,signal);
 };}
 /** Chamado pelo worker imediatamente antes de uma intenção IA sair. Não faz
  * inferência: reconsulta fontes mutáveis e recusa regras/preços retirados. */
 async validarEnvioIA(p:IntencaoOperacao):Promise<boolean>{
  try {
   // Uma intenção de áudio anterior à mudança não herda autorização para sair.
   // O arquivo/histórico permanece preservado; não o reenvia nem o converte aqui.
   if(p.conteudo.tipo==='audio'&&this.d.configuracao.sinteseVozHabilitada!==true)return false;
   if(p.conteudo.autor!=='ia'||p.autor_id!==IDENTIDADE_AGENTE.id||!this.d.configuracao.autoridadeAutomatica||this.d.configuracao.inferenciaHabilitada!==true)return false;
   const atual=await this.repositorio.configuracao(),cfg=atual.configuracao;if(cfg.modo!=='automatico'||!cfg.autoridadeAutomatica||!this.configuracaoAutorizada(cfg))return false;
   const origemAlerta=(await this.d.operacao.pool.query<{tarefa:TarefaIA}>('SELECT t.tarefa FROM atendimento_operacao.alerta_apoio a JOIN atendimento_operacao.agente_tarefa t ON t.id=a.tarefa_id WHERE a.intencao_id=$1 AND a.empresa_id=$2',[p.id,this.d.configuracao.empresaId])).rows[0];
   if(origemAlerta&&!await this.repositorio.configuracaoVigente(origemAlerta.tarefa,atual.versao))return false;
   const alerta=await this.d.operacao.transacao(tx=>validarEnvioAlertaApoioTx(tx,p,this.d.configuracao.empresaId));if(alerta!==null)return alerta;
   const followup=await this.d.operacao.transacao(tx=>validarEnvioFollowupTx(tx,p));
   if(followup!==null){if(!followup)return false;const fonte=(await this.d.operacao.pool.query<{tarefa:TarefaIA;hash:string}>("SELECT a.tarefa,a.hash FROM atendimento_operacao.timer t JOIN atendimento_operacao.agente_tarefa a ON a.id=(t.conteudo->>'tarefaId')::uuid WHERE t.intencao_id=$1",[p.id])).rows[0];return !!fonte&&hashTarefaAgente(fonte.tarefa)===fonte.hash&&await this.autorizado(fonte.tarefa)&&contextoAtualIA(fonte.tarefa,await this.repositorio.contexto(fonte.tarefa))&&!(await this.horario(fonte.tarefa)).politica;}
   const a=(await this.d.operacao.pool.query<{tarefa:TarefaIA;decisao:DecisaoIA;hash:string}>('SELECT tarefa,decisao,hash FROM atendimento_operacao.agente_tarefa WHERE intencao_id=$1 AND empresa_id=$2',[p.id,this.d.configuracao.empresaId])).rows[0];
   if(!a||a.hash!==hashTarefaAgente(a.tarefa)||a.decisao.estado!=='rascunho'||!a.decisao.texto||a.decisao.texto!==p.conteudo.texto||a.tarefa.conversaId!==p.conversa_id||a.tarefa.versao!==Number(p.versao_conversa)||!await this.autorizado(a.tarefa)||!contextoAtualIA(a.tarefa,await this.repositorio.contexto(a.tarefa)))return false;
   const horario=await this.horario(a.tarefa,a.tarefa.id);
   if(a.decisao.motivo==='FORA_HORARIO')return horario.politica?.resposta===a.decisao.texto;
   if(horario.politica)return false;
   const porTema:Partial<Record<TarefaIA['tema'],FerramentaIA>>={produto:'search_products',preco:'search_products',estoque:'search_products',pedido:'get_order',frete:'delivery_conditions',agenda:'available_slots'};
   const tool=porTema[a.tarefa.tema];if(!skillPermiteAgente(atual.skills,a.tarefa.tema,tool??'consultar_conhecimento')&&!(a.tarefa.tema==='produto'&&skillPermiteAgente(atual.skills,'produto','consultar_conhecimento')))return false;
   const fontes=tool?await this.ferramentas()(tool,a.tarefa,AbortSignal.timeout(10000)):await this.conhecimento(a.tarefa);
   if(a.tarefa.tema==='produto')fontes.push(...await this.conhecimento(a.tarefa));
   const escolhidas=a.decisao.fontes.map(r=>fontes.find(f=>f.id===r.id&&f.versao===r.versao&&f.fim>Date.now()));
   const confirmadas=escolhidas.filter((f):f is FonteIA=>!!f);
   const textoValido=a.decisao.motivo===MOTIVO_RESPOSTA_REDIGIDA?validarTextoRedigidoIA(a.decisao.texto,confirmadas):comporTextoAgente([confirmadas.map(f=>f.conteudo).join('\n')],atual.tom)===a.decisao.texto;
   return escolhidas.length>0&&escolhidas.every(Boolean)&&textoValido&&await this.repositorio.configuracaoVigente(a.tarefa,atual.versao);
  }catch{return false;}
 }
 async processarProxima() {
  const cfg=await this.repositorio.configuracao();if(cfg.configuracao.modo==='desligado')return {estado:'desligado'} as const;
  if(this.d.configuracao.inferenciaHabilitada!==true)return {estado:'inferencia_desarmada'} as const;
  if(cfg.configuracao.modo==='automatico'&&!this.d.configuracao.autoridadeAutomatica)return {estado:'autoridade_automatica_desarmada'} as const;
  let bloqueioAlerta:{estado:'alerta_bloqueado';codigo:string}|undefined;
  if(this.d.configuracao.automacoesApoioHabilitadas!==false&&cfg.configuracao.modo==='automatico'&&cfg.configuracao.autoridadeAutomatica&&this.d.configuracao.autoridadeAutomatica&&this.configuracaoAutorizada(cfg.configuracao)){
   const alerta=await processarAlertaApoio(this.d.operacao,IDENTIDADE_AGENTE,this.d.configuracao.empresaId);
   if(alerta.estado==='alerta_enfileirado'||alerta.estado==='alerta_cancelado')return alerta;
   if(alerta.estado==='alerta_bloqueado')bloqueioAlerta=alerta;
   const timer=await processarFollowup(this.d.operacao,IDENTIDADE_AGENTE,async t=>await this.autorizado(t,cfg.versao)&&!(await this.horario(t)).politica,this.d.configuracao.empresaId);
   if(timer.estado==='timer_enfileirado'||timer.estado==='timer_cancelado')return timer;
  }
  let t=await this.repositorio.proxima();if(!t)return bloqueioAlerta??{estado:'sem_pendencias'} as const;
  if(await this.repositorio.invalidarObsoleta(t))return {estado:'invalidado'} as const;
  if(!await this.autorizado(t,cfg.versao))return {estado:'acesso_ou_orcamento_bloqueado'} as const;
  // Exclusividade cobre também STT/TTS. Lock de sessão não mantém transação
  // aberta durante fornecedores e cai com o processo; intenções/custos duráveis
  // impedem pagar novamente pela mídia após uma interrupção ambígua.
  const exclusivo=await this.d.operacao.pool.connect();
  const trava=`processar-agente:${t.id}`;
  let travaAdquirida=false;
  const controller=new AbortController();let verificando=false;let vigiar:ReturnType<typeof setInterval>|undefined;
  try {
   const reserva=await exclusivo.query<{ok:boolean}>('SELECT pg_try_advisory_lock(hashtextextended($1,0)) ok',[trava]);
   if(!reserva.rows[0]?.ok)return {estado:'ocupado'} as const;
   travaAdquirida=true;
  vigiar=setInterval(()=>{if(verificando)return;verificando=true;void Promise.all([this.repositorio.contexto(t!),this.autorizado(t!,cfg.versao)]).then(([c,a])=>{if(!a||!contextoAtualIA(t!,c))controller.abort();}).catch(()=>controller.abort()).finally(()=>{verificando=false;});},750);
  const horario=await this.horario(t);
  const preparado:{tarefa:TarefaIA;imagem?:ImagemIA}=horario.politica?{tarefa:t}:await this.prepararMidia(t,controller.signal);t=preparado.tarefa;
  const fontesFerramenta=new Map<string,FonteIA>();
  const leitura=this.ferramentas();
  try {
   const tarefa=t;
   const provedor=criarProvedorEvidenciasDireto({provedor:cfg.configuracao.provedor,chave:this.credencial(cfg.configuracao.provedor??'anthropic')?.chave??'',modelo:cfg.configuracao.modelo,maxTokens:cfg.configuracao.maxTokens,respostaRedigida:true,estilo:perfilEstiloAgente(cfg.tom,cfg.skills,tarefa.tema),registrarConsumo:o=>this.repositorio.registrarConsumo(tarefa,o)},this.d.transporteModelo??fetch);
   const decisao=await orquestrarIA(tarefa,cfg.configuracao.limites,{repositorio:this.repositorio,respostaRedigida:true,cancelamento:controller.signal,automaticoAutorizado:cfg.configuracao.autoridadeAutomatica&&this.d.configuracao.autoridadeAutomatica,politicaHorario:horario.politica,referenciaOperacional:async()=>horario.referencia,
    autorizar:async(a,_acao,c)=>a===IDENTIDADE_AGENTE.id&&c.empresaId===tarefa.empresaId&&await this.autorizado(tarefa,cfg.versao),
    conhecimento:p=>skillPermiteAgente(cfg.skills,p.tema,'consultar_conhecimento')?this.conhecimento(p):Promise.resolve([]),
    contextoRecente:p=>this.repositorio.contextoRecente(p),imagem:async()=>preparado.imagem,
    ferramenta:async(n,p,s)=>{if(!skillPermiteAgente(cfg.skills,p.tema,n))return [];const f=await leitura(n,p,s);f.forEach(v=>fontesFerramenta.set(v.id,v));return f;},
    provedor:async(p,s)=>{await this.repositorio.iniciarInferencia(tarefa,cfg.versao,cfg.configuracao.provedor??'anthropic',cfg.configuracao.modelo);return provedor(p,s);},
    revalidarFontes:async(p,refs)=>{
     const fontes=(['procedimento','produto'].includes(p.tema)?[...await this.conhecimento(p),...fontesFerramenta.values()]:[...fontesFerramenta.values()]);return refs.every(r=>fontes.some(f=>f.id===r.id&&f.versao===r.versao&&f.fim>Date.now()));
    },
    solicitarApoio:async(p,motivo,fontes)=>{const caso=await this.duvidas(IDENTIDADE_AGENTE).solicitarApoio(atorDuvidas(IDENTIDADE_AGENTE,p.empresaId),{
     empresaId:p.empresaId,conversaId:p.conversaId,versaoConversa:p.versao,mensagemOrigemId:p.mensagemOrigemId,pergunta:p.pergunta.slice(0,2000),contextoFactual:`Tema: ${p.tema}. Motivo: ${motivo}. Contexto disponível no histórico da conversa.`,dadosNecessarios:'Resposta humana conferida para este atendimento.',fontes,motivo:siglaMotivo(motivo),equipeId:cfg.configuracao.equipeApoio,prioridade:financeiro.test(p.pergunta)?'alta':'normal',expiraEm:new Date(Date.now()+86400000).toISOString(),exigirRevisao:true,
    });
     if(this.d.configuracao.automacoesApoioHabilitadas!==false&&cfg.configuracao.modo==='automatico'&&cfg.configuracao.autoridadeAutomatica&&this.d.configuracao.autoridadeAutomatica)await this.d.operacao.transacao(async tx=>{
      const atual=(await tx.query("SELECT conteudo,versao FROM atendimento_operacao.configuracao WHERE chave='agente' FOR SHARE")).rows[0];
      if(Number(atual?.versao)===cfg.versao&&atual.conteudo?.modo==='automatico'&&atual.conteudo.autoridadeAutomatica)await registrarAlertaApoioTx(tx,p,caso.id);
     });return caso;},
   });
   if(decisao.estado==='rascunho'&&decisao.texto&&cfg.configuracao.modo==='automatico'&&cfg.configuracao.autoridadeAutomatica&&this.d.configuracao.autoridadeAutomatica) {
    const anexoId=decisao.motivo==='FORA_HORARIO'?undefined:await this.prepararAudioResposta(tarefa,decisao.texto,controller.signal);
    try {await this.d.operacao.transacao(async tx=>{
     const c=(await tx.query<{conteudo:ConfiguracaoAgente;versao:string}>("SELECT conteudo,versao FROM atendimento_operacao.configuracao WHERE chave='agente' FOR SHARE")).rows[0];
     if(!c||Number(c.versao)!==cfg.versao||c.conteudo.modo!=='automatico'||!c.conteudo.autoridadeAutomatica||!this.configuracaoAutorizada(c.conteudo))throw Error('AGENTE_ENVIO_NAO_AUTORIZADO');
     const atual=await tx.query<{intencao_id:string|null;configuracao_versao:string;decisao:DecisaoIA|null}>('SELECT intencao_id,configuracao_versao,decisao FROM atendimento_operacao.agente_tarefa WHERE id=$1 FOR UPDATE',[tarefa.id]);if(atual.rows[0]?.intencao_id)return;
     if(Number(atual.rows[0]?.configuracao_versao)!==cfg.versao||atual.rows[0]?.decisao?.estado!=='rascunho')throw Error('AGENTE_ENVIO_NAO_AUTORIZADO');
     const envio=await this.d.operacao.enfileirarTx(tx,IDENTIDADE_AGENTE,{conversaId:tarefa.conversaId,versao:tarefa.versao,idempotencia:hashId('agente-resposta:'+tarefa.id),tipo:anexoId?'audio':'text',texto:decisao.texto,...(anexoId?{anexoId}:{})},'ia');await tx.query('UPDATE atendimento_operacao.agente_tarefa SET intencao_id=$2,emitida_em=now() WHERE id=$1',[tarefa.id,envio.id]);
     if(this.d.configuracao.automacoesApoioHabilitadas!==false)await agendarFollowupTx(tx,{tarefa,intencaoId:envio.id,mensagemId:envio.mensagemId,fontes:decisao.fontes});
    });}
    catch {await this.repositorio.evento(tarefa.id,'RESPOSTA_NAO_ENFILEIRADA');await this.repositorio.invalidarObsoleta(tarefa);return {estado:'envio_nao_enfileirado',tarefaId:tarefa.id} as const;}
   }
   if(decisao.estado==='aguardando_apoio'||decisao.estado!=='ocupado'&&decisao.motivo==='FORA_HORARIO')await this.d.operacao.transacao(async tx=>{
    await tx.query(`UPDATE atendimento_operacao.conversa SET fila='apoio' WHERE id=$1 AND versao=$2 AND estado='ia'`,[tarefa.conversaId,tarefa.versao]);
   });
   return {estado:decisao.estado,tarefaId:tarefa.id} as const;
  } finally {controller.abort();}
  } finally {clearInterval(vigiar);controller.abort();if(travaAdquirida)await exclusivo.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[trava]).catch(()=>undefined);exclusivo.release();}
 }
}
