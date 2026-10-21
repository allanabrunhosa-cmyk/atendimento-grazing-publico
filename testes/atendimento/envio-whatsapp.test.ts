import {afterEach,describe,it,expect,vi} from 'vitest';
import {enviarTextoWhatsApp,processarEnvioTexto,type DiarioEnvio} from '../../src/lib/atendimento/envio-whatsapp';
vi.mock('server-only',()=>({}));
const pedido={id:'11111111-1111-4111-8111-111111111111',destinatario:'5511999999999',texto:'TESTE FICTICIO'},config={token:'TOKEN_FICTICIO',numeroId:'123456789012345',versao:'v23.0',modo:'homologacao' as const,destinatariosAutorizados:[pedido.destinatario]};
const habilitar=()=>{vi.stubEnv('ATENDIMENTO_ENVIO_HABILITADO','true');vi.stubEnv('ATENDIMENTO_AUTORIDADE_ENVIO','vps');};
afterEach(()=>vi.unstubAllEnvs());
describe('envio com autoridade fechada e incerteza preservada',()=>{
 it('recusa autoridade ausente, destinatario e permissao antes de chamar Meta',async()=>{
  const f=vi.fn();await expect(enviarTextoWhatsApp(pedido,config,async()=>true,f)).rejects.toThrow('ENVIO_DESABILITADO');habilitar();
  await expect(enviarTextoWhatsApp(pedido,{...config,destinatariosAutorizados:[]},async()=>true,f)).rejects.toThrow('DESTINATARIO_NAO_AUTORIZADO');
  await expect(enviarTextoWhatsApp(pedido,config,async()=>false,f)).rejects.toThrow('ENVIO_ACESSO_REVOGADO');expect(f).not.toHaveBeenCalled();
 });
 it('preserva correlacao de resposta; aceite nao e entrega',async()=>{
  habilitar();const f=vi.fn(async()=>new Response(JSON.stringify({messaging_product:'whatsapp',messages:[{id:'wamid.FICTICIO'}]}),{status:200}));
  expect(await enviarTextoWhatsApp({...pedido,respostaA:'wamid.ORIGINAL'},config,async()=>true,f)).toEqual({estado:'aceito',wamid:'wamid.FICTICIO'});
  const opts=f.mock.calls[0] as unknown as [string,RequestInit];expect(opts[0]).toBe('https://graph.facebook.com/v23.0/123456789012345/messages');expect(JSON.parse(String(opts[1].body)).context).toEqual({message_id:'wamid.ORIGINAL'});
 });
 it.each([()=>{throw Error('TOKEN_FICTICIO payload privado');},()=>new Response('erro',{status:500}),()=>new Response('{}',{status:200}),()=>new Response('nao JSON',{status:400})])('nao repete chamada ambigua nem expoe payload',async r=>{
  habilitar();const f=vi.fn(async()=>r());expect(await enviarTextoWhatsApp(pedido,config,async()=>true,f)).toEqual({estado:'incerto',codigo:'META_RESULTADO_DESCONHECIDO'});expect(f).toHaveBeenCalledTimes(1);
 });
 it('registra somente codigo de recusa explicita',async()=>{habilitar();expect(await enviarTextoWhatsApp(pedido,config,async()=>true,async()=>new Response(JSON.stringify({error:{code:131047,message:'DADO PRIVADO'}}),{status:400}))).toEqual({estado:'recusado',http:400,codigo:131047});});
 it('retomada apos aceite e falha local nao dispara novamente',async()=>{
  habilitar();const ids=new Set<string>(),d:DiarioEnvio={iniciar:async p=>{if(ids.has(p.id))return 'ja_registrada';ids.add(p.id);return 'nova';},concluir:async()=>{throw Error('PERSISTENCIA_FICTICIA_INTERROMPIDA');}},f=vi.fn(async()=>new Response(JSON.stringify({messaging_product:'whatsapp',messages:[{id:'wamid.FICTICIO'}]})));
  await expect(processarEnvioTexto(pedido,config,d,async()=>true,f)).rejects.toThrow('PERSISTENCIA_FICTICIA_INTERROMPIDA');expect(await processarEnvioTexto(pedido,config,d,async()=>true,f)).toEqual({estado:'reconciliacao_necessaria'});expect(f).toHaveBeenCalledTimes(1);
 });
});
