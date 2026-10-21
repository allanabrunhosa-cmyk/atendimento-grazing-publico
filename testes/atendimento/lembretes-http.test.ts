import {describe,it,expect,vi} from 'vitest';
import {Readable} from 'node:stream';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {criarHandlerOperacao} from '../../scripts/atendimento/operacao-servidor';
import type {RepositorioOperacaoPg,RepositorioEntradaPg} from '../../src/lib/atendimento/operacao-repositorio-pg';
import {escritaChatPermitida} from '../../src/lib/atendimento/operacao-chat-minimo';
vi.mock('server-only',()=>({}));
const origem='https://atendimento.exemplo.invalid',conversaId='11111111-1111-4111-a111-111111111111',usuario={id:'fixture-lembrete',nome:'Atendente Fictício',perfilId:'fixture',sessaoVersao:1,permissoes:['consultar','atender']};
const path='/conversa/'+conversaId+'/lembrete',body={acao:'agendar',versao:0,idempotencia:'22222222-2222-4222-a222-222222222222',agendadoPara:'2026-10-20T13:00:00.000Z'};
function req(method='POST',headers:Record<string,string>={}){return Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]),{url:'/api/atendimento/operacao'+path,method,headers:{host:new URL(origem).host,origin:origem,'content-type':'application/json',...headers}}) as IncomingMessage;}
function resposta(){const r={statusCode:0,bytes:'',setHeader:vi.fn(),writeHead(c:number){this.statusCode=c;},end(v?:string){this.bytes=v??'';}};return r as unknown as ServerResponse&{bytes:string};}
function fixture(p:{sessao?:boolean;csrf?:boolean;acesso?:boolean}={}){const repo={autorizar:async()=>p.acesso!==false,alterarLembreteConversa:vi.fn(async()=>({lembrete:null}))} as unknown as RepositorioOperacaoPg;return {repo,handler:criarHandlerOperacao({repo,entrada:{} as RepositorioEntradaPg,webhook:null,origem,somenteChatHumano:true,autenticar:async()=>p.sessao===false?null:usuario,conferirCsrf:async()=>p.csrf!==false,listarEquipe:async()=>({usuarios:[],equipes:[]})})};}
describe('lembrete humano no HTTP',()=>{
 it('encaminha a ação apenas para o repositório de lembretes',async()=>{const {repo,handler}=fixture(),r=resposta();await handler(req(),r);expect(r.statusCode).toBe(200);expect(repo.alterarLembreteConversa).toHaveBeenCalledExactlyOnceWith(usuario,conversaId,body);expect(JSON.parse(r.bytes)).toEqual({lembrete:null});});
 it.each([{sessao:false},{csrf:false},{acesso:false}])('nega sessão, acesso ou CSRF ausentes: %j',async p=>{const {repo,handler}=fixture(p),r=resposta();await handler(req(),r);expect([401,403]).toContain(r.statusCode);expect(repo.alterarLembreteConversa).not.toHaveBeenCalled();});
 it('nega outra origem, conteúdo ou método',async()=>{for(const [method,headers,status] of [['POST',{origin:'https://outro.invalid'},403],['POST',{'content-type':'text/plain'},415],['DELETE',{},405]] as const){const {repo,handler}=fixture(),r=resposta();await handler(req(method,headers),r);expect(r.statusCode).toBe(status);expect(repo.alterarLembreteConversa).not.toHaveBeenCalled();}});
 it.each([['OPERACAO_LEMBRETE_CONFLITO',409],['OPERACAO_LEMBRETE_PRAZO_INVALIDO',400],['OPERACAO_LEMBRETE_AMBIENTE_RECUSADO',403],['OPERACAO_LEMBRETE_AUSENTE',404]])('mantém código explícito %s',async(codigo,status)=>{const {repo,handler}=fixture(),r=resposta();vi.mocked(repo.alterarLembreteConversa).mockRejectedValueOnce(Error(String(codigo)));await handler(req(),r);expect(r.statusCode).toBe(status);expect(JSON.parse(r.bytes).erro).toBe(codigo);});
 it('permite o lembrete manual no Chat humano sem liberar follow-up automático',()=>{expect(escritaChatPermitida(path,body)).toBe(true);expect(escritaChatPermitida('/agente/followup/configurar',{habilitado:true})).toBe(false);expect(escritaChatPermitida('/conversa/'+conversaId+'/acao',{acao:'ia'})).toBe(false);});
});
