// @vitest-environment jsdom
import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import ComercialConversa,{StatusComercialOperacao} from '../../apps/atendimento-chat-consulta/ComercialConversa';
import {criarClienteOperacao} from '../../apps/atendimento-chat-consulta/operacao-api';
import {criarClienteComercial} from '../../apps/atendimento-chat-consulta/comercial-api';
import type {ProdutoComercial} from '../../src/lib/atendimento/comercial-tipos';
const em='2026-10-20T14:00:00.000Z',a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json'}});
const produto=(id='hub-ficticio'):ProdutoComercial=>({hubId:id,nome:'Tábua fictícia '+id,especificacao:'Composição fictícia aprovada no HUB para ensaio.',motivo:'Opção fictícia para a ocasião informada.',fonteHub:{id:'fonte-ficticia',versao:'1',consultadoEm:em},vinculo:{estado:'confirmado',motivo:null},oferta:{produtoId:123,variacaoId:null,sku:'SKU-FICTICIO',url:'https://www.grazingtable.com.br/produto/ensaio-ficticio/',imagemUrl:null,tipo:'simples',preco:{moeda:'BRL',valor:'149.90',tipo:'fixo'},compravel:true,disponibilidade:'Disponível para compra no site. Prazo e frete dependem da confirmação correspondente.',consultadoEm:em}});
const pedido={numero:'GT-10_2',data:em,status:{codigo:'processing',rotulo:'Processando',interpretacao:null},itens:[{nome:'Tábua fictícia adquirida',quantidade:2}],modalidadeEntrega:'retirada',agendamento:null,rastreio:null,consultadoEm:em};
function fixture(alterar?:(u:URL,o:RequestInit|undefined)=>Response|Promise<Response>|undefined){
 let produtos=[produto()],falharPedidos=false,falharStatus=false;
 const buscar=vi.fn<typeof fetch>(async(u,o)=>{const url=new URL(String(u),'https://ficticio.invalid'),r=alterar?.(url,o);if(r)return r;if(o?.method!=='GET')throw Error('ESCRITA_NAO_AUTORIZADA_NO_ENSAIO');const p=url.pathname.replace('/api/atendimento/operacao','');
  if(p==='/comercial/produtos')return json({produtos,consultadoEm:em,avisos:[],mais:false});
  if(p==='/comercial/pedidos')return falharPedidos?json({},503):json({estado:'consultado',pedidos:[pedido],consultadoEm:em,mensagem:null});
  if(p==='/comercial/status')return falharStatus?json({},503):json({estado:'conectado',ultimoSucessoEm:em,ultimaTentativaEm:em,vinculosPendentes:2,produtosVinculados:3,detalhe:null});
  throw Error('ENDPOINT_FICTICIO_NAO_PREPARADO:'+p);
 });const cliente=criarClienteOperacao(buscar,'ensaio'),inserir=vi.fn();
 const props={cliente,conversaId:a,podeConsultarProdutos:true,podeConsultarPedidos:true,podeInserir:true,inserir};
 return {buscar,cliente,inserir,props,setProdutos(v:ProdutoComercial[]){produtos=v;},falharPedidos(){falharPedidos=true;},falharStatus(){falharStatus=true;}};
}
async function buscarProduto(){fireEvent.change(screen.getByRole('textbox',{name:'Buscar produtos do HUB'}),{target:{value:'presente'}});await screen.findAllByRole('button',{name:/Copiar link de Tábua fictícia/});}
afterEach(()=>{cleanup();vi.restoreAllMocks();Reflect.deleteProperty(navigator,'clipboard');});

