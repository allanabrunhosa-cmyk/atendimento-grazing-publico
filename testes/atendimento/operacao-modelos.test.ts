import {describe,it,expect} from 'vitest';
import {variaveisModeloOperacao,modeloTextoSuportadoOperacao,componentesModeloOperacao,contratoModeloOperacao} from '../../src/lib/atendimento/operacao-modelos';
describe('modelos oficiais suportados pelo envio operacional',()=>{
 it('expõe cada variável posicional uma única vez e em ordem',()=>{const m=[{type:'BODY',text:'Olá {{2}}, pedido {{1}} e {{2}}.'}];expect(variaveisModeloOperacao(m)).toEqual(['1','2']);expect(modeloTextoSuportadoOperacao(m)).toBe(true);});
 it('permite texto estático, rodapé e cabeçalho textual estático',()=>{expect(modeloTextoSuportadoOperacao([{type:'HEADER',format:'TEXT',text:'Grazing'},{type:'BODY',text:'Aviso fictício'},{type:'FOOTER',text:'Atendimento'}])).toBe(true);});
 it.each([[{type:'BODY',text:'Olá {{nome}}'}],[{type:'BODY',text:'Olá {{2}}'}],[{type:'BODY',text:'Olá {{0}}'}],[{type:'HEADER',format:'IMAGE'},{type:'BODY',text:'Olá'}],[{type:'BODY',text:'Olá'},{type:'BUTTONS',buttons:[]}],[{type:'BODY',text:'Olá'},{type:'HEADER',format:'TEXT',text:'{{1}} {{2}}'}]].map(componentes=>({componentes})))('recusa formatos ainda sem contrato implementado ($componentes)',({componentes})=>{expect(modeloTextoSuportadoOperacao(componentes)).toBe(false);});
 it('separa o cabeçalho do corpo mesmo quando ambos usam {{1}}',()=>{
  const m=[{type:'BODY',text:'Corpo {{1}}'},{type:'HEADER',format:'TEXT',text:'Cabeçalho {{1}}'}];
  expect(variaveisModeloOperacao(m)).toEqual(['header:1','1']);expect(componentesModeloOperacao(m,['Nome do cabeçalho','Valor diferente do corpo'])).toEqual([{type:'header',parameters:[{type:'text',text:'Nome do cabeçalho'}]},{type:'body',parameters:[{type:'text',text:'Valor diferente do corpo'}]}]);expect(componentesModeloOperacao(m,['Só corpo'])).toBeNull();
 });
 it('URL estático usa a definição aprovada e não fabrica componente ou URL de envio',()=>{
  const m=[{type:'HEADER',format:'TEXT',text:'Título estático'},{type:'BODY',text:'Corpo {{1}}'},{type:'BUTTONS',buttons:[{type:'URL',text:'Abrir',url:'https://exemplo.invalid/consulta'}]}];
  expect(modeloTextoSuportadoOperacao(m)).toBe(true);expect(componentesModeloOperacao(m,['Corpo fictício'])).toEqual([{type:'body',parameters:[{type:'text',text:'Corpo fictício'}]}]);expect(componentesModeloOperacao([{type:'BODY',text:'Estático'},{type:'BUTTONS',buttons:[{type:'URL',text:'Abrir',url:'https://exemplo.invalid/consulta'}]}],[])).toEqual([]);
 });
 it('QUICK_REPLY preserva o retorno definido e a posição original sem executar ações',()=>{
  const m=[{type:'BODY',text:'Estático'},{type:'BUTTONS',buttons:[{type:'URL',text:'Abrir',url:'https://exemplo.invalid/'},{type:'QUICK_REPLY',text:'Sim',payload:'retorno-ficticio'},{type:'QUICK_REPLY',text:'Não'}]}];
  expect(componentesModeloOperacao(m,[])).toEqual([{type:'button',sub_type:'quick_reply',index:'1',parameters:[{type:'payload',payload:'retorno-ficticio'}]},{type:'button',sub_type:'quick_reply',index:'2',parameters:[{type:'payload',payload:'Não'}]}]);
 });
 it.each([{type:'URL',text:'Abrir',url:'https://exemplo.invalid/{{1}}'},{type:'URL',text:'Abrir',url:'javascript:alert(1)'},{type:'FLOW',text:'Abrir'},{type:'QUICK_REPLY',text:'Sim',payload:'x'.repeat(257)}])('recusa botão dinâmico, formato não implementado ou retorno inválido',botao=>{expect(modeloTextoSuportadoOperacao([{type:'BODY',text:'Estático'},{type:'BUTTONS',buttons:[botao]}])).toBe(false);});
 it('conserva contrato canônico ao ler JSONB e recusa dados malformados/duplicados',()=>{const m={nome:'fixture',idioma:'pt_BR',componentes:[{type:'HEADER',format:'TEXT',text:'{{1}}'},{type:'BODY',text:'{{1}}'}]};expect(contratoModeloOperacao(m)).toEqual(contratoModeloOperacao({...m,componentes:[{text:'{{1}}',format:'TEXT',type:'HEADER'},{text:'{{1}}',type:'BODY'}]}));for(const c of [null,[null],[{type:'BODY',text:'a'},{type:'BODY',text:'b'}]])expect(modeloTextoSuportadoOperacao(c)).toBe(false);expect(componentesModeloOperacao(m.componentes,['','b'])).toBeNull();});
});
