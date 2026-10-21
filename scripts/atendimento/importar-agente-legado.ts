// Apenas a base já materializada é lida. Nenhuma chamada à origem ou fornecedor.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Pool} from 'pg';
import type {HorariosAgente} from '../../src/lib/atendimento/operacao-horarios';
const arquivo=process.env.DONATELLA_IMPORTACAO_CONFIG;if(!arquivo)throw Error('CONFIGURACAO_PRIVADA_EXIGIDA');
const c=JSON.parse(await readFile(arquivo,'utf8'));
function url(v:unknown,host:string,bancos:string[]){if(typeof v!=='string')throw Error('IMPORTACAO_CONFIGURACAO_INVALIDA');const u=new URL(v);if(u.protocol!=='postgresql:'||u.hostname!==host||!bancos.includes(u.pathname.slice(1))||!u.password||u.search||u.hash)throw Error('IMPORTACAO_BANCO_RECUSADO');return v;}
const origem=new Pool({connectionString:url(c.origemDatabaseUrl,'grazing-donatella-homologacao-v2-banco',['donatella_preparacao']),max:1,options:'-c default_transaction_read_only=on',statement_timeout:10000});
const destino=new Pool({connectionString:url(c.destinoDatabaseUrl,'grazing-donatella-operacao-v2-banco',['donatella_operacao']),max:1,statement_timeout:10000});
const limiteTexto=(v:unknown,n:number)=>typeof v==='string'?v.slice(0,n):'';
const hh=(v:unknown)=>typeof v==='string'&&/^([01]\d|2[0-3]):[0-5]\d/.test(v)?v.slice(0,5):null;
function canonico(v:unknown):unknown{if(Array.isArray(v))return v.map(canonico);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonico((v as Record<string,unknown>)[k])]));return v;}
const serializar=(v:unknown)=>JSON.stringify(canonico(v===undefined?null:JSON.parse(JSON.stringify(v))));
try {
 const settings=await origem.query(`SELECT id,is_active,auto_response_enabled,system_prompt_override,company_name,sdr_name,timezone,business_hours_start::text,business_hours_end::text,business_days,out_of_hours_auto_reply,out_of_hours_cooldown_minutes,welcome_followup_enabled,welcome_followup_minutes,welcome_followup_message,audio_response_enabled,support_alert_enabled,support_alert_phone,support_alert_template,async_booking_enabled,ai_scheduling_enabled,updated_at FROM donatella_public.nina_settings ORDER BY (user_id IS NULL) DESC,updated_at DESC,id LIMIT 2`);
 if(settings.rows.length!==1)throw Error('AGENTE_LEGADO_CONFIGURACAO_AMBIGUA');
 const s=settings.rows[0],[e,f]=await Promise.all([origem.query('SELECT team_id,day_of_week,is_open,start_time::text,end_time::text FROM donatella_public.team_business_hours ORDER BY team_id,day_of_week'),origem.query('SELECT team_id,date::text,is_open,start_time::text,end_time::text FROM donatella_public.team_holidays ORDER BY date,team_id')]);
 const horarios:HorariosAgente={timezone:limiteTexto(s.timezone,100),inicio:hh(s.business_hours_start)??'',fim:hh(s.business_hours_end)??'',dias:s.business_days,equipes:e.rows.map(v=>({equipeId:v.team_id,dia:v.day_of_week,aberto:v.is_open,inicio:hh(v.start_time),fim:hh(v.end_time)})),feriados:f.rows.map(v=>({equipeId:v.team_id,data:v.date,aberto:v.is_open,inicio:hh(v.start_time),fim:hh(v.end_time)})),respostaForaHorario:limiteTexto(s.out_of_hours_auto_reply,4000),cooldownMinutos:Number.isInteger(s.out_of_hours_cooldown_minutes)&&s.out_of_hours_cooldown_minutes>=1?s.out_of_hours_cooldown_minutes:360};
 const original=limiteTexto(s.system_prompt_override,60000),hash=createHash('sha256').update(original).digest('hex');
 // Prompt é referência interna, não aprovação automática de preços/conhecimento.
 // A lista de campos consultados não contém tokens, chaves ou senhas.
 const suspeito=/\b(?:sk-ant-|sk_live_|Bearer\s+\S+|(?:api[_ -]?key|secret|password|senha|token)\s*[:=]\s*[A-Za-z0-9/+_-]{16,})/i.test(original);
 const minutos=Number.isInteger(s.welcome_followup_minutes)?Math.max(5,s.welcome_followup_minutes):60;
 const texto=typeof s.welcome_followup_message==='string'&&s.welcome_followup_message.length<=4096?s.welcome_followup_message.trim():'';
 const followup={habilitado:s.welcome_followup_enabled===true&&minutos<=1440&&!!texto,minutos:Math.min(1440,minutos),texto};
 const alertaApoio={habilitado:s.support_alert_enabled===true,telefone:typeof s.support_alert_phone==='string'?s.support_alert_phone.replace(/\D/g,''):'',modeloNome:typeof s.support_alert_template==='string'?s.support_alert_template.trim():''};
 const legado={id:s.id,atualizadaEm:s.updated_at,promptHash:hash,promptReferencia:suspeito?'':original,promptLimite:original.length>=60000?'truncado':suspeito?'retido_por_credencial_suspeita':'preservado',companyName:limiteTexto(s.company_name,160),sdrName:limiteTexto(s.sdr_name,80),eraAtivo:s.is_active===true,respostasAutomaticasOrigem:s.auto_response_enabled===true,horarios,followup,alertaApoio,comportamentos:{respostaAudio:s.audio_response_enabled===true,alertaApoio:s.support_alert_enabled===true,reservaAssincrona:s.async_booking_enabled===true,agendaIa:s.ai_scheduling_enabled===true},followupLimite:minutos>1440?'fora_da_janela_24h':typeof s.welcome_followup_message==='string'&&s.welcome_followup_message.length>4096?'texto_incompativel':'preservado'};
 const tx=await destino.connect();try{await tx.query('BEGIN');await tx.query("SET LOCAL lock_timeout='2s'");await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('importar-agente-legado',0))");
  const anterior=(await tx.query("SELECT conteudo FROM atendimento_operacao.configuracao WHERE chave='agente_legado' FOR UPDATE")).rows[0]?.conteudo;
  const mudou=serializar(anterior)!==serializar(legado);
  if(mudou)await tx.query("INSERT INTO atendimento_operacao.configuracao(chave,conteudo) VALUES('agente_legado',$1::jsonb) ON CONFLICT(chave) DO UPDATE SET conteudo=excluded.conteudo,versao=atendimento_operacao.configuracao.versao+1,atualizada_em=now()",[JSON.stringify(legado)]);
  // Inicializar a tela com horários da origem apenas quando ainda não há
  // configuração local. Uma revisão humana no destino nunca é sobrescrita.
  await tx.query("INSERT INTO atendimento_operacao.configuracao(chave,conteudo) VALUES('atendimento',$1::jsonb) ON CONFLICT(chave) DO NOTHING",[JSON.stringify({agente:{modo:'desligado',modelo:''},horarios:{inicio:horarios.inicio,fim:horarios.fim,dias:horarios.dias},automacoes:false})]);
  await tx.query('COMMIT');console.log(JSON.stringify({fase:'configuracao_agente_preservada',mudou,horariosEquipes:e.rowCount,feriados:f.rowCount,promptHash:hash,promptLimite:legado.promptLimite,followupConfigurado:followup.habilitado,followupMinutos:followup.minutos,followupLimite:legado.followupLimite,followupHash:createHash('sha256').update(texto).digest('hex'),origem:'materializada',fornecedoresChamados:0,iaAtivada:false}));
 }catch(erro){await tx.query('ROLLBACK').catch(()=>undefined);throw erro;}finally{tx.release();}
}finally{await Promise.all([origem.end(),destino.end()]);}
