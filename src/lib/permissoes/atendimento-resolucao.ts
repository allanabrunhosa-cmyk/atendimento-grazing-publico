import {permissaoEfetiva,type Permissoes,type Excecoes} from './catalogo';
import {CAPACIDADES_ATENDIMENTO,LISTA_CAPACIDADES_ATENDIMENTO,NOVAS_CAPACIDADES_ATENDIMENTO,type CapacidadeAtendimento} from './atendimento';

export type PermissoesIdentidadeAtendimento={perfilSistema?:string|null;permissoes?:Permissoes|null;excecoes?:Excecoes|null;permissoesGranulares?:boolean;permissoesHierarquia?:boolean};
export const CAPACIDADES_ANTERIORES_ATENDIMENTO=LISTA_CAPACIDADES_ATENDIMENTO.filter(a=>!Object.hasOwn(NOVAS_CAPACIDADES_ATENDIMENTO,a));

/** O marcador novo confirma a materialização do acesso canônico e das ações desmembradas. */
export function resolverPermissoesAtendimento(u:PermissoesIdentidadeAtendimento):CapacidadeAtendimento[]{
 if(u.perfilSistema==='ADMINISTRADOR')return [...LISTA_CAPACIDADES_ATENDIMENTO];
 const base=u.permissoes??{},excecoes=u.excecoes??{};
 const consultaEspecifica=u.permissoesHierarquia!==true&&(Object.hasOwn(base,'crm.atendimento')||Object.hasOwn(excecoes['crm.atendimento']??{},'visualizar'));
 const atenderEspecifico=u.permissoesHierarquia!==true&&(consultaEspecifica||Object.hasOwn(excecoes['crm.atendimento']??{},'editar'));
 const legado=(a:'consultar'|'atender'|'configurar'|'conhecimento')=>permissaoEfetiva(base,excecoes,a==='consultar'?(consultaEspecifica?'crm.atendimento':'crm'):a==='atender'?(atenderEspecifico?'crm.atendimento':'crm'):'crm.atendimento.configuracoes',a==='consultar'?'visualizar':'editar');
 if(!legado('consultar'))return [];
 const anteriores=CAPACIDADES_ANTERIORES_ATENDIMENTO.filter(a=>{
  const {recurso,acao,origemLegada}=CAPACIDADES_ATENDIMENTO[a];
  if(a==='consultar'||a==='atender'||a==='configurar')return legado(a);
  const explicita=Object.hasOwn(base,recurso)||Object.hasOwn(excecoes[recurso]??{},'visualizar')||Object.hasOwn(excecoes[recurso]??{},acao);
  return explicita||u.permissoesGranulares===true?permissaoEfetiva(base,excecoes,recurso,acao):legado(origemLegada);
 });
 const permitidas=new Set<string>(anteriores);
 for(const [capacidade,regra] of Object.entries(NOVAS_CAPACIDADES_ATENDIMENTO)){
  const autorizada=u.permissoesHierarquia===true?permissaoEfetiva(base,excecoes,regra.recurso,regra.acao):regra.origens.every(a=>permitidas.has(a));
  if(autorizada)permitidas.add(capacidade);
 }
 return LISTA_CAPACIDADES_ATENDIMENTO.filter(a=>permitidas.has(a));
}
