import {describe,expect,it} from 'vitest';
import {resolverPermissoesAtendimento} from '../../src/lib/permissoes/atendimento-resolucao';
import {LISTA_CAPACIDADES_ATENDIMENTO} from '../../src/lib/permissoes/atendimento';
import type {Permissoes} from '../../src/lib/permissoes/catalogo';

const legado:Permissoes={crm:['visualizar','editar'],'crm.atendimento.configuracoes':['visualizar','editar']};
const pronto={permissoesGranulares:true,permissoesHierarquia:true};
describe('resolução da hierarquia do Atendimento',()=>{
 it('preserva o legado antes do marcador e nega ações novas ausentes depois dele',()=>{
  expect(resolverPermissoesAtendimento({permissoes:legado})).toEqual(LISTA_CAPACIDADES_ATENDIMENTO);
  const depois=resolverPermissoesAtendimento({...pronto,permissoes:legado});
  expect(depois).toEqual(['consultar','atender','configuracao.visualizar','configurar']);
 });
 it('mantém a precedência histórica do alias somente antes da materialização',()=>{
  const permissoes:Permissoes={crm:[],'crm.atendimento':['visualizar','editar']};
  expect(resolverPermissoesAtendimento({permissoes})).toContain('atender');
  expect(resolverPermissoesAtendimento({...pronto,permissoes})).toEqual([]);
  const inverso:Permissoes={crm:['visualizar'],'crm.atendimento':[]};
  expect(resolverPermissoesAtendimento({permissoes:inverso})).toEqual([]);
  expect(resolverPermissoesAtendimento({...pronto,permissoes:inverso})).toEqual(['consultar']);
 });
 it('usa ações exatas sem depender de atender ou configurar',()=>{
  const permissoes:Permissoes={crm:['visualizar'],'crm.atendimento.contatos':['visualizar','adicionar'],'crm.atendimento.modelos':['visualizar','excluir'],'crm.atendimento.lembretes':['visualizar','editar'],'crm.atendimento.atividades.equipe':['visualizar']};
  const resultado=resolverPermissoesAtendimento({...pronto,permissoes});
  expect(resultado).toEqual(expect.arrayContaining(['consultar','contatos.visualizar','contatos.adicionar','modelos.visualizar','modelos.excluir','lembretes.visualizar','lembretes.editar','atividades.equipe.visualizar']));
  expect(resultado).not.toContain('atender');
  expect(resultado).not.toContain('configurar');
  expect(resultado).not.toContain('contatos.editar');
  expect(resultado).not.toContain('modelos.adicionar');
 });
 it('aplica os vetos e exige visualizar para a escrita no mesmo recurso',()=>{
  const permissoes:Permissoes={...legado,'crm.atendimento.atalhos':['visualizar','adicionar','editar','excluir'],'crm.atendimento.lembretes':['editar']};
  const resultado=resolverPermissoesAtendimento({...pronto,permissoes,excecoes:{'crm.atendimento.atalhos':{excluir:false}}});
  expect(resultado).toContain('atalhos.adicionar');
  expect(resultado).not.toContain('atalhos.excluir');
  expect(resultado).not.toContain('lembretes.editar');
  expect(resolverPermissoesAtendimento({...pronto,permissoes,excecoes:{crm:{visualizar:false}}})).toEqual([]);
 });
 it('deriva a ação nova de todos os requisitos anteriores antes do marcador',()=>{
  const permissoes:Permissoes={...legado,'crm.atendimento.contatos':['visualizar'],'crm.atendimento.mensagens':['visualizar']};
  const resultado=resolverPermissoesAtendimento({permissoes,permissoesGranulares:true});
  expect(resultado).toContain('contatos.adicionar');
  expect(resultado).not.toContain('conversas.adicionar');
  expect(resultado).not.toContain('modelos.adicionar');
  expect(resultado).toContain('atividades.equipe.visualizar');
 });
 it('não muda o perfil recebido e mantém administrador com o contrato completo',()=>{
  const antes=JSON.stringify(legado);
  resolverPermissoesAtendimento({...pronto,permissoes:legado});
  expect(JSON.stringify(legado)).toBe(antes);
  expect(resolverPermissoesAtendimento({perfilSistema:'ADMINISTRADOR'})).toEqual(LISTA_CAPACIDADES_ATENDIMENTO);
 });
});
