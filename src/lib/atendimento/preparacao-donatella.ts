import 'server-only';
import {randomUUID} from 'node:crypto';
import type {IdentidadeOperacao,AcaoOperacao} from './operacao-tipos';
import {validarIdOperacao} from './operacao-tipos';
import type {RepositorioOperacaoPg} from './operacao-repositorio-pg';
import {hashConfiguracaoAgente,invalidarConfiguracaoAgenteTx,validarConfiguracaoAgente,validarSkillsAgente,validarTomAgente,type ConfiguracaoAgente,type ConfiguracaoSkillsAgente,type SkillAgente,type TomAgente} from './repositorio-agente-pg';
import type {CandidatoConhecimento,VersaoConhecimento,CategoriaConhecimento} from './duvidas-aprendizagem';

export const DOCUMENTO_PREPARACAO_DONATELLA='PROMPT_DONATELLA_IA_PRONTA_PARA_LIGAR.md';
const autorizacao='pedido_proprietario_2026-10-19';
const fonteCasoId='documento:'+DOCUMENTO_PREPARACAO_DONATELLA;
const modelosPermitidos=['claude-sonnet-4-5','claude-sonnet-4-5-20250929'];
const permissoes:AcaoOperacao[]=['ia.editar','tom.editar','skills.visualizar','skills.adicionar','skills.editar','skills.excluir','conhecimento.adicionar','conhecimento.editar'];
export const CONHECIMENTO_DOCUMENTAL_DONATELLA:readonly {chave:string;pergunta:string;resposta:string;categoria:CategoriaConhecimento}[]=[
 {chave:'identidade',pergunta:'Procedimento de atendimento: quem é Donatella e como começa a triagem?',resposta:'Sou a Donatella, assistente virtual da Grazing Table & Co. Posso acolher sua solicitação e ajudar na triagem de tábuas, presentes e eventos.',categoria:'procedimento'},
 {chave:'produtos',pergunta:'Produto: orientação sobre tábuas, presentes e eventos.',resposta:'A Grazing Table & Co. atende solicitações sobre tábuas, presentes e eventos. A equipe humana orienta os próximos passos da solicitação.',categoria:'produto'},
 {chave:'evento',pergunta:'Procedimento: quais informações coletar para encaminhar orçamento de evento?',resposta:'Para encaminhar um orçamento de evento à equipe, informe a ocasião, a data e o número de pessoas.',categoria:'procedimento'},
 {chave:'fontes',pergunta:'Procedimento: como responder sobre preço, estoque, disponibilidade, frete e prazo sem fonte atual?',resposta:'A equipe humana precisa confirmar preço, estoque, disponibilidade, frete e prazo com uma fonte atual antes de informar essas condições.',categoria:'politica'},
];
export const TOM_DOCUMENTAL_DONATELLA:TomAgente={nome:'Donatella',persona:'Assistente virtual da Grazing Table & Co. Atendimento em português brasileiro, cordial, elegante, consultivo e objetivo. Usa frases curtas. Não inventa condições comerciais.',formalidade:'equilibrada',conciso:true,emojis:'moderado',termosPreferidos:[],termosProibidos:[],exemplos:['Para encaminhar seu orçamento de evento à equipe, informe a ocasião, a data e o número de pessoas.']};
function skillsPreparadas(atuais:ConfiguracaoSkillsAgente,atorId:string):ConfiguracaoSkillsAgente{
 const propostas:Omit<SkillAgente,'versao'|'responsavelId'>[]=[
  {id:'recepcao',nome:'Recepção e triagem',finalidade:'Acolher a solicitação, identificar tábuas, presentes ou eventos e consultar apenas a orientação oficial aprovada. Encaminhar à equipe quando faltar uma fonte.',escopo:['procedimento','produto'],habilitada:true,ferramentas:['consultar_conhecimento','solicitar_apoio']},
  {id:'catalogo',nome:'Tábuas e presentes',finalidade:'Orientar sobre tábuas e presentes somente com conhecimento estático aprovado. Não confirmar preço, estoque ou disponibilidade sem fonte atual.',escopo:['produto'],habilitada:true,ferramentas:['consultar_conhecimento','solicitar_apoio']},
  {id:'eventos',nome:'Orçamento de evento',finalidade:'Coletar ocasião, data e número de pessoas para encaminhar um orçamento de evento à equipe. Não confirmar condições comerciais.',escopo:['procedimento','produto'],habilitada:true,ferramentas:['consultar_conhecimento','solicitar_apoio']},
  {id:'conhecimento',nome:'Dúvidas frequentes',finalidade:'Consultar orientação oficial aprovada e vigente. Histórico é contexto e não comprova política comercial atual.',escopo:['procedimento'],habilitada:true,ferramentas:['consultar_conhecimento','solicitar_apoio']},
  {id:'apoio',nome:'Atendimento humano',finalidade:'Encaminhar pedidos de humano, dúvidas sem fonte e exceções à equipe. O apoio obrigatório permanece disponível em qualquer skill.',escopo:['produto','preco','estoque','frete','agenda','pedido','procedimento','alergia','excecao'],habilitada:true,ferramentas:['solicitar_apoio']},
 ];
 const porId=new Map(atuais.skills.map(s=>[s.id,s]));
 for(const proposta of propostas){const anterior=porId.get(proposta.id),igual=anterior&&hashConfiguracaoAgente({...anterior,versao:0,responsavelId:''})===hashConfiguracaoAgente({...proposta,versao:0,responsavelId:''});porId.set(proposta.id,{...proposta,versao:anterior?anterior.versao+(igual?0:1):1,responsavelId:igual?anterior.responsavelId:atorId});}
 // Fontes comerciais e agenda não foram validadas por esta execução. Suas
 // skills ficam preservadas, desativadas, sem autorizar consulta ou fechamento.
 for(const id of ['pedido','entrega','agenda']){const anterior=porId.get(id);if(anterior?.habilitada)porId.set(id,{...anterior,habilitada:false,versao:anterior.versao+1,responsavelId:atorId});}
 const resultado={skills:[...porId.values()]};validarSkillsAgente(resultado);return resultado;
}
type VersaoDocumental=VersaoConhecimento&{fonteDocumento:{nome:string;sha256:string;autorizacao:string}};
export type PedidoPreparacaoDonatella={idempotencia:string;documentoSha256:string;modelo:string;orcamentoMaximoCentavosDia:number};

