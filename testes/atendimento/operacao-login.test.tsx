// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PainelAcesso } from '../../src/app/login/painel-acesso';
import { iniciarLoginOperacao, loginHtml, loginJs, loginTemaCss } from '../../scripts/atendimento/operacao-login';

afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

// A página é estática, sem hidratação. Testar o mesmo DOM servido evita instalar
// handlers React que não existem na VPS e disputariam a visibilidade da senha.
function montar() { document.body.innerHTML = loginHtml().match(/<body[^>]*>([\s\S]*)<\/body>/)![1]; }

function entrada(buscar = vi.fn<typeof fetch>(async () => new Response('{}', { status: 401 })), busca = '') {
  montar();
  const navegar = vi.fn<(destino: string) => void>();
  iniciarLoginOperacao(document, { buscar, navegar, busca });
  const email = screen.getByLabelText('E-mail') as HTMLInputElement;
  const senha = screen.getByLabelText('Senha') as HTMLInputElement;
  fireEvent.change(email, { target: { value: 'operador@example.invalid' } });
  fireEvent.change(senha, { target: { value: 'senha-ficticia' } });
  return { buscar, navegar, email, senha, form: document.getElementById('login') as HTMLFormElement, entrar: screen.getByRole('button', { name: 'Entrar' }) };
}

it('reutiliza a estrutura do HUB com identidade e textos próprios do Atendimento', () => {
  montar();
  expect(screen.getByText('Atendimento')).toBeTruthy();
  expect(screen.getByText('Entre com sua conta do Grazing HUB para acessar suas conversas e atendimentos.')).toBeTruthy();
  expect(screen.getByText('Acesso exclusivo à sua operação')).toBeTruthy();
  expect(document.querySelector('.marca-acesso-atendimento svg text')?.textContent).toBe('GA');
  expect(screen.getByRole('img', { name: 'Grazing Atendimento' })).toBeTruthy();
  expect(document.querySelector('.marca-acesso-hub')).toBeNull();
  expect(document.querySelector('[data-slot="card"]')).toBeTruthy();
  expect(screen.getByLabelText('E-mail').getAttribute('data-slot')).toBe('input');
  expect(screen.getByLabelText('E-mail').getAttribute('maxlength')).toBe('254');
  expect(screen.getByLabelText('Senha').getAttribute('maxlength')).toBe('128');
  expect(screen.getByLabelText('Senha').getAttribute('autocomplete')).toBe('current-password');
  expect(document.querySelector('#login')?.getAttribute('method')).toBe('post');
  expect(document.querySelector('#login')?.getAttribute('action')).toBe('/api/atendimento/operacao/login');
  expect(screen.getByRole('button', { name: 'Entrar' }).getAttribute('data-slot')).toBe('button');
  expect(screen.getByRole('link', { name: 'Esqueci minha senha' }).getAttribute('href')).toBe('https://grazinghub.com.br/login/recuperar');
});

it('entrega página clara, idioma correto e script/CSS de login independentes do Chat protegido', () => {
  const html = loginHtml();
  expect(html).toContain('<html lang="pt-BR" class="h-full antialiased light" data-identidade="atendimento">');
  expect(html).toContain('href="/operacao/login.css"');
  expect(html).toContain('src="/operacao/login.js"');
  expect(html).not.toContain('<style>');
  expect(html).not.toContain('/operacao/assets/');
  expect(html).not.toContain('preparação operacional');
  const runtime = readFileSync('scripts/atendimento/operacao-runtime.ts', 'utf8');
  expect(runtime.indexOf('if(arquivosLogin[u.pathname]')).toBeLessThan(runtime.indexOf('const i=await auth.autenticar(req);if(!i){res.writeHead(303,{Location:\'/operacao/login\'+'));
  expect(runtime).toContain("'/operacao/login.css':['login.css','text/css; charset=utf-8']");
  expect(runtime).toContain("'/operacao/login.js':['login.js','text/javascript; charset=utf-8']");
  expect(runtime).toContain("'/operacao/login':['login.html','text/html; charset=utf-8']");
  expect(runtime).not.toContain("from './operacao-login'");
  expect(runtime).not.toContain("u.pathname.startsWith('/operacao/login-assets/')");
});

it('isola a identidade roxa sem publicar tema global no HUB', () => {
  const css = loginTemaCss();
  expect(css).toContain('html.light[data-identidade="atendimento"]');
  expect(css).toContain('--primary: #6200d6');
  expect(css).toContain('--brand-navy: #210954');
  expect(css).not.toContain(':root');
  expect(css).not.toContain('data-identidade="hub"');
});

it('preserva as marcas existentes no painel padrão dos outros sistemas', () => {
  const html = renderToStaticMarkup(<PainelAcesso titulo="Entrada padrão" descricao="Descrição">{null}</PainelAcesso>);
  expect(html).toContain('marca-acesso-hub');
  expect(html).toContain('marca-acesso-pedidos');
  expect(html).toContain('marca-acesso-etiquetas');
  expect(html).not.toContain('marca-acesso-atendimento');
});

