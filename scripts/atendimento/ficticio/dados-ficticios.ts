/** Dados de exemplo do ambiente fictício local. Nomes, telefones (DDD 00) e
 * textos são inventados; nada aqui vem da operação real. */
export const EMPRESA_FICTICIA = 'demo-grazing';
export const EQUIPE_FICTICIA = { id: 'demo-equipe-atendimento', nome: 'Atendimento (exemplo)' };
export const USUARIO_FICTICIO = { id: 'demo-usuario', nome: 'Pessoa de teste', perfilId: 'demo-perfil-completo' };
export const COLEGA_FICTICIO = { id: 'demo-colega', nome: 'Colega de teste' };

export type EstadoConversaFicticia = 'ia' | 'humano' | 'pausado' | 'encerrada';
export type CanalFicticio = 'whatsapp' | 'instagram';
export type MensagemFicticia = { id: string; conversaId: string; autor: 'cliente' | 'humano' | 'ia'; autorId: string | null; autorNome: string | null; conteudo: string | null; tipo: string; estado: string; criadaEm: string; anexoId: null; citadaId: string | null; evento?: 'encerramento' | 'reabertura' };
export type ConversaFicticia = { id: string; contatoId: string; nome: string; telefone: string | null; canal: CanalFicticio; classificacao: 'cliente' | 'lead'; estado: EstadoConversaFicticia; responsavelId: string | null; equipeId: string | null; tags: string[]; versao: number; naoLidas: number; pendentesResposta: number; notas: { id: string; autorId: string; texto: string; criadaEm: string }[]; rascunho: { texto: string; versao: number }; lembrete: null | { id: string; agendadoPara: string; descricao: string; versao: number; criadoPorId: string; criadoPorNome: string } };

const minutos = (agora: Date, m: number) => new Date(agora.getTime() - m * 60000).toISOString();

export function conversasFicticias(agora: Date): { conversas: ConversaFicticia[]; mensagens: MensagemFicticia[] } {
  const conversa = (id: string, nome: string, canal: CanalFicticio, estado: EstadoConversaFicticia, extra: Partial<ConversaFicticia> = {}): ConversaFicticia => ({ id: `demo-conversa-${id}`, contatoId: `demo-contato-${id}`, nome, telefone: null, canal, classificacao: 'lead', estado, responsavelId: null, equipeId: EQUIPE_FICTICIA.id, tags: [], versao: 1, naoLidas: 0, pendentesResposta: 0, notas: [], rascunho: { texto: '', versao: 0 }, lembrete: null, ...extra });
  const cliente = (conversa: string, n: number, texto: string, m: number): MensagemFicticia => ({ id: `demo-msg-${conversa}-${n}`, conversaId: `demo-conversa-${conversa}`, autor: 'cliente', autorId: null, autorNome: null, conteudo: texto, tipo: 'text', estado: 'recebido', criadaEm: minutos(agora, m), anexoId: null, citadaId: null });
  const equipe = (conversa: string, n: number, texto: string, m: number, autor: 'humano' | 'ia' = 'humano'): MensagemFicticia => ({ id: `demo-msg-${conversa}-${n}`, conversaId: `demo-conversa-${conversa}`, autor, autorId: autor === 'ia' ? 'donatella' : COLEGA_FICTICIO.id, autorNome: autor === 'ia' ? 'Donatella' : COLEGA_FICTICIO.nome, conteudo: texto, tipo: 'text', estado: 'aceito_simulado', criadaEm: minutos(agora, m), anexoId: null, citadaId: null });
  return {
    conversas: [
      conversa('marina', 'Marina Exemplo', 'whatsapp', 'humano', { telefone: '+55 00 00000-0001', classificacao: 'cliente', responsavelId: USUARIO_FICTICIO.id, tags: ['entrega'], naoLidas: 1, pendentesResposta: 1 }),
      conversa('rafael', 'Rafael Exemplo', 'instagram', 'ia', { naoLidas: 1, pendentesResposta: 1 }),
      conversa('bruno', 'Bruno Exemplo', 'whatsapp', 'pausado', { telefone: '+55 00 00000-0002' }),
      conversa('joana', 'Joana Exemplo', 'whatsapp', 'encerrada', { telefone: '+55 00 00000-0003', classificacao: 'cliente' }),
    ],
    mensagens: [
      cliente('marina', 1, 'Oi! Vocês entregam no domingo?', 50),
      equipe('marina', 2, 'Oi, Marina! Entregamos, sim. Para qual bairro seria?', 45),
      cliente('marina', 3, 'É no centro. Dá para receber até as 11h?', 5),
      cliente('rafael', 1, 'Quanto custa a tábua para 10 pessoas?', 180),
      equipe('rafael', 2, 'Para 10 pessoas, o catálogo de exemplo tem a Tábua Exemplo G. O preço atualizado aparece no site.', 179, 'ia'),
      cliente('rafael', 3, 'Vocês fazem versão sem lactose?', 170),
      cliente('bruno', 1, 'Vou ver com a minha esposa e te falo.', 60 * 26),
      equipe('bruno', 2, 'Combinado, Bruno! Fico no aguardo.', 60 * 26 - 3),
      cliente('joana', 1, 'Chegou tudo certinho, obrigada!', 60 * 48),
      equipe('joana', 2, 'Que bom, Joana! Obrigado pela preferência.', 60 * 48 - 4),
    ],
  };
}

/** Fontes de exemplo. As cinco primeiras entram aprovadas e as duas últimas
 * ficam pendentes, para treinar a aprovação no painel. */
export const FONTES_FICTICIAS: { pergunta: string; resposta: string; categoria: 'produto' | 'procedimento' | 'politica'; aprovada: boolean }[] = [
  { pergunta: 'Vocês entregam aos domingos e feriados?', resposta: 'Texto de exemplo: entregamos todos os dias, inclusive domingos e feriados, nas datas que aparecem disponíveis no site.', categoria: 'procedimento', aprovada: true },
  { pergunta: 'Como funciona o parcelamento no cartão?', resposta: 'Texto de exemplo: as opções de parcelamento aparecem na finalização do pedido no site, conforme o valor da compra.', categoria: 'politica', aprovada: true },
  { pergunta: 'Posso trocar itens da tábua?', resposta: 'Texto de exemplo: a personalização depende das opções mostradas no catálogo. Se a opção não aparecer, a equipe confere antes de confirmar.', categoria: 'produto', aprovada: true },
  { pergunta: 'Qual a diferença entre a Tábua Exemplo P e a Tábua Exemplo G?', resposta: 'Texto de exemplo: a Tábua Exemplo P serve até 4 pessoas e a Tábua Exemplo G serve até 10 pessoas.', categoria: 'produto', aprovada: true },
  { pergunta: 'Como faço para cancelar um pedido?', resposta: 'Texto de exemplo: pedidos são cancelados pela equipe de atendimento, que confere o prazo antes de confirmar.', categoria: 'politica', aprovada: true },
  { pergunta: 'Vocês emitem nota fiscal?', resposta: 'Texto de exemplo: a nota fiscal é enviada junto com a confirmação do pedido.', categoria: 'procedimento', aprovada: false },
  { pergunta: 'Atendem eventos corporativos?', resposta: 'Texto de exemplo: eventos corporativos são orçados pela equipe comercial.', categoria: 'procedimento', aprovada: false },
];
