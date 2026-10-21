import {describe,it,expect,vi} from 'vitest';
import type {Pool,PoolClient} from 'pg';
import {normalizarContatosCompartilhadosOperacao,resumoContatosCompartilhadosOperacao,AVISO_CONTATOS_COMPARTILHADOS_GRANDE,type LeitorContatosCompartilhadosOperacao} from '../../src/lib/atendimento/operacao-contatos-compartilhados';
import {interpretarMensagemEntradaOperacao} from '../../src/lib/atendimento/operacao-mensagem-entrada';
import {RepositorioOperacaoPg,RepositorioEntradaPg,conteudoMensagemOperacao} from '../../src/lib/atendimento/operacao-repositorio-pg';
import type {IdentidadeOperacao} from '../../src/lib/atendimento/operacao-tipos';
import {paginarOperacaoPorBytes} from '../../src/lib/atendimento/operacao-paginacao';
vi.mock('server-only',()=>({}));
const cartao={name:{formatted_name:'Empresa Fictícia'},org:{company:'Empresa Exemplo'},phones:[{phone:'+55 (11) 90000-0001',type:'WORK',wa_id:'5511900009999'}],emails:[{email:'equipe@example.com',type:'WORK'}]};
const normalizado={nome:'Empresa Fictícia',empresa:'Empresa Exemplo',telefones:[{numero:'+55 (11) 90000-0001',tipo:'WORK'}],emails:['equipe@example.com']};
const id='11111111-1111-4111-8111-111111111111',mensagemId='22222222-2222-4222-8222-222222222222',citadoId='33333333-3333-4333-8333-333333333333';
const ator:IdentidadeOperacao={id:'fixture-cartoes',nome:'Atendente Fictício',perfilId:'fixture',sessaoVersao:1,permissoes:[]};
const mensagem=()=>({id:mensagemId,conversa_id:id,autor:'cliente',wamid:'wamid.fixture-cartao',tipo:'unsupported',conteudo:'',metadados:{tipoOriginal:'contacts'},criada_em:new Date(),cursor_em:'2026-10-15T12:00:00.000000Z',estado:'recebido'});
function ambiente(p:{ler?:LeitorContatosCompartilhadosOperacao;mensagens?:Record<string,unknown>[];identidade?:string;wabaId?:string;ficticia?:boolean;permitir?:boolean}={}){
 const rows=p.mensagens??[mensagem()],conversa={id,contato_id:citadoId,identidade_canal:p.identidade??'whatsapp:123456789:5511900000001',ficticia:p.ficticia??true,versao:1,estado:'humano'};
 const query=vi.fn(async(sql:string)=>{
  if(sql==='SELECT current_database() nome')return {rows:[{nome:'donatella_ensaio_operacao'}],rowCount:1};
  if(sql.startsWith('SELECT v.*'))return {rows:[conversa],rowCount:1};
  if(sql.startsWith('WITH conversas'))return {rows:rows.map(v=>({...v})),rowCount:rows.length};
  return {rows:[],rowCount:0};
 });
 const tx={query,release:vi.fn()} as unknown as PoolClient,pool={connect:vi.fn(async()=>tx)} as unknown as Pool;
 const repo=new RepositorioOperacaoPg(pool,async(_,a)=>a!=='mensagens.visualizar'||p.permitir!==false,()=> 'homologacao','fixture',undefined,undefined,'humano',{numeroId:'123456789',wabaId:p.wabaId??'1122334455',ficticio:true},p.ler);
 return {repo,query};
}
describe('cartões de contatos recebidos',()=>{
 it('interpreta o contato e preserva o telefone literal sem usar wa_id',()=>{
  const r=interpretarMensagemEntradaOperacao({type:'contacts',contacts:[cartao]});expect(r).toEqual({tipo:'unsupported',conteudo:'Contato compartilhado: Empresa Fictícia',metadados:{tipoOriginal:'contacts',contatosCompartilhados:[normalizado]}});expect(r.metadados).not.toHaveProperty('wa_id');
 });
 it('não confunde o perfil do remetente com os cartões anexados',()=>{expect(interpretarMensagemEntradaOperacao({type:'text',text:{body:'Seguem contatos'},contacts:[cartao]})).toMatchObject({tipo:'text',conteudo:'Seguem contatos'});});
 it('usa componentes do nome e mantém empresa, email ou nome sem telefone',()=>{
  expect(normalizarContatosCompartilhadosOperacao([{name:{first_name:'Ana',middle_name:'de',last_name:'Souza'}},{org:{company:'Empresa Fictícia'}},{emails:[{email:'pessoa@example.com'}]}]).map(c=>c.nome)).toEqual(['Ana de Souza','Empresa Fictícia','Contato compartilhado']);
 });
 it('remove controles e marcas bidirecionais sem executar conteúdo',()=>{
  const [r]=normalizarContatosCompartilhadosOperacao([{...cartao,name:{formatted_name:'  Ana\u0000\u202e\nSouza  '},org:{company:'<script>alert(1)</script>'}}]);expect(r.nome).toBe('Ana Souza');expect(r.empresa).toBe('<script>alert(1)</script>');
 });
 it('rejeita telefones com letras, controles e múltiplos sinais sem fabricar número',()=>{
  const [r]=normalizarContatosCompartilhadosOperacao([{name:{formatted_name:'Pessoa Fictícia'},phones:['5511900000001','5511900000001abc','++5511900000001','55119\n00000001','+','1'.repeat(81)].map(phone=>({phone,wa_id:'5511900000001'}))}]);expect(r.telefones).toEqual([{numero:'5511900000001',tipo:''}]);
 });
 it('remove repetições de telefone/email e recusa emails malformados',()=>{
  const [r]=normalizarContatosCompartilhadosOperacao([{...cartao,phones:[...cartao.phones,...cartao.phones],emails:[{email:'equipe@example.com'},{email:' equipe@example.com '},{email:'abc'},{email:'x\n@example.com'}]}]);expect(r.telefones).toHaveLength(1);expect(r.emails).toEqual(['equipe@example.com']);
 });
 it('preserva todos os cartões, telefones e emails, limitando os textos',()=>{
  const bruto={name:{formatted_name:'a'.repeat(199)+'🙂'+'b'.repeat(100)},org:{company:'c'.repeat(300)},phones:Array.from({length:25},(_,n)=>({phone:'551190000'+String(n).padStart(4,'0'),type:'t'.repeat(80)})),emails:Array.from({length:25},(_,n)=>({email:`pessoa${n}@example.com`}))};
  const r=normalizarContatosCompartilhadosOperacao(Array.from({length:25},()=>bruto));expect(r).toHaveLength(25);expect(r[0].telefones).toHaveLength(25);expect(r[0].emails).toHaveLength(25);expect(r[0].nome).toBe('a'.repeat(199));expect(r[0].empresa).toHaveLength(200);expect(r[0].telefones[0].tipo).toHaveLength(40);
 });
 it.each([undefined,null,{},['texto'],[{name:{}}],[{phones:[{wa_id:'5511900000001'}]}]])('trata payload inválido como contato indisponível: %j',contacts=>{expect(interpretarMensagemEntradaOperacao({type:'contacts',contacts})).toEqual({tipo:'unsupported',conteudo:'Contato compartilhado indisponível',metadados:{tipoOriginal:'contacts',contatosCompartilhados:[]}});});
 it('resume múltiplos cartões para prévia e citação sem mostrar payload bruto',()=>{const r=normalizarContatosCompartilhadosOperacao(Array.from({length:5},(_,n)=>({name:{formatted_name:'Pessoa '+n}})));expect(resumoContatosCompartilhadosOperacao(r)).toBe('Contatos compartilhados: Pessoa 0, Pessoa 1, Pessoa 2 e mais 2');expect(conteudoMensagemOperacao({tipo:'unsupported',conteudo:'',metadados:{tipoOriginal:'contacts',contatosCompartilhados:[normalizado]}})).toBe('Contato compartilhado: Empresa Fictícia');});
 it('preserva 257 cartões dentro do teto do histórico, incluindo o último contato',()=>{
  const contatosCompartilhados=normalizarContatosCompartilhadosOperacao(Array.from({length:257},(_,n)=>({...cartao,name:{formatted_name:'Pessoa fictícia '+n}})));
  const p=paginarOperacaoPorBytes([{id,criadaEm:'2026-10-15T12:00:00Z',contatosCompartilhados}],false,{});expect(p.registros[0].contatosCompartilhados).toHaveLength(257);expect(p.registros[0].contatosCompartilhados[256].nome).toBe('Pessoa fictícia 256');
 });
 it('mantém o histórico legível e avisa quando um cartão recebido exceder o orçamento de exibição',async()=>{
  const bruto=[{name:{formatted_name:'Pessoa fictícia'},phones:Array.from({length:30000},(_,n)=>({phone:'551190'+String(n).padStart(7,'0'),type:'WORK'}))}];
  expect(Buffer.byteLength(JSON.stringify(bruto))).toBeLessThan(2097152);const contatosCompartilhados=normalizarContatosCompartilhadosOperacao(bruto);expect(contatosCompartilhados[0].telefones).toHaveLength(30000);
  const metadados={tipoOriginal:'contacts',contatosCompartilhados},antes=JSON.stringify(metadados),{repo}=ambiente({mensagens:[{...mensagem(),metadados},{...mensagem(),id:citadoId,tipo:'text',conteudo:'Texto normal preservado',metadados:{},citada_resolvida_id:mensagemId,citada_tipo:'unsupported',citada_autor:'cliente',citada_metadados:metadados}]});
  const r=await repo.historico(ator,{conversaId:id});expect(r.registros).toHaveLength(2);expect(r.registros.find(m=>m.id===mensagemId)).toMatchObject({tipo:'unsupported',conteudo:AVISO_CONTATOS_COMPARTILHADOS_GRANDE,contatosCompartilhados:[]});expect(r.registros.find(m=>m.id===citadoId)).toMatchObject({conteudo:'Texto normal preservado',citada:{tipo:'unsupported',conteudo:AVISO_CONTATOS_COMPARTILHADOS_GRANDE}});
  expect(JSON.stringify(metadados)).toBe(antes);expect(Buffer.byteLength(JSON.stringify(r))).toBeLessThan(1024*1024);
 });
});
describe('resgate durável sem reprocessamento',()=>{
 it('recupera mensagem e citação num único lote com escopo exato',async()=>{
  const ler=vi.fn(async()=>new Map([['wamid.fixture-cartao',[normalizado]]]));const {repo}=ambiente({ler,mensagens:[{...mensagem(),citada_resolvida_id:citadoId,citada_tipo:'unsupported',citada_autor:'cliente',citada_wamid:'wamid.fixture-cartao',citada_metadados:{tipoOriginal:'contacts'}}]});
  const r=await repo.historico(ator,{conversaId:id});expect(ler).toHaveBeenCalledExactlyOnceWith([{wamid:'wamid.fixture-cartao',waba:'1122334455',numero:'123456789',remetente:'5511900000001'}]);expect(r.registros[0]).toMatchObject({tipo:'contacts',conteudo:'Contato compartilhado: Empresa Fictícia',contatosCompartilhados:[normalizado],citada:{id:citadoId,tipo:'contacts',conteudo:'Contato compartilhado: Empresa Fictícia'}});
 });
 it('não consulta entrada para cartões já preservados nos metadados',async()=>{const ler=vi.fn(async()=>new Map());const {repo}=ambiente({ler,mensagens:[{...mensagem(),metadados:{tipoOriginal:'contacts',contatosCompartilhados:[normalizado]}}]});expect((await repo.historico(ator,{conversaId:id})).registros[0]).toMatchObject({tipo:'contacts',contatosCompartilhados:[normalizado]});expect(ler).not.toHaveBeenCalled();});
 it('preserva o restante do histórico se a origem estiver offline',async()=>{const {repo}=ambiente({ler:async()=>{throw Error('ORIGEM_OFFLINE');}});expect((await repo.historico(ator,{conversaId:id})).registros[0]).toMatchObject({tipo:'unsupported',conteudo:'Contato compartilhado indisponível',contatosCompartilhados:[]});});
 it.each([{identidade:'whatsapp:999999999:5511900000001'},{identidade:'instagram:123456789:123456789'},{ficticia:false},{wabaId:''},{wabaId:'WABA-inválida'}])('não cruza número empresarial, canal ou ambiente sem WABA válida: %j',async p=>{const ler=vi.fn(async()=>new Map());const {repo}=ambiente({...p,ler});await repo.historico(ator,{conversaId:id});expect(ler).not.toHaveBeenCalled();});
 it('não consulta conteúdo sem a permissão de ler mensagens',async()=>{const ler=vi.fn(async()=>new Map());const {repo,query}=ambiente({ler,permitir:false});expect((await repo.historico(ator,{conversaId:id})).registros).toEqual([]);expect(ler).not.toHaveBeenCalled();expect(query.mock.calls.some(([s])=>s.startsWith('WITH conversas'))).toBe(false);});
 it('não recupera o remetente a partir do telefone exibido ou de uma mensagem humana',async()=>{const ler=vi.fn(async()=>new Map());const {repo}=ambiente({ler,mensagens:[{...mensagem(),autor:'humano'}]});await repo.historico(ator,{conversaId:id});expect(ler).not.toHaveBeenCalled();});
});
describe('leitor de recibos',()=>{
 function entrada(nome='donatella_ensaio_entrada',rows:Record<string,unknown>[]=[]){const query=vi.fn(async(sql:string)=>({rows:sql==='SELECT current_database() nome'?[{nome}]:sql.startsWith('SELECT p.wamid')?rows:[],rowCount:1})),tx={query,release:vi.fn()} as unknown as PoolClient;return {repo:new RepositorioEntradaPg({connect:async()=>tx} as unknown as Pool),query,tx};}
 const pedidos=[{wamid:'wamid.fixture-cartao',waba:'1122334455',numero:'123456789',remetente:'5511900000001'}];
 it('lê somente a origem exata em transação read only',async()=>{const {repo,query,tx}=entrada(undefined,[{wamid:pedidos[0].wamid,contatos:[cartao]}]);expect((await repo.contatosCompartilhados(pedidos,true)).get(pedidos[0].wamid)).toEqual([normalizado]);expect(query).toHaveBeenCalledWith('BEGIN READ ONLY');const [sql]=query.mock.calls.find(([s])=>s.startsWith('SELECT p.wamid'))!;expect(sql).toContain('e.chave=p.chave');expect(sql).toContain('e.waba=p.waba');expect(sql).toContain('e.numero=p.numero');expect(sql).toContain("e.conteudo->'item'->>'from'=p.remetente");expect(sql).toContain("e.conteudo->'item'->>'id'=p.wamid");expect(query.mock.calls.some(([s])=>/INSERT|UPDATE|DELETE/.test(s))).toBe(false);expect(tx.release).toHaveBeenCalled();});
 it('recusa banco de outro ambiente antes de ler o recibo',async()=>{const {repo,query}=entrada('donatella_entrada');await expect(repo.contatosCompartilhados(pedidos,true)).rejects.toThrow('DESTINO_ENTRADA_RECUSADO');expect(query.mock.calls.some(([s])=>s.startsWith('SELECT p.wamid'))).toBe(false);expect(query).toHaveBeenCalledWith('ROLLBACK');});
 it('não escolhe entre dois eventos com a mesma referência',async()=>{const {repo}=entrada(undefined,Array.from({length:2},()=>({wamid:pedidos[0].wamid,contatos:[cartao]})));expect(await repo.contatosCompartilhados(pedidos,true)).toEqual(new Map());});
 it('valida tamanho do lote e identificadores antes de conectar',async()=>{const {repo,query}=entrada();await expect(repo.contatosCompartilhados([...pedidos,{...pedidos[0],remetente:'outro'}],true)).rejects.toThrow('REFERENCIA_CONTATO_INVALIDA');await expect(repo.contatosCompartilhados(Array.from({length:101},()=>pedidos[0]),true)).rejects.toThrow('REFERENCIA_CONTATO_INVALIDA');expect(query).not.toHaveBeenCalled();});
});
