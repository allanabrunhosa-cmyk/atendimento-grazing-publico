// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog';

afterEach(cleanup);

it.each(['default', 'outline', 'destructive'] as const)('Cancelar usa cor neutra com variante %s e preserva o bloqueio', variant => {
  render(<Button variant={variant} disabled>Cancelar</Button>);
  const botao = screen.getByRole('button', { name: 'Cancelar' });
  expect(botao.getAttribute('data-acao')).toBe('cancelar');
  expect(botao.className).toContain('bg-card/80');
  expect(botao.className).not.toContain('bg-destructive');
  expect(botao.hasAttribute('disabled')).toBe(true);
  expect(botao.textContent).toBe('Cancelar');
});

it('o diálogo identifica Cancelar sem mudar a ação do X de fechar', () => {
  render(<Dialog open><DialogContent><DialogTitle>Exemplo fictício</DialogTitle><DialogClose>Cancelar</DialogClose></DialogContent></Dialog>);
  expect(screen.getByRole('button', { name: 'Cancelar' }).getAttribute('data-acao')).toBe('cancelar');
  expect(screen.getByRole('button', { name: /Fechar/ }).getAttribute('data-acao')).not.toBe('cancelar');
});
