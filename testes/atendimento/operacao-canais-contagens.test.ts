import {describe,it,expect,vi} from 'vitest';
import type {Pool,PoolClient} from 'pg';
import {RepositorioOperacaoPg,canalConversaOperacao,limitarPreviaConversaOperacao} from '../../src/lib/atendimento/operacao-repositorio-pg';
import {validarCanalConversaOperacao,type AcaoOperacao,type IdentidadeOperacao} from '../../src/lib/atendimento/operacao-tipos';
vi.mock('server-only',()=>({}));
const ator:IdentidadeOperacao={id:'fixture-canais',nome:'Atendente fictício',perfilId:'fixture',sessaoVersao:1,permissoes:['consultar']};
const em=new Date('2026-10-10T12:00:00.000Z');
const linha={id:'11111111-1111-4111-a111-111111111111',contato_id:'22222222-2222-4222-a222-222222222222',nome:'Contato fictício',telefone:'5511999990000',identidade_canal:'whatsapp:123456789:5511999990000',estado:'humano',versao:1,ultima_mensagem_em:em,ultima_cliente_em:em,ficticia:false};
function ambiente(permitido=true,verLembrete=true){
 const lembrete={id:'33333333-3333-4333-a333-333333333333',agendadoPara:em.toISOString(),descricao:'Descrição privada fictícia',versao:1,atrasado:true,conferidoEm:em.toISOString(),criadoPorId:ator.id,criadoPorNome:ator.nome},registro={...linha,lembrete};
 const query=vi.fn(async(sql:string,parametros?:unknown[])=>{
  void parametros;
  if(sql==='SELECT current_database() nome')return {rows:[{nome:'donatella_ensaio_operacao'}],rowCount:1};
  if(sql.startsWith('WITH escopo'))return {rows:[{registros:Array.from({length:31},()=>registro),contagens:{total:66,ia:31,humano:32,pausado:3,encerrada:1},contagens_conferidas_em:em,proximo_lembrete_em:em}],rowCount:1};
  if(sql.startsWith('SELECT v.*'))return {rows:[registro],rowCount:1};
  if(sql.includes('atendimento_operacao.mensagem')||sql.includes('atendimento_operacao.nota'))return {rows:[],rowCount:0};
  if(sql.startsWith('SELECT *')&&sql.includes('FROM atendimento_operacao.contato WHERE'))return {rows:[{...linha,id:linha.contato_id,conversa_id:linha.id}],rowCount:1};
  return {rows:[],rowCount:0};
 });
 const tx={query,release:vi.fn()} as unknown as PoolClient,pool={connect:vi.fn(async()=>tx)} as unknown as Pool;
 const autorizar=vi.fn(async(_i:IdentidadeOperacao,acao:AcaoOperacao)=>permitido&&(verLembrete||acao!=='lembretes.visualizar')),repo=new RepositorioOperacaoPg(pool,autorizar,()=> 'homologacao','fixture');
 return {repo,query,pool,autorizar};
}
describe('canal comprovado e contagens de conversa no servidor',()=>{
 it('nega lembrete na lista, histórico e próximo vencimento sem usar os dados privados na ordenação',async()=>{
  const a=ambiente(true,false),lista=await a.repo.listar(ator,{});expect(lista.registros.every(v=>'lembrete' in v&&v.lembrete===null)).toBe(true);expect(lista.proximoLembreteEm).toBeNull();
  const consulta=a.query.mock.calls.find(([s])=>s.startsWith('WITH escopo'))![0];expect(consulta).toContain('NULL::jsonb AS lembrete');expect(consulta).not.toContain('l.descricao');
  expect((await a.repo.historico(ator,{conversaId:linha.id})).conversa.lembrete).toBeNull();expect(JSON.stringify(lista)).not.toContain('Descrição privada');
  const b=ambiente(),permitida=await b.repo.listar(ator,{});expect('lembrete' in permitida.registros[0]?permitida.registros[0].lembrete?.descricao:null).toBe('Descrição privada fictícia');expect(permitida.proximoLembreteEm).toBe(em.toISOString());
 });
 it('limita a prévia por unidades UTF-16 sem cortar o emoji e sem alterar o histórico',()=>{const texto='a'.repeat(279)+'🙂';expect(limitarPreviaConversaOperacao(texto)).toBe('a'.repeat(279));expect(texto.length).toBe(281);expect(limitarPreviaConversaOperacao('🙂'.repeat(150))).toBe('🙂'.repeat(140));});
 it.each([
  ['whatsapp:123456789:5511999990000','whatsapp'],['instagram:123456789:987654321','instagram'],['facebook:123456789:987654321','facebook'],
  [null,'nao_identificado'],[undefined,'nao_identificado'],['5511999990000','nao_identificado'],['whatsapp:123456789:abc','nao_identificado'],
  ['WHATSAPP:123456789:5511999990000','nao_identificado'],['whatsapp:123456789:5511999990000\n','nao_identificado'],['interno:plantao:fixture','nao_identificado'],
  ['instagram:nome:987654321','nao_identificado'],['facebook:123456789:987654321:extra','nao_identificado'],
 ])('classifica a identidade %s sem inferir pelo telefone',(identidade,esperado)=>{expect(canalConversaOperacao(identidade)).toBe(esperado);});
 it.each(['whatsapp','instagram','facebook','nao_identificado',undefined])('aceita somente filtros documentados: %s',canal=>{expect(()=>validarCanalConversaOperacao(canal)).not.toThrow();});
 it.each(['','todos','WHATSAPP',null,{},'instagram OR 1=1'])('recusa filtro não permitido: %s',canal=>{expect(()=>validarCanalConversaOperacao(canal)).toThrow('OPERACAO_CANAL_INVALIDO');});
 it('retorna contagens do escopo e instante do servidor, sem usar o tamanho da página',async()=>{
  const {repo,query}=ambiente(),r=await repo.listar(ator,{busca:'%_\\teste',fila:'novos',estado:'humano',canal:'whatsapp',pagina:2});
  expect(r.registros).toHaveLength(30);expect(r.mais).toBe(true);expect(r.pagina).toBe(2);expect(r.contagens).toEqual({total:66,ia:31,humano:32,pausado:3,encerrada:1});expect(r.contagensConferidasEm).toBe(em.toISOString());
  expect(r.registros[0]).toMatchObject({canal:'whatsapp'});expect(r.registros[0]).not.toHaveProperty('identidade_canal');
  const [sql,parametros]=query.mock.calls.find(([s])=>s.startsWith('WITH escopo'))!;
  expect(sql).toContain('WITH escopo AS MATERIALIZED');expect(sql).toContain('statement_timestamp()');
  const escopo=sql.slice(0,sql.indexOf('), pagina AS'));expect(escopo).toContain('v.fila=$4');expect(escopo).toContain('=$5');expect(escopo).not.toContain('estado=$3');expect(escopo).not.toContain('LIMIT 31');
  expect(sql.slice(sql.indexOf('), pagina AS'))).toContain('estado=$3');expect(sql).toContain('LIMIT 31 OFFSET $2');expect(parametros).toEqual(['%\\%\\_\\\\teste%',30,'humano','novos','whatsapp',ator.id]);
  expect(query.mock.calls.filter(([s])=>s.startsWith('WITH escopo'))).toHaveLength(1);
 });
 it('inclui o canal também na conversa do histórico em somente leitura',async()=>{const {repo}=ambiente(),r=await repo.historico(ator,{conversaId:String(linha.id)});expect(r.conversa).toMatchObject({canal:'whatsapp',somenteLeitura:true});expect(r.conversa).not.toHaveProperty('identidade_canal');});
 it('inclui canal e conversa vinculada no contato sem incorporar contagens de conversa',async()=>{const {repo,query}=ambiente(),r=await repo.listar(ator,{busca:'Contato',pagina:1},true);expect(r).not.toHaveProperty('contagens');expect(r.registros[0]).toMatchObject({id:linha.contato_id,canal:'whatsapp',conversaId:linha.id});expect(r.registros[0]).not.toHaveProperty('identidade_canal');expect(query.mock.calls.some(([s])=>s.startsWith('WITH escopo'))).toBe(false);});
 it('nega acesso antes de consultar conversas ou contagens',async()=>{const {repo,query,autorizar}=ambiente(false);await expect(repo.listar(ator,{canal:'whatsapp'})).rejects.toThrow('OPERACAO_ACESSO_NEGADO');expect(autorizar).toHaveBeenCalledWith(ator,'consultar',expect.anything());expect(query.mock.calls.some(([s])=>s.startsWith('WITH escopo'))).toBe(false);expect(query).toHaveBeenCalledWith('ROLLBACK');});
 it('recusa canal inválido antes de conectar ao banco',async()=>{const {repo,pool}=ambiente();await expect(repo.listar(ator,{canal:'todos'})).rejects.toThrow('OPERACAO_CANAL_INVALIDO');expect(pool.connect).not.toHaveBeenCalled();});
});
