import {expect,it,vi} from 'vitest';
import {criarClienteOperacao} from '../../apps/atendimento-chat-consulta/operacao-api';
const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json'}});
const sessao={usuario:{id:'ficticio',nome:'Pessoa fictícia',perfilId:'perfil',permissoes:['consultar','atender']},csrf:'csrf-ficticio',modo:'homologacao',escritasReais:false};
const lembrete={id:'11111111-1111-4111-8111-111111111111',agendadoPara:'2026-10-20T14:00:00.000Z',conferidoEm:'2026-10-19T14:00:00.000Z',versao:1,atrasado:false,criadoPorId:'ficticio',criadoPorNome:'Atendente fictício'};
const dados={acao:'agendar' as const,versao:0,idempotencia:'22222222-2222-4222-8222-222222222222',agendadoPara:lembrete.agendadoPara};
it('lembrete exige sessão e preserva corpo, ambiente e CSRF no endpoint próprio',async()=>{
 const f=vi.fn<typeof fetch>(async()=>json(sessao)),c=criarClienteOperacao(f,'ensaio');
 await expect(c.alterarLembrete('conversa-ficticia',dados)).rejects.toMatchObject({codigo:'LOGIN'});expect(f).not.toHaveBeenCalled();await c.sessao();
 f.mockResolvedValueOnce(json({lembrete:{...lembrete,segredo:'descartar',recebidoEm:-1}}));const antes=performance.now(),r=await c.alterarLembrete('conversa-ficticia',dados);
 expect(r.lembrete).toMatchObject(lembrete);expect(r.lembrete?.recebidoEm).toBeGreaterThanOrEqual(antes);expect(r.lembrete).not.toHaveProperty('segredo');
 expect(r.lembrete?.descricao).toBe('');
 expect(f.mock.calls[1][0]).toBe('/api/atendimento/operacao/conversa/conversa-ficticia/lembrete');expect(f.mock.calls[1][1]?.headers).toMatchObject({'X-CSRF-Token':'csrf-ficticio','X-Atendimento-Ambiente':'ensaio'});expect(JSON.parse(String(f.mock.calls[1][1]?.body))).toEqual(dados);
});
it('preserva descrição e ação de atualizar sem acrescentar horário no pedido',async()=>{const f=vi.fn<typeof fetch>(async()=>json(sessao)),c=criarClienteOperacao(f);await c.sessao();f.mockResolvedValueOnce(json({lembrete:{...lembrete,descricao:'Retornar com o orçamento',versao:2}}));const p={acao:'atualizar' as const,versao:1,idempotencia:dados.idempotencia,lembreteId:lembrete.id,descricao:'Retornar com o orçamento'},r=await c.alterarLembrete('conversa',p);expect(r.lembrete?.descricao).toBe(p.descricao);expect(JSON.parse(String(f.mock.calls[1][1]?.body))).toEqual(p);});
it.each([null,'a'.repeat(1001),'Texto\u0000indevido'])('descrição inválida na resposta deixa a confirmação incerta',async descricao=>{const f=vi.fn<typeof fetch>(async()=>json(sessao)),c=criarClienteOperacao(f);await c.sessao();f.mockResolvedValueOnce(json({lembrete:{...lembrete,descricao}}));await expect(c.alterarLembrete('conversa',dados)).rejects.toMatchObject({codigo:'RESULTADO_INCERTO'});});
it.each([{},{lembrete:{...lembrete,versao:0}},{lembrete:{...lembrete,agendadoPara:'2026-02-30T14:00:00.000Z'}},{lembrete:{...lembrete,conferidoEm:'2026-10-19T11:00:00-03:00'}},{lembrete:{...lembrete,atrasado:true}}])('resposta de escrita inválida mantém resultado incerto %j',async resposta=>{
 const f=vi.fn<typeof fetch>(async()=>json(sessao)),c=criarClienteOperacao(f);await c.sessao();f.mockResolvedValueOnce(json(resposta));await expect(c.alterarLembrete('conversa',dados)).rejects.toMatchObject({codigo:'RESULTADO_INCERTO'});
});
it.each([[401,'LOGIN'],[403,'PERMISSAO'],[409,'CONFLITO'],[423,'BLOQUEADO'],[503,'RESULTADO_INCERTO']])('mantém recusa HTTP %s sem sucesso local',async(status,codigo)=>{
 const f=vi.fn<typeof fetch>(async()=>json(sessao)),c=criarClienteOperacao(f);await c.sessao();f.mockResolvedValueOnce(json({},Number(status)));await expect(c.alterarLembrete('conversa',dados)).rejects.toMatchObject({codigo});
});
it('cancelamento pode confirmar ausência de alerta pendente e não cria envio',async()=>{
 const f=vi.fn<typeof fetch>(async()=>json(sessao)),c=criarClienteOperacao(f);await c.sessao();f.mockResolvedValueOnce(json({lembrete:null}));expect(await c.alterarLembrete('conversa',{...dados,acao:'cancelar'})).toEqual({lembrete:null});expect(f.mock.calls).toHaveLength(2);
});
