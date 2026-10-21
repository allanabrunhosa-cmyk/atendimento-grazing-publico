import 'server-only';
import {MOTIVO_RESPOSTA_REDIGIDA} from './ia-resposta-fundamentada';
import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { contextoAtualIA, type ContextoIA, type DecisaoIA, type LimitesIA, type PendenciaApoioIA, type RepositorioIA, type TarefaIA, type TemaIA } from './ia-orquestrador';
import type {ObservacaoConsumoIA} from './ia-provedor-tipos';
import type {ObservacaoConsumoVoz} from './operacao-ferramentas';

export type ConfiguracaoAgente = {
 modo: 'desligado'|'rascunho'|'automatico'; provedor?: ProvedorAgente; modelo: string; maxTokens: number; equipeApoio: string;
 limites: LimitesIA; custoCentavosDia: number; autoridadeAutomatica: boolean; grupoExterno: 'indisponivel';
 moedaOrcamento?: 'USD';
};
export type ProvedorAgente = 'anthropic'|'google'|'openai';
export type FerramentaSkillAgente = 'search_products'|'get_order'|'delivery_conditions'|'available_slots'|'consultar_conhecimento'|'solicitar_apoio';
export type SkillAgente = {id:string;nome:string;finalidade:string;escopo:TemaIA[];habilitada:boolean;ferramentas:FerramentaSkillAgente[];versao:number;responsavelId:string};
export type ConfiguracaoSkillsAgente = {skills:SkillAgente[]};
export type TomAgente = {nome:string;persona:string;formalidade:'informal'|'equilibrada'|'formal';conciso:boolean;emojis:'nenhum'|'moderado';termosPreferidos:string[];termosProibidos:string[];exemplos:string[]};
export const FERRAMENTAS_SKILLS_AGENTE:readonly FerramentaSkillAgente[]=['search_products','get_order','delivery_conditions','available_slots','consultar_conhecimento','solicitar_apoio'];
const temas:readonly TemaIA[]=['produto','preco','estoque','frete','agenda','pedido','procedimento','alergia','excecao'];
export const TOM_AGENTE_PADRAO:TomAgente={nome:'Donatella',persona:'Assistente cordial da Grazing Table & Co.',formalidade:'equilibrada',conciso:true,emojis:'nenhum',termosPreferidos:[],termosProibidos:[],exemplos:[]};
export const SKILLS_AGENTE_PADRAO:ConfiguracaoSkillsAgente={skills:[
 {id:'catalogo',nome:'Catálogo',finalidade:'Consultar produtos, preços e disponibilidade nas ferramentas autorizadas.',escopo:['produto','preco','estoque'],habilitada:true,ferramentas:['search_products'],versao:1,responsavelId:'service:donatella-preparacao'},
 {id:'pedido',nome:'Pedidos',finalidade:'Consultar somente o pedido pertencente ao contato do atendimento.',escopo:['pedido'],habilitada:true,ferramentas:['get_order'],versao:1,responsavelId:'service:donatella-preparacao'},
 {id:'entrega',nome:'Entrega',finalidade:'Consultar condições de entrega revisadas.',escopo:['frete'],habilitada:true,ferramentas:['delivery_conditions'],versao:1,responsavelId:'service:donatella-preparacao'},
 {id:'agenda',nome:'Agenda',finalidade:'Consultar horários disponíveis sem criar compromissos.',escopo:['agenda'],habilitada:true,ferramentas:['available_slots'],versao:1,responsavelId:'service:donatella-preparacao'},
 {id:'conhecimento',nome:'Conhecimento',finalidade:'Consultar conhecimento aprovado e vigente.',escopo:['procedimento'],habilitada:true,ferramentas:['consultar_conhecimento'],versao:1,responsavelId:'service:donatella-preparacao'},
 {id:'apoio',nome:'Apoio humano',finalidade:'Encaminhar dúvidas e exceções à equipe humana. O encaminhamento obrigatório é uma política permanente.',escopo:[...temas],habilitada:true,ferramentas:['solicitar_apoio'],versao:1,responsavelId:'service:donatella-preparacao'},
]};
const objeto=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function campos(v:unknown,permitidos:readonly string[],codigo:string){if(!objeto(v)||Object.keys(v).some(k=>!permitidos.includes(k)))throw Error(codigo);}
function texto(v:unknown,max:number,multilinha=false){return typeof v==='string'&&v.trim().length>0&&v.length<=max&&!(multilinha?/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/:/[\x00-\x1f\x7f]/).test(v);}
function lista(v:unknown,max:number,item:(s:unknown)=>boolean){return Array.isArray(v)&&v.length<=max&&new Set(v).size===v.length&&v.every(item);}
export function normalizarConfiguracaoAgente(c:ConfiguracaoAgente):ConfiguracaoAgente {return {...c,provedor:c.provedor??'anthropic',moedaOrcamento:c.moedaOrcamento??'USD'};}
export function validarSkillsAgente(c:ConfiguracaoSkillsAgente){
 const erro='AGENTE_SKILLS_INVALIDAS';campos(c,['skills'],erro);
 if(!Array.isArray(c.skills)||c.skills.length>20||new Set(c.skills.map(s=>s?.id)).size!==c.skills.length)throw Error(erro);
 for(const s of c.skills){campos(s,['id','nome','finalidade','escopo','habilitada','ferramentas','versao','responsavelId'],erro);
  if(typeof s.id!=='string'||!/^[a-z][a-z0-9_-]{0,59}$/.test(s.id)||!texto(s.nome,80)||!texto(s.finalidade,1000,true)||!lista(s.escopo,9,v=>temas.includes(v as TemaIA))||s.escopo.length<1||typeof s.habilitada!=='boolean'||!lista(s.ferramentas,6,v=>FERRAMENTAS_SKILLS_AGENTE.includes(v as FerramentaSkillAgente))||!Number.isSafeInteger(s.versao)||s.versao<1||!texto(s.responsavelId,128))throw Error(erro);
 }
}
export function validarTomAgente(c:TomAgente){
 const erro='AGENTE_TOM_INVALIDO';campos(c,['nome','persona','formalidade','conciso','emojis','termosPreferidos','termosProibidos','exemplos'],erro);
 if(!texto(c.nome,80)||!texto(c.persona,1000,true)||!['informal','equilibrada','formal'].includes(c.formalidade)||typeof c.conciso!=='boolean'||!['nenhum','moderado'].includes(c.emojis)||!lista(c.termosPreferidos,30,v=>texto(v,80))||!lista(c.termosProibidos,30,v=>texto(v,80))||!lista(c.exemplos,10,v=>texto(v,1000,true))||JSON.stringify(c).length>8000)throw Error(erro);
}
export function skillPermiteAgente(c:ConfiguracaoSkillsAgente,tema:TemaIA,ferramenta:FerramentaSkillAgente){
 // Solicitação humana obrigatória não depende de configuração de estilo/skill.
 return ferramenta==='solicitar_apoio'||c.skills.some(s=>s.habilitada&&s.escopo.includes(tema)&&s.ferramentas.includes(ferramenta));
}
export function perfilEstiloAgente(tom:TomAgente,skills:ConfiguracaoSkillsAgente,tema:TemaIA){
 validarTomAgente(tom);validarSkillsAgente(skills);
 return JSON.stringify({tom,skills:skills.skills.filter(s=>s.habilitada&&s.escopo.includes(tema)).map(s=>({nome:s.nome,finalidade:s.finalidade,escopo:s.escopo,ferramentas:s.ferramentas})),limite:'Somente apresentação. Não altera fatos, segurança, preços, autorização, apoio humano ou políticas.'});
}
/** Estilo atua apenas no enquadramento e separação. Fatos aprovados não são
 * resumidos, substituídos ou reinterpretados por persona, termos ou exemplos. */
