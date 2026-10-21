import {describe,it,expect} from 'vitest';
import {criarLeitorArquivos} from '../../scripts/atendimento/consulta-arquivos';
const o={id:'ficticio',bucket_id:'whatsapp-media',name:'ficticio.txt',metadata:{eTag:'"a"',size:3}};
const v={arquivo:'a'.repeat(64)+'.bin',sha256:'a'.repeat(64),bytes:3,metadata:{eTag:'"a"'}};
describe('consulta dos anexos locais apos sincronizacao',()=>{
 it('usa o acervo inicial somente quando ETag/tamanho correspondem',async()=>{
  const ler=criarLeitorArquivos({'whatsapp-media/ficticio.txt':[v]},async()=>{throw Error('NAO_CONSULTAR_INCREMENTAL');});expect(await ler(o)).toMatchObject({raiz:'/midia',arquivo:v.arquivo});
 });
 it('abre nova versao preservada na VPS sem proxy ou URL externa',async()=>{
  const atual={...o,metadata:{eTag:'"b"',size:3}};const ler=criarLeitorArquivos({'whatsapp-media/ficticio.txt':[v]},async r=>{expect(r).toEqual(atual);return [{...v,sha256:'b'.repeat(64),arquivo:'b'.repeat(64)+'.bin'}];});expect(await ler(atual)).toMatchObject({raiz:'/incrementais/arquivos/conteudos',arquivo:'b'.repeat(64)+'.bin'});
 });
 it('nao usa versao antiga quando atual esta ausente e recusa caminho/hash divergentes',async()=>{
  expect(await criarLeitorArquivos({'whatsapp-media/ficticio.txt':[v]},async()=>[])({...o,metadata:{eTag:'"b"',size:3}})).toBeNull();await expect(criarLeitorArquivos({},async()=>[{...v,arquivo:'../privado'}])(o)).rejects.toThrow('ANEXO_INDICE_DIVERGENTE');await expect(criarLeitorArquivos({},async()=>[{...v,bytes:4}])(o)).rejects.toThrow('ANEXO_INDICE_DIVERGENTE');
 });
});
