import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
vi.mock('server-only',()=>({}));
import {publicarMidiaChat} from '../../scripts/atendimento/chat-minimo-arquivos';
import {RepositorioOperacaoPg} from '../../src/lib/atendimento/operacao-repositorio-pg';

const pastas:string[]=[];const novo=async()=>{const p=await mkdtemp(join(tmpdir(),'donatella-chat-cas-'));pastas.push(p);return p;};
afterEach(async()=>{for(const p of pastas.splice(0)){if(!resolve(p).startsWith(resolve(tmpdir())+sep)||!p.includes('donatella-chat-cas-'))throw Error('LIMPEZA_RECUSADA');await rm(p,{recursive:true});}});
const bytes=Buffer.from('Anexo fictício importado, sem cliente'),hash=createHash('sha256').update(bytes).digest('hex');
function repo(midia:string,legado:()=>Promise<Buffer>,autorizado=true){const id=randomUUID(),r={id,hash,nome:'ficticio.txt',mime:'text/plain',tamanho:bytes.length,importado:true};const tx={query:vi.fn(async(s:string)=>s.includes('current_database')?{rows:[{nome:'donatella_ensaio_operacao'}]}:s.includes('SELECT id,hash')?{rowCount:1,rows:[r]}:{rows:[]}),release:vi.fn()};return{id,repo:new RepositorioOperacaoPg({connect:async()=>tx} as unknown as Pool,async()=>autorizado,()=> 'homologacao',midia,undefined,legado),legado};}
const identidade={id:'ficticio',nome:'Fictício',perfilId:'teste',sessaoVersao:1,permissoes:['consultar'] as ['consultar']};
describe('CAS compartilhado do núcleo mínimo',()=>{
 it('publica bytes completos e retoma sem substituir o mesmo hash',async()=>{const p=await novo();await publicarMidiaChat(p,hash,bytes);await publicarMidiaChat(p,hash,bytes);expect(await readFile(join(p,hash))).toEqual(bytes);expect(await readdir(p)).toEqual([hash]);});
 it('duas publicações concorrentes permanecem idempotentes',async()=>{const p=await novo();await Promise.all([publicarMidiaChat(p,hash,bytes),publicarMidiaChat(p,hash,bytes)]);expect(await readFile(join(p,hash))).toEqual(bytes);expect(await readdir(p)).toEqual([hash]);});
 it('recusa conteúdo divergente e mantém o arquivo prévio intacto',async()=>{const p=await novo(),anterior=Buffer.from('corrupção fictícia');await writeFile(join(p,hash),anterior);await expect(publicarMidiaChat(p,hash,bytes)).rejects.toThrow('EXISTENTE_DIVERGENTE');expect(await readFile(join(p,hash))).toEqual(anterior);await expect(publicarMidiaChat(p,'a'.repeat(64),bytes)).rejects.toThrow('CONTEUDO_RECUSADO');});
 it('abre anexo recém-importado do CAS operacional sem depender do legado',async()=>{const p=await novo();await publicarMidiaChat(p,hash,bytes);const legado=vi.fn(async()=>{throw Error('LEGADO_INDISPONIVEL');}),r=repo(p,legado);expect((await r.repo.obterAnexo(identidade,r.id)).bytes).toEqual(bytes);expect(legado).not.toHaveBeenCalled();});
 it('mantém fallback legado apenas quando falta o arquivo no CAS',async()=>{const p=await novo(),legado=vi.fn(async()=>bytes),r=repo(p,legado);expect((await r.repo.obterAnexo(identidade,r.id)).bytes).toEqual(bytes);expect(legado).toHaveBeenCalledOnce();});
 it('não mascara CAS corrompido usando outra cópia e exige autorização',async()=>{const p=await novo();await writeFile(join(p,hash),'corrompido');const legado=vi.fn(async()=>bytes),r=repo(p,legado);await expect(r.repo.obterAnexo(identidade,r.id)).rejects.toThrow('MIDIA_CORROMPIDA');expect(legado).not.toHaveBeenCalled();const negado=repo(p,legado,false);await expect(negado.repo.obterAnexo(identidade,negado.id)).rejects.toThrow('ACESSO_NEGADO');});
});
