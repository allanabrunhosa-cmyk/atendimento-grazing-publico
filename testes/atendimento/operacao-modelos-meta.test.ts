import {describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {lerBibliotecaMeta} from '../../src/lib/atendimento/operacao-modelos-meta';
const m={id:'123456789',name:'fixture_plantao',language:'pt_BR',status:'APPROVED',parameter_format:'POSITIONAL',components:[{type:'BODY',text:'Aviso fictício.'}]};
describe('Biblioteca oficial Meta',()=>{
 it('lê página completa e mantém conteúdo/estado oficial',()=>{const p=lerBibliotecaMeta({data:[m]});expect(p.completa).toBe(true);expect(p.modelos[0].componentes).toEqual(m.components);expect(p.modelos[0].estado).toBe('APPROVED');});
 it('não confunde uma primeira página com a biblioteca completa',()=>{expect(lerBibliotecaMeta({data:[m],paging:{next:'https://graph.facebook.com/fixture'}}).completa).toBe(false);});
 it('valida sequência, duplicidade e respostas de erro',()=>{expect(()=>lerBibliotecaMeta({paginas:[{data:[m]},{data:[]}]})).toThrow('SEQUENCIA_INVALIDA');expect(()=>lerBibliotecaMeta({paginas:[{data:[m],paging:{next:'https://graph.facebook.com/fixture'}},{data:[m]}]})).toThrow('DUPLICADO');expect(()=>lerBibliotecaMeta({error:{message:'fixture'}})).toThrow('BIBLIOTECA_INVALIDA');});
 it('hash é estável após ordem JSONB e independe da ordem dos modelos',()=>{const outro={...m,id:'987654321',name:'fixture_outro'};expect(lerBibliotecaMeta({data:[m,outro]}).hash).toBe(lerBibliotecaMeta({data:[outro,JSON.parse(JSON.stringify(m))]}).hash);});
 it('recusa IDs ou nomes fora do contrato, sem dereferenciar links',()=>{for(const p of [{...m,id:'../../etc'},{...m,name:'nome indevido'},{...m,status:'approved'},{...m,parameter_format:'OTHER'}])expect(()=>lerBibliotecaMeta({data:[p]})).toThrow();});
});
