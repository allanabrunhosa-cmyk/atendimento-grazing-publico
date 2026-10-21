import {expect,it,vi} from 'vitest';
import {criarClienteOperacao} from '../../apps/atendimento-chat-consulta/operacao-api';

const id='11111111-1111-4111-8111-111111111111',em='2026-10-15T16:00:00.123456Z';
const conversa={id,contatoId:'22222222-2222-4222-8222-222222222222',nome:'Origem fictícia',telefone:null,canal:'whatsapp',estado:'humano',responsavelId:null,equipeId:null,tags:[],versao:1,ultimaMensagemEm:em,ficticia:true,somenteLeitura:false};
const mensagem={id:'33333333-3333-4333-8333-333333333333',conversaId:id,autor:'cliente',autorId:null,autorNome:null,conteudo:'Contato compartilhado: Pessoa fictícia',tipo:'contacts',estado:'recebido',criadaEm:em,anexoId:null,citadaId:null};
const cartao={nome:'Pessoa fictícia',telefones:[{numero:'+55 (11) 90000-0001',tipo:'Celular'}],emails:['pessoa@example.invalid'],empresa:'Empresa fictícia'};
const json=(valor:unknown)=>new Response(JSON.stringify(valor),{headers:{'content-type':'application/json'}});
function fixture(contatosCompartilhados:unknown,legado=false){const buscar=vi.fn<typeof fetch>(async()=>json({conversa,registros:[{...mensagem,...(legado?{}:{contatosCompartilhados})}],notas:[],proxima:{antes:em,id:mensagem.id}}));return {buscar,cliente:criarClienteOperacao(buscar)};}

it('entrega apenas o contrato do cartão e preserva telefone, histórico e cursor',async()=>{
 const {buscar,cliente}=fixture([{...cartao,wa_id:'não é destino do telefone',segredo:'campo inesperado',url:'https://externo.invalid/privado',telefones:[{...cartao.telefones[0],wa_id:'id-distinto'}]}]);
 const h=await cliente.historico(id);
 expect(h.registros[0]).toMatchObject({...mensagem,contatosCompartilhados:[cartao]});
 expect(h.proxima).toEqual({antes:em,id:mensagem.id});
 expect(JSON.stringify(h)).not.toContain('campo inesperado');expect(JSON.stringify(h)).not.toContain('externo.invalid');
 expect(buscar).toHaveBeenCalledTimes(1);expect(buscar.mock.calls[0][1]?.method).toBe('GET');
 expect(buscar.mock.calls[0][1]?.body).toBeUndefined();
});

it('não cria cartões para mensagens anteriores sem o campo e aceita cartão sem telefone',async()=>{
 const antigo=await fixture(undefined,true).cliente.historico(id);expect(antigo.registros[0]).not.toHaveProperty('contatosCompartilhados');
 const semTelefone={...cartao,telefones:[],emails:[],empresa:''};expect((await fixture([semTelefone]).cliente.historico(id)).registros[0].contatosCompartilhados).toEqual([semTelefone]);
});

it('preserva mais de 20 cartões e telefones sem truncar valores ou escolher destino',async()=>{
 const limite={nome:'N'.repeat(200),empresa:'E'.repeat(200),emails:Array.from({length:21},()=> 'a'.repeat(254)),telefones:Array.from({length:21},(_,n)=>({numero:String(n)+'0'.repeat(78),tipo:'T'.repeat(40)}))};
 const cartões=Array.from({length:21},()=>limite),resultado=(await fixture(cartões).cliente.historico(id)).registros[0].contatosCompartilhados;
 expect(resultado).toEqual(cartões);expect(resultado?.[0].telefones).toHaveLength(21);expect(resultado?.[0].emails).toHaveLength(21);
});

it.each([
 null,{},[null],
 [{...cartao,nome:''}],[{...cartao,nome:'N'.repeat(201)}],[{...cartao,nome:'Nome\nInjetado'}],
 [{...cartao,empresa:'E'.repeat(201)}],[{...cartao,empresa:'Empresa\0'}],
 [{...cartao,telefones:undefined}],
 [{...cartao,telefones:[{numero:'1'.repeat(81),tipo:''}]}],[{...cartao,telefones:[{numero:'',tipo:''}]}],
 [{...cartao,telefones:[{numero:'+55\r\n11',tipo:''}]}],[{...cartao,telefones:[{numero:'5511900000001',tipo:'T'.repeat(41)}]}],
 [{...cartao,emails:['a'.repeat(255)]}],[{...cartao,emails:['linha\r\nextra']}],
])('recusa cartão malformado antes de entregá-lo à interface (%#)',async(valor)=>{
 await expect(fixture(valor).cliente.historico(id)).rejects.toMatchObject({codigo:'INVALIDO'});
});
