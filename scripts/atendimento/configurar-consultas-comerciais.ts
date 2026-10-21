import {createHash} from 'node:crypto';
import type {ServicoAgenteOperacional} from '../../src/lib/atendimento/operacao-agente';
import type {ServicoComercialOperacao} from '../../src/lib/atendimento/operacao-comercial';
import type {IdentidadeOperacao} from '../../src/lib/atendimento/operacao-tipos';
import {hashConfiguracaoAgente,validarSkillsAgente,type ConfiguracaoSkillsAgente,type FerramentaSkillAgente} from '../../src/lib/atendimento/repositorio-agente-pg';

const idFixo=(chave:string)=>{const h=createHash('sha256').update('donatella-hub-woo-consultas-20261020:'+chave).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
export const IDS_CONSULTAS_COMERCIAIS=Object.freeze({vinculo:idFixo('vinculo-brie-aprovado'),skills:idFixo('skills-consultas-v3-semantica')});
export const VINCULO_BRIE_APROVADO=Object.freeze({hubId:'e7e82470-0828-4332-8b9a-293a2dbe06e1',produtoWooId:16019,variacaoWooId:null});

export function skillsConsultasComerciais(atual:ConfiguracaoSkillsAgente):ConfiguracaoSkillsAgente{
 validarSkillsAgente(atual);
 if(!['catalogo','pedido'].every(id=>atual.skills.filter(s=>s.id===id).length===1))throw Error('COMERCIAL_SKILLS_EXISTENTES_EXIGIDAS');
 const adicionar=(atuais:FerramentaSkillAgente[],nova:FerramentaSkillAgente)=>[...new Set([...atuais,nova])];
 const resultado:ConfiguracaoSkillsAgente={skills:atual.skills.map(s=>s.id==='catalogo'?{...s,nome:'Recomendar e compartilhar produtos',finalidade:'Recomendar até três opções com as especificações do HUB e a necessidade já informada. Associar automaticamente o anúncio da loja por nome e significado quando quantidade, versão e variação forem compatíveis. Consultar link, preço e disponibilidade atuais no site. Perguntar ao cliente somente preferências ou detalhes que faltam. Pedir apoio humano para dúvida importante, conflito material, alergia ou condição comercial sem fonte. Não prometer prazo ou frete sem confirmação.',escopo:['produto','preco','estoque'],habilitada:true,ferramentas:adicionar(s.ferramentas,'search_products')}:s.id==='pedido'?{...s,nome:'Acompanhar pedido',finalidade:'Consultar a situação atual do pedido do site somente após conferir a identidade da conversa e o telefone completo do comprador. Preservar os itens históricos. Não interpretar status ambíguo como preparo físico ou entrega recebida. Encaminhar divergências à equipe.',habilitada:true,ferramentas:adicionar(s.ferramentas,'get_order')}:{...s})};
 validarSkillsAgente(resultado);return resultado;
}

/** Preparação explícita pelo chamador privado. Importar este módulo não lê
 * arquivos, não chama fornecedores e não executa qualquer alteração. */
export async function configurarConsultasComerciais(d:{agente:ServicoAgenteOperacional;comercial:ServicoComercialOperacao;ator:IdentidadeOperacao},signal:AbortSignal=AbortSignal.timeout(45000)){
 const {agente,comercial,ator}=d;if(ator.tipo!==undefined&&ator.tipo!=='usuario')throw Error('OPERACAO_ACESSO_NEGADO');
 const inicial=await agente.estado(ator);
 const desligada=(v:typeof inicial)=>v.modo==='desligado'&&v.autoridadeAutomatica===false&&v.estadoEfetivo==='desligada';
 if(!desligada(inicial))throw Error('COMERCIAL_PREPARACAO_EXIGE_IA_DESLIGADA');
 const secao=await agente.skills(ator);if(secao.versaoAgente!==inicial.versao)throw Error('OPERACAO_CONFLITO');
 const desejada=skillsConsultasComerciais(secao.conteudo),alterarSkills=hashConfiguracaoAgente(desejada)!==hashConfiguracaoAgente(secao.conteudo);
 const vinculos=await comercial.configuracao(ator),existentes=vinculos.vinculos.filter(v=>v.hubId===VINCULO_BRIE_APROVADO.hubId);
 if(existentes.length>1||existentes.some(v=>v.produtoWooId!==VINCULO_BRIE_APROVADO.produtoWooId||v.variacaoWooId!==null))throw Error('COMERCIAL_ASSOCIACAO_EXISTENTE_DIVERGENTE');
 const conferir=async(versao:number)=>{if(signal.aborted)throw Error('COMERCIAL_PREPARACAO_CANCELADA');const atual=await agente.estado(ator);if(!desligada(atual)||atual.versao!==versao)throw Error('OPERACAO_CONTEXTO_ALTERADO');return atual;};
 await conferir(inicial.versao);
 const vinculo=existentes.length?{estado:'preservado' as const,versao:vinculos.versao}:{estado:'configurado' as const,...await comercial.salvarVinculo(ator,{...VINCULO_BRIE_APROVADO,versao:vinculos.versao,idempotencia:IDS_CONSULTAS_COMERCIAIS.vinculo},signal)};
 await conferir(inicial.versao);
 const skills=alterarSkills?{estado:'configuradas' as const,...await agente.configurarSkills(ator,{conteudo:desejada,versao:secao.versao,idempotencia:IDS_CONSULTAS_COMERCIAIS.skills},{modo:'desligado',versaoAgente:inicial.versao})}:{estado:'preservadas' as const,versao:secao.versao,versaoAgente:inicial.versao};
 const final=await conferir(skills.versaoAgente);
 return {vinculo:{estado:vinculo.estado,versao:vinculo.versao},skills:{estado:skills.estado,versao:skills.versao},ia:{modo:final.modo,autoridadeAutomatica:final.autoridadeAutomatica,versao:final.versao},envios:0,inferencias:0};
}