export function comporTextoAgente(fatos:string[],tom:TomAgente):string {
 validarTomAgente(tom);
 let abertura=tom.formalidade==='formal'?'Segue a informação confirmada:':tom.formalidade==='informal'?'Vamos conferir:':'';
 if(tom.termosProibidos.some(t=>abertura.toLocaleLowerCase('pt-BR').includes(t.toLocaleLowerCase('pt-BR'))))abertura='';
 const emoji=tom.emojis==='moderado'&&!tom.termosProibidos.includes('🙂')?'🙂':'';
 return [abertura,...fatos,emoji].filter(Boolean).join(tom.conciso?'\n':'\n\n');
}
export async function invalidarConfiguracaoAgenteTx(tx:PoolClient,empresaId:string){
 // Só pendentes são canceladas. Uma transmissão já em curso conserva seu
 // recibo/lease e será revalidada; não se afirma que um POST em voo foi desfeito.
 const canceladas=await tx.query(`WITH canceladas AS (UPDATE atendimento_operacao.intencao i SET estado='cancelado',codigo='AGENTE_CONFIGURACAO_ALTERADA',atualizada_em=now() WHERE i.estado='pendente' AND i.autor_id='service:donatella-ia' AND (EXISTS(SELECT 1 FROM atendimento_operacao.agente_tarefa a WHERE a.empresa_id=$1 AND a.intencao_id=i.id) OR EXISTS(SELECT 1 FROM atendimento_operacao.timer t JOIN atendimento_operacao.agente_tarefa a ON a.id=(t.conteudo->>'tarefaId')::uuid WHERE a.empresa_id=$1 AND t.intencao_id=i.id) OR EXISTS(SELECT 1 FROM atendimento_operacao.alerta_apoio a WHERE a.empresa_id=$1 AND a.intencao_id=i.id)) RETURNING mensagem_id) UPDATE atendimento_operacao.mensagem SET estado='cancelado' WHERE id IN (SELECT mensagem_id FROM canceladas)`,[empresaId]);
 const tarefas=await tx.query(`UPDATE atendimento_operacao.agente_tarefa a SET decisao_invalidada=coalesce(a.decisao_invalidada,a.decisao),decisao='{"estado":"invalidado","motivo":"AGENTE_CONFIGURACAO_ALTERADA","fontes":[],"enviosReais":false}'::jsonb,lease=NULL,lease_ate=NULL,automatico_preparado=false,atualizada_em=now() WHERE a.empresa_id=$1 AND a.configuracao_versao<>(SELECT versao FROM atendimento_operacao.configuracao WHERE chave='agente') AND (a.decisao IS NULL OR a.decisao->>'estado' IN ('apoio_pendente','aguardando_apoio') OR a.decisao->>'estado'='rascunho' AND (a.intencao_id IS NULL OR EXISTS(SELECT 1 FROM atendimento_operacao.intencao i WHERE i.id=a.intencao_id AND i.estado IN ('pendente','processando','cancelado'))))`,[empresaId]);
 await tx.query(`UPDATE atendimento_operacao.timer t SET estado='cancelado',codigo='AGENTE_CONFIGURACAO_ALTERADA' FROM atendimento_operacao.agente_tarefa a WHERE a.empresa_id=$1 AND a.id=(t.conteudo->>'tarefaId')::uuid AND t.estado='pendente'`,[empresaId]);
 await tx.query("UPDATE atendimento_operacao.alerta_apoio SET estado='cancelado',codigo='AGENTE_CONFIGURACAO_ALTERADA',atualizada_em=now() WHERE empresa_id=$1 AND estado='pendente'",[empresaId]);
 return {tarefasInvalidadas:tarefas.rowCount??0,intencoesCanceladas:canceladas.rowCount??0};
}
async function travarConfiguracaoTx(tx:PoolClient){
 const r=await tx.query<{conteudo:ConfiguracaoAgente;versao:string;tom:TomAgente}>(`SELECT a.conteudo,a.versao,t.conteudo tom FROM atendimento_operacao.configuracao a LEFT JOIN atendimento_operacao.configuracao t ON t.chave='agente_tom' WHERE a.chave='agente' FOR SHARE OF a`);if(!r.rows[0])throw Error('AGENTE_CONFIGURACAO_AUSENTE');return r.rows[0];
}
const id = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function canonico(v:unknown):unknown {
 if(Array.isArray(v))return v.map(canonico);
 if(v!==null&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonico((v as Record<string,unknown>)[k])]));
 if(v===null||typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v))return v;
 throw Error('AGENTE_TAREFA_SERIALIZACAO_INVALIDA');
}
export const hashConfiguracaoAgente = (v:unknown)=>createHash('sha256').update(JSON.stringify(canonico(v))).digest('hex');
export const hashTarefaAgente = (t:TarefaIA)=>hashConfiguracaoAgente(t);
const hashTarefa=hashTarefaAgente;
const hashId = (s: string) => { const b=createHash('sha256').update(s).digest('hex'); return `${b.slice(0,8)}-${b.slice(8,12)}-4${b.slice(13,16)}-a${b.slice(17,20)}-${b.slice(20,32)}`; };
export function temaPergunta(pergunta: string): TemaIA {
 if (/alerg|intoler|anafilax/i.test(pergunta)) return 'alergia';
 if (/reembol|estorno|desconto|cancelar pedido|reclama/i.test(pergunta)) return 'excecao';
 if (/\bpedido\b|rastre|entregue|status/i.test(pergunta)) return 'pedido';
 if (/frete|entrega|bairro|endere[cç]o|cep/i.test(pergunta)) return 'frete';
 if (/agenda|agendar|hor[aá]rio|reserva/i.test(pergunta)) return 'agenda';
 if (/pre[cç]o|custa|valor|quanto/i.test(pergunta)) return 'preco';
 if (/estoque|dispon[ií]vel|disponibilidade/i.test(pergunta)) return 'estoque';
 if (/produto|cat[aá]logo|card[aá]pio|cesta|t[aá]bua|caf[eé]|op[cç][aã]o|recomend|sugest|\blink\b|\bcomprar\b|\bpresente\b|\bpessoas?\b|\bbrie\b|\bgrazing\b/i.test(pergunta)) return 'produto';
 return 'procedimento';
}
export function validarConfiguracaoAgente(c: ConfiguracaoAgente) {
 campos(c,['modo','provedor','modelo','maxTokens','equipeApoio','limites','custoCentavosDia','moedaOrcamento','autoridadeAutomatica','grupoExterno'],'AGENTE_CONFIGURACAO_INVALIDA');
 const provedor=c.provedor??'anthropic',padraoModelo=provedor==='anthropic'?/^claude-[a-z0-9-]{1,80}$/:provedor==='google'?/^gemini-[a-z0-9.-]{1,80}$/:/^(gpt-[a-z0-9.-]{1,80}|o[1-9][a-z0-9.-]{0,80})$/;
 if (!['anthropic','google','openai'].includes(provedor)||c.moedaOrcamento!==undefined&&c.moedaOrcamento!=='USD'||!['desligado','rascunho','automatico'].includes(c.modo) || typeof c.modelo!=='string' || c.modelo.length>90 || c.modelo!==''&&!padraoModelo.test(c.modelo) || c.modo!=='desligado'&&!c.modelo || !Number.isSafeInteger(c.maxTokens)||c.maxTokens<64||c.maxTokens>2048 || !/^[A-Za-z0-9_-]{1,100}$/.test(c.equipeApoio) || !Number.isSafeInteger(c.custoCentavosDia)||c.custoCentavosDia<0||c.custoCentavosDia>100000 || typeof c.autoridadeAutomatica!=='boolean'||c.grupoExterno!=='indisponivel')throw Error('AGENTE_CONFIGURACAO_INVALIDA');
 const l=c.limites;
 if(!l||typeof l!=='object'||Array.isArray(l)||Object.keys(l).length!==5||Object.keys(l).some(k=>!['maxChamadas','custoPorChamadaCentavos','maxCustoCentavos','maxDuracaoMs','timeoutChamadaMs'].includes(k)))throw Error('AGENTE_LIMITES_INVALIDOS');
 if (!l||!Object.values(l).every(v=>Number.isSafeInteger(v)&&v>=0)||l.maxChamadas<1||l.maxChamadas>5||l.maxDuracaoMs<1000||l.maxDuracaoMs>60000||l.timeoutChamadaMs<100||l.timeoutChamadaMs>l.maxDuracaoMs||l.custoPorChamadaCentavos>10000||l.maxCustoCentavos>30000)throw Error('AGENTE_LIMITES_INVALIDOS');
 if (c.modo!=='desligado'&&(l.custoPorChamadaCentavos<1||l.maxCustoCentavos<l.custoPorChamadaCentavos||c.custoCentavosDia<l.custoPorChamadaCentavos))throw Error('AGENTE_ORCAMENTO_NAO_AUTORIZADO');
}