/** Preparação única autorizada pelo documento do proprietário. Reutiliza
 * configuração, candidatos, revisões e auditorias existentes. Não chama modelo
 * nem cria casos, contatos, conversas ou intenções de envio. */
export async function prepararDonatellaPainel(repo:RepositorioOperacaoPg,i:IdentidadeOperacao,p:PedidoPreparacaoDonatella){
 validarIdOperacao(p.idempotencia);
 if(!/^[a-f0-9]{64}$/.test(p.documentoSha256)||!modelosPermitidos.includes(p.modelo)||p.orcamentoMaximoCentavosDia!==500)throw Error('DONATELLA_PREPARACAO_RECUSADA');
 if(i.tipo!==undefined&&i.tipo!=='usuario')throw Error('OPERACAO_ACESSO_NEGADO');
 return repo.transacao(async tx=>{
  for(const capacidade of permissoes)await repo.exigir(tx,i,capacidade);
  return repo.comando(tx,i,p.idempotencia,{preparacao:autorizacao,...p},async()=>{
   const cfg=(await tx.query<{conteudo:ConfiguracaoAgente;versao:string}>("SELECT conteudo,versao FROM atendimento_operacao.configuracao WHERE chave='agente' FOR UPDATE")).rows[0];
   if(!cfg||cfg.conteudo.modo!=='desligado'||cfg.conteudo.autoridadeAutomatica!==false)throw Error('DONATELLA_PREPARACAO_EXIGE_DESLIGADA');
   await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('atendimento-duvidas:' || $1,0))",['grazing']);
   const secoes=(await tx.query<{chave:string;conteudo:ConfiguracaoSkillsAgente|TomAgente;versao:string}>("SELECT chave,conteudo,versao FROM atendimento_operacao.configuracao WHERE chave IN ('agente_skills','agente_tom') FOR UPDATE")).rows;
   const anteriores=secoes.find(v=>v.chave==='agente_skills')?.conteudo as ConfiguracaoSkillsAgente|undefined;
   if(!anteriores)throw Error('DONATELLA_SKILLS_AUSENTES');
   const skills=skillsPreparadas(anteriores,i.id),tom=TOM_DOCUMENTAL_DONATELLA;
   validarTomAgente(tom);
   const configuracao:ConfiguracaoAgente={...cfg.conteudo,modo:'desligado',autoridadeAutomatica:false,provedor:'anthropic',moedaOrcamento:'USD',modelo:p.modelo,maxTokens:512,custoCentavosDia:500,grupoExterno:'indisponivel',limites:{maxChamadas:3,custoPorChamadaCentavos:50,maxCustoCentavos:150,maxDuracaoMs:45000,timeoutChamadaMs:15000}};
   validarConfiguracaoAgente(configuracao);
   let mudou=hashConfiguracaoAgente(configuracao)!==hashConfiguracaoAgente(cfg.conteudo);
   for(const [chave,conteudo] of [['agente_skills',skills],['agente_tom',tom]] as const){const anterior=secoes.find(v=>v.chave===chave);if(anterior&&hashConfiguracaoAgente(anterior.conteudo)===hashConfiguracaoAgente(conteudo))continue;mudou=true;const r=await tx.query("INSERT INTO atendimento_operacao.configuracao(chave,conteudo) VALUES($1,$2::jsonb) ON CONFLICT(chave) DO UPDATE SET conteudo=excluded.conteudo,versao=atendimento_operacao.configuracao.versao+1,atualizada_em=now() RETURNING versao",[chave,JSON.stringify(conteudo)]);await repo.auditar(tx,i,chave,'preparar_'+chave,Number(r.rows[0].versao));}
   const agora=new Date((await tx.query('SELECT clock_timestamp() agora')).rows[0].agora).toISOString();let criados=0,reutilizados=0;
   for(const fato of CONHECIMENTO_DOCUMENTAL_DONATELLA){
    const fingerprint=hashConfiguracaoAgente({empresaId:'grazing',fonteDocumento:DOCUMENTO_PREPARACAO_DONATELLA,chave:fato.chave});
    const anterior=(await tx.query<{conteudo:CandidatoConhecimento}>('SELECT conteudo FROM atendimento_apoio.candidatos WHERE empresa_id=$1 AND conteudo->>\'fingerprint\'=$2 FOR UPDATE',['grazing',fingerprint])).rows[0]?.conteudo;
    if(anterior){const ultima=anterior.versoes.at(-1) as VersaoDocumental;if(ultima.fonteCasoId!==fonteCasoId)throw Error('DONATELLA_FONTE_DOCUMENTAL_CONFLITANTE');reutilizados++;continue;}
    const versao:VersaoDocumental={versao:1,estado:'aprovado',pergunta:fato.pergunta,resposta:fato.resposta,categoria:fato.categoria,escopo:'oficial',condicoes:'Orientação estática aprovada pelo documento do proprietário. Não comprova condições comerciais mutáveis.',vigenteDe:agora,vigenteAte:'9999-12-31T23:59:59.999Z',autorId:i.id,criadaEm:agora,fonteCasoId,fonteDocumento:{nome:DOCUMENTO_PREPARACAO_DONATELLA,sha256:p.documentoSha256,autorizacao},aprovadorId:i.id,revisadaEm:agora,motivoRevisao:'Conteúdo próprio explicitamente autorizado pelo proprietário no documento desta execução.',conflitos:[],minimizacaoRevisada:true,responsavelId:i.id};
    const candidato:CandidatoConhecimento={id:randomUUID(),empresaId:'grazing',fingerprint,revisao:1,versoes:[versao]};
    await tx.query('INSERT INTO atendimento_apoio.candidatos(empresa_id,id,revisao,conteudo) VALUES($1,$2,1,$3::jsonb)',['grazing',candidato.id,JSON.stringify(candidato)]);
    await tx.query("INSERT INTO atendimento_apoio.revisoes(empresa_id,colecao,entidade_id,revisao,conteudo) VALUES($1,'candidatos',$2,1,$3::jsonb)",['grazing',candidato.id,JSON.stringify(candidato)]);
    await tx.query('INSERT INTO atendimento_apoio.auditoria(empresa_id,id,ator_id,entidade_id,acao,revisao,em,motivo) VALUES($1,$2,$3,$4,$5,1,$6,$7)',['grazing',randomUUID(),i.id,candidato.id,'conhecimento_documental_aprovado',agora,fonteCasoId]);criados++;
   }
   if(criados){mudou=true;await tx.query('INSERT INTO atendimento_apoio.catalogo(empresa_id,epoca) VALUES($1,1) ON CONFLICT(empresa_id) DO UPDATE SET epoca=atendimento_apoio.catalogo.epoca+1',['grazing']);}
   const versao=Number(cfg.versao)+(mudou?1:0);
   if(mudou){await tx.query("UPDATE atendimento_operacao.configuracao SET conteudo=$1::jsonb,versao=versao+1,atualizada_em=now() WHERE chave='agente'",[JSON.stringify(configuracao)]);await invalidarConfiguracaoAgenteTx(tx,'grazing');}
   await repo.auditar(tx,i,'agente','preparar_donatella_documento',versao);
   return {versao,modo:'desligado' as const,autoridadeAutomatica:false,provedor:'anthropic',modelo:p.modelo,fonteDocumento:DOCUMENTO_PREPARACAO_DONATELLA,documentoSha256:p.documentoSha256,conhecimentosCriados:criados,conhecimentosReutilizados:reutilizados,skills:skills.skills.length,enviosExternos:0,inferencias:0};
  });
 });
}
