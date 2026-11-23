import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { criarApiFicticia, type ApiFicticia } from '../../scripts/atendimento/ficticio/api-ficticia';
import { criarClienteOperacao, ErroOperacao, type ClienteOperacao } from '../../apps/atendimento-chat-consulta/operacao-api';

let api: ApiFicticia, servidor: Server, base = '', cliente: ClienteOperacao;
const chamadas: string[] = [];
const fetchOriginal = globalThis.fetch;

beforeAll(async () => {
  // Toda chamada de rede do processo passa por aqui: só pode ser ao servidor local do teste.
  globalThis.fetch = ((u: string | URL | Request, init?: RequestInit) => { chamadas.push(String(u instanceof Request ? u.url : u)); return fetchOriginal(u, init); }) as typeof fetch;
  api = await criarApiFicticia();
  servidor = createServer((req, res) => { void api.atender(req, res).then(ok => { if (!ok) { res.writeHead(404); res.end(); } }); });
  await new Promise<void>(r => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  cliente = criarClienteOperacao((u, init) => globalThis.fetch(base + String(u), init), 'ensaio');
  await cliente.sessao();
});
afterAll(async () => { api.encerrar(); await new Promise(r => servidor.close(r)); globalThis.fetch = fetchOriginal; });

describe('API fictícia do painel', () => {
  it('abre a sessão sem envios reais e lista as conversas com o cliente do painel', async () => {
    const sessao = await cliente.sessao();
    expect(sessao.modo).toBe('homologacao');
    expect(sessao.escritasReais).toBe(false);
    expect(sessao.usuario.permissoes).toContain('conhecimento.adicionar');
    const abertas = await cliente.conversas('', '', '', 0);
    expect(abertas.registros.map(c => c.nome)).toEqual(['Marina Exemplo', 'Rafael Exemplo', 'Bruno Exemplo']);
    expect(abertas.contagens).toMatchObject({ total: 3, ia: 1, humano: 1, pausado: 1, encerrada: 1 });
    expect((await cliente.conversas('', 'ia', '', 0)).registros.map(c => c.nome)).toEqual(['Rafael Exemplo']);
    expect((await cliente.conversas('', 'encerrada', '', 0)).registros.map(c => c.nome)).toEqual(['Joana Exemplo']);
  });

  it('registra o envio como simulado e não duplica com a mesma idempotência', async () => {
    const pedido = { conversaId: 'demo-conversa-marina', versao: 1, idempotencia: 'teste-envio-1', tipo: 'text' as const, texto: 'Consegue sim!' };
    const primeiro = await cliente.enviar(pedido), repetido = await cliente.enviar(pedido);
    expect(repetido).toEqual(primeiro);
    expect(primeiro.estado).toBe('aceito_simulado');
    const historico = await cliente.historico('demo-conversa-marina');
    expect(historico.registros.filter(m => m.conteudo === 'Consegue sim!')).toHaveLength(1);
  });

  it('cadastra e importa fontes pelas regras reais da base de conhecimento', async () => {
    const antes = await cliente.conhecimento();
    expect(antes.filter(c => c.versoes.at(-1)?.estado === 'aprovado')).toHaveLength(5);
    const vigencia = { vigenteDe: new Date().toISOString(), vigenteAte: new Date(Date.now() + 86400000 * 30).toISOString(), responsavelId: 'demo-usuario' };
    const resultados = await cliente.importarConhecimentos({ ...vigencia, itens: [
      { pergunta: 'Vocês aceitam Pix?', resposta: 'Texto de exemplo: o Pix aparece na finalização do pedido.', categoria: 'politica' },
      { pergunta: 'Vocês aceitam Pix?', resposta: 'Texto de exemplo: o Pix aparece na finalização do pedido.', categoria: 'politica' },
      { pergunta: 'Qual o telefone da loja?', resposta: 'Ligue para (00) 90000-0000.', categoria: 'procedimento' },
    ] });
    expect(resultados.map(r => r.estado)).toEqual(['criado', 'existente', 'recusado']);
    expect(resultados[2].codigo).toBe('CONHECIMENTO_DADOS_PESSOAIS');
    await expect(cliente.cadastrarConhecimento({ pergunta: 'Pode?', resposta: 'Sim', categoria: 'procedimento', condicoes: '', ...vigencia })).rejects.toMatchObject({ codigo: 'INVALIDO', status: 400 });
    const depois = await cliente.conhecimento();
    expect(depois.find(c => c.versoes.at(-1)?.pergunta === 'Vocês aceitam Pix?')?.versoes.at(-1)?.estado).toBe('pendente');
  });

  it('simula o teste da Donatella sem IA, com a mesma escolha de fonte por assunto', async () => {
    const { versao } = await cliente.agente();
    const parcelamento = await cliente.testarAgente({ pergunta: 'Vocês parcelam no cartão?', versao, idempotencia: 'teste-1' });
    const fontes = await cliente.conhecimento();
    const idParcelamento = fontes.find(c => c.versoes.at(-1)?.pergunta === 'Como funciona o parcelamento no cartão?')?.id;
    expect(parcelamento.estado).toBe('concluido');
    expect(parcelamento.fontes[0]?.id).toBe(idParcelamento);
    expect(parcelamento.texto).toContain('nenhuma IA foi chamada');
    expect((await cliente.testarAgente({ pergunta: 'Tenho alergia a nozes, posso comer?', versao, idempotencia: 'teste-2' })).estado).toBe('apoio');
    expect((await cliente.testarAgente({ pergunta: 'Qual a taxa de entrega no meu bairro?', versao, idempotencia: 'teste-3' })).motivo).toBe('As condições de entrega ainda não foram aprovadas.');
    const entrega = await cliente.entrega();
    await expect(cliente.configurarEntrega({ texto: 'Ligue (00) 90000-0000', aprovada: true, versao: entrega.versao, idempotencia: 'e-1' })).rejects.toMatchObject({ codigo: 'INVALIDO', status: 400 });
    await cliente.configurarEntrega({ texto: 'Texto de exemplo: entregamos todos os dias.', aprovada: true, versao: entrega.versao, idempotencia: 'e-2' });
    const frete = await cliente.testarAgente({ pergunta: 'Qual a taxa de entrega no meu bairro?', versao, idempotencia: 'teste-4' });
    expect(frete.estado).toBe('concluido');
    expect(frete.texto).toContain('Texto de exemplo: entregamos todos os dias.');
  });

  it('não liga a Donatella e responde conflito de versão como o servidor real', async () => {
    const { versao } = await cliente.agente();
    await expect(cliente.controlarAgente({ acao: 'ligar', versao, idempotencia: 'c-1' })).rejects.toMatchObject({ codigo: 'AGENTE_PENDENTE', status: 409 });
    await expect(cliente.configurarEntrega({ texto: 'Outro texto.', aprovada: false, versao: 1, idempotencia: 'e-3' })).rejects.toBeInstanceOf(ErroOperacao);
  });

  it('recusa host externo e escrita sem token CSRF', async () => {
    const pedir = (host: string, metodo: string, caminho: string) => new Promise<number>((resolver, rejeitar) => {
      const r = request(base + '/api/atendimento/operacao' + caminho, { method: metodo, headers: { Host: host, 'Content-Type': 'application/json' } }, res => { res.resume(); resolver(res.statusCode ?? 0); });
      r.on('error', rejeitar); r.end(metodo === 'POST' ? '{}' : undefined);
    });
    expect(await pedir('atendimento.grazinghub.com.br', 'GET', '/sessao')).toBe(421);
    expect(await pedir('127.0.0.1', 'POST', '/conhecimento/cadastrar')).toBe(403);
  });

  it('não faz nenhuma chamada de rede fora do servidor local', () => {
    expect(chamadas.length).toBeGreaterThan(0);
    expect(chamadas.every(u => u.startsWith(base + '/'))).toBe(true);
  });
});
