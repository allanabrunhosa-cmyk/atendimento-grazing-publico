import {describe,it,expect,beforeEach} from 'vitest';
import bcrypt from 'bcryptjs';
import type {Pool} from 'pg';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {criarAutenticacaoHub} from '../../src/lib/atendimento/operacao-autenticacao-hub';
import {CAPACIDADES_ATENDIMENTO,LISTA_CAPACIDADES_ATENDIMENTO,NOVAS_CAPACIDADES_ATENDIMENTO} from '../../src/lib/permissoes/atendimento';
const origem='https://atendimento.grazinghub.com.br';
describe('Conta HUB atual no destino sem copiar identidades ou privilégios da origem',()=>{
 let usuario:Record<string,unknown>,vinculado:boolean,sessoes:Map<string,{hub_usuario_id:string;versao:number;revogado?:boolean}>,falhas:Map<string,number>,recusarExclusao:boolean,vinculoExistente:boolean;
 let auth:ReturnType<typeof criarAutenticacaoHub>,cabecalhos:Record<string,string>;
 const req=(headers:Record<string,string>={})=>({headers:{origin:origem,...headers}} as IncomingMessage);
 const res=()=>({setHeader:(n:string,v:string)=>{cabecalhos[n]=v;}} as unknown as ServerResponse);
 beforeEach(async()=>{
  usuario={id:'fixture-hub',nome:'Pessoa fictícia',email:'fixture@example.invalid',senhaHash:await bcrypt.hash('Senha-Ficticia-2026',4),senhaDefinida:true,ativo:true,excluido:false,sessaoVersao:1,perfilId:'perfil-ficticio',perfilSistema:null,permissoes:{'crm.atendimento':['visualizar']},excecoes:{},permissoesGranulares:true};vinculado=true;vinculoExistente=true;sessoes=new Map();falhas=new Map();recusarExclusao=false;cabecalhos={};
  const central={query:async(sql:string,p:unknown[])=>({rows:sql.includes('lower(email)')?(p[0]===usuario.email?[usuario]:[]):p[0]===usuario.id?[usuario]:[]})};
  const local={query:async(sql:string,p:unknown[]=[])=>{
   if(sql.includes('SELECT hub_usuario_id,versao')){const s=sessoes.get(String(p[0]));return {rows:s&&!s.revogado?[s]:[]};}
   if(sql.includes('INSERT INTO atendimento_acesso.vinculo')&&!vinculoExistente){vinculoExistente=true;vinculado=true;}
   if(sql.includes('SELECT 1 FROM atendimento_acesso.vinculo'))return {rowCount:vinculado?1:0};
   if(sql.includes('SELECT 1 FROM atendimento_acesso.tentativa'))return {rowCount:(falhas.get(String(p[0]))??0)>=5?1:0};
   if(sql.includes('INSERT INTO atendimento_acesso.tentativa'))falhas.set(String(p[0]),(falhas.get(String(p[0]))??0)+1);
   if(sql.includes('DELETE FROM atendimento_acesso.tentativa')){if(recusarExclusao)throw Object.assign(Error('permission denied'),{code:'42501'});falhas.delete(String(p[0]));}
   if(sql.includes('UPDATE atendimento_acesso.tentativa SET falhas=0'))falhas.set(String(p[0]),0);
   if(sql.includes('INSERT INTO atendimento_acesso.sessao'))sessoes.set(String(p[0]),{hub_usuario_id:String(p[1]),versao:Number(p[2])});
   if(sql.includes('SET revogada_em')){const s=sessoes.get(String(p[0]));if(s)s.revogado=true;}
   return {rows:[],rowCount:1};
  }};
  auth=criarAutenticacaoHub({central:central as unknown as Pool,local:local as unknown as Pool,origem,csrfSecret:'f'.repeat(40)});
 });
 async function entrar(){const r=await auth.login(req(),res(),'fixture@example.invalid','Senha-Ficticia-2026');const token=cabecalhos['Set-Cookie'].split(';')[0];return {r,request:req({cookie:token}),token};}
 it('usa a senha atual central e cookie host-only; sessão guarda só hash de token',async()=>{const {r,request}=await entrar();expect(r.status).toBe(200);expect(await auth.autenticar(request)).toMatchObject({id:'fixture-hub',permissoes:['consultar','atalhos.visualizar','lembretes.visualizar','atividades.visualizar']});expect(cabecalhos['Set-Cookie']).toContain('HttpOnly');expect(cabecalhos['Set-Cookie']).toContain('Secure');expect(cabecalhos['Set-Cookie']).not.toContain('Domain');expect([...sessoes.keys()][0]).toMatch(/^[a-f0-9]{64}$/);expect(JSON.stringify([...sessoes.values()])).not.toContain('senhaHash');});
 it('revogação/versão/inativação central valem na próxima requisição',async()=>{const {request}=await entrar();usuario.sessaoVersao=2;expect(await auth.autenticar(request)).toBeNull();usuario.sessaoVersao=1;usuario.ativo=false;expect(await auth.autenticar(request)).toBeNull();});
 it('vínculo revogado fecha acesso mesmo com senha e perfil válidos',async()=>{const {request}=await entrar();vinculado=false;expect(await auth.autenticar(request)).toBeNull();expect((await auth.login(req(),res(),'fixture@example.invalid','Senha-Ficticia-2026')).status).toBe(401);});
 it('usuário permitido recebe vínculo técnico no primeiro login sem cadastro separado',async()=>{vinculado=false;vinculoExistente=false;const {r,request}=await entrar();expect(r.status).toBe(200);expect(vinculado).toBe(true);expect((await auth.autenticar(request))?.id).toBe('fixture-hub');});
 it('permite consultar com a permissão histórica do CRM sem conceder escrita ou configuração',async()=>{
  usuario.permissoes={crm:['visualizar']};vinculado=false;vinculoExistente=false;
  const {r,request}=await entrar();expect(r.status).toBe(200);expect(vinculado).toBe(true);
  const i=(await auth.autenticar(request))!;expect(i.permissoes.filter(a=>!Object.hasOwn(NOVAS_CAPACIDADES_ATENDIMENTO,a))).toEqual(['consultar']);
  expect(await auth.autorizar(i,'consultar')).toBe(true);
  for(const acao of ['atender','configurar','conhecimento'])expect(await auth.autorizar(i,acao)).toBe(false);
 });
 it('permite atender com visualizar e editar históricos sem conceder configurações',async()=>{
  usuario.permissoes={crm:['visualizar','editar']};vinculado=false;vinculoExistente=false;
  const {r,request}=await entrar();expect(r.status).toBe(200);expect(vinculado).toBe(true);
  const i=(await auth.autenticar(request))!;expect(i.permissoes.filter(a=>!Object.hasOwn(NOVAS_CAPACIDADES_ATENDIMENTO,a))).toEqual(['consultar','atender']);
  expect(await auth.autorizar(i,'atender')).toBe(true);
  for(const acao of ['configurar','conhecimento'])expect(await auth.autorizar(i,acao)).toBe(false);
 });
 it.each([
  ['concessão histórica por exceção',{crm:['visualizar']},{crm:{editar:true}},true],
  ['veto histórico de editar',{crm:['visualizar','editar']},{crm:{editar:false}},false],
  ['perfil específico somente leitura',{crm:['visualizar','editar'],'crm.atendimento':['visualizar']},{},false],
  ['veto específico de editar sem perfil fino',{crm:['visualizar','editar']},{'crm.atendimento':{editar:false}},false],
  ['concessão específica de editar sem visualizar fino',{crm:['visualizar','editar']},{'crm.atendimento':{editar:true}},false],
  ['decisão específica somente de visualizar',{crm:['visualizar','editar']},{'crm.atendimento':{visualizar:true}},false],
  ['concessão específica sobre veto histórico',{crm:['visualizar','editar'],'crm.atendimento':['visualizar','editar']},{crm:{editar:false}},true],
  ['veto específico sobre concessão fina',{crm:['visualizar','editar'],'crm.atendimento':['visualizar','editar']},{'crm.atendimento':{editar:false}},false],
 ])('avalia atender com %s',async(_caso,permissoes,excecoes,permitido)=>{
  usuario.permissoes=permissoes;usuario.excecoes=excecoes;
  const {r,request}=await entrar();expect(r.status).toBe(200);const i=(await auth.autenticar(request))!;
  expect(i.permissoes.includes('atender')).toBe(permitido);
  expect(await auth.autorizar(i,'atender')).toBe(permitido);
 });
 it.each([
  ['apenas visualizar',['visualizar'],{},false],
  ['visualizar e editar',['visualizar','editar'],{},true],
  ['veto de editar',['visualizar','editar'],{'crm.atendimento.configuracoes':{editar:false}},false],
 ])('mantém configuração e conhecimento separados com %s',async(_caso,acoes,excecoes,permitido)=>{
  usuario.permissoes={crm:['visualizar'],'crm.atendimento.configuracoes':acoes};usuario.excecoes=excecoes;
  const {r,request}=await entrar();expect(r.status).toBe(200);const i=(await auth.autenticar(request))!;
  expect(await auth.autorizar(i,'atender')).toBe(false);
  expect(await auth.autorizar(i,'configurar')).toBe(permitido);
  expect(await auth.autorizar(i,'conhecimento.editar')).toBe(false);
 });
 it('relê a revogação histórica de editar em uma sessão aberta',async()=>{
  usuario.permissoes={crm:['visualizar','editar']};const {request}=await entrar();const i=(await auth.autenticar(request))!;
  expect(await auth.autorizar(i,'atender')).toBe(true);usuario.excecoes={crm:{editar:false}};
  expect(await auth.autorizar(i,'atender')).toBe(false);
  expect((await auth.autenticar(request))?.permissoes.filter(a=>!Object.hasOwn(NOVAS_CAPACIDADES_ATENDIMENTO,a))).toEqual(['consultar']);
 });
 it.each([
  ['sem qualquer permissão',{},{}],
  ['CRM sem visualizar',{crm:['editar']},{}],
  ['negação histórica',{crm:['visualizar']},{crm:{visualizar:false}}],
  ['recurso específico vazio',{crm:['visualizar'],'crm.atendimento':[]},{}],
  ['recurso específico sem visualizar',{crm:['visualizar'],'crm.atendimento':['editar']},{}],
  ['exceção específica negativa sem base',{crm:['visualizar']},{'crm.atendimento':{visualizar:false}}],
  ['exceção específica negativa com base',{crm:['visualizar'],'crm.atendimento':['visualizar']},{'crm.atendimento':{visualizar:false}}],
 ])('nega login e não cria vínculo quando há %s',async(_caso,permissoes,excecoes)=>{
  usuario.permissoes=permissoes;usuario.excecoes=excecoes;vinculado=false;vinculoExistente=false;
  expect((await auth.login(req(),res(),'fixture@example.invalid','Senha-Ficticia-2026')).status).toBe(401);
  expect(vinculado).toBe(false);expect(sessoes.size).toBe(0);
 });
 it.each([
  ['concessão específica sem base',{}, {'crm.atendimento':{visualizar:true}}],
  ['concessão específica sobre negação histórica',{'crm.atendimento':['visualizar']},{crm:{visualizar:false}}],
  ['exceção de escrita específica sem decisão de leitura',{crm:['visualizar']},{'crm.atendimento':{editar:false}}],
  ['concessão histórica por exceção',{}, {crm:{visualizar:true}}],
 ])('preserva consulta com %s',async(_caso,permissoes,excecoes)=>{
  usuario.permissoes=permissoes;usuario.excecoes=excecoes;
  const {r,request}=await entrar();expect(r.status).toBe(200);
  expect((await auth.autenticar(request))?.permissoes.filter(a=>!Object.hasOwn(NOVAS_CAPACIDADES_ATENDIMENTO,a))).toEqual(['consultar']);
 });
 it('relê a negação específica depois de abrir uma sessão com permissão histórica',async()=>{
  usuario.permissoes={crm:['visualizar']};const {request}=await entrar();const i=(await auth.autenticar(request))!;
  usuario.excecoes={'crm.atendimento':{visualizar:false}};
  expect(await auth.autorizar(i,'consultar')).toBe(false);
  expect((await auth.autenticar(request))?.permissoes).toEqual([]);
  expect((await auth.login(req(),res(),'fixture@example.invalid','Senha-Ficticia-2026')).status).toBe(401);
 });
 it('convite pendente e usuário sem permissão não recebem vínculo nem sessão',async()=>{vinculado=false;vinculoExistente=false;usuario.senhaDefinida=false;expect((await auth.login(req(),res(),'fixture@example.invalid','Senha-Ficticia-2026')).status).toBe(401);expect(vinculado).toBe(false);usuario.senhaDefinida=true;usuario.permissoes={};expect((await auth.login(req(),res(),'fixture@example.invalid','Senha-Ficticia-2026')).status).toBe(401);expect(vinculado).toBe(false);expect(sessoes.size).toBe(0);});
 it('leitura não herda escrita e exceção negativa prevalece',async()=>{const {request}=await entrar();const i=(await auth.autenticar(request))!;expect(await auth.autorizar(i,'atender')).toBe(false);usuario.permissoes={'crm.atendimento':['visualizar','editar']};usuario.excecoes={'crm.atendimento':{editar:false}};expect(await auth.autorizar(i,'atender')).toBe(false);});
 it('administrador do HUB preserva autorização central, sem consultar perfil da origem',async()=>{usuario.perfilSistema='ADMINISTRADOR';const {request}=await entrar();expect((await auth.autenticar(request))?.permissoes).toEqual(LISTA_CAPACIDADES_ATENDIMENTO);});
 it('após readiness nega novas capacidades ausentes mesmo com os direitos históricos',async()=>{
  usuario.permissoesHierarquia=true;
  usuario.permissoes={crm:['visualizar','editar'],'crm.atendimento.configuracoes':['visualizar','editar']};const {request}=await entrar();const i=(await auth.autenticar(request))!;
  expect(i.permissoes).toEqual(['consultar','atender','configuracao.visualizar','configurar']);
  for(const a of ['mensagens.adicionar','notas.adicionar','skills.excluir','conhecimento.editar'])expect(await auth.autorizar(i,a)).toBe(false);
 });
 it('o marcador da hierarquia encerra somente a compatibilidade das operações novas',async()=>{
  usuario.permissoesHierarquia=undefined;usuario.permissoes={crm:['visualizar','editar'],'crm.atendimento.contatos':['visualizar'],'crm.atendimento.modelos':['visualizar'],'crm.atendimento.configuracoes':['visualizar','editar']};
  const {request}=await entrar();const i=(await auth.autenticar(request))!;expect(await auth.autorizar(i,'contatos.adicionar')).toBe(true);expect(await auth.autorizar(i,'atalhos.excluir')).toBe(true);expect(await auth.autorizar(i,'modelos.excluir')).toBe(true);
  usuario.permissoesHierarquia=true;expect(await auth.autorizar(i,'contatos.adicionar')).toBe(false);expect(await auth.autorizar(i,'atalhos.excluir')).toBe(false);expect(await auth.autorizar(i,'modelos.excluir')).toBe(false);expect(await auth.autorizar(i,'atender')).toBe(true);
 });
 it('capacidade própria salva no HUB funciona sem editar conversas e é revogada na sessão aberta',async()=>{
  usuario.permissoesHierarquia=true;
  usuario.permissoes={crm:['visualizar'],'crm.atendimento.contatos':['visualizar','editar']};const {request}=await entrar();const i=(await auth.autenticar(request))!;
  expect(await auth.autorizar(i,'contatos.editar')).toBe(true);expect(await auth.autorizar(i,'atender')).toBe(false);expect(await auth.autorizar(i,'configurar')).toBe(false);
  usuario.excecoes={'crm.atendimento.contatos':{editar:false}};expect(await auth.autorizar(i,'contatos.editar')).toBe(false);expect((await auth.autenticar(request))?.permissoes).not.toContain('contatos.editar');
 });
 it('antes de readiness mantém equivalência histórica e preserva vetos novos explícitos',async()=>{
  usuario.permissoesGranulares=undefined;usuario.permissoes={crm:['visualizar','editar'],'crm.atendimento.configuracoes':['visualizar','editar'],'crm.atendimento.notas':[]};usuario.excecoes={'crm.atendimento.mensagens':{adicionar:false}};
  const {request}=await entrar();const i=(await auth.autenticar(request))!;
  expect(await auth.autorizar(i,'agenda.adicionar')).toBe(true);expect(await auth.autorizar(i,'conhecimento.excluir')).toBe(true);
  expect(await auth.autorizar(i,'mensagens.adicionar')).toBe(false);expect(await auth.autorizar(i,'notas.visualizar')).toBe(false);
 });
 it.each(LISTA_CAPACIDADES_ATENDIMENTO.filter(a=>!['consultar','atender','configurar','configuracao.visualizar'].includes(a)))('usa somente o recurso exato depois de readiness: %s',async capacidade=>{
  const {recurso,acao}=CAPACIDADES_ATENDIMENTO[capacidade];usuario.permissoesHierarquia=true;usuario.permissoes={crm:['visualizar'],[recurso]:['visualizar',...acao==='visualizar'?[]:[acao]]};
  const {request}=await entrar();const i=(await auth.autenticar(request))!;expect(await auth.autorizar(i,capacidade)).toBe(true);
  usuario.excecoes={[recurso]:{[acao]:false}};expect(await auth.autorizar(i,capacidade)).toBe(false);
 });
 it('revogar consulta fecha também direitos granulares declarados em sessão aberta',async()=>{
  usuario.permissoes={crm:['visualizar'],'crm.atendimento.mensagens':['visualizar','adicionar']};const {request}=await entrar();const i=(await auth.autenticar(request))!;
  usuario.excecoes={crm:{visualizar:false}};expect(await auth.autorizar(i,'mensagens.adicionar')).toBe(false);expect((await auth.autenticar(request))?.permissoes).toEqual([]);
 });
 it('origem incorreta é recusada e CSRF é obrigatório no logout',async()=>{expect((await auth.login(req({origin:'https://example.invalid'}),res(),'fixture@example.invalid','Senha-Ficticia-2026')).status).toBe(400);const {request,token}=await entrar();expect(await auth.logout(request,res())).toBe(false);const csrf=auth.tokenCsrf(request)!;const autorizado=req({cookie:token,'x-csrf-token':csrf});expect(await auth.logout(autorizado,res())).toBe(true);expect(await auth.autenticar(request)).toBeNull();});
 it('limita tentativas incorretas de modo persistente',async()=>{for(let n=0;n<5;n++)expect((await auth.login(req(),res(),'fixture@example.invalid','errada')).status).toBe(401);expect((await auth.login(req(),res(),'fixture@example.invalid','Senha-Ficticia-2026')).status).toBe(429);});
 it('conclui o login com SELECT/INSERT/UPDATE, sem exigir DELETE',async()=>{recusarExclusao=true;expect((await auth.login(req(),res(),'fixture@example.invalid','errada')).status).toBe(401);const {r,request}=await entrar();expect(r.status).toBe(200);expect(await auth.autenticar(request)).toMatchObject({id:'fixture-hub'});expect([...falhas.values()]).toEqual([0]);});
 it('normaliza e-mail como o HUB sem remover espaços da senha',async()=>{usuario.senhaHash=await bcrypt.hash(' Senha-Ficticia-2026 ',4);expect((await auth.login(req(),res(),'  FIXTURE@EXAMPLE.INVALID  ',' Senha-Ficticia-2026 ')).status).toBe(200);expect((await auth.login(req(),res(),'fixture@example.invalid','Senha-Ficticia-2026')).status).toBe(401);});
 it('variações de espaços/maiúsculas compartilham o mesmo limite persistente',async()=>{for(const email of ['fixture@example.invalid',' FIXTURE@example.invalid','fixture@EXAMPLE.INVALID ',' fixture@example.invalid ','FIXTURE@EXAMPLE.INVALID'])expect((await auth.login(req(),res(),email,'errada')).status).toBe(401);expect((await auth.login(req(),res(),'fixture@example.invalid','Senha-Ficticia-2026')).status).toBe(429);});
 it('e-mail só com espaços é inválido antes de consultar ou registrar tentativas',async()=>{expect((await auth.login(req(),res(),'   ','Senha-Ficticia-2026')).status).toBe(400);expect(falhas.size).toBe(0);expect(sessoes.size).toBe(0);});
 it('cookie duplicado ou token malformado nunca autentica',async()=>{const {token}=await entrar();expect(await auth.autenticar(req({cookie:token+'; '+token}))).toBeNull();expect(await auth.autenticar(req({cookie:'donatella_operacao_v2=incorreto'}))).toBeNull();});
});
