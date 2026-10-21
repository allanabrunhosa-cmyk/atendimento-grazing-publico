import {describe,it,expect,vi} from 'vitest';
import type {Pool,PoolClient} from 'pg';
import {RepositorioOperacaoPg,hashOperacao} from '../../src/lib/atendimento/operacao-repositorio-pg';
import {validarPedidoLembreteConversaOperacao,validarPrazoLembreteConversaOperacao,lerLembreteConversaDTO} from '../../src/lib/atendimento/operacao-lembretes';
import type {AcaoOperacao,IdentidadeOperacao,ModoOperacao} from '../../src/lib/atendimento/operacao-tipos';
vi.mock('server-only',()=>({}));
const conversaId='11111111-1111-4111-8111-111111111111',comandoId='22222222-2222-4222-8222-222222222222',lembreteId='33333333-3333-4333-8333-333333333333';
const ator:IdentidadeOperacao={id:'fixture-lembrete',nome:'Atendente Fictício',perfilId:'fixture',sessaoVersao:1,permissoes:[]};
const servidor=new Date('2026-10-19T12:00:00.000Z');
const pedido=()=>({acao:'agendar',versao:0,idempotencia:comandoId,agendadoPara:'2026-10-19T13:00:00.000Z'});
describe('contrato do lembrete humano',()=>{
 it.each(['2026-10-19T13:00:00Z','2026-10-19T13:00:00.1Z','2026-10-19T13:00:00.123Z'])('aceita instante UTC explícito: %s',agendadoPara=>{expect(()=>validarPedidoLembreteConversaOperacao({...pedido(),agendadoPara})).not.toThrow();});
 it.each(['2026-10-19T13:00','2026-10-19 13:00:00','2026-10-19T10:00:00-03:00','2026-02-30T13:00:00.000Z','2026-10-19T24:00:00.000Z','2026-10-19T13:00:00.1234Z','not-a-date'])('recusa data ambígua ou normalizada pelo parser: %s',agendadoPara=>{expect(()=>validarPedidoLembreteConversaOperacao({...pedido(),agendadoPara})).toThrow('LEMBRETE_DATA_INVALIDA');});
 it.each([{acao:'enviar'},{telefone:'5511900000001'},{autorId:'outro'},{ficticia:true},{versao:1},{lembreteId},{idempotencia:'inválido'},{agendadoPara:null}])('recusa campos e controle de escopo do navegador: %j',extra=>{expect(()=>validarPedidoLembreteConversaOperacao({...pedido(),...extra})).toThrow();});
 it.each(['reagendar','concluir','cancelar'])('exige ID e versão própria para %s',acao=>{expect(()=>validarPedidoLembreteConversaOperacao({acao,idempotencia:comandoId,versao:1,lembreteId,...(acao==='reagendar'?{agendadoPara:pedido().agendadoPara}:{})})).not.toThrow();expect(()=>validarPedidoLembreteConversaOperacao({acao,idempotencia:comandoId,versao:0,lembreteId})).toThrow();expect(()=>validarPedidoLembreteConversaOperacao({acao,idempotencia:comandoId,versao:1})).toThrow();});
 it('não aceita nova data ao concluir ou cancelar',()=>{for(const acao of ['concluir','cancelar'])expect(()=>validarPedidoLembreteConversaOperacao({...pedido(),acao,versao:1,lembreteId})).toThrow('LEMBRETE_INVALIDO');});
 it('aceita descrição opcional na criação e exige descrição explícita na atualização sem horário',()=>{for(const descricao of ['', 'Retomar orçamento\nConfirmar a retirada.', 'a'.repeat(1000)]){expect(()=>validarPedidoLembreteConversaOperacao({...pedido(),descricao})).not.toThrow();expect(()=>validarPedidoLembreteConversaOperacao({acao:'atualizar',idempotencia:comandoId,versao:1,lembreteId,descricao})).not.toThrow();}expect(()=>validarPedidoLembreteConversaOperacao({acao:'atualizar',idempotencia:comandoId,versao:1,lembreteId})).toThrow('DESCRICAO_INVALIDA');expect(()=>validarPedidoLembreteConversaOperacao({...pedido(),acao:'atualizar',versao:1,lembreteId,descricao:'Retornar'})).toThrow('LEMBRETE_INVALIDO');});
 it.each([null,10,'a'.repeat(1001),'Texto\u0000indevido','Texto\u007findevido'])('recusa descrição inválida antes da transação: %j',descricao=>{expect(()=>validarPedidoLembreteConversaOperacao({...pedido(),descricao})).toThrow('DESCRICAO_INVALIDA');});
 it('não aceita alteração implícita de descrição ao concluir ou cancelar',()=>{for(const acao of ['concluir','cancelar'])expect(()=>validarPedidoLembreteConversaOperacao({acao,versao:1,lembreteId,idempotencia:comandoId,descricao:'Rascunho não salvo'})).toThrow('DESCRICAO_INVALIDA');});
 it('usa o relógio recebido do servidor para o mínimo de um minuto e o máximo de 365 dias',()=>{for(const diferenca of [60000,365*86400000])expect(()=>validarPrazoLembreteConversaOperacao(new Date(servidor.getTime()+diferenca).toISOString(),servidor)).not.toThrow();for(const diferenca of [-1,0,59999,365*86400000+1])expect(()=>validarPrazoLembreteConversaOperacao(new Date(servidor.getTime()+diferenca).toISOString(),servidor)).toThrow('LEMBRETE_PRAZO_INVALIDO');expect(()=>validarPrazoLembreteConversaOperacao(pedido().agendadoPara,new Date(NaN))).toThrow('LEMBRETE_PRAZO_INVALIDO');});
 it('exige conferidoEm, normaliza descrição legada e não expõe colunas da persistência',()=>{const dto={id:lembreteId,agendadoPara:pedido().agendadoPara,versao:1,atrasado:false,conferidoEm:servidor.toISOString(),criadoPorId:ator.id,criadoPorNome:ator.nome};expect(lerLembreteConversaDTO({...dto,estado:'pendente',conversa_id:conversaId})).toEqual({...dto,descricao:''});expect(lerLembreteConversaDTO({...dto,descricao:'Retomar proposta'})).toEqual({...dto,descricao:'Retomar proposta'});expect(lerLembreteConversaDTO(null)).toBeNull();expect(()=>lerLembreteConversaDTO({...dto,conferidoEm:undefined})).toThrow('LEMBRETE_DADOS_INVALIDOS');expect(()=>lerLembreteConversaDTO({...dto,descricao:null})).toThrow('LEMBRETE_DADOS_INVALIDOS');});
});
function ambiente(p:{ator?:IdentidadeOperacao;acesso?:boolean;modo?:ModoOperacao;ficticia?:boolean;ambienteFicticio?:boolean;replay?:boolean;revogarReplay?:boolean;direitos?:AcaoOperacao[];corpo?:Record<string,unknown>}={}){
 const autor=p.ator??ator,corpo=p.corpo??pedido();let verificacoes=0;
 const query=vi.fn(async(sql:string)=>{
  if(sql==='SELECT current_database() nome')return {rows:[{nome:'donatella_ensaio_operacao'}],rowCount:1};
  if(sql.startsWith('SELECT v.*'))return {rows:[{id:conversaId,ficticia:p.ficticia??true,estado:'encerrada'}],rowCount:1};
  if(sql.startsWith('SELECT autor_id,hash,resultado'))return {rows:p.replay?[{autor_id:autor.id,hash:hashOperacao([autor.id,[conversaId,corpo]]),resultado:{lembreteId}}]:[],rowCount:p.replay?1:0};
  if(sql.startsWith('SELECT id,versao,estado FROM atendimento_operacao.lembrete_conversa'))return {rows:corpo.acao==='agendar'?[]:[{id:lembreteId,versao:1,estado:'pendente'}],rowCount:corpo.acao==='agendar'?0:1};
  if(sql==='SELECT clock_timestamp() AS agora')return {rows:[{agora:servidor}],rowCount:1};
  return {rows:[],rowCount:0};
 });
 const tx={query,release:vi.fn()} as unknown as PoolClient,pool={connect:vi.fn(async()=>tx)} as unknown as Pool;
 const repo=new RepositorioOperacaoPg(pool,async(_,a)=>{if(a==='lembretes.adicionar')verificacoes++;return p.acesso!==false&&(!p.direitos||p.direitos.includes(a))&&!(p.revogarReplay&&verificacoes>1);},()=>p.modo??'homologacao','fixture',undefined,undefined,'humano',{numeroId:'123456789',ficticio:p.ambienteFicticio??true});
 return {repo,query,pool,autor};
}
describe('guardas do lembrete na persistência',()=>{
 it.each([
  ['agendar','lembretes.adicionar'],['reagendar','lembretes.editar'],['atualizar','lembretes.editar'],['concluir','lembretes.editar'],['cancelar','lembretes.excluir'],
 ] as const)('%s usa somente a ação própria e visualizar, sem atender ou configurar',async(acao,capacidade)=>{
  const corpo:Record<string,unknown>={...pedido(),acao,versao:acao==='agendar'?0:1,...acao==='agendar'?{}:{lembreteId},...['agendar','reagendar'].includes(acao)?{}:{agendadoPara:undefined},...acao==='atualizar'?{descricao:'Retomar proposta'}:{}};
  if(corpo.agendadoPara===undefined)delete corpo.agendadoPara;
  const direitos:AcaoOperacao[]=['consultar','lembretes.visualizar',capacidade],a=ambiente({direitos,corpo});await a.repo.alterarLembreteConversa(ator,conversaId,corpo);
  expect(a.query.mock.calls.some(([s])=>/^(INSERT INTO|UPDATE) atendimento_operacao.lembrete_conversa/.test(s))).toBe(true);
  const b=ambiente({direitos:['consultar','lembretes.visualizar','atender','configurar'],corpo});await expect(b.repo.alterarLembreteConversa(ator,conversaId,corpo)).rejects.toThrow('ACESSO_NEGADO');expect(b.query.mock.calls.some(([s])=>s.startsWith('SELECT v.*'))).toBe(false);
 });
 it('a capacidade de escrever não contorna a negação de visualizar o alerta',async()=>{
  const a=ambiente({direitos:['consultar','atender','configurar','lembretes.adicionar']});await expect(a.repo.alterarLembreteConversa(ator,conversaId,pedido())).rejects.toThrow('ACESSO_NEGADO');expect(a.query.mock.calls.some(([s])=>s.startsWith('SELECT v.*'))).toBe(false);
 });
 it('valida o pedido antes de conectar',async()=>{const {repo,pool}=ambiente();await expect(repo.alterarLembreteConversa(ator,conversaId,{...pedido(),telefone:'outro'})).rejects.toThrow('LEMBRETE_INVALIDO');expect(pool.connect).not.toHaveBeenCalled();});
 it.each([{acesso:false},{ator:{...ator,tipo:'ia' as const}},{ator:{...ator,tipo:'automacao' as const}}])('nega escrita sem capacidade do lembrete humano: %j',async p=>{const {repo,query,autor}=ambiente(p);await expect(repo.alterarLembreteConversa(autor,conversaId,pedido())).rejects.toThrow();expect(query.mock.calls.some(([s])=>s.startsWith('SELECT v.*')||/INSERT INTO atendimento_operacao.lembrete/.test(s))).toBe(false);});
 it.each([{modo:'receber' as const},{modo:'homologacao' as const,ficticia:false},{modo:'operacao' as const,ficticia:false,ambienteFicticio:true}])('nega modo ou ambiente incorreto inclusive no replay: %j',async p=>{const {repo,query}=ambiente({...p,replay:true});await expect(repo.alterarLembreteConversa(ator,conversaId,pedido())).rejects.toThrow();expect(query.mock.calls.some(([s])=>s.startsWith('SELECT jsonb_build_object'))).toBe(false);});
 it('revoga replay antes de retornar dados ou repetir a mutação',async()=>{const {repo,query}=ambiente({replay:true,revogarReplay:true});await expect(repo.alterarLembreteConversa(ator,conversaId,pedido())).rejects.toThrow('ACESSO_NEGADO');expect(query.mock.calls.some(([s])=>s.startsWith('SELECT jsonb_build_object')||s.startsWith('INSERT INTO atendimento_operacao.lembrete'))).toBe(false);});
 it('replay lê o lembrete atual e não retorna o DTO antigo memorizado',async()=>{const {repo,query}=ambiente({replay:true});expect(await repo.alterarLembreteConversa(ator,conversaId,pedido())).toEqual({lembrete:null});expect(query.mock.calls.some(([s])=>s.startsWith('SELECT jsonb_build_object'))).toBe(true);expect(query.mock.calls.some(([s])=>/^(INSERT|UPDATE|DELETE)\b|pg_notify/.test(s))).toBe(false);});
 it('agendamento não muda conversa, timers, mensagens ou intenções',async()=>{const {repo,query}=ambiente();await repo.alterarLembreteConversa(ator,conversaId,pedido());expect(query.mock.calls.some(([s])=>s.startsWith('INSERT INTO atendimento_operacao.lembrete'))).toBe(true);expect(query.mock.calls.some(([s])=>s.includes('pg_notify'))).toBe(true);expect(query.mock.calls.some(([s])=>/^(UPDATE|INSERT INTO) atendimento_operacao\.(conversa|timer|mensagem|intencao)\b/.test(s))).toBe(false);});
});
