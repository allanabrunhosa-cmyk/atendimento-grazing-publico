import {describe,it,expect} from 'vitest';
import {paginarOperacaoPorBytes} from '../../src/lib/atendimento/operacao-paginacao';
describe('paginação operacional limitada pelo envelope',()=>{
 const linhas=[{id:'2',criadaEm:'2026-10-10T01:00:00.123457Z',conteudo:'B'.repeat(100)},{id:'1',criadaEm:'2026-10-10T01:00:00.123456Z',conteudo:'A'.repeat(100)}];
 it('ordena cronologicamente sem perder o cursor exato',()=>{const p=paginarOperacaoPorBytes(linhas,true,{conversa:{id:'conversa'},notas:[]});expect(p.registros.map(m=>m.id)).toEqual(['1','2']);expect(p.proxima).toEqual({antes:linhas[1].criadaEm,id:'1'});});
 it('inclui notas e detalhes na medida e preserva o texto inteiro',()=>{const limite=Buffer.byteLength(JSON.stringify({conversa:'x',registros:[linhas[0]],proxima:{antes:linhas[0].criadaEm,id:linhas[0].id}}));const p=paginarOperacaoPorBytes(linhas,false,{conversa:'x'},limite);expect(p.registros).toEqual([linhas[0]]);expect(p.proxima?.id).toBe('2');expect(Buffer.byteLength(JSON.stringify(p))).toBeLessThanOrEqual(limite);});
 it('não pula uma mensagem que não cabe',()=>{expect(()=>paginarOperacaoPorBytes(linhas,false,{notas:'x'.repeat(500)},100)).toThrow('HISTORICO_GRANDE');});
 it('página vazia ou completa não inventa cursor',()=>{expect(paginarOperacaoPorBytes([],false,{}).proxima).toBeNull();expect(paginarOperacaoPorBytes(linhas,false,{}).proxima).toBeNull();});
});
