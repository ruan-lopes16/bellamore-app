import { describe, expect, it, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useScrollLock } from '@/lib/useScrollLock';

function definirScroll(y: number) {
  Object.defineProperty(window, 'scrollY', { value: y, writable: true, configurable: true });
}

function definirLargura(w: number) {
  Object.defineProperty(window, 'innerWidth', { value: w, writable: true, configurable: true });
}

describe('useScrollLock', () => {
  beforeEach(() => {
    // O cleanup automatico do @testing-library/react (ativo porque o vitest roda
    // com globals: true) desmonta os hooks entre os testes, zerando o contador
    // de referencia do modulo. Aqui so limpamos o que sobra no DOM.
    document.body.style.cssText = '';
    definirScroll(0);
    definirLargura(1024);
    // jsdom nao implementa scrollTo — sem o stub ele emite "Not implemented".
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  });

  it('fixa o body no offset da rolagem atual', () => {
    definirScroll(320);

    renderHook(() => useScrollLock());

    expect(document.body.style.position).toBe('fixed');
    expect(document.body.style.top).toBe('-320px');
    expect(document.body.style.width).toBe('100%');
  });

  it('restaura a posicao exata ao desmontar', () => {
    definirScroll(320);

    const { unmount } = renderHook(() => useScrollLock());
    unmount();

    expect(document.body.style.position).toBe('');
    expect(document.body.style.top).toBe('');
    expect(window.scrollTo).toHaveBeenCalledWith(0, 320);
  });

  it('nao destrava enquanto outro modal continuar aberto', () => {
    definirScroll(150);

    const debaixo = renderHook(() => useScrollLock());
    const emCima  = renderHook(() => useScrollLock());

    emCima.unmount();
    expect(document.body.style.position).toBe('fixed');
    expect(window.scrollTo).not.toHaveBeenCalled();

    debaixo.unmount();
    expect(document.body.style.position).toBe('');
    expect(window.scrollTo).toHaveBeenCalledWith(0, 150);
  });

  it('nao faz nada quando inativo', () => {
    definirScroll(80);

    renderHook(() => useScrollLock(false));

    expect(document.body.style.position).toBe('');
  });

  it('trava quando ativo passa de false para true', () => {
    definirScroll(80);

    const { rerender } = renderHook(({ aberto }) => useScrollLock(aberto), {
      initialProps: { aberto: false },
    });
    expect(document.body.style.position).toBe('');

    rerender({ aberto: true });
    expect(document.body.style.position).toBe('fixed');
    expect(document.body.style.top).toBe('-80px');
  });

  it('com apenasMobile, ignora larguras de desktop', () => {
    definirScroll(80);
    definirLargura(1280);

    renderHook(() => useScrollLock(true, { apenasMobile: true }));

    expect(document.body.style.position).toBe('');
  });

  it('com apenasMobile, trava abaixo do breakpoint', () => {
    definirScroll(80);
    definirLargura(390);

    renderHook(() => useScrollLock(true, { apenasMobile: true }));

    expect(document.body.style.position).toBe('fixed');
  });
});
