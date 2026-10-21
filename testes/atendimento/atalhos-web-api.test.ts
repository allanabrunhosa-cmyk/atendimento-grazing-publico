import {expect,it,vi} from 'vitest';
import {criarClienteOperacao} from '../../apps/atendimento-chat-consulta/operacao-api';
import {salvarAtalho,validarListaAtalhos} from '../../apps/atendimento-chat-consulta/atalhos-api';
const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json'}});
const sessao={usuario:{id:'ficticio',nome:'Pessoa fictícia',perfilId:'perfil',permissoes:['consultar','atender']},csrf:'csrf-ficticio',modo:'homologacao',escritasReais:false};
const pedido={nome:'retorno',texto:'Olá!\nVamos retomar o atendimento.',versao:0,idempotencia:'11111111-1111-4111-8111-111111111111'};
const atalho={id:'22222222-2222-4222-8222-222222222222',nome:pedido.nome,texto:pedido.texto};
it('consulta atalhos sem escrita e transmite o ambiente e o cancelamento',async()=>{
 const f=vi.fn<typeof fetch>(async()=>json({versao:1,registros:[atalho]})),c=criarClienteOperacao(f,'ensaio'),abortar=new AbortController();
 expect(validarListaAtalhos(await c.consultarAtalhos(abortar.signal))).toEqual({versao:1,registros:[atalho]});
 expect(f.mock.calls[0][0]).toBe('/api/atendimento/operacao/atalhos');expect(f.mock.calls[0][1]).toMatchObject({method:'GET',credentials:'same-origin',signal:abortar.signal,headers:{'X-Atendimento-Ambiente':'ensaio'}});expect(f.mock.calls[0][1]?.body).toBeUndefined();
});
it('exige sessão e preserva pedido, CSRF e ambiente sem chamar transporte de mensagens',async()=>{
 const f=vi.fn<typeof fetch>(async()=>json(sessao)),c=criarClienteOperacao(f,'ensaio');await expect(c.alterarAtalho('/atalhos/salvar',pedido)).rejects.toMatchObject({codigo:'LOGIN'});expect(f).not.toHaveBeenCalled();await c.sessao();
 f.mockResolvedValueOnce(json({versao:1,atalho}));await expect(salvarAtalho(c,pedido)).resolves.toEqual({versao:1,atalho});
 expect(f.mock.calls[1][0]).toBe('/api/atendimento/operacao/atalhos/salvar');expect(f.mock.calls[1][1]).toMatchObject({method:'POST',headers:{'X-CSRF-Token':'csrf-ficticio','X-Atendimento-Ambiente':'ensaio'}});expect(JSON.parse(String(f.mock.calls[1][1]?.body))).toEqual(pedido);expect(f).toHaveBeenCalledTimes(2);
});
it('limita a escrita aos dois caminhos de atalhos',async()=>{const f=vi.fn<typeof fetch>(),c=criarClienteOperacao(f);await expect(c.alterarAtalho('/mensagens/envio' as '/atalhos/salvar',pedido)).rejects.toMatchObject({codigo:'INVALIDO'});expect(f).not.toHaveBeenCalled();});
it.each([[401,'LOGIN'],[403,'PERMISSAO'],[409,'CONFLITO'],[423,'BLOQUEADO'],[503,'RESULTADO_INCERTO']])('mantém recusa HTTP %s',async(status,codigo)=>{const f=vi.fn<typeof fetch>(async()=>json(sessao)),c=criarClienteOperacao(f);await c.sessao();f.mockResolvedValueOnce(json({},Number(status)));await expect(c.alterarAtalho('/atalhos/salvar',pedido)).rejects.toMatchObject({codigo});});
it.each([['OPERACAO_ATALHO_NOME_CONFLITO',409,'ATALHO_NOME'],['OPERACAO_ATALHOS_LIMITE_INVALIDO',400,'ATALHOS_LIMITE'],['OPERACAO_ATALHOS_TAMANHO_INVALIDO',400,'ATALHOS_LIMITE']])('explica a recusa %s',async(erro,status,codigo)=>{const f=vi.fn<typeof fetch>(async()=>json(sessao)),c=criarClienteOperacao(f);await c.sessao();f.mockResolvedValueOnce(json({erro},Number(status)));await expect(c.alterarAtalho('/atalhos/salvar',pedido)).rejects.toMatchObject({codigo});});
it('distingue perda da escrita de falha da consulta posterior',async()=>{const f=vi.fn<typeof fetch>(async()=>json(sessao)),c=criarClienteOperacao(f);await c.sessao();f.mockRejectedValueOnce(Error('queda fictícia'));await expect(c.alterarAtalho('/atalhos/salvar',pedido)).rejects.toMatchObject({codigo:'RESULTADO_INCERTO'});f.mockRejectedValueOnce(Error('queda fictícia'));await expect(c.consultarAtalhos()).rejects.toMatchObject({codigo:'INDISPONIVEL'});});
it.each([new Response('inválido'),json({dados:'x'.repeat(1024*1024)})])('resposta de escrita ilegível exige conferir a mesma operação',async resposta=>{const f=vi.fn<typeof fetch>(async()=>json(sessao)),c=criarClienteOperacao(f);await c.sessao();f.mockResolvedValueOnce(resposta);await expect(c.alterarAtalho('/atalhos/excluir',{id:atalho.id,versao:1,idempotencia:pedido.idempotencia})).rejects.toMatchObject({codigo:'RESULTADO_INCERTO'});});
