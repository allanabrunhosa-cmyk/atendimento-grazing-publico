import {describe,it,expect} from 'vitest';
import {normalizarTelefoneContato,validarDestinatarioWhatsAppExistente} from '../../src/lib/atendimento/operacao-telefone-contato';
import {validarCriacaoContatoOperacao} from '../../src/lib/atendimento/operacao-contatos';
const id='11111111-1111-4111-a111-111111111111';
describe('telefone do cadastro manual de Atendimento',()=>{
 it.each([['(11) 90000-0001','5511900000001'],['+55 (11) 90000-0001','5511900000001'],['5511900000001','5511900000001'],['(55) 2345-6789','555523456789'],['(55) 90000-0001','5555900000001'],['+1 (202) 555-0101','12025550101'],['+44 20 7946 0101','442079460101']])('normaliza %s sem inserir ou remover dígitos do assinante', (entrada,saida)=>{expect(normalizarTelefoneContato(entrada)).toBe(saida);});
 it('DDI explícito é preservado para entrada nacional fora do Brasil',()=>{expect(normalizarTelefoneContato('(202) 555-0101','1')).toBe('12025550101');});
 it.each(['','119000000','119000000000','20900000001','11900000001123456789','+55 20 90000-0001','+55 11 0000-0000','+55 11 21234-5678','+55 11 9123-4567','00 55 11 90000-0001','011900000001','+05511900000001','++5511900000001','11900000001a','11900000001;','11900000001\n','+1 202 555 0101 9999999999','11900000001\u0000'])('recusa entrada inválida ou ambígua: %j',entrada=>{expect(()=>normalizarTelefoneContato(entrada)).toThrow('OPERACAO_TELEFONE_INVALIDO');});
 it('não aplica a regra de cadastro novo ao wa_id brasileiro legado recebido',()=>{expect(validarDestinatarioWhatsAppExistente('551191234567')).toBe('551191234567');expect(()=>normalizarTelefoneContato('+551191234567')).toThrow('OPERACAO_TELEFONE_INVALIDO');});
 it.each([null,123,{},'+5511900000001','00000000','1234567890123456'])('identidade existente exige dígitos internacionais, sem correção: %j',entrada=>{expect(()=>validarDestinatarioWhatsAppExistente(entrada)).toThrow('OPERACAO_TELEFONE_INVALIDO');});
});
describe('campos do cadastro de contato',()=>{
 it('aceita o cadastro mínimo e campos opcionais válidos',()=>{expect(()=>validarCriacaoContatoOperacao({nome:'Pessoa fictícia',telefone:'11900000001',idempotencia:id})).not.toThrow();expect(()=>validarCriacaoContatoOperacao({nome:'Pessoa fictícia',telefone:'+5511900000001',ddi:'55',email:'ficticio@example.com',descricao:'Empresa fictícia',classificacao:'lead',idempotencia:id})).not.toThrow();});
 it.each([{phoneId:'outro'},{autorId:'outro'},{ficticia:true},{ultimaClienteEm:new Date().toISOString()},{hubClienteId:'outro'},{tags:['Tag']},{notas:'Nota'}])('nega campos que não pertencem ao formulário: %j',extra=>{expect(()=>validarCriacaoContatoOperacao({nome:'Pessoa fictícia',telefone:'11900000001',idempotencia:id,...extra})).toThrow('OPERACAO_CONTATO_CAMPO_INVALIDO');});
 it.each([{nome:'x'.repeat(201)},{email:'sem-arroba'},{descricao:'x'.repeat(201)},{nome:'Pessoa\nTeste'},{classificacao:'outro'}])('preserva os limites do editor existente: %j',extra=>{expect(()=>validarCriacaoContatoOperacao({nome:'Pessoa fictícia',telefone:'11900000001',idempotencia:id,...extra})).toThrow();});
});
