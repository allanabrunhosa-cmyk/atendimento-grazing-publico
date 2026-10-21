import {describe,it,expect,vi} from 'vitest';
import {WorkerOperacao,type IntencaoOperacao} from '../../src/lib/atendimento/operacao-envio';
import type {RepositorioOperacaoPg,RepositorioEntradaPg} from '../../src/lib/atendimento/operacao-repositorio-pg';
import {hashOperacao} from '../../src/lib/atendimento/operacao-repositorio-pg';
import {contratoModeloOperacao} from '../../src/lib/atendimento/operacao-modelos';
import type {IdentidadeOperacao} from '../../src/lib/atendimento/operacao-tipos';
vi.mock('server-only',()=>({}));
const modelo={nome:'fixture',idioma:'pt_BR',componentes:[{type:'BODY',text:'Somente exemplo fictício'}]};
function ensaio(p:{autor?:'automacao'|'ia'|'humano';id?:string;callback?:boolean;aprovar?:boolean;estado?:string;telefone?:string;acesso?:boolean;modeloAlterado?:boolean}={}){
 const autor=p.autor??'automacao',i:IdentidadeOperacao={id:p.id??'service:donatella-woocommerce',nome:'Fictício',perfilId:'fixture',sessaoVersao:1,tipo:autor==='humano'?'usuario':autor,permissoes:['atender']};
 const t:IntencaoOperacao={id:'fa330001-0000-4000-a000-000000000001',mensagem_id:'fa330002-0000-4000-a000-000000000002',conversa_id:'fa330003-0000-4000-a000-000000000003',autor_id:i.id,versao_conversa:'1',lease:'fixture',conteudo:{conversaId:'fa330003-0000-4000-a000-000000000003',versao:1,idempotencia:'fa330001-0000-4000-a000-000000000001',tipo:'template',modeloId:'fixture',variaveis:[],modeloHash:p.modeloAlterado?'0'.repeat(64):hashOperacao(contratoModeloOperacao(modelo)),autor,ficticia:true,telefone:'5511000000330',autorContexto:i}};
 const query=vi.fn(async(sql:string)=>sql.includes('SELECT * FROM atendimento_operacao.intencao')?{rowCount:1,rows:[t]}:sql.startsWith('SELECT nome,idioma,componentes')?{rowCount:1,rows:[modelo]}:{rowCount:1,rows:[{id:t.id}]});
 const tx={query};const repo={notificarChat:async()=>undefined,modo:()=> 'homologacao',transacao:async<T>(f:(v:typeof tx)=>Promise<T>)=>f(tx),conversa:async()=>({estado:p.estado??(autor==='humano'?'humano':'ia'),versao:2,telefone:p.telefone??t.conteudo.telefone}),autorizar:async()=>p.acesso!==false} as unknown as RepositorioOperacaoPg;
 const validar=vi.fn(async()=>p.aprovar!==false),simular=vi.fn(async()=>({estado:'aceito_simulado' as const,wamid:'fixture.woo'})),fetcher=vi.fn<typeof fetch>(async()=>{throw Error('EXTERNO_PROIBIDO');});
 const w=new WorkerOperacao(repo,{} as RepositorioEntradaPg,async()=>i,{token:'fixture',numeroId:'123456789',versao:'v23.0',autoridade:'nenhuma',enviosHabilitados:false},simular,fetcher,async()=>true,p.callback===false?undefined:validar);
 return {w,simular,validar,fetcher,query};
}
describe('exceção de revisão exclusiva do serviço Woo validado',()=>{
 it('aviso Woo válido sobrevive à revisão da conversa e exige confirmação final',async()=>{const e=ensaio();expect((await e.w.enviarProximo()).estado).toBe('aceito_simulado');expect(e.validar).toHaveBeenCalledOnce();expect(e.simular).toHaveBeenCalledOnce();expect(e.fetcher).not.toHaveBeenCalled();});
 it.each([{callback:false},{id:'service:automacao-generica'},{autor:'ia' as const,id:'service:donatella-ia'},{autor:'humano' as const,id:'usuario-ficticio'}])('não dispensa revisão fora do serviço/callback exatos: %j',async p=>{const e=ensaio(p);expect((await e.w.enviarProximo()).estado).toBe('vazio');expect(e.simular).not.toHaveBeenCalled();expect(e.validar).not.toHaveBeenCalled();});
 it('callback que reprova Woo impede transporte mesmo após dispensa da revisão',async()=>{const e=ensaio({aprovar:false});expect((await e.w.enviarProximo()).estado).toBe('recusado');expect(e.validar).toHaveBeenCalledOnce();expect(e.simular).not.toHaveBeenCalled();});
 it.each([{estado:'encerrada'},{telefone:'5511000000440'},{acesso:false}])('mantém encerramento, destinatário e acesso: %j',async p=>{const e=ensaio(p);expect((await e.w.enviarProximo()).estado).toBe('vazio');expect(e.simular).not.toHaveBeenCalled();});
 it('modelo alterado continua impedindo a exceção de chegar ao transporte',async()=>{const e=ensaio({modeloAlterado:true});expect((await e.w.enviarProximo()).estado).toBe('recusado');expect(e.validar).not.toHaveBeenCalled();expect(e.simular).not.toHaveBeenCalled();});
});
