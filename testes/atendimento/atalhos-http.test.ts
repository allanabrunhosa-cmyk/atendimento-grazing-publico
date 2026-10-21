import {describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {Readable} from 'node:stream';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {randomUUID} from 'node:crypto';
import {criarHandlerOperacao} from '../../scripts/atendimento/operacao-servidor';
import {criarExtensaoAtalhos} from '../../src/lib/atendimento/operacao-atalhos-http';
import type {RepositorioEntradaPg} from '../../src/lib/atendimento/operacao-repositorio-pg';
import {ambienteAtalhos,atorAtalhos} from './atalhos-fixtures';

const origem='https://atendimento.fixture.example';
function requisicao(path:string,method='GET',p:unknown={},headers:Record<string,string>={}){return Object.assign(Readable.from([Buffer.from(JSON.stringify(p))]),{url:'/api/atendimento/operacao'+path,method,headers:{host:new URL(origem).host,origin:origem,'content-type':'application/json','x-csrf-token':'csrf-ficticio',...headers}}) as unknown as IncomingMessage;}
function resposta(){const r={statusCode:0,bytes:'',setHeader:vi.fn(),writeHead(c:number){this.statusCode=c;},end(v?:string){this.bytes=v??'';}};return r as unknown as ServerResponse&{bytes:string};}
function ambiente(p:{sessao?:boolean;csrf?:boolean;preparada?:boolean}={}){const a=ambienteAtalhos(),handler=criarHandlerOperacao({repo:a.repo,entrada:{} as RepositorioEntradaPg,webhook:null,origem,somenteChatHumano:true,painelDonatellaPreparado:p.preparada!==false,autenticar:async()=>p.sessao===false?null:atorAtalhos,conferirCsrf:async()=>p.csrf!==false,listarEquipe:async()=>({usuarios:[],equipes:[]}),extensao:criarExtensaoAtalhos(a.servico)});return {...a,handler};}
const novo=()=>({nome:'Boas vindas',texto:'Olá!\nEstamos à disposição.',versao:0,idempotencia:randomUUID()});
describe('HTTP de atalhos com handler e serviço reais, banco fictício',()=>{
 it('lista vazia e HEAD sem corpo, sem exigir a disponibilidade da IA',async()=>{const a=ambiente({preparada:false}),r=resposta();await a.handler(requisicao('/atalhos'),r);expect(r.statusCode).toBe(200);expect(JSON.parse(r.bytes)).toEqual({versao:0,registros:[]});const s=resposta();await a.handler(requisicao('/atalhos','HEAD'),s);expect(s.statusCode).toBe(200);expect(s.bytes).toBe('');});
 it('cria, edita, lista e exclui pelo handler do chat humano',async()=>{
  const a=ambiente({preparada:false}),r=resposta();await a.handler(requisicao('/atalhos/salvar','POST',novo()),r);expect(r.statusCode).toBe(200);const criado=JSON.parse(r.bytes);expect(criado.atalho.nome).toBe('boas-vindas');
  const s=resposta();await a.handler(requisicao('/atalhos/salvar','POST',{...novo(),id:criado.atalho.id,nome:'Revisado',versao:1}),s);expect(s.statusCode).toBe(200);
  const lista=resposta();await a.handler(requisicao('/atalhos'),lista);expect(JSON.parse(lista.bytes)).toMatchObject({versao:2,registros:[{nome:'revisado'}]});
  const fim=resposta();await a.handler(requisicao('/atalhos/excluir','POST',{id:criado.atalho.id,versao:2,idempotencia:randomUUID()}),fim);expect(fim.statusCode).toBe(200);expect(JSON.parse(fim.bytes)).toEqual({versao:3,id:criado.atalho.id});expect(a.snapshot().comandos).toHaveLength(3);
 });
 it('não grava sem sessão, CSRF ou origem própria',async()=>{
  for(const opcoes of [{sessao:false},{csrf:false},{}]){const a=ambiente(opcoes),r=resposta();await a.handler(requisicao('/atalhos/salvar','POST',novo(),Object.keys(opcoes).length?{}:{origin:'https://outro.fixture.example'}),r);expect(r.statusCode).toBe(opcoes.sessao===false?401:403);expect(a.snapshot().cfg).toBeNull();}
 });
 it('replay não duplica, mas segue exigindo a capacidade de adicionar atalhos',async()=>{
  const a=ambiente(),p=novo(),r=resposta();await a.handler(requisicao('/atalhos/salvar','POST',p),r);expect(r.statusCode).toBe(200);const s=resposta();await a.handler(requisicao('/atalhos/salvar','POST',p),s);expect(s.bytes).toBe(r.bytes);expect(a.snapshot().auditorias).toHaveLength(1);
  a.direitos.delete('atalhos.adicionar');const negado=resposta();await a.handler(requisicao('/atalhos/salvar','POST',p),negado);expect(negado.statusCode).toBe(403);expect(a.snapshot().auditorias).toHaveLength(1);
 });
 it('não aceita identidade nem campos inesperados em corpo ou query',async()=>{
  for(const path of ['/atalhos?autorId=outro','/atalhos/salvar?url=https://outro.fixture.example']){const a=ambiente(),r=resposta();await a.handler(requisicao(path,path.includes('/salvar')?'POST':'GET',novo()),r);expect(r.statusCode).toBe(400);expect(a.snapshot().cfg).toBeNull();}
  const a=ambiente(),r=resposta();await a.handler(requisicao('/atalhos/salvar','POST',{...novo(),autorId:'outro'}),r);expect(r.statusCode).toBe(400);expect(a.snapshot().cfg).toBeNull();
 });
 it('método de consulta não executa exclusão nem salvamento',async()=>{const a=ambiente();for(const path of ['/atalhos/excluir','/atalhos/salvar']){const r=resposta();await a.handler(requisicao(path),r);expect(r.statusCode).toBe(405);}expect(a.snapshot().comandos).toHaveLength(0);});
});
