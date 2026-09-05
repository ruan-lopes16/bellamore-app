import { describe, expect, it } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { render, fireEvent } from '@testing-library/react';
import { avancarComEnter } from '@/lib/formNav';

/** Monta um <form onKeyDown={avancarComEnter}> com os filhos dados. */
function montarForm(...filhos: ReactNode[]) {
  const { container } = render(
    createElement('form', { onKeyDown: avancarComEnter }, ...filhos),
  );
  return container.querySelector('form') as HTMLFormElement;
}
const inp = (id: string, extra: Record<string, unknown> = {}) =>
  createElement('input', { key: id, id, type: 'text', defaultValue: '', ...extra });
const submitBtn = () => createElement('button', { key: 's', type: 'submit' }, 'Salvar');

describe('avancarComEnter', () => {
  it('Enter num input move o foco para o próximo, pulando o disabled', () => {
    const form = montarForm(inp('a'), inp('b', { disabled: true }), inp('c'), submitBtn());
    const a = form.querySelector('#a') as HTMLInputElement;
    a.focus();
    const naoCancelado = fireEvent.keyDown(a, { key: 'Enter' });
    expect(naoCancelado).toBe(false); // preventDefault foi chamado
    expect(document.activeElement).toBe(form.querySelector('#c'));
  });

  it('Enter no último campo foca o button[type=submit] e NÃO envia', () => {
    const form = montarForm(inp('a'), inp('c'), submitBtn());
    let enviou = false;
    form.addEventListener('submit', (e) => { enviou = true; e.preventDefault(); });
    const c = form.querySelector('#c') as HTMLInputElement;
    c.focus();
    fireEvent.keyDown(c, { key: 'Enter' });
    expect(document.activeElement).toBe(form.querySelector('button[type=submit]'));
    expect(enviou).toBe(false);
  });

  it('Shift+Enter é ignorado (evento não cancelado)', () => {
    const form = montarForm(inp('a'), inp('c'), submitBtn());
    const a = form.querySelector('#a') as HTMLInputElement;
    a.focus();
    const naoCancelado = fireEvent.keyDown(a, { key: 'Enter', shiftKey: true });
    expect(naoCancelado).toBe(true);
    expect(document.activeElement).toBe(a); // foco não mudou
  });

  it('Enter em <textarea> não é interceptado (quebra de linha normal)', () => {
    const form = montarForm(inp('a'), createElement('textarea', { key: 't', id: 't' }), submitBtn());
    const t = form.querySelector('#t') as HTMLTextAreaElement;
    t.focus();
    const naoCancelado = fireEvent.keyDown(t, { key: 'Enter' });
    expect(naoCancelado).toBe(true);
    expect(document.activeElement).toBe(t);
  });

  it('Enter que confirma composição de IME (isComposing) não é navegação', () => {
    const form = montarForm(inp('a'), inp('c'), submitBtn());
    const a = form.querySelector('#a') as HTMLInputElement;
    a.focus();
    const naoCancelado = fireEvent.keyDown(a, { key: 'Enter', isComposing: true });
    expect(naoCancelado).toBe(true); // preventDefault NÃO foi chamado
    expect(document.activeElement).toBe(a); // foco não mudou
  });

  it('Enter a partir de elemento fora da lista de campos não volta o foco pro 1º campo', () => {
    const form = montarForm(
      createElement('div', { key: 'd', id: 'd', tabIndex: 0 }, 'fora'),
      inp('a'),
      inp('c'),
      submitBtn(),
    );
    const d = form.querySelector('#d') as HTMLDivElement;
    d.focus();
    fireEvent.keyDown(d, { key: 'Enter' });
    expect(document.activeElement).toBe(d); // não caiu em campos[0]
  });
});
