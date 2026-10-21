import {describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {randomUUID} from 'node:crypto';
import {limitesAtalhosOperacao,normalizarNomeAtalhoOperacao,type AtalhoTextoOperacao} from '../../src/lib/atendimento/operacao-atalhos';
import {atividadesOperacao} from '../../src/lib/atendimento/operacao-atividades';
import {ambienteAtalhos,atorAtalhos} from './atalhos-fixtures';

const pedido=(extra:Record<string,unknown>={})=>({nome:'Saudação Inicial',texto:'Olá!\nComo posso ajudar?',versao:0,idempotencia:randomUUID(),...extra});
describe('atalhos compartilhados da operação, repositório real e banco fictício',()=>{
 it('as ações próprias autorizam o CRUD sem atender ou configurar',async()=>{
  const a=ambienteAtalhos();expect(a.direitos.has('atender')).toBe(false);expect(a.direitos.has('configurar')).toBe(false);
  const criado=await a.servico.salvar(atorAtalhos,pedido());const editado=await a.servico.salvar(atorAtalhos,pedido({id:criado.atalho.id,versao:1}));
  await a.servico.excluir(atorAtalhos,{id:editado.atalho.id,versao:2,idempotencia:randomUUID()});expect((await a.servico.listar(atorAtalhos)).registros).toEqual([]);
 });
 it.each(['atalhos.visualizar','atalhos.adicionar','atalhos.editar','atalhos.excluir'] as const)('direitos antigos não substituem %s',async falta=>{
  const a=ambienteAtalhos(),criado=await a.servico.salvar(atorAtalhos,pedido()),foto=a.snapshot();a.direitos.add('atender');a.direitos.add('configurar');a.direitos.delete(falta);
  const executar=falta==='atalhos.visualizar'?()=>a.servico.listar(atorAtalhos):falta==='atalhos.excluir'?()=>a.servico.excluir(atorAtalhos,{id:criado.atalho.id,versao:1,idempotencia:randomUUID()}):()=>a.servico.salvar(atorAtalhos,pedido(falta==='atalhos.editar'?{id:criado.atalho.id,versao:1}:{nome:'Outro',versao:1}));
  await expect(executar()).rejects.toThrow('ACESSO_NEGADO');expect(a.snapshot()).toEqual(foto);
 });
 it('revogação após a trava impede gravar e reverte a transação',async()=>{
  const a=ambienteAtalhos();let verificacoes=0;vi.spyOn(a.repo,'autorizar').mockImplementation(async(_i,acao)=>a.direitos.has(acao)&&(acao!=='atalhos.adicionar'||++verificacoes===1));
  await expect(a.servico.salvar(atorAtalhos,pedido())).rejects.toThrow('ACESSO_NEGADO');expect(a.snapshot().cfg).toBeNull();expect(a.snapshot().comandos).toEqual([]);expect(a.snapshot().auditorias).toEqual([]);
 });
 it('normaliza nomes para o mesmo /comando, sem perder o texto multilinha',async()=>{
  const a=ambienteAtalhos();expect(await a.servico.listar(atorAtalhos)).toEqual({versao:0,registros:[]});
  const r=await a.servico.salvar(atorAtalhos,pedido());expect(r).toMatchObject({versao:1,atalho:{nome:'saudacao-inicial',texto:'Olá!\nComo posso ajudar?'}});
  expect(await a.servico.listar(atorAtalhos)).toEqual({versao:1,registros:[r.atalho]});
  expect(a.snapshot().auditorias).toHaveLength(1);expect(a.snapshot().auditorias[0]).toEqual([expect.any(String),atorAtalhos.id,r.atalho.id,'atalho_criar',1,atorAtalhos.nome]);
  expect(JSON.stringify(a.snapshot().auditorias)).not.toContain(r.atalho.texto);
 });
 it('reconcilia criação e exclusão com a mesma idempotência antes de comparar versões',async()=>{
  const a=ambienteAtalhos(),p=pedido(),criado=await a.servico.salvar(atorAtalhos,p);
  const foto=a.snapshot();expect(await a.servico.salvar(atorAtalhos,p)).toEqual(criado);expect(a.snapshot()).toEqual(foto);
  const q={id:criado.atalho.id,versao:1,idempotencia:randomUUID()},excluido=await a.servico.excluir(atorAtalhos,q),final=a.snapshot();
  expect(await a.servico.excluir(atorAtalhos,q)).toEqual(excluido);expect(a.snapshot()).toEqual(final);expect(await a.servico.listar(atorAtalhos)).toEqual({versao:2,registros:[]});
 });
 it('editar preserva UUID e aplica controle otimista da lista compartilhada',async()=>{
  const a=ambienteAtalhos(),criado=await a.servico.salvar(atorAtalhos,pedido());
  const p=pedido({id:criado.atalho.id,nome:'Retirada',texto:'Seu pedido pode ser retirado no horário confirmado.',versao:1});
  const alterado=await a.servico.salvar(atorAtalhos,p);expect(alterado).toEqual({versao:2,atalho:{id:criado.atalho.id,nome:'retirada',texto:p.texto}});
  const foto=a.snapshot();await expect(a.servico.salvar(atorAtalhos,pedido({id:criado.atalho.id,versao:1}))).rejects.toThrow('OPERACAO_CONFLITO');expect(a.snapshot()).toEqual(foto);
  expect(a.snapshot().auditorias.map(a=>a[3])).toEqual(['atalho_criar','atalho_editar']);
 });
 it('impede nome equivalente duplicado, inclusive acento, caixa e espaços',async()=>{
  const a=ambienteAtalhos();await a.servico.salvar(atorAtalhos,pedido());const foto=a.snapshot();
  await expect(a.servico.salvar(atorAtalhos,pedido({nome:'SAUDACAO INICIAL',versao:1}))).rejects.toThrow('OPERACAO_ATALHO_NOME_CONFLITO');expect(a.snapshot()).toEqual(foto);
 });
 it('UUID reaproveitado com outro texto ou autor não altera a lista nem a auditoria',async()=>{
  const a=ambienteAtalhos(),p=pedido();await a.servico.salvar(atorAtalhos,p);const foto=a.snapshot();
  await expect(a.servico.salvar(atorAtalhos,{...p,texto:'Texto alterado'})).rejects.toThrow('OPERACAO_IDEMPOTENCIA_DIVERGENTE');
  await expect(a.servico.salvar({...atorAtalhos,id:'fixture-outro'},p)).rejects.toThrow('OPERACAO_IDEMPOTENCIA_DIVERGENTE');expect(a.snapshot()).toEqual(foto);
 });
 it('revalida a permissão no replay após perda da confirmação',async()=>{
  const a=ambienteAtalhos(),p=pedido();await a.servico.salvar(atorAtalhos,p);const foto=a.snapshot();a.direitos.delete('atalhos.adicionar');
  await expect(a.servico.salvar(atorAtalhos,p)).rejects.toThrow('OPERACAO_ACESSO_NEGADO');expect(a.snapshot()).toEqual(foto);
  expect((await a.servico.listar(atorAtalhos)).registros).toHaveLength(1);
 });
 it.each(['ia','automacao'] as const)('recusa identidade %s antes de qualquer leitura ou escrita de atalhos',async tipo=>{
  const a=ambienteAtalhos(),i={...atorAtalhos,tipo};await expect(a.servico.listar(i)).rejects.toThrow('OPERACAO_AUTOR_RECUSADO');await expect(a.servico.salvar(i,pedido())).rejects.toThrow('OPERACAO_AUTOR_RECUSADO');
  expect(a.sqls.some(sql=>sql.includes('atendimento_operacao.configuracao'))).toBe(false);expect(a.snapshot().comandos).toHaveLength(0);
 });
 it('consultar é obrigatório e o modo receber permanece sem escrita',async()=>{
  const a=ambienteAtalhos();a.direitos.delete('consultar');await expect(a.servico.listar(atorAtalhos)).rejects.toThrow('OPERACAO_ACESSO_NEGADO');
  await expect(a.servico.salvar(atorAtalhos,pedido())).rejects.toThrow('OPERACAO_ACESSO_NEGADO');a.direitos.add('consultar');a.setModo('receber');
  await expect(a.servico.salvar(atorAtalhos,pedido())).rejects.toThrow('OPERACAO_SOMENTE_LEITURA');expect(a.snapshot().cfg).toBeNull();
 });
 it('ambientes não compartilham o cadastro',async()=>{
  const realFicticio=ambienteAtalhos(),ensaioFicticio=ambienteAtalhos();await realFicticio.servico.salvar(atorAtalhos,pedido());expect(await ensaioFicticio.servico.listar(atorAtalhos)).toEqual({versao:0,registros:[]});
 });
 it.each(['/nome','nome!','a\nb','a\tb','_interno','-nome','🚫','a'.repeat(51),''])('recusa nome inválido: %j',nome=>{expect(()=>normalizarNomeAtalhoOperacao(nome)).toThrow();});
 it.each(['', ' ', 'a'.repeat(4097),'a\u0000b','a\u007fb','a\ud800b'])('recusa texto inválido sem persistir: %j',async texto=>{
  const a=ambienteAtalhos();await expect(a.servico.salvar(atorAtalhos,pedido({texto}))).rejects.toThrow('OPERACAO_ENTRADA_INVALIDA');expect(a.snapshot().cfg).toBeNull();
 });
 it('normaliza CRLF e CR para LF, preservando espaços intencionais e quebras de linha',async()=>{
  const a=ambienteAtalhos(),r=await a.servico.salvar(atorAtalhos,pedido({texto:'  Olá!\r\n\r\nComo posso ajudar?\rAssinatura  '}));
  expect(r.atalho.texto).toBe('  Olá!\n\nComo posso ajudar?\nAssinatura  ');expect((await a.servico.listar(atorAtalhos)).registros[0].texto).toBe(r.atalho.texto);
 });
 it('aceita os limites de domínio e limita o cadastro a 200 sem impedir edição',async()=>{
  const a=ambienteAtalhos(),registros=Array.from({length:200},(_,i)=>({id:randomUUID(),nome:'nome'+i,texto:'Texto fictício'}));a.setConfig({registros},20);
  await expect(a.servico.salvar(atorAtalhos,pedido({versao:20}))).rejects.toThrow('OPERACAO_ATALHOS_LIMITE_INVALIDO');
  const r=await a.servico.salvar(atorAtalhos,pedido({id:registros[0].id,nome:'a'.repeat(50),texto:'a'.repeat(4096),versao:20}));expect(r.versao).toBe(21);expect((await a.servico.listar(atorAtalhos)).registros).toHaveLength(200);
 });
 it('recusa a gravação antes que o envelope ultrapasse a capacidade de leitura do cliente',async()=>{
  const a=ambienteAtalhos(),registros:AtalhoTextoOperacao[]=[],texto='\t'.repeat(4095)+'a',bytes=(lista:AtalhoTextoOperacao[])=>Buffer.byteLength(JSON.stringify({versao:Number.MAX_SAFE_INTEGER,registros:lista}),'utf8');
  for(let i=0;i<200;i++){const proximo={id:randomUUID(),nome:'nome'+i,texto};if(bytes([...registros,proximo])>limitesAtalhosOperacao.bytes)break;registros.push(proximo);}
  expect(bytes(registros)).toBeLessThanOrEqual(limitesAtalhosOperacao.bytes);expect(registros.length).toBeLessThan(200);a.setConfig({registros},20);const antes=a.snapshot();
  await expect(a.servico.salvar(atorAtalhos,pedido({texto,versao:20}))).rejects.toThrow('OPERACAO_ATALHOS_TAMANHO_INVALIDO');expect(a.snapshot()).toEqual(antes);
 });
 it('não sobrescreve cadastro corrompido nem cadastra atualização de ID ausente',async()=>{
  const a=ambienteAtalhos();a.setConfig({registros:[{id:randomUUID(),nome:'valido',texto:'Texto'},{id:randomUUID(),nome:'valido',texto:'Duplicado'}]});
  await expect(a.servico.salvar(atorAtalhos,pedido({versao:1}))).rejects.toThrow('OPERACAO_ATALHOS_INDISPONIVEIS');expect(a.snapshot().comandos).toHaveLength(0);
  const b=ambienteAtalhos();await expect(b.servico.salvar(atorAtalhos,pedido({id:randomUUID()}))).rejects.toThrow('OPERACAO_ATALHO_AUSENTE');
  await expect(b.servico.excluir(atorAtalhos,{id:randomUUID(),versao:0,idempotencia:randomUUID()})).rejects.toThrow('OPERACAO_ATALHO_AUSENTE');expect(b.snapshot().cfg).toBeNull();
 });
 it('registra somente macroações e nunca cria intenção nem mensagem',async()=>{
  const a=ambienteAtalhos(),r=await a.servico.salvar(atorAtalhos,pedido());await a.servico.excluir(atorAtalhos,{id:r.atalho.id,versao:r.versao,idempotencia:randomUUID()});
  expect(a.sqls.some(s=>/intencao|mensagem|pg_notify|woo_pedido/.test(s))).toBe(false);
  for(const acao of ['atalho_criar','atalho_editar','atalho_excluir','lembrete_atualizar'])expect(atividadesOperacao[acao]).toMatchObject({categoria:'organizacao'});
 });
});
