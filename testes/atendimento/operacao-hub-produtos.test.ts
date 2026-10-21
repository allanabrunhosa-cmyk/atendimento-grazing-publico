import {describe,expect,it,vi} from 'vitest';
import type {Pool,PoolClient} from 'pg';
vi.mock('server-only',()=>({}));
import {criarCatalogoHub} from '../../src/lib/atendimento/operacao-hub-produtos';
const instante='2026-10-20T13:00:00.000Z';
const linha=(extra:Record<string,unknown>={})=>({id:'produto-ficticio',nome:'Tábua fictícia',especificacao:'Serve duas pessoas.',descricao:'Composição comercial fictícia.',versao:'3',sku:null,woo_produto_id:null,woo_variacao_id:null,...extra});
function fixture(rows:unknown[]=[linha()]){
 const query=vi.fn(async(sql:string)=>({rows:sql.startsWith('SELECT id,')?rows:[],rowCount:rows.length})),release=vi.fn();
 const central={connect:vi.fn(async()=>({query,release}) as unknown as PoolClient)};
 return {query,release,central:central as unknown as Pick<Pool,'connect'>,catalogo:criarCatalogoHub(central as unknown as Pick<Pool,'connect'>,{agora:()=>new Date(instante)})};
}
describe('catálogo HUB pela projeção comercial, sem rede ou banco real',()=>{
 it('consulta somente a view em transação readonly e retorna fatos HUB sem inferir SKU/Woo',async()=>{
  const f=fixture(),r=await f.catalogo.buscar('Tábua',new AbortController().signal);
  expect(r).toEqual({produtos:[{id:'produto-ficticio',nome:'Tábua fictícia',especificacao:'Serve duas pessoas.\nComposição comercial fictícia.',sku:null,versao:'3',wooProdutoId:null,wooVariacaoId:null,consultadoEm:instante}],mais:false});
  expect(f.query.mock.calls[0]).toEqual(['BEGIN READ ONLY']);expect(f.query.mock.calls.at(-1)).toEqual(['ROLLBACK']);expect(f.release).toHaveBeenCalledTimes(1);
  expect(f.query.mock.calls.find(c=>c[0].startsWith('SELECT id,'))?.[0]).toContain('FROM atendimento_integracao.produto_comercial');
  expect(f.query.mock.calls.map(c=>c[0]).join('\n')).not.toMatch(/public\.|INSERT|UPDATE|DELETE|\bCOMMIT\b/);
 });
 it('usa descrição comercial quando especificação não foi preenchida',async()=>{
  const f=fixture([linha({especificacao:null,descricao:'<p>Opção para presente.</p>'})]);expect((await f.catalogo.buscar('',new AbortController().signal)).produtos[0].especificacao).toBe('Opção para presente.');
 });
 it('não oferece produto sem especificação factual nem repassa campos privados adicionais',async()=>{
  const f=fixture([linha({especificacao:' ',descricao:'<p></p>',custo:'segredo-ficticio'}),linha({id:'outra-ficticia',custo:'segredo-ficticio'})]);
  const r=await f.catalogo.buscar('',new AbortController().signal);expect(r.produtos).toHaveLength(1);expect(JSON.stringify(r)).not.toMatch(/custo|segredo/);
 });
 it('limita resultados e sinaliza que há mais, sem copiar catálogo completo',async()=>{
  const f=fixture(Array.from({length:11},(_,i)=>linha({id:'ficticio-'+i})));const r=await f.catalogo.buscar('',new AbortController().signal);expect(r.produtos).toHaveLength(10);expect(r.mais).toBe(true);
 });
 it('separa parâmetros da SQL e escapa curingas fornecidos na busca',async()=>{
  const f=fixture();await f.catalogo.buscar("%_\\ ' OR 1=1",new AbortController().signal);const c=f.query.mock.calls.find(c=>c[0].startsWith('SELECT id,')) as unknown as [string,unknown[]];expect(c[0]).not.toContain('OR 1=1');expect(c[1][2]).toEqual(['%\\%\\_\\\\%',"%'%",'%or%','%1=1%']);
 });
 it('obtém somente o ID selecionado sem aceitar uma URL como destino',async()=>{
  const f=fixture();const p=await f.catalogo.obter('produto-ficticio',new AbortController().signal);expect(p?.id).toBe('produto-ficticio');const c=f.query.mock.calls.find(c=>c[0].startsWith('SELECT id,')) as unknown as [string,unknown[]];expect(c[1]).toEqual(['produto-ficticio','',[],1]);
 });
 it('cancelamento anterior não abre conexão',async()=>{
  const f=fixture(),c=new AbortController();c.abort();await expect(f.catalogo.buscar('teste',c.signal)).rejects.toThrow('HUB_CONSULTA_CANCELADA');expect(f.central.connect).not.toHaveBeenCalled();
 });
 it('cancelamento durante a leitura descarta o resultado e libera a conexão',async()=>{
  const f=fixture(),c=new AbortController();f.query.mockImplementation(async(sql:string)=>{if(sql.startsWith('SELECT id,'))c.abort();return {rows:[linha()],rowCount:1};});await expect(f.catalogo.buscar('teste',c.signal)).rejects.toThrow('HUB_CONSULTA_CANCELADA');expect(f.release).toHaveBeenCalledTimes(1);expect(f.query.mock.calls.at(-1)).toEqual(['ROLLBACK']);
 });
 it('view ausente ou leitura negada informa indisponibilidade sem expor erros internos',async()=>{
  const f=fixture();f.query.mockImplementation(async(sql:string)=>{if(sql.startsWith('SELECT id,'))throw Error('segredo-ficticio schema banco');return {rows:[],rowCount:0};});await expect(f.catalogo.buscar('',new AbortController().signal)).rejects.toThrow(/^HUB_CATALOGO_INDISPONIVEL$/);expect(f.release).toHaveBeenCalledTimes(1);
 });
 it('descarta conexão quebrada sem expor falha privada do rollback',async()=>{
  const f=fixture();f.query.mockImplementation(async(sql:string)=>{if(sql==='ROLLBACK')throw Error('segredo-ficticio');return {rows:sql.startsWith('SELECT id,')?[linha()]:[],rowCount:1};});expect((await f.catalogo.buscar('',new AbortController().signal)).produtos).toHaveLength(1);expect(f.release).toHaveBeenCalledExactlyOnceWith(true);
 });
 it('não transforma códigos ou vínculos desconhecidos em autorização comercial',async()=>{
  const f=fixture([linha({sku:'interno-nao-conferido',woo_produto_id:17})]);await expect(f.catalogo.buscar('',new AbortController().signal)).rejects.toThrow('HUB_CATALOGO_INDISPONIVEL');
 });
 it('valida limites e entrada antes de consultar',async()=>{
  const f=fixture();expect(()=>criarCatalogoHub(f.central,{limite:21})).toThrow('HUB_CONFIGURACAO_INVALIDA');await expect(f.catalogo.buscar('x'.repeat(161),new AbortController().signal)).rejects.toThrow('HUB_BUSCA_INVALIDA');expect(f.central.connect).not.toHaveBeenCalled();
 });
 it('busca por termos alternativos, compara acentos sem extensão e ordena por relevância',async()=>{
  const f=fixture();await f.catalogo.buscar('TÁBUA clássica clássica',new AbortController().signal);const c=f.query.mock.calls.find(c=>c[0].startsWith('SELECT id,')) as unknown as [string,unknown[]];expect(c[1][2]).toEqual(['%tabua%','%classica%']);expect(c[0]).toContain('r.relevancia>0');expect(c[0]).toContain('r.relevancia DESC');expect(c[0]).toContain('translate(lower(p.nome)');expect(c[0]).toContain('THEN 3');expect(c[0]).toContain('THEN 1');expect(c[0]).not.toContain('unaccent');
 });
 it('conta a projeção sem ler o catálogo nem dados de outra tabela',async()=>{
  const f=fixture();f.query.mockImplementation(async(sql:string)=>({rows:sql.startsWith('SELECT count(*)')?[{total:'55'}]:[],rowCount:1}));expect(await f.catalogo.contar()).toBe(55);expect(f.query.mock.calls.find(c=>c[0].startsWith('SELECT count(*)'))?.[0]).toBe('SELECT count(*)::text total FROM atendimento_integracao.produto_comercial');expect(f.release).toHaveBeenCalledTimes(1);
 });
});
