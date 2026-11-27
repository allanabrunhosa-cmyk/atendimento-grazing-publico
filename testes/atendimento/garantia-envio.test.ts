import {describe,it,expect,vi,afterEach} from 'vitest';
import type {Pool,PoolClient} from 'pg';
import {enviarTextoWhatsApp} from '../../src/lib/atendimento/envio-whatsapp';
import {criarAutenticacaoHub} from '../../src/lib/atendimento/operacao-autenticacao-hub';
import {conciliarAceitePerdidoOperacaoTx} from '../../src/lib/atendimento/operacao-repositorio-pg';
vi.mock('server-only',()=>({}));
const intencaoId='fa440001-0000-4000-a000-000000000001';
afterEach(()=>{delete process.env.ATENDIMENTO_ENVIO_HABILITADO;delete process.env.ATENDIMENTO_AUTORIDADE_ENVIO;vi.useRealTimers();});
describe('Garantia de envio e agilidade do atendimento',()=>{
 it('texto leva o ID da intenção para a Meta devolver nos status',async()=>{
  process.env.ATENDIMENTO_ENVIO_HABILITADO='true';process.env.ATENDIMENTO_AUTORIDADE_ENVIO='vps';
  const f=vi.fn(async()=>new Response(JSON.stringify({messaging_product:'whatsapp',messages:[{id:'wamid.FICTICIO'}]}),{status:200}));
  await enviarTextoWhatsApp({id:intencaoId,destinatario:'5511000000440',texto:'Texto fictício'},{token:'fixture',numeroId:'123456789012345',versao:'v23.0',modo:'operacao',destinatariosAutorizados:[]},async()=>true,f as unknown as typeof fetch);
  const chamada=f.mock.calls[0] as unknown as [string,RequestInit];
  expect(JSON.parse(String(chamada[1].body)).biz_opaque_callback_data).toBe(intencaoId);
 });
 it('conciliação ignora referência ou wamid fora do formato sem consultar o banco',async()=>{
  const query=vi.fn(),tx={query} as unknown as PoolClient,em=new Date().toISOString();
  expect(await conciliarAceitePerdidoOperacaoTx(tx,undefined,'wamid.FICTICIO',em)).toBe(false);
  expect(await conciliarAceitePerdidoOperacaoTx(tx,'texto livre','wamid.FICTICIO',em)).toBe(false);
  expect(await conciliarAceitePerdidoOperacaoTx(tx,intencaoId,'outro-id',em)).toBe(false);
  expect(query).not.toHaveBeenCalled();
 });
 it('conciliação só vincula intenção sem wamid, em processamento ou incerta',async()=>{
  const sqls:string[]=[],em=new Date().toISOString();
  const tx={query:vi.fn(async(sql:string)=>{sqls.push(sql);return sqls.length===1?{rowCount:1,rows:[{mensagem_id:'m',conversa_id:'c'}]}:{rowCount:1,rows:[]};})} as unknown as PoolClient;
  expect(await conciliarAceitePerdidoOperacaoTx(tx,intencaoId,'wamid.FICTICIO',em)).toBe(true);
  expect(sqls[0]).toContain("wamid IS NULL AND estado IN ('processando','incerto')");expect(sqls[0]).toContain('NOT EXISTS');expect(sqls).toHaveLength(3);
  const semLinha={query:vi.fn(async()=>({rowCount:0,rows:[]}))} as unknown as PoolClient;
  expect(await conciliarAceitePerdidoOperacaoTx(semLinha,intencaoId,'wamid.FICTICIO',em)).toBe(false);expect(semLinha.query).toHaveBeenCalledOnce();
 });
 describe('memória curta da identidade do HUB',()=>{
  const usuario={id:'fixture-hub',nome:'Pessoa fictícia',ativo:true,excluido:false,senhaDefinida:true,sessaoVersao:1,perfilId:'perfil-ficticio',perfilSistema:null,permissoes:{'crm.atendimento':['visualizar']},excecoes:{},permissoesGranulares:true};
  const identidade={id:usuario.id,nome:usuario.nome,perfilId:usuario.perfilId,sessaoVersao:1,permissoes:[]};
  function montar(cacheIdentidadeMs?:number){
   let falhar=false;const central={query:vi.fn(async()=>{if(falhar)throw Error('indisponível');return {rows:[usuario]};})},local={query:vi.fn(async()=>({rows:[],rowCount:1}))};
   const auth=criarAutenticacaoHub({central:central as unknown as Pool,local:local as unknown as Pool,origem:'https://atendimento.grazinghub.com.br',csrfSecret:'f'.repeat(40),cacheIdentidadeMs});
   return {auth,central,falhar:(v:boolean)=>{falhar=v;}};
  }
  it('sem configuração, cada conferência consulta o HUB',async()=>{
   const {auth,central}=montar();await auth.autorizar(identidade,'consultar');await auth.autorizar(identidade,'consultar');expect(central.query).toHaveBeenCalledTimes(2);
  });
  it('com memória, conferências próximas compartilham uma leitura e expiram em três segundos',async()=>{
   vi.useFakeTimers();const {auth,central}=montar(3000);
   expect(await Promise.all([auth.autorizar(identidade,'consultar'),auth.autorizar(identidade,'consultar')])).toEqual([true,true]);
   await auth.autorizar(identidade,'consultar');expect(central.query).toHaveBeenCalledTimes(1);
   vi.advanceTimersByTime(3001);await auth.autorizar(identidade,'consultar');expect(central.query).toHaveBeenCalledTimes(2);
  });
  it('revogação no HUB vale assim que a memória expira e falha nunca fica guardada',async()=>{
   vi.useFakeTimers();const {auth,central,falhar}=montar(3000);
   falhar(true);await expect(auth.autorizar(identidade,'consultar')).rejects.toThrow();falhar(false);
   expect(await auth.autorizar(identidade,'consultar')).toBe(true);expect(central.query).toHaveBeenCalledTimes(2);
   usuario.ativo=false;vi.advanceTimersByTime(3001);expect(await auth.autorizar(identidade,'consultar')).toBe(false);usuario.ativo=true;
  });
  it('limita a memória a cinco segundos',async()=>{
   vi.useFakeTimers();const {auth,central}=montar(60000);await auth.autorizar(identidade,'consultar');vi.advanceTimersByTime(5001);await auth.autorizar(identidade,'consultar');expect(central.query).toHaveBeenCalledTimes(2);
  });
 });
});