/** Callback da recepção, dentro do commit da mensagem. Importadores nunca o
 * chamam. Releitura confirma autoria/ID/versão e flag de histórico, sem backfill. */
export async function programarMensagemAgenteTx(tx: PoolClient, p: {empresaId:string;conversaId:string;mensagemId:string;versao:number;conteudo:string;tipo:string}) {
 if (!/^[A-Za-z0-9_-]{1,100}$/.test(p.empresaId)||!id.test(p.conversaId)||!id.test(p.mensagemId)||!Number.isSafeInteger(p.versao)||p.versao<1||typeof p.conteudo!=='string'||p.conteudo.length>65536)throw Error('AGENTE_MENSAGEM_INVALIDA');
 const r=await tx.query<{contato_id:string;estado:string;versao:string;importada:boolean;autor:string;conteudo:string;tipo:string;interno:boolean;elegivel:boolean}>(`SELECT c.contato_id,c.estado,c.versao,m.importada,m.autor,m.conteudo,m.tipo,(ct.memoria->>'destinatarioInterno'='alerta_apoio' OR f.conteudo->'alertaApoio'->>'habilitado'='true' AND f.conteudo->'alertaApoio'->>'telefone'=ct.telefone) interno,EXISTS(SELECT 1 FROM atendimento_operacao.agente_controle g JOIN atendimento_operacao.configuracao a ON a.chave='agente' WHERE g.empresa_id=$3 AND g.ativada_em IS NOT NULL AND m.criada_em>g.ativada_em AND a.conteudo->>'modo'='automatico' AND a.conteudo->>'autoridadeAutomatica'='true') elegivel FROM atendimento_operacao.conversa c JOIN atendimento_operacao.contato ct ON ct.id=c.contato_id JOIN atendimento_operacao.mensagem m ON m.conversa_id=c.id LEFT JOIN atendimento_operacao.configuracao f ON f.chave='agente_legado' WHERE c.id=$1 AND m.id=$2`,[p.conversaId,p.mensagemId,p.empresaId]);
 const v=r.rows[0]; if (!v||!v.elegivel||v.interno||v.importada||v.autor!=='cliente'||v.estado!=='ia'||Number(v.versao)!==p.versao||v.conteudo!==p.conteudo||v.tipo!==p.tipo)return {agendada:false} as const;
 await tx.query("UPDATE atendimento_operacao.timer SET estado='cancelado' WHERE conversa_id=$1 AND estado='pendente' AND versao_conversa IS DISTINCT FROM $2",[p.conversaId,p.versao]);
 // O histórico mantém o conteúdo integral. Texto além do limite do modelo
 // exige apoio humano, sem impedir o commit da recepção nem inferir um recorte.
 const extensa=p.conteudo.length>4000||['document','video','unsupported'].includes(p.tipo);
 const tarefa:TarefaIA={id:hashId(`agente:${p.empresaId}:${p.mensagemId}`),atorId:'service:donatella-ia',empresaId:p.empresaId,conversaId:p.conversaId,clienteId:v.contato_id,versao:p.versao,mensagemOrigemId:p.mensagemId,pergunta:p.conteudo.trim().slice(0,4000)||'O cliente enviou uma mídia. Confira o conteúdo preservado.',tema:extensa?'excecao':temaPergunta(p.conteudo),...(['image','audio'].includes(p.tipo)?{midia:{tipo:p.tipo==='image'?'imagem' as const:'audio' as const,preservada:false}}:{})};
 await tx.query(`INSERT INTO atendimento_operacao.agente_tarefa(id,empresa_id,conversa_id,mensagem_id,versao_conversa,tarefa,hash,configuracao_versao) SELECT $1,$2,$3,$4,$5,$6::jsonb,$7,versao FROM atendimento_operacao.configuracao WHERE chave='agente' ON CONFLICT(mensagem_id) DO NOTHING`,[tarefa.id,p.empresaId,p.conversaId,p.mensagemId,p.versao,JSON.stringify(tarefa),hashTarefa(tarefa)]);
 return {agendada:true,tarefaId:tarefa.id} as const;
}

