import {afterEach,describe,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {processarMidiaPendenteChat} from '../../src/lib/atendimento/operacao-midia-chat';
import {carregarMidiaMeta} from '../../src/lib/atendimento/operacao-midia-meta';
import type {RepositorioOperacaoPg} from '../../src/lib/atendimento/operacao-repositorio-pg';
import {amrFicticio,pngFicticio} from './fixtures-midia';
import {oggFicticio} from './voz-fixtures';

vi.mock('server-only',()=>({}));
const mensagem='33333333-3333-4333-a333-333333333333',conversa='22222222-2222-4222-a222-222222222222';
const cfg={token:'credencial-exclusivamente-ficticia',numeroId:'123456789',versao:'v23.0'};
const temporarios:string[]=[];
afterEach(async()=>{vi.useRealTimers();await Promise.all(temporarios.splice(0).map(p=>rm(p,{recursive:true,force:true})));});

/** O modelo substitui somente SQL; CAS/fsync e downloader são os de produção.
 * A integração PostgreSQL/reinício é conferida no ensaio isolado da migração. */
async function armazenamento(){
 const midia=await mkdtemp(join(tmpdir(),'donatella-midia-ficticia-'));temporarios.push(midia);
 const estado={metadados:{mediaId:'12345678901',nomeArquivo:'audio-ficticio.amr'} as Record<string,unknown>,anexo:null as null|{id:string;hash:string;mime:string;tamanho:number},falharInsert:false};
 const query=vi.fn(async(sql:string,parametros:unknown[]=[])=>{
  if(sql.startsWith('SELECT id FROM atendimento_operacao.mensagem'))return {rowCount:estado.anexo?0:1,rows:!estado.anexo&&(!estado.metadados.midiaProximaTentativa||Date.parse(String(estado.metadados.midiaProximaTentativa))<=Date.now())?[{id:mensagem}]:[]};
  if(sql.startsWith('SELECT m.anexo_id'))return {rowCount:1,rows:[{anexo_id:estado.anexo?.id,metadados:estado.metadados,...estado.anexo}]};
  if(sql.startsWith('SELECT id,conversa_id,anexo_id'))return {rowCount:1,rows:[{id:mensagem,conversa_id:conversa,anexo_id:estado.anexo?.id}]};
  if(sql.startsWith('SELECT hash'))return {rowCount:estado.anexo?1:0,rows:estado.anexo?[{hash:estado.anexo.hash}]:[]};
  if(sql.startsWith('INSERT INTO atendimento_operacao.anexo')){
   if(estado.falharInsert){estado.falharInsert=false;throw Error('FALHA_FICTICIA_ANTES_DO_COMMIT');}
   estado.anexo={id:String(parametros[0]),hash:String(parametros[2]),mime:String(parametros[4]),tamanho:Number(parametros[5])};
  }else if(sql.includes("jsonb_build_object('midiaFalha'")){
   estado.metadados.midiaFalha='PRESERVACAO_PENDENTE';estado.metadados.midiaProximaTentativa=new Date(Date.now()+300000).toISOString();
  }else if(sql.includes("metadados-'midiaProximaTentativa'")){
   delete estado.metadados.midiaProximaTentativa;delete estado.metadados.midiaFalha;
  }else if(!sql.startsWith('UPDATE atendimento_operacao.mensagem SET anexo_id='))throw Error('SQL_NAO_PREVISTO_NO_ENSAIO');
  return {rowCount:1,rows:[]};
 });
 const abrir=(modo='operacao')=>({midia,modo:()=>modo,pool:{query},notificarChat:vi.fn(async()=>undefined),transacao:async(executar:(tx:{query:typeof query})=>Promise<unknown>)=>executar({query})}) as unknown as RepositorioOperacaoPg;
 return {estado,midia,query,abrir};
}
function fronteira(bytes:Buffer=amrFicticio,mime='audio/amr',url='https://lookaside.fbsbx.com/media-fixture',hash=createHash('sha256').update(bytes).digest('hex')){
 return vi.fn<typeof fetch>().mockImplementation(async(input)=>{
  if(String(input).startsWith('https://graph.facebook.com/'))return Response.json({id:'12345678901',url,mime_type:mime,file_size:bytes.length,sha256:hash});
  if(String(input)===url)return new Response(new Uint8Array(bytes),{headers:{'content-type':mime,'content-length':String(bytes.length)}});
  throw Error('DESTINO_NAO_PREVISTO_NO_ENSAIO');
 });
}

describe('preservação de mídia do Chat independente de IA',()=>{
 it('não lê a Meta nem a fila fora da operação',async()=>{
  const a=await armazenamento(),f=fronteira();expect(await processarMidiaPendenteChat(a.abrir('homologacao'),cfg,f)).toEqual({estado:'desarmado'});expect(a.query).not.toHaveBeenCalled();expect(f).not.toHaveBeenCalled();
 });
 it('preserva áudio em CAS e vínculo transacional e reutiliza após reiniciar o worker',async()=>{
  const a=await armazenamento(),f=fronteira();expect(await processarMidiaPendenteChat(a.abrir(),cfg,f)).toEqual({estado:'preservada'});
  expect((await readFile(join(a.midia,a.estado.anexo!.hash))).equals(amrFicticio)).toBe(true);
  const insert=a.query.mock.calls.find(([s])=>s.startsWith('INSERT INTO atendimento_operacao.anexo'))!;
  expect(insert[1]?.slice(1)).toEqual([conversa,a.estado.anexo!.hash,'audio-ficticio.amr','audio/amr',amrFicticio.length]);
  expect(f).toHaveBeenCalledTimes(2);for(const [,opcoes] of f.mock.calls){expect(opcoes?.method).toBeUndefined();expect(opcoes?.redirect).toBe('error');}
  expect(String(f.mock.calls[0][0])).toContain('phone_number_id=123456789');
  expect(await processarMidiaPendenteChat(a.abrir(),cfg,f)).toEqual({estado:'vazio'});
  const salvo=await carregarMidiaMeta(a.abrir(),mensagem,cfg,f);expect(salvo?.bytes.equals(amrFicticio)).toBe(true);expect(f).toHaveBeenCalledTimes(2);
 });
 it('registra falha e próxima tentativa, sem perder a referência ao reiniciar',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-12T12:00:00Z'));
  const a=await armazenamento(),falha=vi.fn<typeof fetch>(async()=>new Response('',{status:503}));
  expect(await processarMidiaPendenteChat(a.abrir(),cfg,falha)).toEqual({estado:'pendente'});
  expect(a.estado.metadados).toMatchObject({mediaId:'12345678901',midiaFalha:'PRESERVACAO_PENDENTE',midiaProximaTentativa:'2026-10-12T12:05:00.000Z'});
  const sucesso=fronteira();expect(await processarMidiaPendenteChat(a.abrir(),cfg,sucesso)).toEqual({estado:'vazio'});expect(sucesso).not.toHaveBeenCalled();
  vi.setSystemTime(new Date('2026-10-12T12:05:01Z'));expect(await processarMidiaPendenteChat(a.abrir(),cfg,sucesso)).toEqual({estado:'preservada'});
  expect(a.estado.metadados).not.toHaveProperty('midiaFalha');expect(a.estado.metadados).not.toHaveProperty('midiaProximaTentativa');
 });
 it('preserva Ogg com declaração explícita de Opus e devolve MIME reproduzível',async()=>{
  const a=await armazenamento(),bytes=oggFicticio(),f=fronteira(bytes,'audio/ogg; codecs=opus');
  expect(await processarMidiaPendenteChat(a.abrir(),cfg,f)).toEqual({estado:'preservada'});
  expect(a.estado.anexo?.mime).toBe('audio/ogg');expect((await readFile(join(a.midia,a.estado.anexo!.hash))).equals(bytes)).toBe(true);
 });
 it('retoma após arquivo gravado e falha antes do vínculo, sem duplicar o CAS',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-12T12:00:00Z'));
  const a=await armazenamento(),f=fronteira();a.estado.falharInsert=true;
  expect(await processarMidiaPendenteChat(a.abrir(),cfg,f)).toEqual({estado:'pendente'});expect(a.estado.anexo).toBeNull();
  const hash=createHash('sha256').update(amrFicticio).digest('hex');expect((await readFile(join(a.midia,hash))).equals(amrFicticio)).toBe(true);
  vi.setSystemTime(new Date('2026-10-12T12:05:01Z'));expect(await processarMidiaPendenteChat(a.abrir(),cfg,f)).toEqual({estado:'preservada'});expect(a.estado.anexo?.hash).toBe(hash);
 });
 it('recusa destino não autorizado antes de transferir a credencial',async()=>{
  const a=await armazenamento(),f=fronteira(amrFicticio,'audio/amr','https://exemplo.invalid/midia');
  await expect(carregarMidiaMeta(a.abrir(),mensagem,cfg,f)).rejects.toThrow('HOST_RECUSADO');expect(f).toHaveBeenCalledTimes(1);expect(a.estado.anexo).toBeNull();
 });
 it('recusa hash divergente e arquivo local corrompido, mantendo a mensagem',async()=>{
  const a=await armazenamento(),f=fronteira(pngFicticio,'image/png',undefined,'0'.repeat(64));
  await expect(carregarMidiaMeta(a.abrir(),mensagem,cfg,f)).rejects.toThrow('HASH_DIVERGENTE');expect(a.estado.anexo).toBeNull();
  const valido=fronteira();await carregarMidiaMeta(a.abrir(),mensagem,cfg,valido);
  await writeFile(join(a.midia,a.estado.anexo!.hash),Buffer.from('corrupcao-ficticia'));
  await expect(carregarMidiaMeta(a.abrir(),mensagem,cfg,valido)).rejects.toThrow('CORROMPIDA');expect(valido).toHaveBeenCalledTimes(2);
 });
});