it('busca automaticamente, limita a três opções e limpa o campo com foco preservado',async()=>{
 const f=fixture();f.setProdutos([produto('1'),produto('2'),produto('3'),produto('4')]);render(<ComercialConversa {...f.props}/>);await buscarProduto();expect(screen.getAllByRole('button',{name:/Copiar link de/})).toHaveLength(3);expect(screen.getByText(/Mostrando até 3 opções/)).toBeTruthy();const q=new URL(String(f.buscar.mock.calls[0][0]),'https://ficticio.invalid');expect(q.searchParams.get('busca')).toBe('presente');fireEvent.click(screen.getByRole('button',{name:'Limpar busca'}));expect(screen.getByRole('textbox',{name:'Buscar produtos do HUB'})).toHaveProperty('value','');expect(document.activeElement).toBe(screen.getByRole('textbox',{name:'Buscar produtos do HUB'}));expect(screen.queryByRole('button',{name:/Copiar link de/})).toBeNull();
});
it('revalida o preço e prepara o compositor por callback, sem enviar mensagem',async()=>{
 const f=fixture();render(<ComercialConversa {...f.props}/>);await buscarProduto();const novo=produto();novo.oferta!.preco!.valor='159.90';f.setProdutos([novo]);fireEvent.click(screen.getByRole('button',{name:/Inserir Tábua fictícia/}));await waitFor(()=>expect(f.inserir).toHaveBeenCalledTimes(1));const texto=f.inserir.mock.calls[0][0];expect(texto).toContain('159,90');expect(texto).not.toContain('149,90');expect(texto).toContain(novo.oferta!.url);expect(screen.getByText(/Produto inserido no rascunho/)).toBeTruthy();expect(f.buscar.mock.calls.every(([,o])=>o?.method==='GET')).toBe(true);expect(f.buscar.mock.calls.some(([u])=>String(u).includes('/mensagens/envio'))).toBe(false);
});
it('copia apenas o link oficial sem alterar o compositor',async()=>{
 const copiar=vi.fn().mockResolvedValue(undefined);Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:copiar}});const f=fixture();render(<ComercialConversa {...f.props}/>);await buscarProduto();fireEvent.click(screen.getByRole('button',{name:/Copiar link de/}));await screen.findByText('Link copiado.');expect(copiar).toHaveBeenCalledWith(produto().oferta!.url);expect(f.inserir).not.toHaveBeenCalled();
});
it('consulta produtos em leitura sem liberar a inserção no compositor',async()=>{
 const f=fixture();render(<ComercialConversa {...f.props} podeInserir={false}/>);await buscarProduto();expect(screen.getByRole('button',{name:/Copiar link de/})).toHaveProperty('disabled',false);expect(screen.getByRole('button',{name:/Inserir Tábua fictícia/})).toHaveProperty('disabled',true);fireEvent.click(screen.getByRole('button',{name:/Inserir Tábua fictícia/}));expect(f.inserir).not.toHaveBeenCalled();
});
it('não anuncia inserção quando o compositor recusa a alteração',async()=>{
 const f=fixture();f.inserir.mockReturnValue(false);render(<ComercialConversa {...f.props}/>);await buscarProduto();fireEvent.click(screen.getByRole('button',{name:/Inserir Tábua fictícia/}));expect(await screen.findByRole('alert')).toHaveProperty('textContent','O texto não foi inserido. Confira o rascunho e o limite da mensagem.');expect(screen.queryByText(/Produto inserido no rascunho/)).toBeNull();
});
it('mantém especificações do HUB mas não oferece link pendente ou produto não comprável',async()=>{
 const f=fixture(),pendente=produto('pendente'),indisponivel=produto('indisponivel');pendente.vinculo={estado:'ambiguo',motivo:'Associação pendente de conferência.'};indisponivel.oferta!.compravel=false;f.setProdutos([pendente,indisponivel]);render(<ComercialConversa {...f.props}/>);fireEvent.change(screen.getByRole('textbox',{name:'Buscar produtos do HUB'}),{target:{value:'presente'}});await screen.findByText('Associação pendente de conferência.');expect(screen.getAllByText('Especificações no HUB')).toHaveLength(2);expect(screen.queryByRole('button',{name:/Copiar link de/})).toBeNull();expect(screen.queryByRole('button',{name:/Inserir .* no atendimento/})).toBeNull();
});
it('distingue preço a partir de e opções variáveis sem fabricar um checkout',async()=>{
 const f=fixture(),p=produto();p.oferta!.tipo='variavel';p.oferta!.preco!.tipo='a_partir';f.setProdutos([p]);render(<ComercialConversa {...f.props}/>);await buscarProduto();expect(screen.getByText(/Preço no site: a partir de/)).toBeTruthy();expect(screen.getByText('Escolha as opções na página do produto.')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:/Inserir Tábua fictícia/}));await waitFor(()=>expect(f.inserir).toHaveBeenCalled());expect(f.inserir.mock.calls[0][0]).toContain('As opções são escolhidas na página do produto.');expect(f.inserir.mock.calls[0][0]).not.toMatch(/checkout|add-to-cart/);
});
it('consulta pedido por número visível customizado e remove o estado anterior quando a atualização falha',async()=>{
 const f=fixture();render(<ComercialConversa {...f.props}/>);fireEvent.change(screen.getByRole('textbox',{name:'Número visível do pedido (opcional)'}),{target:{value:'#GT-10_2'}});fireEvent.click(screen.getByRole('button',{name:'Atualizar pedidos do site'}));await screen.findByText('Pedido GT-10_2');expect(screen.getByText('Processando')).toBeTruthy();expect(screen.getByText('2 × Tábua fictícia adquirida')).toBeTruthy();const u=new URL(String(f.buscar.mock.calls[0][0]),'https://ficticio.invalid');expect(u.searchParams.get('conversaId')).toBe(a);expect(u.searchParams.get('numero')).toBe('#GT-10_2');f.falharPedidos();fireEvent.click(screen.getByRole('button',{name:'Atualizar pedidos do site'}));await screen.findByRole('alert');expect(screen.queryByText('Pedido GT-10_2')).toBeNull();expect(screen.queryByText('Processando')).toBeNull();
});
it('trocar de conversa aborta a consulta e impede mostrar o pedido da conversa anterior',async()=>{
 let resolver:((r:Response)=>void)|undefined;const f=fixture(u=>u.pathname.endsWith('/comercial/pedidos')?new Promise<Response>(r=>{resolver=r;}):undefined),vista=render(<ComercialConversa {...f.props}/>);fireEvent.click(screen.getByRole('button',{name:'Atualizar pedidos do site'}));await waitFor(()=>expect(resolver).toBeTypeOf('function'));const sinal=f.buscar.mock.calls[0][1]?.signal;vista.rerender(<ComercialConversa {...f.props} conversaId={b}/>);expect(sinal?.aborted).toBe(true);await act(async()=>resolver!(json({estado:'consultado',pedidos:[pedido],consultadoEm:em,mensagem:null})));expect(screen.queryByText('Pedido GT-10_2')).toBeNull();expect(screen.getByText(/Atualize para consultar os pedidos autorizados/)).toBeTruthy();
});
it('trocar de conversa cancela também uma recomendação ainda em consulta',async()=>{
 let resolver:((r:Response)=>void)|undefined;const f=fixture(u=>u.pathname.endsWith('/comercial/produtos')?new Promise<Response>(r=>{resolver=r;}):undefined),vista=render(<ComercialConversa {...f.props}/>);fireEvent.change(screen.getByRole('textbox',{name:'Buscar produtos do HUB'}),{target:{value:'presente'}});await waitFor(()=>expect(resolver).toBeTypeOf('function'));const sinal=f.buscar.mock.calls[0][1]?.signal;vista.rerender(<ComercialConversa {...f.props} conversaId={b}/>);expect(sinal?.aborted).toBe(true);await act(async()=>resolver!(json({produtos:[produto()],consultadoEm:em,avisos:[],mais:false})));expect(screen.getByRole('textbox',{name:'Buscar produtos do HUB'})).toHaveProperty('value','');expect(screen.queryByRole('button',{name:/Copiar link de/})).toBeNull();
});
it('não consulta dados nem prepara texto sem as permissões necessárias',async()=>{
 const f=fixture();render(<><ComercialConversa {...f.props} podeConsultarProdutos={false} podeConsultarPedidos={false} podeInserir={false}/><StatusComercialOperacao cliente={f.cliente} podeConsultar={false}/></>);expect(screen.queryByRole('textbox')).toBeNull();expect(screen.getByRole('button',{name:'Atualizar pedidos do site'})).toHaveProperty('disabled',true);expect(screen.getByRole('button',{name:'Atualizar conexão WooCommerce'})).toHaveProperty('disabled',true);expect(f.buscar).not.toHaveBeenCalled();
});
it('status compacto mostra última consulta e vínculos; falha não conserva conectado como estado atual',async()=>{
 const f=fixture();render(<StatusComercialOperacao cliente={f.cliente} podeConsultar/>);await screen.findByText('Conectado');expect(screen.getByText('Ainda sem vínculo conferido')).toBeTruthy();expect(screen.getByText('Última consulta concluída')).toBeTruthy();f.falharStatus();fireEvent.click(screen.getByRole('button',{name:'Atualizar conexão WooCommerce'}));await screen.findByRole('alert');expect(screen.queryByText('Conectado')).toBeNull();
});
it.each(['https://host-ficticio.invalid/produto/a','https://www.grazingtable.com.br/wp-admin/','https://www.grazingtable.com.br/checkout/?key=privada','javascript:alert(1)'])('recusa link fora do contrato de compra: %s',async url=>{
 const f=fixture(),p=produto();p.oferta!.url=url;f.setProdutos([p]);await expect(criarClienteComercial(f.cliente).comercialProdutos('presente')).rejects.toMatchObject({codigo:'INVALIDO'});
});

it('aceita os limites de dez dígitos no preço e cem itens do pedido sem truncar',async()=>{
 const itens=Array.from({length:100},(_,i)=>({nome:'Item fictício '+(i+1),quantidade:1}));
 const f=fixture(u=>u.pathname.endsWith('/comercial/pedidos')?json({estado:'consultado',pedidos:[{...pedido,itens}],consultadoEm:em,mensagem:null}):undefined),p=produto();p.oferta!.preco={moeda:'BRL',valor:'1234567890.1234',ate:'1234567891.1234',tipo:'faixa'};f.setProdutos([p]);const api=criarClienteComercial(f.cliente);
 expect((await api.comercialProdutos('presente')).produtos[0].oferta!.preco).toEqual(p.oferta!.preco);expect((await api.comercialPedidos(a)).pedidos[0].itens).toEqual(itens);
 p.oferta!.preco.valor='12345678901.1234';await expect(api.comercialProdutos('presente')).rejects.toMatchObject({codigo:'INVALIDO'});
});
