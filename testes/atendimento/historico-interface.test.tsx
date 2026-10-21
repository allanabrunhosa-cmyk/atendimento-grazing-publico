// @vitest-environment jsdom
import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen,within,fireEvent} from '@testing-library/react';
import ChatOperacao from '../../apps/atendimento-chat-consulta/ChatOperacao';
import {criarClienteOperacao,type MensagemOperacao} from '../../apps/atendimento-chat-consulta/operacao-api';
import {LISTA_CAPACIDADES_ATENDIMENTO} from '../../src/lib/permissoes/atendimento';
const id='11111111-1111-4111-8111-111111111111',anterior='22222222-2222-4222-8222-222222222222',em='2026-10-15T14:00:00.123456Z';
const conversa={id,contatoId:anterior,nome:'Contato de demonstração',telefone:null,canal:'whatsapp',estado:'humano',responsavelId:null,equipeId:null,tags:[],versao:1,ultimaMensagemEm:em,ficticia:true,somenteLeitura:false};
const registro=(chave:string,evento?:MensagemOperacao['evento'],autorNome:string|null=null)=>({id:chave,conversaId:anterior,autor:'humano',autorId:null,autorNome,conteudo:evento?null:'Mensagem do atendimento anterior',tipo:evento?'evento':'text',estado:evento?'registrado':'aceito',criadaEm:em,anexoId:null,citadaId:null,podeResponder:false,podeTentarNovamente:false,...(evento?{evento}:{})});
const json=(v:unknown)=>new Response(JSON.stringify(v),{headers:{'content-type':'application/json'}});
function cliente(registros:unknown[]){return criarClienteOperacao(async entrada=>{
 const p=new URL(String(entrada),'https://ficticio.invalid').pathname.replace('/api/atendimento/operacao','');
 if(p==='/sessao')return json({usuario:{id:'fixture',nome:'Pessoa de teste',perfilId:'fixture',permissoes:LISTA_CAPACIDADES_ATENDIMENTO},csrf:'fixture',modo:'homologacao',escritasReais:false});
 if(p==='/conversas')return json({registros:[conversa],mais:false,pagina:0});
 if(p==='/historico')return json({conversa,registros,notas:[],proxima:null});
 if(p==='/rascunho')return json({texto:'',versao:0});
 if(p.endsWith('/abertura'))return json({registrada:true});
 if(p==='/equipe')return json({usuarios:[],equipes:[]});
 if(p==='/status')return json({modo:'homologacao',enviosReais:false,receptor:'desarmado',fila:{pendentes:0,incertos:0,falhas:0},backup:{ultimoSucessoEm:null,falha:null},agente:{modo:'desligado',modelo:'fixture',disponivel:false},atualizadoEm:em,importadoEm:null});
 throw Error('ENDPOINT_FICTICIO_NAO_PREVISTO');
});}
async function abrir(){fireEvent.click(await within(await screen.findByRole('region',{name:'Lista de conversas'})).findByRole('button',{name:/Contato de demonstração/}));await screen.findByRole('textbox',{name:'Mensagem'});}
afterEach(cleanup);
it('mostra mensagens antigas e eventos com autoria e data, sem ações de envio nos avisos',async()=>{
 const {container}=render(<ChatOperacao cliente={cliente([registro('mensagem'),registro('fechamento','encerramento','Ana Fictícia'),registro('reabertura','reabertura','Sistema — WhatsApp')])}/>);await abrir();
 expect(screen.getByText('Mensagem do atendimento anterior')).toBeTruthy();
 const fechado=screen.getByRole('note',{name:'Conversa encerrada'}),reaberto=screen.getByRole('note',{name:'Conversa reaberta'});
 expect(within(fechado).getByText('Por Ana Fictícia')).toBeTruthy();expect(within(reaberto).getByText('Por Sistema — WhatsApp')).toBeTruthy();
 expect(fechado.querySelector('time')?.getAttribute('datetime')).toBe(em);expect(reaberto.querySelector('time')?.textContent).toContain('15/10/2026');
 expect(container.querySelectorAll('.balao')).toHaveLength(1);expect(within(fechado).queryByRole('button')).toBeNull();expect(within(reaberto).queryByRole('button')).toBeNull();
 expect(screen.queryByRole('button',{name:'Responder a esta mensagem'})).toBeNull();expect(screen.queryByRole('button',{name:/Tentar novamente a mensagem/})).toBeNull();
});
it('não inventa responsável ou reabertura para início legado sem auditoria',async()=>{
 render(<ChatOperacao cliente={cliente([registro('inicio','inicio')])}/>);await abrir();const aviso=screen.getByRole('note',{name:'Atendimento iniciado'});
 expect(within(aviso).getByText('Responsável não registrado')).toBeTruthy();expect(within(aviso).queryByText('Pessoa de teste')).toBeNull();expect(screen.queryByRole('note',{name:'Conversa reaberta'})).toBeNull();
});
it('preserva eventos e o cursor exato no contrato paginado da API',async()=>{
 const buscar=vi.fn<typeof fetch>(async()=>json({conversa,registros:[registro('fechamento','encerramento','Ana Fictícia')],notas:[],proxima:{antes:em,id:anterior}})),c=criarClienteOperacao(buscar);
 const h=await c.historico(id,{antes:em,id:anterior});expect(h.registros[0]).toMatchObject({evento:'encerramento',autorNome:'Ana Fictícia',podeResponder:false});expect(h.proxima).toEqual({antes:em,id:anterior});expect(String(buscar.mock.calls[0][0])).toContain(encodeURIComponent(em));
});
it('recusa categoria de evento desconhecida',async()=>{
 const c=criarClienteOperacao(async()=>json({conversa,registros:[{...registro('aviso'),evento:'desconhecido'}],notas:[],proxima:null}));await expect(c.historico(id)).rejects.toMatchObject({codigo:'INVALIDO'});
});
