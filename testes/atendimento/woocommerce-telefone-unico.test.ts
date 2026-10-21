import {createHash} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import type {PoolClient} from 'pg';
import type {RepositorioOperacaoPg} from '../../src/lib/atendimento/operacao-repositorio-pg';
import {hashWoo,normalizarRegraWoo,ServicoAutomacoesWoo,type ConfiguracaoAutomacoesWoo} from '../../src/lib/atendimento/operacao-woocommerce-automacoes';
vi.mock('server-only',()=>({}));

const telefone='5511900000123',contato='11111111-1111-4111-a111-111111111111',conversa='22222222-2222-4222-a222-222222222222',execucao='33333333-3333-4333-a333-333333333333';
const configuracao:ConfiguracaoAutomacoesWoo={site:'https://loja-ficticia.test/',segredo:'assinatura-ficticia',webhookIds:['3301'],habilitado:true,modo:'operacao',autoridade:'vps',enviosHabilitados:true,ficticio:true};
const payload={id:3301,status:'processing',billing:{first_name:'Pessoa fictícia',phone:'+'+telefone,country:'BR'}};
const regra=normalizarRegraWoo({id:'44444444-4444-4444-a444-444444444444',active:true,trigger_topic:'order.updated',action_type:'whatsapp_message',delay_minutes:0,cooldown_hours:0,cancel_if_changed:true,filters:{logic:'OR',conditions:[{field:'status',operator:'changed_to',value:'processing'},{field:'status',operator:'changed_to',value:'completed'}]},action_config:{phone_field:'billing.phone',template_id:'modelo-ficticio',variables:['billing.first_name','id']}},'modelo-ficticio');
function ambiente(candidatos:{id:string;identidade_canal:string|null;versao:number}[],jaVinculado=false){
 const raw=Buffer.from(JSON.stringify(payload)),agora=new Date('2026-10-15T12:00:00Z');
 const query=vi.fn(async(sql:string,parametros?:unknown[])=>{
  void parametros;
  if(sql==='SELECT current_database() nome')return {rows:[{nome:'donatella_ensaio_operacao'}]};
  if(sql.startsWith('SELECT id,external_id FROM atendimento_operacao.woo_execucao'))return {rows:[{id:execucao,external_id:'3301'}]};
  if(sql.startsWith('SELECT * FROM atendimento_operacao.woo_execucao'))return {rows:[{id:execucao,external_id:'3301',event_id:'evento-ficticio',regra_id:regra.id,regra_hash:hashWoo(regra),payload}]};
  if(sql.startsWith('SELECT id,conteudo,hash,modelo_id'))return {rows:[{id:regra.id,conteudo:regra,hash:hashWoo(regra),modelo_id:'modelo-ficticio'}]};
  if(sql.startsWith('SELECT status,conteudo'))return {rows:[{status:'processing',conteudo:payload}]};
  if(sql.startsWith('SELECT id,nome,idioma,estado,componentes'))return {rows:[{id:'modelo-ficticio',nome:'modelo_ficticio',idioma:'pt_BR',estado:'APPROVED',componentes:[{type:'BODY',text:'Olá {{1}}'}]}]};
  if(sql.startsWith('SELECT raw,payload_hash,estado'))return {rows:[{raw,payload_hash:createHash('sha256').update(raw).digest('hex'),estado:'processado'}]};
  if(sql.startsWith('SELECT id,telefone FROM atendimento_operacao.contato'))return {rows:jaVinculado?[{id:contato,telefone}]:[]};
  if(sql.startsWith('INSERT INTO atendimento_operacao.contato'))return {rows:[{id:contato,telefone}]};
  if(sql.startsWith('SELECT id,versao,ficticia FROM atendimento_operacao.conversa'))return {rows:jaVinculado?[{id:conversa,versao:'1',ficticia:true}]:[]};
  if(sql.startsWith('INSERT INTO atendimento_operacao.conversa'))return {rows:[{id:conversa,versao:'1',ficticia:true}]};
  if(sql.startsWith('SELECT pg_advisory_xact_lock')||sql.startsWith('UPDATE atendimento_operacao.woo_execucao'))return {rows:[],rowCount:1};
  throw Error('SQL_FIXTURE_INESPERADO:'+sql);
 });
 const tx={query} as unknown as PoolClient,contatosTelefoneExatoTx=vi.fn(async()=>candidatos),enfileirarTx=vi.fn(async()=>({id:execucao})),auditar=vi.fn(async()=>{});
 const repo={transacao:async<T>(f:(tx:PoolClient)=>Promise<T>)=>f(tx),autorizar:async()=>true,contatosTelefoneExatoTx,enfileirarTx,auditar} as unknown as RepositorioOperacaoPg;
 const servico=new ServicoAutomacoesWoo({repo,empresaId:'empresa-ficticia',canalNumeroId:'123456789',configuracao:()=>configuracao,agora:()=>agora});
 return {servico,query,tx,contatosTelefoneExatoTx,enfileirarTx,auditar};
}

it.each([null,'whatsapp:987654321:'+telefone])('preserva a execução pendente quando o telefone já existe com identidade %s',async identidade_canal=>{
 const f=ambiente([{id:contato,identidade_canal,versao:1}]);
 expect(await f.servico.processarProxima()).toEqual({estado:'bloqueada',codigo:'IDENTIDADE_CONFLITO'});
 expect(f.contatosTelefoneExatoTx).toHaveBeenCalledExactlyOnceWith(f.tx,telefone);
 expect(f.query.mock.calls.some(([s])=>s.startsWith('INSERT INTO atendimento_operacao.contato')||s.startsWith('INSERT INTO atendimento_operacao.conversa'))).toBe(false);
 expect(f.query.mock.calls.find(([s])=>s.startsWith('UPDATE atendimento_operacao.woo_execucao'))?.[1]).toEqual([execucao,'IDENTIDADE_CONFLITO','2026-10-15T12:01:00.000Z']);
 expect(f.query.mock.calls.some(([s])=>s.includes("estado='cancelada'"))).toBe(false);
 expect(f.enfileirarTx).not.toHaveBeenCalled();expect(f.auditar).not.toHaveBeenCalled();
});

it('permite o cadastro somente quando o telefone exato não existe',async()=>{
 const f=ambiente([]);expect(await f.servico.processarProxima()).toEqual({estado:'enfileirada',intencaoId:execucao});
 expect(f.contatosTelefoneExatoTx).toHaveBeenCalledExactlyOnceWith(f.tx,telefone);
 expect(f.query.mock.calls.filter(([s])=>s.startsWith('INSERT INTO atendimento_operacao.contato'))).toHaveLength(1);
 expect(f.enfileirarTx).toHaveBeenCalledOnce();
});

it('mantém o fluxo da identidade já vinculada sem criar outro cadastro',async()=>{
 const f=ambiente([],true);expect(await f.servico.processarProxima()).toEqual({estado:'enfileirada',intencaoId:execucao});
 expect(f.contatosTelefoneExatoTx).not.toHaveBeenCalled();expect(f.query.mock.calls.some(([s])=>s.startsWith('INSERT INTO atendimento_operacao.contato'))).toBe(false);
 expect(f.enfileirarTx).toHaveBeenCalledWith(f.tx,expect.objectContaining({tipo:'automacao'}),expect.objectContaining({conversaId:conversa,versao:1,idempotencia:execucao,tipo:'template'}),'automacao');
});
