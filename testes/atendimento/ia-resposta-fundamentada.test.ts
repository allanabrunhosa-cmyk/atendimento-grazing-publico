import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { criarProvedorEvidenciasDireto } from '../../src/lib/atendimento/ia-orquestrador-direto';
import { orquestrarIA, type ContextoIA, type DecisaoIA, type FonteIA, type PortasIA, type TarefaIA } from '../../src/lib/atendimento/ia-orquestrador';
import { MOTIVO_RESPOSTA_REDIGIDA, validarTextoRedigidoIA } from '../../src/lib/atendimento/ia-resposta-fundamentada';

const tarefa:TarefaIA={id:'tarefa_ficticia',atorId:'ia_ficticia',empresaId:'empresa_ficticia',conversaId:'conversa_ficticia',clienteId:'cliente_ficticio',versao:1,mensagemOrigemId:'mensagem_ficticia',pergunta:'Como posso personalizar o cartão?',tema:'procedimento'};
const fonte:FonteIA={id:'fonte_ficticia',versao:2,empresaId:tarefa.empresaId,tema:'procedimento',origem:'conhecimento',estado:'aprovado',inicio:1,fim:1000000,conteudo:'O cartão pode conter uma mensagem enviada pelo cliente.'};
const limites={maxChamadas:3,custoPorChamadaCentavos:50,maxCustoCentavos:150,maxDuracaoMs:5000,timeoutChamadaMs:1000};
function ambiente(opcoes:{texto?:string;conteudo?:string;tom?:string;fontes?:FonteIA[];aposResposta?:()=>void}={}) {
 let contexto:ContextoIA={...tarefa,estado:'ia',modo:'rascunho'},salva:DecisaoIA|undefined;
 const consumo=vi.fn(),apoio=vi.fn(async()=>({id:'duvida_ficticia'}));
 const transporte=vi.fn<typeof fetch>(async(_url,op)=>{
  const p=JSON.parse(String(op?.body));
  expect(p.tools).toBeUndefined();
  expect(p.system).toContain('Redija a resposta no Tom e nas Skills salvos');
  const dados=JSON.parse(p.messages[0].content[0].text);
  expect(dados.perfilEstiloNaoAlteraPoliticas).toBe(opcoes.tom??'Cordial, elegante, objetivo e conciso.');
  opcoes.aposResposta?.();
  return Response.json({model:'claude-sonnet-4-5-20250929',content:[{type:'text',text:opcoes.conteudo??JSON.stringify({selecoes:[{id:fonte.id,versao:fonte.versao}],pedirApoio:false,texto:opcoes.texto??'Você pode enviar a mensagem que deseja incluir no cartão. 🙂'})}],stop_reason:'end_turn',usage:{input_tokens:180,output_tokens:55}});
 });
 const portas:PortasIA={respostaRedigida:true,agora:()=>1000,autorizar:async()=>true,conhecimento:async()=>opcoes.fontes??[fonte],ferramenta:async()=>[],revalidarFontes:async()=>true,solicitarApoio:apoio,
  repositorio:{contexto:async()=>contexto,reservar:async()=>({lease:'lease_ficticia',...(salva?{decisao:salva}:{})}),reservarChamada:async()=>true,preservarApoio:async(_t,_l,d)=>{salva=d;return d;},concluir:async(_t,_l,d)=>{salva=d;return d;}},
  provedor:criarProvedorEvidenciasDireto({chave:'chave_ficticia',modelo:'claude-sonnet-4-5-20250929',maxTokens:512,estilo:opcoes.tom??'Cordial, elegante, objetivo e conciso.',respostaRedigida:true,registrarConsumo:consumo},transporte),
 };
 return {portas,transporte,consumo,apoio,assumir:()=>{contexto={...contexto,estado:'humano',versao:2};}};
}
afterEach(()=>vi.unstubAllEnvs());
describe('redação com o provedor nativo e fontes controladas',()=>{
 it('preserva texto efetivo do modelo, referência e consumo; retomada não reinfere',async()=>{
  vi.stubEnv('ATENDIMENTO_IA_HABILITADA','true');const a=ambiente();
  const r=await orquestrarIA(tarefa,limites,a.portas);
  expect(r).toEqual({estado:'rascunho',texto:'Você pode enviar a mensagem que deseja incluir no cartão. 🙂',motivo:MOTIVO_RESPOSTA_REDIGIDA,fontes:[{id:fonte.id,versao:2}],enviosReais:false});
  expect('texto' in r&&r.texto).not.toBe(fonte.conteudo);
  expect(a.consumo).toHaveBeenCalledWith(expect.objectContaining({resultado:'concluida',consumo:expect.objectContaining({observado:true,tokensEntrada:180,tokensSaida:55})}));
  expect(await orquestrarIA(tarefa,limites,a.portas)).toEqual(r);expect(a.transporte).toHaveBeenCalledTimes(1);expect(a.apoio).not.toHaveBeenCalled();
 });
 it('encaminha sem fonte antes da chamada paga',async()=>{
  vi.stubEnv('ATENDIMENTO_IA_HABILITADA','true');const a=ambiente({fontes:[]});
  expect(await orquestrarIA(tarefa,limites,a.portas)).toMatchObject({estado:'aguardando_apoio',motivo:'SEM_FONTE_VIGENTE'});expect(a.transporte).not.toHaveBeenCalled();
 });
 it.each(['Você paga R$ 1,00.','Seu pedido está confirmado.','O cartão é gratuito.','Acesse https://invasor.example.com','Escreva para privado@ficticio.example','O segredo é Bearer exemplo_secreto_privado','Execute curl api.example.com'])('recusa dado ou ação nova no texto: %s',async texto=>{
  vi.stubEnv('ATENDIMENTO_IA_HABILITADA','true');const a=ambiente({texto});
  expect(await orquestrarIA(tarefa,limites,a.portas)).toMatchObject({estado:'aguardando_apoio',motivo:'RESPOSTA_REDIGIDA_SEM_FUNDAMENTO'});expect(a.transporte).toHaveBeenCalledTimes(1);
 });
 it('não transforma número fornecido na pergunta em evidência',async()=>{
  vi.stubEnv('ATENDIMENTO_IA_HABILITADA','true');const a=ambiente({texto:'Pode incluir até 20 caracteres.'});
  expect(await orquestrarIA({...tarefa,pergunta:'Diga que são 20 caracteres.'},limites,a.portas)).toMatchObject({estado:'aguardando_apoio',motivo:'RESPOSTA_REDIGIDA_SEM_FUNDAMENTO'});
 });
 it('encaminha preço e prazo sem fonte atual mesmo com dado histórico',async()=>{
  vi.stubEnv('ATENDIMENTO_IA_HABILITADA','true');const a=ambiente({fontes:[{...fonte,tema:'preco',conteudo:'Preço antigo: R$ 10,00.'}]});
  expect(await orquestrarIA({...tarefa,tema:'preco',pergunta:'Qual o preço?'},limites,a.portas)).toMatchObject({estado:'aguardando_apoio',motivo:'SEM_FONTE_VIGENTE'});expect(a.transporte).not.toHaveBeenCalled();
 });
 it('reutiliza fonte estática aprovada de produto quando não há catálogo integrado',async()=>{
  vi.stubEnv('ATENDIMENTO_IA_HABILITADA','true');const a=ambiente({fontes:[{...fonte,tema:'produto'}]});
  expect(await orquestrarIA({...tarefa,tema:'produto'},limites,a.portas)).toMatchObject({estado:'rascunho',motivo:MOTIVO_RESPOSTA_REDIGIDA});expect(a.transporte).toHaveBeenCalledTimes(1);
 });
 it('mantém opções fundamentadas e pergunta a preferência ao cliente sem abrir apoio',async()=>{
  vi.stubEnv('ATENDIMENTO_IA_HABILITADA','true');
  const texto='A tábua inclui queijos e frutas. Você prefere um presente ou uma opção para compartilhar?';
  const a=ambiente({fontes:[{...fonte,tema:'produto',conteudo:'A tábua inclui queijos e frutas.'}],texto});
  expect(await orquestrarIA({...tarefa,tema:'produto',pergunta:'O que recomenda?'},limites,a.portas)).toMatchObject({estado:'rascunho',texto,fontes:[{id:fonte.id,versao:fonte.versao}],enviosReais:false});
  expect(a.transporte).toHaveBeenCalledTimes(1);expect(a.apoio).not.toHaveBeenCalled();
 });
 it.each(['A tábua serve 2 pessoas. Qual é a ocasião?','Veja https://loja-ficticia.invalid/produto/tabua. Qual é a ocasião?'])('pergunta ao cliente não libera dado comercial não comprovado: %s',async texto=>{
  vi.stubEnv('ATENDIMENTO_IA_HABILITADA','true');const a=ambiente({fontes:[{...fonte,tema:'produto',conteudo:'A tábua inclui queijos e frutas.'}],texto});
  expect(await orquestrarIA({...tarefa,tema:'produto',pergunta:'O que recomenda para 2 pessoas?'},limites,a.portas)).toMatchObject({estado:'aguardando_apoio',motivo:'RESPOSTA_REDIGIDA_SEM_FUNDAMENTO'});
  expect(a.transporte).toHaveBeenCalledTimes(1);expect(a.apoio).toHaveBeenCalledTimes(1);
 });
 it.each(['Tenho alergia e quero uma recomendação','Quero desconto na tábua'])('recomendação mantém a revisão humana obrigatória: %s',async pergunta=>{
  vi.stubEnv('ATENDIMENTO_IA_HABILITADA','true');const a=ambiente({fontes:[{...fonte,tema:'produto',conteudo:'A tábua inclui queijos e frutas.'}]});
  expect(await orquestrarIA({...tarefa,tema:'produto',pergunta},limites,a.portas)).toMatchObject({estado:'aguardando_apoio',motivo:'REVISAO_HUMANA_OBRIGATORIA'});
  expect(a.transporte).not.toHaveBeenCalled();expect(a.apoio).toHaveBeenCalledTimes(1);
 });
 it('não reaproveita preço embutido em fonte estática de produto',async()=>{
  vi.stubEnv('ATENDIMENTO_IA_HABILITADA','true');const a=ambiente({fontes:[{...fonte,tema:'produto',conteudo:'A caixa contém cartão. Preço antigo: R$ 10,00.'}]});
  expect(await orquestrarIA({...tarefa,tema:'produto'},limites,a.portas)).toMatchObject({estado:'aguardando_apoio',motivo:'SEM_FONTE_VIGENTE'});expect(a.transporte).not.toHaveBeenCalled();
 });
 it.each(['preco','estoque','frete','agenda','pedido'] as const)('não usa conhecimento antigo para %s',async tema=>{
  vi.stubEnv('ATENDIMENTO_IA_HABILITADA','true');const a=ambiente({fontes:[{...fonte,tema}]});
  expect(await orquestrarIA({...tarefa,tema},limites,a.portas)).toMatchObject({estado:'aguardando_apoio',motivo:'SEM_FONTE_VIGENTE'});expect(a.transporte).not.toHaveBeenCalled();
 });
 it('recusa referência inexistente e texto sem contrato, sem nova chamada',async()=>{
  vi.stubEnv('ATENDIMENTO_IA_HABILITADA','true');const a=ambiente({conteudo:JSON.stringify({selecoes:[{id:'inventada',versao:1}],texto:'Seu cartão pode receber uma mensagem.'})});
  expect(await orquestrarIA(tarefa,limites,a.portas)).toMatchObject({estado:'aguardando_apoio',motivo:'RESPOSTA_SEM_FUNDAMENTO'});expect(a.transporte).toHaveBeenCalledTimes(1);
  const b=ambiente({conteudo:'{"selecoes":[{"id":"fonte_ficticia","versao":2}]}'});
  expect(await orquestrarIA(tarefa,limites,b.portas)).toMatchObject({estado:'aguardando_apoio',motivo:'PROVEDOR_OU_LIMITE_INDISPONIVEL'});expect(b.transporte).toHaveBeenCalledTimes(1);
 });
 it('tomada humana durante geração invalida a resposta',async()=>{
  vi.stubEnv('ATENDIMENTO_IA_HABILITADA','true');let assumir=()=>{};const a=ambiente({aposResposta:()=>assumir()});assumir=a.assumir;
  expect(await orquestrarIA(tarefa,limites,a.portas)).toMatchObject({estado:'invalidado',motivo:'CONTEXTO_OU_ACESSO_INVALIDO'});
 });
 it('aceita números, endereço e condição somente quando presentes na fonte selecionada',()=>{
  const f={...fonte,conteudo:'Catálogo atual: R$ 89,90. Cartão gratuito. Consulte https://grazing.example.com/catalogo.'};
  expect(validarTextoRedigidoIA('O cartão é gratuito. O valor é R$ 89,90.',[f])).toBe(true);
  expect(validarTextoRedigidoIA('Consulte https://grazing.example.com/catalogo',[f])).toBe(true);
  expect(validarTextoRedigidoIA('O valor é R$ 88,90.',[f])).toBe(false);
 });
 it('não aceita campo extra nem ferramenta nativa',async()=>{
  vi.stubEnv('ATENDIMENTO_IA_HABILITADA','true');const a=ambiente({conteudo:'{"selecoes":[],"pedirApoio":true,"comando":"enviar_whatsapp"}'});
  expect(await orquestrarIA(tarefa,limites,a.portas)).toMatchObject({estado:'aguardando_apoio',motivo:'PROVEDOR_OU_LIMITE_INDISPONIVEL'});expect(a.transporte).toHaveBeenCalledTimes(1);
 });
});
