// @vitest-environment jsdom
import React,{useState} from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import CampoTelefoneContato from '../../apps/atendimento-chat-consulta/CampoTelefoneContato';
import {formatarTelefoneContatoDigitado} from '../../apps/atendimento-chat-consulta/telefone-contato-mascara';
import {normalizarTelefoneContato} from '../../src/lib/atendimento/operacao-telefone-contato';
import NovoContatoOperacao from '../../apps/atendimento-chat-consulta/NovoContatoOperacao';
import type {ClienteOperacao} from '../../apps/atendimento-chat-consulta/operacao-api';

afterEach(cleanup);
function Campo(){const [valor,setValor]=useState('');return <CampoTelefoneContato aria-label="Telefone" value={valor} alterar={setValor}/>;}
function digitar(texto:string){const el=screen.getByLabelText('Telefone') as HTMLInputElement;for(const tecla of texto){const inicio=el.selectionStart??el.value.length,fim=el.selectionEnd??inicio;if(fireEvent.keyDown(el,{key:tecla})){const valor=el.value.slice(0,inicio)+tecla+el.value.slice(fim);fireEvent.change(el,{target:{value:valor,selectionStart:inicio+tecla.length,selectionEnd:inicio+tecla.length}});}}return el;}

it.each([['1','(1'],['11','(11)'],['119','(11) 9'],['1198765','(11) 98765'],['11987654321','(11) 98765-4321'],['1123456789','(11) 2345-6789'],['55987654321','(55) 98765-4321'],['+5511987654321','+55 (11) 98765-4321'],['+12025550123','+12025550123']])('formata a sequência %s sem alterar dígitos', (entrada,saida)=>{render(<Campo/>);expect(digitar(entrada)).toHaveProperty('value',saida);});
it.each(['1123456789','11987654321','+551123456789','+5511987654321','+123456789012345'])('bloqueia novos dígitos ao atingir o limite de %s',entrada=>{render(<Campo/>);const el=digitar(entrada),valor=el.value;expect(fireEvent.keyDown(el,{key:'8'})).toBe(false);fireEvent.change(el,{target:{value:valor+'8'}});expect(el.value).toBe(valor);});
it.each([['(11) 98765-4321','(11) 98765-4321'],['5511987654321','+55 (11) 98765-4321'],['(55) 2345-6789','(55) 2345-6789'],['+1 (202) 555-0123','+12025550123']])('formata a colagem e preserva o telefone canônico: %s',(entrada,saida)=>{render(<Campo/>);const el=screen.getByLabelText('Telefone');fireEvent.paste(el,{clipboardData:{getData:()=>entrada}});expect(el).toHaveProperty('value',saida);expect(normalizarTelefoneContato(saida)).toBe(normalizarTelefoneContato(entrada));});
it.each(['119876543219','+551198765432199','+1234567890123456','(11) letras','11987654321\n'])('rejeita colagem inválida ou excedente sem trocar o telefone: %j',entrada=>{render(<Campo/>);const el=digitar('1123456789');el.select();fireEvent.paste(el,{clipboardData:{getData:()=>entrada}});expect(el.value).toBe('(11) 2345-6789');});
it('permite corrigir dígitos no meio sem levar o cursor ao fim',()=>{render(<Campo/>);const el=digitar('11987654321');el.setSelectionRange(7,8);digitar('0');expect(el.value).toBe('(11) 98065-4321');expect(el.selectionStart).toBe(8);});
it('permite substituir o número inteiro, inclusive por outro formato',()=>{render(<Campo/>);const el=digitar('1123456789');el.select();fireEvent.paste(el,{clipboardData:{getData:()=>'+44 20 7946 0101'}});expect(el.value).toBe('+442079460101');expect(normalizarTelefoneContato(el.value)).toBe('442079460101');});
it('apaga o dígito vizinho ao hífen sem prender a tecla de apagar',()=>{render(<Campo/>);const el=digitar('11987654321');el.setSelectionRange(11,11);fireEvent.keyDown(el,{key:'Backspace'});expect(el.value.replace(/\D/g,'')).toBe('1198764321');expect(el.selectionStart).toBeLessThan(el.value.length);});
it('permite limpar todo o campo e voltar a digitar',()=>{render(<Campo/>);const el=digitar('11987654321');fireEvent.change(el,{target:{value:''}});expect(el.value).toBe('');expect(digitar('1123456789').value).toBe('(11) 2345-6789');});
it('não converte edição nacional excedente em outro DDI',()=>{expect(formatarTelefoneContatoDigitado('(55) 98765-43219')).toBeNull();expect(formatarTelefoneContatoDigitado('5511987654321')).toBeNull();});

it('continuar ou Escape preservam o formulário; descartar exige clique explícito',async()=>{
 const fechar=vi.fn(),cliente={criarContato:vi.fn()} as unknown as ClienteOperacao;
 render(<NovoContatoOperacao podeSalvar cliente={cliente} fechar={fechar} salvo={()=>undefined} falhar={()=>undefined}/>);
 fireEvent.change(screen.getByLabelText('Nome'),{target:{value:'Pessoa fictícia'}});digitar('11987654321');
 fireEvent.click(screen.getByRole('button',{name:'Fechar cadastro de contato'}));await screen.findByRole('alertdialog',{name:'Sair sem salvar?'});
 expect(screen.getByRole('button',{name:'Continuar editando'}).classList.contains('btn')).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'Continuar editando'}));await waitFor(()=>expect(screen.queryByRole('alertdialog')).toBeNull());expect(screen.getByLabelText('Telefone')).toHaveProperty('value','(11) 98765-4321');expect(fechar).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Fechar cadastro de contato'}));const aviso=await screen.findByRole('alertdialog');fireEvent.keyDown(aviso,{key:'Escape'});await waitFor(()=>expect(screen.queryByRole('alertdialog')).toBeNull());expect(fechar).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Fechar cadastro de contato'}));fireEvent.click(await screen.findByRole('button',{name:'Sair sem salvar'}));expect(fechar).toHaveBeenCalledTimes(1);expect(cliente.criarContato).not.toHaveBeenCalled();
});