it('mostrar e ocultar usa os ícones reais, mantém o valor e não envia credenciais', () => {
  const { senha, buscar } = entrada();
  const mostrar = screen.getByRole('button', { name: 'Mostrar senha' });
  expect(mostrar.getAttribute('aria-controls')).toBe('senha');
  fireEvent.click(mostrar);
  expect(senha.type).toBe('text');
  expect(senha.value).toBe('senha-ficticia');
  expect(screen.getByRole('button', { name: 'Ocultar senha' }).getAttribute('aria-pressed')).toBe('true');
  expect(mostrar.querySelector('.lucide-eye-off')).toBeTruthy();
  fireEvent.click(mostrar);
  expect(senha.type).toBe('password');
  expect(mostrar.getAttribute('aria-label')).toBe('Mostrar senha');
  expect(mostrar.querySelector('.lucide-eye')).toBeTruthy();
  expect(buscar).not.toHaveBeenCalled();
});

it('pendência impede duplicação, oculta a senha e desabilita campos e botão de visibilidade', async () => {
  let responder!: (r: Response) => void;
  const buscar = vi.fn<typeof fetch>(() => new Promise(resolve => { responder = resolve; }));
  const { form, senha, email, entrar } = entrada(buscar);
  fireEvent.click(screen.getByRole('button', { name: 'Mostrar senha' }));
  fireEvent.submit(form);
  expect(senha.type).toBe('password');
  expect(form.getAttribute('aria-busy')).toBe('true');
  expect(email.disabled && senha.disabled && (entrar as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('button', { name: 'Mostrar senha' })).toHaveProperty('disabled', true);
  expect(screen.getByRole('button', { name: 'Entrando...' }).querySelector('svg.animate-spin')).toBeTruthy();
  fireEvent.submit(form);
  expect(buscar).toHaveBeenCalledTimes(1);
  expect(buscar.mock.calls[0]).toEqual(['/api/atendimento/operacao/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ email: 'operador@example.invalid', senha: 'senha-ficticia' }) }]);
  responder(new Response('{}', { status: 401 }));
  await screen.findByRole('alert');
  expect(form.getAttribute('aria-busy')).toBe('false');
  expect(email.disabled || senha.disabled || (entrar as HTMLButtonElement).disabled).toBe(false);
  expect(senha.value).toBe('');
  expect(email.value).toBe('operador@example.invalid');
});

it.each([400, 401, 403, 429, 503])('erro HTTP %s permanece genérico, permite nova tentativa e não redireciona', async status => {
  const { form, navegar, buscar, senha } = entrada(vi.fn<typeof fetch>(async () => new Response('{"erro":"detalhe-privado-ficticio"}', { status })));
  fireEvent.submit(form);
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Não foi possível entrar. Confira o acesso ou aguarde antes de tentar novamente.'));
  expect(document.body.textContent).not.toContain('detalhe-privado-ficticio');
  expect(navegar).not.toHaveBeenCalled();
  fireEvent.change(senha, { target: { value: 'outra-senha-ficticia' } });
  fireEvent.submit(form);
  await waitFor(() => expect(buscar).toHaveBeenCalledTimes(2));
});

it('falha de rede devolve o botão e limpa a senha sem expor detalhes do erro', async () => {
  const { form, navegar, senha } = entrada(vi.fn<typeof fetch>(async () => { throw Error('falha-ficticia'); }));
  fireEvent.submit(form);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Entrar' })).toHaveProperty('disabled', false));
  expect(screen.getByRole('alert').textContent).toContain('Não foi possível entrar.');
  expect(senha.value).toBe('');
  expect(navegar).not.toHaveBeenCalled();
});

it.each([['', '/operacao/chat'], ['?ambiente=ensaio', '/operacao/chat?ambiente=ensaio'], ['?retorno=https://externo.invalid/&ambiente=outro', '/operacao/chat']])('sucesso preserva exclusivamente o ambiente autorizado: %s', async (busca, destino) => {
  const { form, navegar, senha } = entrada(vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 })), busca);
  fireEvent.submit(form);
  await waitFor(() => expect(navegar).toHaveBeenCalledWith(destino));
  expect(senha.value).toBe('');
  expect(screen.queryByRole('alert')).toBeNull();
});

it('campos inválidos não iniciam nenhuma requisição', () => {
  const { form, email, buscar } = entrada();
  fireEvent.change(email, { target: { value: 'sem-arroba' } });
  fireEvent.submit(form);
  expect(buscar).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Entrar' })).toHaveProperty('disabled', false);
});

it('o script externo serializado funciona com o HTML servido sem hidratação React', async () => {
  montar();
  const buscar = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }));
  const destino = { href: '', search: '?ambiente=ensaio' };
  new Function('document', 'fetch', 'location', loginJs)(document, buscar, destino);
  const email = document.getElementById('email') as HTMLInputElement;
  const senha = document.getElementById('senha') as HTMLInputElement;
  email.value = 'operador@example.invalid'; senha.value = 'senha-ficticia';
  fireEvent.click(screen.getByRole('button', { name: 'Mostrar senha' }));
  expect(senha.type).toBe('text');
  fireEvent.submit(document.getElementById('login')!);
  await waitFor(() => expect(destino.href).toBe('/operacao/chat?ambiente=ensaio'));
  expect(buscar).toHaveBeenCalledTimes(1);
  document.body.innerHTML = '';
});