export class RepositorioAgentePg implements RepositorioIA {
 constructor(readonly pool:Pool,readonly empresaId:string) {if(!/^[A-Za-z0-9_-]{1,100}$/.test(empresaId))throw Error('AGENTE_EMPRESA_INVALIDA');}
 private async tx<T>(executar:(tx:PoolClient)=>Promise<T>) {
  const c=await this.pool.connect();try {await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='5s'"); const b=await c.query<{nome:string}>('SELECT current_database() nome');if(!['donatella_operacao','donatella_ensaio_operacao'].includes(b.rows[0]?.nome))throw Error('DESTINO_AGENTE_RECUSADO');const r=await executar(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK').catch(()=>undefined);throw e;}finally{c.release();}
 }
 async configuracao():Promise<{configuracao:ConfiguracaoAgente;versao:number;skills:ConfiguracaoSkillsAgente;tom:TomAgente}> {return this.tx(async tx=>{
  const r=await tx.query<{conteudo:ConfiguracaoAgente;versao:string;skills:ConfiguracaoSkillsAgente;tom:TomAgente}>(`SELECT a.conteudo,a.versao,s.conteudo skills,t.conteudo tom FROM atendimento_operacao.configuracao a LEFT JOIN atendimento_operacao.configuracao s ON s.chave='agente_skills' LEFT JOIN atendimento_operacao.configuracao t ON t.chave='agente_tom' WHERE a.chave='agente'`);const c=r.rows[0];if(!c)throw Error('AGENTE_CONFIGURACAO_AUSENTE');
  const skills=c.skills??SKILLS_AGENTE_PADRAO,tom=c.tom??TOM_AGENTE_PADRAO;validarConfiguracaoAgente(c.conteudo);validarSkillsAgente(skills);validarTomAgente(tom);return {configuracao:normalizarConfiguracaoAgente(c.conteudo),versao:Number(c.versao),skills,tom};
 });}
 async configuracaoVigente(t:TarefaIA,versao?:number):Promise<boolean>{return this.tx(async tx=>{
  const r=await tx.query(`SELECT 1 FROM atendimento_operacao.agente_tarefa a JOIN atendimento_operacao.configuracao c ON c.chave='agente' AND c.versao=a.configuracao_versao WHERE a.id=$1 AND a.empresa_id=$2 AND a.hash=$3 AND ($4::bigint IS NULL OR c.versao=$4)`,[t.id,this.empresaId,hashTarefa(t),versao??null]);return r.rowCount===1;
 });}
 async contexto(t:TarefaIA):Promise<ContextoIA|null> {
  if(t.empresaId!==this.empresaId)return null;
  return this.tx(async tx=>{const r=await tx.query<{contato_id:string;estado:string;versao:string;modo:string}>(`SELECT c.contato_id,c.estado,c.versao,f.conteudo->>'modo' modo FROM atendimento_operacao.conversa c JOIN atendimento_operacao.agente_tarefa a ON a.conversa_id=c.id JOIN atendimento_operacao.configuracao f ON f.chave='agente' AND f.versao=a.configuracao_versao WHERE c.id=$1 AND a.id=$2 AND a.empresa_id=$3`,[t.conversaId,t.id,this.empresaId]);const c=r.rows[0];return c?{empresaId:this.empresaId,conversaId:t.conversaId,clienteId:c.contato_id,versao:Number(c.versao),estado:c.estado==='ia'?'ia':c.estado==='encerrada'?'encerrada':'humano',modo:c.modo==='automatico'?'automatico':'rascunho'}:null;});
 }
 async proxima():Promise<TarefaIA|null> {return this.tx(async tx=>{const r=await tx.query<{tarefa:TarefaIA}>(`SELECT a.tarefa FROM atendimento_operacao.agente_tarefa a CROSS JOIN atendimento_operacao.configuracao f WHERE a.empresa_id=$1 AND f.chave='agente' AND (a.decisao IS NULL OR a.decisao->>'estado'='apoio_pendente' AND a.atualizada_em<now()-interval '30 seconds' OR a.decisao->>'estado'='rascunho' AND a.automatico_preparado AND a.emitida_em IS NULL AND f.conteudo->>'modo'='automatico' AND f.conteudo->>'autoridadeAutomatica'='true') AND (a.lease_ate IS NULL OR a.lease_ate<=now()) ORDER BY a.criada_em,a.id LIMIT 1`,[this.empresaId]);return r.rows[0]?.tarefa??null;});}
 async reservar(t:TarefaIA,agora:number,leaseMs:number) {
  if(!contextoAtualIA(t,await this.contexto(t)))return null;
  return this.tx(async tx=>{
   const cfg=await travarConfiguracaoTx(tx);
   const r=await tx.query<{hash:string;decisao:DecisaoIA|null;lease:string|null;lease_ate:Date|null;configuracao_versao:string}>('SELECT hash,decisao,lease,lease_ate,configuracao_versao FROM atendimento_operacao.agente_tarefa WHERE id=$1 AND empresa_id=$2 FOR UPDATE',[t.id,this.empresaId]);const a=r.rows[0];if(!a||a.hash!==hashTarefa(t))throw Error('AGENTE_TAREFA_DIVERGENTE');if(a.configuracao_versao!==cfg.versao)return null;
   if(a.decisao&&a.decisao.estado!=='apoio_pendente')return {lease:a.lease??'',decisao:a.decisao};if(a.lease_ate&&a.lease_ate.getTime()>agora)return null;
   const lease=randomUUID();await tx.query('UPDATE atendimento_operacao.agente_tarefa SET lease=$2,lease_ate=$3,atualizada_em=now() WHERE id=$1',[t.id,lease,new Date(agora+leaseMs)]);return {lease,...(a.decisao?{decisao:a.decisao}:{})};
  });
 }
 async reservarChamada(tarefaId:string,lease:string,limites:LimitesIA,agora:number) {
  return this.tx(async tx=>{
   const cfg=await travarConfiguracaoTx(tx);
   const a=(await tx.query<{tarefa:TarefaIA;lease:string;lease_ate:Date;decisao:DecisaoIA|null;chamadas:number;custo_reservado_centavos:string;configuracao_versao:string}>('SELECT * FROM atendimento_operacao.agente_tarefa WHERE id=$1 AND empresa_id=$2 FOR UPDATE',[tarefaId,this.empresaId])).rows[0];
   if(!a||a.configuracao_versao!==cfg.versao||a.lease!==lease||!a.lease_ate||a.lease_ate.getTime()<=agora||a.decisao||a.chamadas>=limites.maxChamadas||Number(a.custo_reservado_centavos)+limites.custoPorChamadaCentavos>limites.maxCustoCentavos)return false;
   const c=(await tx.query<{estado:string;versao:string}>('SELECT estado,versao FROM atendimento_operacao.conversa WHERE id=$1 FOR SHARE',[a.tarefa.conversaId])).rows[0];if(c?.estado!=='ia'||Number(c.versao)!==a.tarefa.versao)return false;
   const config=cfg.conteudo;
   if(!config||config.modo==='desligado'||config.custoCentavosDia<limites.custoPorChamadaCentavos)return false;
   const dia=new Date(agora).toISOString().slice(0,10);await tx.query('INSERT INTO atendimento_operacao.agente_orcamento(empresa_id,dia) VALUES($1,$2) ON CONFLICT DO NOTHING',[this.empresaId,dia]);
   const b=await tx.query('UPDATE atendimento_operacao.agente_orcamento SET reservado_centavos=reservado_centavos+$3 WHERE empresa_id=$1 AND dia=$2 AND reservado_centavos+$3<=$4 RETURNING reservado_centavos',[this.empresaId,dia,limites.custoPorChamadaCentavos,config.custoCentavosDia]);if(b.rowCount!==1)return false;
   await tx.query('UPDATE atendimento_operacao.agente_tarefa SET chamadas=chamadas+1,custo_reservado_centavos=custo_reservado_centavos+$2,atualizada_em=now() WHERE id=$1',[tarefaId,limites.custoPorChamadaCentavos]);return true;
  });
 }
 async preservarApoio(t:TarefaIA,lease:string,d:PendenciaApoioIA,agora:number):Promise<PendenciaApoioIA|null> {return this.tx(async tx=>{
  const cfg=await travarConfiguracaoTx(tx);
  const r=await tx.query<{decisao:DecisaoIA|null}>(`SELECT decisao FROM atendimento_operacao.agente_tarefa WHERE id=$1 AND empresa_id=$2 AND hash=$3 AND lease=$4 AND lease_ate>$5 AND configuracao_versao=$6 FOR UPDATE`,[t.id,this.empresaId,hashTarefa(t),lease,new Date(agora),cfg.versao]);const a=r.rows[0];if(!a||a.decisao&&a.decisao.estado!=='apoio_pendente')return null;
  if(a.decisao?.estado==='apoio_pendente'&&(a.decisao.motivo!==d.motivo||JSON.stringify(a.decisao.fontes)!==JSON.stringify(d.fontes)))throw Error('AGENTE_APOIO_DIVERGENTE');
  await tx.query('UPDATE atendimento_operacao.agente_tarefa SET decisao=$2::jsonb,atualizada_em=now() WHERE id=$1',[t.id,JSON.stringify(d)]);return d;
 });}
 async concluir(t:TarefaIA,lease:string,d:DecisaoIA,agora:number):Promise<DecisaoIA|null> {return this.tx(async tx=>{
  const cfg=await travarConfiguracaoTx(tx);
  const a=(await tx.query<{decisao:DecisaoIA|null;configuracao_versao:string}>(`SELECT decisao,configuracao_versao FROM atendimento_operacao.agente_tarefa WHERE id=$1 AND empresa_id=$2 AND hash=$3 AND lease=$4 AND lease_ate>$5 FOR UPDATE`,[t.id,this.empresaId,hashTarefa(t),lease,new Date(agora)])).rows[0];if(!a)return null;if(a.decisao&&a.decisao.estado!=='apoio_pendente')return a.decisao;
  const c=(await tx.query<{estado:string;versao:string}>('SELECT estado,versao FROM atendimento_operacao.conversa WHERE id=$1 FOR SHARE',[t.conversaId])).rows[0];let final:DecisaoIA=c?.estado==='ia'&&Number(c.versao)===t.versao&&a.configuracao_versao===cfg.versao?d:{estado:'invalidado',motivo:'CONTEXTO_OU_CONFIGURACAO_INVALIDO',fontes:[],enviosReais:false};
  if(final.estado==='rascunho'&&final.texto&&final.motivo!=='FORA_HORARIO'&&final.motivo!==MOTIVO_RESPOSTA_REDIGIDA){
   const estilizado=comporTextoAgente([final.texto],cfg.tom??TOM_AGENTE_PADRAO);
   final=estilizado.length<=4096?{...final,texto:estilizado}:{estado:'invalidado',motivo:'AGENTE_ESTILO_LIMITE_EXCEDIDO',fontes:final.fontes,enviosReais:false};
  }
  await tx.query(`UPDATE atendimento_operacao.agente_tarefa SET decisao=$2::jsonb,automatico_preparado=($2::jsonb->>'estado'='rascunho' AND EXISTS(SELECT 1 FROM atendimento_operacao.configuracao WHERE chave='agente' AND conteudo->>'modo'='automatico' AND conteudo->>'autoridadeAutomatica'='true')),lease=NULL,lease_ate=NULL,atualizada_em=now() WHERE id=$1`,[t.id,JSON.stringify(final)]);return final;
 });}
 async invalidarObsoleta(t:TarefaIA) {return this.tx(async tx=>{const cfg=await travarConfiguracaoTx(tx);const r=await tx.query(`UPDATE atendimento_operacao.agente_tarefa a SET decisao_invalidada=coalesce(a.decisao_invalidada,a.decisao),decisao='{"estado":"invalidado","motivo":"CONTEXTO_OU_CONFIGURACAO_INVALIDO","fontes":[],"enviosReais":false}'::jsonb,lease=NULL,lease_ate=NULL,atualizada_em=now() FROM atendimento_operacao.conversa c WHERE a.id=$1 AND a.empresa_id=$2 AND c.id=a.conversa_id AND (c.estado<>'ia' OR c.versao<>a.versao_conversa OR a.configuracao_versao<>$3) AND (a.decisao IS NULL OR a.decisao->>'estado'='apoio_pendente' OR a.decisao->>'estado'='rascunho' AND a.intencao_id IS NULL)`,[t.id,this.empresaId,cfg.versao]);return r.rowCount===1;});}
 async reservarMidia(t:TarefaIA,custoCentavos:number) {return this.tx(async tx=>{
  if(!Number.isSafeInteger(custoCentavos)||custoCentavos<1)throw Error('VOZ_ORCAMENTO_INVALIDO');
  const cfg=await travarConfiguracaoTx(tx);
  const a=(await tx.query<{midia_estado:string;configuracao_versao:string;custo_reservado_centavos:string}>(`SELECT midia_estado,configuracao_versao,custo_reservado_centavos FROM atendimento_operacao.agente_tarefa WHERE id=$1 AND empresa_id=$2 AND hash=$3 FOR UPDATE`,[t.id,this.empresaId,hashTarefa(t)])).rows[0];if(a?.midia_estado!=='pendente'||a.configuracao_versao!==cfg.versao||Number(a.custo_reservado_centavos)+custoCentavos>cfg.conteudo.limites.maxCustoCentavos)return false;
  const c=cfg.conteudo;if(c.modo==='desligado')return false;
  const dia=new Date().toISOString().slice(0,10);await tx.query('INSERT INTO atendimento_operacao.agente_orcamento(empresa_id,dia) VALUES($1,$2) ON CONFLICT DO NOTHING',[this.empresaId,dia]);
  const r=await tx.query(`UPDATE atendimento_operacao.agente_orcamento SET reservado_centavos=reservado_centavos+$3 WHERE empresa_id=$1 AND dia=$2 AND reservado_centavos+$3<=$4 RETURNING dia`,[this.empresaId,dia,custoCentavos,c.custoCentavosDia]);if(r.rowCount!==1)return false;await tx.query("UPDATE atendimento_operacao.agente_tarefa SET midia_estado='processando',custo_reservado_centavos=custo_reservado_centavos+$2 WHERE id=$1",[t.id,custoCentavos]);return true;
 });}
 async prepararMidia(t:TarefaIA,p:{pergunta:string;midia:NonNullable<TarefaIA['midia']>}) {return this.tx(async tx=>{
  const cfg=await travarConfiguracaoTx(tx);
  const nova={...t,...p,tema:temaPergunta(p.pergunta)};
  const r=await tx.query(`UPDATE atendimento_operacao.agente_tarefa SET tarefa=$3::jsonb,hash=$4,midia_estado=$5,atualizada_em=now() WHERE id=$1 AND empresa_id=$2 AND decisao IS NULL AND lease IS NULL AND configuracao_versao=$6 RETURNING tarefa`,[t.id,this.empresaId,JSON.stringify(nova),hashTarefa(nova),p.midia.preservada?'concluida':'indisponivel',cfg.versao]);return r.rowCount===1?nova:t;
 });}
 async contextoRecente(t:TarefaIA) {return this.tx(async tx=>{
  const r=await tx.query<{autor:'cliente'|'humano'|'ia';conteudo:string}>(`SELECT autor,left(conteudo,2000) conteudo FROM atendimento_operacao.mensagem WHERE conversa_id=$1 AND (criada_em,id)<=(SELECT criada_em,id FROM atendimento_operacao.mensagem WHERE id=$2) ORDER BY criada_em DESC,id DESC LIMIT 20`,[t.conversaId,t.mensagemOrigemId]);return r.rows.reverse().map(m=>({autor:m.autor,texto:m.conteudo}));
 });}
 async observar() {return this.tx(async tx=>{
  const r=await tx.query(`SELECT count(*)::int total,count(*) FILTER(WHERE decisao IS NULL)::int pendentes,count(*) FILTER(WHERE decisao->>'estado' IN ('apoio_pendente','aguardando_apoio'))::int apoio,count(*) FILTER(WHERE decisao->>'estado'='rascunho')::int rascunhos,count(*) FILTER(WHERE decisao->>'motivo' IN ('PROVEDOR_OU_LIMITE_INDISPONIVEL','FERRAMENTA_OU_LIMITE_INDISPONIVEL') OR decisao->>'falha'='APOIO_INDISPONIVEL')::int falhas,max(atualizada_em) ultima_atividade_em FROM atendimento_operacao.agente_tarefa WHERE empresa_id=$1`,[this.empresaId]);
  const motivos=await tx.query(`SELECT decisao->>'motivo' motivo,count(*)::int total FROM atendimento_operacao.agente_tarefa WHERE empresa_id=$1 AND decisao->>'estado' IN ('apoio_pendente','aguardando_apoio') AND decisao->>'motivo' ~ '^[A-Z_]{1,100}$' GROUP BY decisao->>'motivo' ORDER BY total DESC LIMIT 10`,[this.empresaId]);return {...r.rows[0],motivos:motivos.rows};
 });}
 async evento(tarefaId:string|null,codigo:string) {if(!/^[A-Z_]{1,100}$/.test(codigo))throw Error('AGENTE_EVENTO_INVALIDO');return this.tx(tx=>tx.query('INSERT INTO atendimento_operacao.agente_evento(id,tarefa_id,codigo) VALUES($1,$2,$3)',[randomUUID(),tarefaId,codigo]));}
 async iniciarInferencia(t:TarefaIA,versao:number,provedor:ProvedorAgente,modelo:string){return this.tx(async tx=>{
  const cfg=await travarConfiguracaoTx(tx);
  const a=(await tx.query<{chamadas:number;configuracao_versao:string;lease_ate:Date|null;decisao:DecisaoIA|null}>('SELECT chamadas,configuracao_versao,lease_ate,decisao FROM atendimento_operacao.agente_tarefa WHERE id=$1 AND empresa_id=$2 AND hash=$3 FOR UPDATE',[t.id,this.empresaId,hashTarefa(t)])).rows[0];
  if(!a||a.chamadas<1||Number(a.configuracao_versao)!==versao||Number(cfg.versao)!==versao||a.decisao||!a.lease_ate||a.lease_ate.getTime()<=Date.now()||(cfg.conteudo.provedor??'anthropic')!==provedor||cfg.conteudo.modelo!==modelo)throw Error('AGENTE_INFERENCIA_SEM_RESERVA');
  if((await tx.query("SELECT 1 FROM atendimento_operacao.agente_consumo WHERE tarefa_id=$1 AND operacao='inferencia' AND (concluida_em IS NULL OR resultado='incerta')",[t.id])).rowCount)throw Error('AGENTE_INFERENCIA_INCERTA_RECONCILIAR');
  const consumo={observado:false};const h=hashConfiguracaoAgente({provedor,modelo,resultado:'incerta',consumo});
  const r=await tx.query("INSERT INTO atendimento_operacao.agente_consumo(id,tarefa_id,empresa_id,configuracao_versao,operacao,chamada,provedor,modelo,resultado,consumo,hash) VALUES($1,$2,$3,$4,'inferencia',$5,$6,$7,'incerta',$8::jsonb,$9) ON CONFLICT(tarefa_id,operacao,chamada) DO NOTHING RETURNING id",[randomUUID(),t.id,this.empresaId,versao,a.chamadas,provedor,modelo,JSON.stringify(consumo),h]);if(r.rowCount!==1)throw Error('AGENTE_INFERENCIA_JA_INICIADA');
 });}
 async registrarConsumo(t:TarefaIA,o:ObservacaoConsumoIA){
  if(!['anthropic','google','openai'].includes(o.provedor)||!['concluida','truncada','incerta','recusada'].includes(o.resultado)||!texto(o.modelo,90)||typeof o.consumo?.observado!=='boolean')throw Error('AGENTE_CONSUMO_INVALIDO');
  const consumo:Record<string,string|number|boolean>={observado:o.consumo.observado};
  for(const k of ['tokensEntrada','tokensSaida','tokensTotal','tokensCacheLeitura','tokensCacheGravacao','tokensRaciocinio','tokensFerramentas'] as const){const v=o.consumo[k];if(v!==undefined){if(!Number.isSafeInteger(v)||v<0||v>1_000_000_000)throw Error('AGENTE_CONSUMO_INVALIDO');consumo[k]=v;}}
  for(const k of ['modeloObservado','respostaId','requisicaoId'] as const){const v=o.consumo[k];if(v!==undefined){if(typeof v!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(v))throw Error('AGENTE_CONSUMO_INVALIDO');consumo[k]=v;}}
  return this.tx(async tx=>{
   // A reserva permanece mesmo quando a configuração mudou em plena chamada.
   // Metadados do fornecedor são preservados sem conteúdo, prompt ou credencial.
   const a=(await tx.query<{chamadas:number;configuracao_versao:string}>('SELECT chamadas,configuracao_versao FROM atendimento_operacao.agente_tarefa WHERE id=$1 AND empresa_id=$2 AND hash=$3 FOR UPDATE',[t.id,this.empresaId,hashTarefa(t)])).rows[0];if(!a||a.chamadas<1)throw Error('AGENTE_CONSUMO_SEM_RESERVA');
   const h=hashConfiguracaoAgente({provedor:o.provedor,modelo:o.modelo,resultado:o.resultado,consumo});
   const r=await tx.query("UPDATE atendimento_operacao.agente_consumo SET resultado=$4,consumo=$5::jsonb,hash=$6,concluida_em=now() WHERE tarefa_id=$1 AND operacao='inferencia' AND chamada=$2 AND provedor=$3 AND modelo=$7 AND concluida_em IS NULL RETURNING id",[t.id,a.chamadas,o.provedor,o.resultado,JSON.stringify(consumo),h,o.modelo]);
   if(!r.rowCount){const antiga=(await tx.query<{hash:string}>("SELECT hash FROM atendimento_operacao.agente_consumo WHERE tarefa_id=$1 AND operacao='inferencia' AND chamada=$2",[t.id,a.chamadas])).rows[0];if(antiga?.hash!==h)throw Error('AGENTE_CONSUMO_DIVERGENTE');}
  });
 }
 async registrarConsumoVoz(t:TarefaIA,o:ObservacaoConsumoVoz){
  if(!['transcricao','sintese'].includes(o.operacao)||o.provedor!=='elevenlabs'||!['concluida','incerta','recusada'].includes(o.resultado)||!texto(o.modelo,90)||typeof o.consumo?.observado!=='boolean')throw Error('AGENTE_CONSUMO_VOZ_INVALIDO');
  const consumo:Record<string,string|number|boolean>={observado:o.consumo.observado};
  for(const k of ['duracaoEntradaMs','caracteresEntrada','caracteresCobrados'] as const){const v=o.consumo[k];if(v!==undefined){if(!Number.isFinite(v)||v<0||v>10_000_000||k==='caracteresEntrada'&&!Number.isSafeInteger(v))throw Error('AGENTE_CONSUMO_VOZ_INVALIDO');consumo[k]=v;}}
  for(const k of ['requisicaoId','rastreioId'] as const){const v=o.consumo[k];if(v!==undefined){if(typeof v!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(v))throw Error('AGENTE_CONSUMO_VOZ_INVALIDO');consumo[k]=v;}}
  return this.tx(async tx=>{
   const a=(await tx.query<{configuracao_versao:string;midia_estado:string;resposta_audio_estado:string}>('SELECT configuracao_versao,midia_estado,resposta_audio_estado FROM atendimento_operacao.agente_tarefa WHERE id=$1 AND empresa_id=$2 FOR UPDATE',[t.id,this.empresaId])).rows[0];if(!a||(o.operacao==='transcricao'?a.midia_estado:a.resposta_audio_estado)!=='processando')throw Error('AGENTE_CONSUMO_VOZ_SEM_RESERVA');
   const h=hashConfiguracaoAgente({...o,consumo});const r=await tx.query('INSERT INTO atendimento_operacao.agente_consumo(id,tarefa_id,empresa_id,configuracao_versao,operacao,chamada,provedor,modelo,resultado,consumo,hash,concluida_em) VALUES($1,$2,$3,$4,$5,1,$6,$7,$8,$9::jsonb,$10,now()) ON CONFLICT(tarefa_id,operacao,chamada) DO NOTHING RETURNING id',[randomUUID(),t.id,this.empresaId,a.configuracao_versao,o.operacao,o.provedor,o.modelo,o.resultado,JSON.stringify(consumo),h]);
   if(!r.rowCount){const antiga=(await tx.query<{hash:string}>('SELECT hash FROM atendimento_operacao.agente_consumo WHERE tarefa_id=$1 AND operacao=$2 AND chamada=1',[t.id,o.operacao])).rows[0];if(antiga?.hash!==h)throw Error('AGENTE_CONSUMO_VOZ_DIVERGENTE');}
  });
 }
}
