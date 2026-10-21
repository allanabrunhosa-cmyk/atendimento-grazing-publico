import {describe,it,expect} from 'vitest';
import {nomeContatoOperacao} from '../../src/lib/atendimento/operacao-nomes';
import {limiteVariavelModeloOperacao,componentesModeloOperacao} from '../../src/lib/atendimento/operacao-modelos';
import {motivoFalhaOperacao,codigoFalhaMetaOperacao} from '../../src/lib/atendimento/operacao-falhas';
import {atividadesOperacao} from '../../src/lib/atendimento/operacao-atividades';

describe('ajustes operacionais',()=>{
 it.each([[' MARIA  DA SILVA ','Maria da Silva'],['joÃO dos SANTOS','João dos Santos'],["ANA-MARIA d’ÁVILA","Ana-Maria D’Ávila"],['LUÍS de SOUZA e COSTA','Luís de Souza e Costa']])('formata o nome automático %s', (nome,esperado)=>expect(nomeContatoOperacao(nome)).toBe(esperado));
 it('preserva a grafia manual',()=>expect(nomeContatoOperacao('McDonald de Souza',true)).toBe('McDonald de Souza'));
 it('aceita preenchimento longo em corpo único e recusa acima do limite final',()=>{const corpo=[{type:'BODY',text:'Olá {{1}}'}];expect(componentesModeloOperacao(corpo,['a'.repeat(2000)])).not.toBeNull();expect(componentesModeloOperacao(corpo,['a'.repeat(32765)])).toBeNull();});
 it('limita digitação e colagem pelo orçamento total do corpo e do cabeçalho',()=>{expect(limiteVariavelModeloOperacao([{type:'BODY',text:'Olá {{1}}'}],'1')).toBe(32764);expect(limiteVariavelModeloOperacao([{type:'HEADER',format:'TEXT',text:'Olá {{1}}'},{type:'BODY',text:'{{1}}'}],'header:1')).toBe(56);expect(limiteVariavelModeloOperacao([{type:'BODY',text:'Olá {{1}}'},{type:'FOOTER',text:'Rodapé'}],'1')).toBe(1020);});
 it('conta variáveis repetidas e preserva o espaço usado pelas demais',()=>{expect(limiteVariavelModeloOperacao([{type:'BODY',text:'{{1}} {{1}} {{2}}'},{type:'FOOTER',text:'Rodapé'}],'1',{'2':'abc'})).toBe(509);expect(limiteVariavelModeloOperacao([{type:'BODY',text:'{{1}} {{2}}'},{type:'FOOTER',text:'Rodapé'}],'1',{'2':'a'.repeat(1024)})).toBe(0);});
 it('aplica o limite total quando há outros componentes',()=>{const partes=[{type:'HEADER',format:'TEXT',text:'Olá {{1}}'},{type:'BODY',text:'Olá {{1}}'}];expect(componentesModeloOperacao(partes,['Pessoa','a'.repeat(1020)])).not.toBeNull();expect(componentesModeloOperacao(partes,['Pessoa','a'.repeat(1021)])).toBeNull();expect(componentesModeloOperacao(partes,['a'.repeat(57),'Assunto'])).toBeNull();});
 it('não registra mensagens individuais no extrato',()=>{expect(atividadesOperacao.enfileirar).toBeUndefined();expect(atividadesOperacao.template_utilizado.categoria).toBe('templates');});
 it('explica erros conhecidos, causa ausente e resultado incerto sem inventar entrega',()=>{expect(motivoFalhaOperacao('ENVIO_DESABILITADO')).toBe('O envio de mensagens está desativado na configuração do serviço.');expect(motivoFalhaOperacao('META_400_131047')).toContain('24 horas');expect(motivoFalhaOperacao('META_STATUS_132000')).toContain('quantidade de variáveis');expect(motivoFalhaOperacao(null)).toContain('não foi registrada');expect(motivoFalhaOperacao('qualquer',true)).toContain('Não houve confirmação');});
 it('extrai somente o código do provedor',()=>{expect(codigoFalhaMetaOperacao({error:{code:132001,message:'conteúdo privado',error_data:{details:'segredo'}}})).toBe('META_CODIGO_132001');expect(codigoFalhaMetaOperacao({error:{code:'segredo'}})).toBe('META_ENVIO_RECUSADO');expect(motivoFalhaOperacao('credencial privada')).not.toContain('credencial privada');});
});
