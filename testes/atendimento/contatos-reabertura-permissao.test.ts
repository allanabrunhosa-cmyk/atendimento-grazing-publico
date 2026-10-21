import {describe,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {RepositorioOperacaoPg} from '../../src/lib/atendimento/operacao-repositorio-pg';
import type {AcaoOperacao,IdentidadeOperacao} from '../../src/lib/atendimento/operacao-tipos';
vi.mock('server-only',()=>({}));
const contatoId='11111111-1111-4111-8111-111111111111',conversaId='22222222-2222-4222-8222-222222222222';
const ator:IdentidadeOperacao={id:'fixture-reabertura',nome:'Pessoa fictícia',perfilId:'fixture',sessaoVersao:1,permissoes:[],tipo:'usuario'};
function ambiente(estadoInicial='encerrada'){
 let estado=estadoInicial;const direitos=new Set<AcaoOperacao>(['consultar','contatos.visualizar','conversas.visualizar','conversas.adicionar','mensagens.visualizar','mensagens.adicionar']),comandos=new Map<string,{autor_id:string;hash:string;resultado:unknown}>();
 const contato={id:contatoId,nome:'Contato fictício',telefone:'5511900000001',identidade_canal:'whatsapp:123456789:5511900000001',versao:1,tags:[]};
 const registro=()=>({...contato,id:conversaId,contato_id:contatoId,estado,versao:1,ficticia:true});
 const query=vi.fn(async(sql:string,p:unknown[]=[])=>{
  let rows:unknown[]=[];
  if(sql==='SELECT current_database() nome')rows=[{nome:'donatella_ensaio_operacao'}];
  else if(sql.startsWith('SELECT c.*,EXISTS'))rows=[contato];
  else if(sql.startsWith('SELECT id FROM atendimento_operacao.contato'))rows=[{id:contatoId}];
  else if(sql.startsWith('SELECT autor_id,hash,resultado')){const r=comandos.get(String(p[0]));rows=r?[r]:[];}
  else if(sql.startsWith('INSERT INTO atendimento_operacao.comando'))comandos.set(String(p[0]),{autor_id:String(p[1]),hash:String(p[2]),resultado:JSON.parse(String(p[3]))});
  return {rows,rowCount:rows.length};
 });
 const pool={connect:async()=>({query,release:vi.fn()})} as unknown as Pool,repo=new RepositorioOperacaoPg(pool,async(_i,a)=>direitos.has(a),()=> 'operacao','fixture',undefined,undefined,'humano',{numeroId:'123456789',ficticio:true});
 vi.spyOn(repo,'contatosTelefoneExatoTx').mockResolvedValue([{id:contatoId,identidade_canal:contato.identidade_canal,versao:1}]);vi.spyOn(repo,'representanteContatoTx').mockImplementation(async()=>registro());vi.spyOn(repo,'conversa').mockImplementation(async()=>registro());vi.spyOn(repo,'auditar').mockResolvedValue();
 const reabrir=vi.spyOn(repo,'reabrirRepresentanteTx').mockImplementation(async()=>{estado='humano';return registro();});
 const pedido={contatoId,versaoContato:1,idempotencia:randomUUID()};return {repo,direitos,comandos,reabrir,pedido};
}
describe('iniciar por contato preserva a permissão de reabrir',()=>{
 it('Adicionar não reabre encerrada; Editar permite e o replay exige Editar atual',async()=>{
  const a=ambiente();await expect(a.repo.iniciarConversaContato(ator,a.pedido)).rejects.toThrow('ACESSO_NEGADO');expect(a.reabrir).not.toHaveBeenCalled();expect(a.comandos.size).toBe(0);
  a.direitos.add('atender');const aberta=await a.repo.iniciarConversaContato(ator,a.pedido);expect(aberta.conversa.estado).toBe('humano');expect(a.reabrir).toHaveBeenCalledOnce();expect([...a.comandos.values()][0].resultado).toMatchObject({reaberta:true});
  a.direitos.delete('atender');await expect(a.repo.iniciarConversaContato(ator,a.pedido)).rejects.toThrow('ACESSO_NEGADO');expect(a.reabrir).toHaveBeenCalledOnce();expect(a.comandos.size).toBe(1);
 });
 it('abrir e conferir uma conversa já aberta continuam permitidos sem Editar',async()=>{
  const a=ambiente('humano');expect((await a.repo.iniciarConversaContato(ator,a.pedido)).conversa.estado).toBe('humano');expect((await a.repo.iniciarConversaContato(ator,a.pedido)).conversa.estado).toBe('humano');expect(a.reabrir).not.toHaveBeenCalled();expect([...a.comandos.values()][0].resultado).toMatchObject({reaberta:false});
 });
 it('recibo reutilizado legado sem indicação do ramo exige Editar no replay',async()=>{
  const a=ambiente('humano');await a.repo.iniciarConversaContato(ator,a.pedido);const recibo=a.comandos.get(a.pedido.idempotencia)!;recibo.resultado={contatoId,conversaId,reutilizada:true};await expect(a.repo.iniciarConversaContato(ator,a.pedido)).rejects.toThrow('ACESSO_NEGADO');a.direitos.add('atender');expect((await a.repo.iniciarConversaContato(ator,a.pedido)).conversa.estado).toBe('humano');expect(a.reabrir).not.toHaveBeenCalled();
 });
});
