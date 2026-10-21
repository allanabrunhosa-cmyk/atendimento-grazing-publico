import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EyeOff, Loader2 } from 'lucide-react';
import { PainelAcesso } from '../../src/app/login/painel-acesso';
import { Input } from '../../src/components/ui/input';
import { Label } from '../../src/components/ui/label';
import { Button } from '../../src/components/ui/button';
import { CampoSenha } from '../../src/components/campo-senha';
import { IDENTIDADE_PREVIEW } from '../../apps/atendimento/preview/identidade';

/** A entrada isolada usa a mesma composição do HUB; autenticação continua na VPS. */
export function LoginOperacao() {
  return <PainelAcesso marca="atendimento" titulo="Atendimento" descricao="Entre com sua conta do Grazing HUB para acessar suas conversas e atendimentos.">
    <form id="login" method="post" action="/api/atendimento/operacao/login" className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="email">E-mail</Label>
        <Input id="email" name="email" type="email" autoComplete="username" placeholder="voce@empresa.com.br" maxLength={254} required autoFocus />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="senha">Senha</Label>
        <CampoSenha id="senha" name="senha" autoComplete="current-password" maxLength={128} required />
        <div className="pt-1 text-right"><a href="https://grazinghub.com.br/login/recuperar" className="rounded text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">Esqueci minha senha</a></div>
      </div>
      <p id="aviso" role="alert" hidden className="rounded-md bg-destructive/10 p-2 text-center text-sm text-destructive" />
      <Button id="entrar" type="submit" className="w-full"><span id="texto-entrar">Entrar</span></Button>
    </form>
    <template id="icone-senha-oculta"><EyeOff className="size-5" /></template>
    <template id="icone-entrando"><Loader2 className="size-4 animate-spin" /></template>
  </PainelAcesso>;
}

type ServicosLogin = {
  buscar: typeof fetch;
  navegar: (destino: string) => void;
  busca: string;
};

/** Serializável para um script externo, permitido pela CSP sem hidratar a aplicação. */
export function iniciarLoginOperacao(documento: Document, servicos: ServicosLogin) {
  const form = documento.getElementById('login') as HTMLFormElement | null;
  const email = documento.getElementById('email') as HTMLInputElement | null;
  const senha = documento.getElementById('senha') as HTMLInputElement | null;
  const entrar = documento.getElementById('entrar') as HTMLButtonElement | null;
  const texto = documento.getElementById('texto-entrar');
  const aviso = documento.getElementById('aviso');
  const visibilidade = documento.querySelector<HTMLButtonElement>('button[aria-controls="senha"]');
  const ocultar = documento.getElementById('icone-senha-oculta') as HTMLTemplateElement | null;
  const entrando = documento.getElementById('icone-entrando') as HTMLTemplateElement | null;
  if (!form || !email || !senha || !entrar || !texto || !aviso || !visibilidade || !ocultar || !entrando) return;
  const olho = visibilidade.firstElementChild?.cloneNode(true);
  let pendente = false;
  function esconderSenha() {
    senha!.type = 'password';
    visibilidade!.setAttribute('aria-label', 'Mostrar senha');
    visibilidade!.setAttribute('aria-pressed', 'false');
    if (olho) visibilidade!.replaceChildren(olho.cloneNode(true));
  }
  visibilidade.addEventListener('click', () => {
    if (pendente) return;
    if (senha.type === 'text') esconderSenha();
    else {
      senha.type = 'text';
      visibilidade.setAttribute('aria-label', 'Ocultar senha');
      visibilidade.setAttribute('aria-pressed', 'true');
      const icone = ocultar.content.firstElementChild;
      if (icone) visibilidade.replaceChildren(icone.cloneNode(true));
    }
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (pendente || !form.reportValidity()) return;
    pendente = true;
    const dados = { email: email.value, senha: senha.value };
    esconderSenha();
    email.disabled = senha.disabled = entrar.disabled = visibilidade.disabled = true;
    form.setAttribute('aria-busy', 'true');
    texto.textContent = 'Entrando...';
    const icone = entrando.content.firstElementChild?.cloneNode(true);
    if (icone) entrar.prepend(icone);
    aviso.hidden = false;
    aviso.className = 'sr-only';
    aviso.setAttribute('role', 'status');
    aviso.textContent = 'Conferindo acesso…';
    try {
      const resposta = await servicos.buscar('/api/atendimento/operacao/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(dados),
      });
      senha.value = '';
      if (!resposta.ok) throw Error();
      servicos.navegar('/operacao/chat' + (new URLSearchParams(servicos.busca).get('ambiente') === 'ensaio' ? '?ambiente=ensaio' : ''));
    } catch {
      senha.value = '';
      aviso.className = 'rounded-md bg-destructive/10 p-2 text-center text-sm text-destructive';
      aviso.setAttribute('role', 'alert');
      aviso.textContent = 'Não foi possível entrar. Confira o acesso ou aguarde antes de tentar novamente.';
      email.disabled = senha.disabled = entrar.disabled = visibilidade.disabled = false;
      form.setAttribute('aria-busy', 'false');
      texto.textContent = 'Entrar';
      icone?.parentNode?.removeChild(icone);
      pendente = false;
    }
  });
}

export function loginHtml() {
  // Moldura de documento estático; não é uma página Next nem precisa de seu Head.
  return '<!doctype html><html lang="pt-BR" class="h-full antialiased light" data-identidade="atendimento"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Grazing Atendimento</title><link rel="stylesheet" href="/operacao/login.css"></head><body class="min-h-full flex flex-col">'
    + renderToStaticMarkup(<LoginOperacao />)
    + '<script defer src="/operacao/login.js"></script></body></html>';
}

export const loginJs = `(${iniciarLoginOperacao.toString()})(document,{buscar:(...args)=>fetch(...args),navegar:destino=>{location.href=destino;},busca:location.search});`;

/** Identidade já utilizada no Chat aprovado, em um escopo isolado do login. */
export function loginTemaCss() {
  return 'html.light[data-identidade="atendimento"] {\n'
    + Object.entries(IDENTIDADE_PREVIEW.papeis).map(([nome,valor]) => `  ${nome}: ${valor};`).join('\n')
    + '\n}\n';
}
