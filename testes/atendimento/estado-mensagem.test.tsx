// @vitest-environment jsdom
import {afterEach,it,expect} from 'vitest';
import {render,screen,cleanup} from '@testing-library/react';
import EstadoMensagem from '../../apps/atendimento-chat-consulta/EstadoMensagem';
import type {MensagemOperacao} from '../../apps/atendimento-chat-consulta/operacao-api';
afterEach(cleanup);
const mensagem={id:'fixture',autor:'humano',estado:'recusado',falhaCodigo:'META_400_131047'} as MensagemOperacao;
it('mostra exclamação, texto e causa no aviso acessível',()=>{render(<EstadoMensagem mensagem={mensagem}/>);const aviso=screen.getByRole('img',{name:/Não enviada.*24 horas/});expect(aviso.querySelector('svg.lucide-circle-alert')).toBeTruthy();expect(aviso.getAttribute('title')).toContain('24 horas');expect(aviso.getAttribute('tabindex')).toBe('0');expect(aviso.className).toContain('mensagem-nao-enviada');});
it('distingue ausência de confirmação de recusa e entrega',()=>{const {rerender}=render(<EstadoMensagem mensagem={{...mensagem,estado:'incerto'}}/>);expect(screen.getByRole('img',{name:/Envio sem confirmação/})).toBeTruthy();rerender(<EstadoMensagem mensagem={{...mensagem,estado:'entregue'}}/>);expect(screen.queryByRole('img')).toBeNull();expect(screen.getByLabelText('Estado da mensagem: entregue')).toBeTruthy();});
it.each(['cancelado','cancelled'])('envio interrompido exibe aviso e causa no hover para %s',estado=>{render(<EstadoMensagem mensagem={{...mensagem,estado,falhaCodigo:'CONTEXTO_OU_ACESSO_REVOGADO'}}/>);const aviso=screen.getByRole('img',{name:/Não enviada.*atendimento mudou.*permissão de envio foi revogada/});expect(aviso.querySelector('svg.lucide-circle-alert')).toBeTruthy();expect(aviso.getAttribute('title')).toBe('O envio foi interrompido porque o atendimento mudou ou a permissão de envio foi revogada.');expect(aviso.className).toContain('mensagem-nao-enviada');expect(aviso.className).not.toContain('envio-incerto');});
