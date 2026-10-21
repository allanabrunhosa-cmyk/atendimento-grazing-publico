import {describe,it,expect,vi} from 'vitest';
import {Readable} from 'node:stream';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {criarHandlerOperacao} from '../../scripts/atendimento/operacao-servidor';
import {criarExtensaoAgenteOperacional} from '../../src/lib/atendimento/operacao-agente-http';
import type {ServicoAgenteOperacional} from '../../src/lib/atendimento/operacao-agente';
import type {RepositorioOperacaoPg,RepositorioEntradaPg} from '../../src/lib/atendimento/operacao-repositorio-pg';
vi.mock('server-only',()=>({}));
const origem='https://atendimento.exemplo.invalid',usuario={id:'fixture-reconciliar',nome:'Pessoa Fictícia',perfilId:'fixture',sessaoVersao:1,permissoes:['consultar','ia.editar']};
const body={tipo:'controle',pedido:{acao:'pausar',versao:3,idempotencia:'11111111-1111-4111-a111-111111111111'}};
function req(path='/agente/reconciliar',p:unknown=body,headers:Record<string,string>={},method='POST'){return Object.assign(Readable.from([Buffer.from(JSON.stringify(p))]),{url:'/api/atendimento/operacao'+path,method,headers:{host:new URL(origem).host,origin:origem,'content-type':'application/json',...headers}}) as IncomingMessage;}
function resposta(){const r={statusCode:0,bytes:'',setHeader:vi.fn(),writeHead(c:number){this.statusCode=c;},end(v?:string){this.bytes=v??'';}};return r as unknown as ServerResponse&{bytes:string};}
function fixture(p:{sessao?:boolean;csrf?:boolean;acesso?:boolean;erro?:string;preparada?:boolean}={}){
 const reconciliar=vi.fn(async()=>{if(p.erro)throw Error(p.erro);return {estado:'confirmada',versao:4};});
 const agente={duvidas:()=>({}),reconciliar,configurar:vi.fn(async()=>{if(p.erro)throw Error(p.erro);return {versao:4};})} as unknown as ServicoAgenteOperacional;
 const repo={autorizar:async()=>p.acesso!==false} as unknown as RepositorioOperacaoPg;
 const registrarErroAgente=vi.fn();return {reconciliar,agente,registrarErroAgente,handler:criarHandlerOperacao({repo,entrada:{} as RepositorioEntradaPg,webhook:null,origem,somenteChatHumano:true,painelDonatellaPreparado:p.preparada!==false,registrarErroAgente,autenticar:async()=>p.sessao===false?null:usuario,conferirCsrf:async()=>p.csrf!==false,listarEquipe:async()=>({usuarios:[],equipes:[]}),extensao:criarExtensaoAgenteOperacional(agente,'grazing')})};
}
describe('reconciliação do painel no HTTP',()=>{
 it('consulta com sessão e CSRF sem chamar configurar nem controlar',async()=>{const f=fixture(),r=resposta();await f.handler(req(),r);expect(r.statusCode).toBe(200);expect(f.reconciliar).toHaveBeenCalledExactlyOnceWith(usuario,body);expect(JSON.parse(r.bytes)).toEqual({estado:'confirmada',versao:4});expect(f.agente.configurar).not.toHaveBeenCalled();});
 it.each([{sessao:false},{csrf:false},{acesso:false}])('nega sessão/acesso/CSRF %j',async p=>{const f=fixture(p),r=resposta();await f.handler(req(),r);expect([401,403]).toContain(r.statusCode);expect(f.reconciliar).not.toHaveBeenCalled();});
 it('nega outra origem e campos externos',async()=>{const f=fixture(),r=resposta();await f.handler(req('/agente/reconciliar',body,{origin:'https://outro.invalid'}),r);expect(r.statusCode).toBe(403);expect(f.reconciliar).not.toHaveBeenCalled();const extra=resposta();await f.handler(req('/agente/reconciliar',{...body,autorId:'outro'}),extra);expect(extra.statusCode).toBe(400);expect(f.reconciliar).not.toHaveBeenCalled();});
 it('GET não consulta o recibo nem altera a agente',async()=>{const f=fixture(),r=resposta();await f.handler(req('/agente/reconciliar',body,{},'GET'),r);expect(r.statusCode).toBe(405);expect(f.reconciliar).not.toHaveBeenCalled();});
 it('mantém o bloqueio de escrita quando o painel não está preparado',async()=>{const f=fixture({preparada:false}),r=resposta();await f.handler(req(),r);expect(r.statusCode).toBe(403);expect(f.reconciliar).not.toHaveBeenCalled();});
 it.each([['AGENTE_USE_CONTROLE_LIGAR_PAUSAR',409],['AGENTE_NAO_PRONTO_PARA_LIGAR',409],['AGENTE_CONFIGURACAO_NAO_AUTORIZADA',400],['AGENTE_ORCAMENTO_NAO_AUTORIZADO',409],['AGENTE_TESTE_CONSUMO_NAO_AUTORIZADO',409],['AGENTE_TESTE_ORCAMENTO_ESGOTADO',409]])('recusa de domínio %s não vira gravação incerta',async(codigo,status)=>{const f=fixture({erro:String(codigo)}),r=resposta();await f.handler(req('/agente/configurar',{conteudo:{},versao:1,idempotencia:'fixture'}),r);expect(r.statusCode).toBe(status);expect(JSON.parse(r.bytes).erro).toBe(codigo);});
 it.each([['AGENTE_USE_CONTROLE_LIGAR_PAUSAR',409,'AGENTE_USE_CONTROLE_LIGAR_PAUSAR'],['SEGREDO_PRIVADO_NAO_EXIBIR',503,'OPERACAO_FALHOU'],['SQL com nome e token privado',503,'OPERACAO_FALHOU']])('registra apenas referência, rota fixa e código permitido para %s',async(erro,status,codigo)=>{const f=fixture({erro}),r=resposta();await f.handler(req('/agente/configurar?segredo=nunca',{conteudo:{mensagem:'dado privado'},versao:1,idempotencia:'fixture'}),r);const registro=f.registrarErroAgente.mock.calls[0][0];expect(r.statusCode).toBe(status);expect(registro).toEqual({referencia:JSON.parse(r.bytes).referencia,rota:'/agente/configurar',status,codigo,horario:expect.stringMatching(/^\d{4}-\d\d-\d\dT/)});expect(JSON.stringify(registro)).not.toMatch(/dado privado|segredo=|SEGREDO_PRIVADO|SQL com|fixture/);});
});
