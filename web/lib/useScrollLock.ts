'use client';

import { useEffect } from 'react';

/** Mesmo breakpoint usado pelas media queries de mobile em globals.css. */
const BREAKPOINT_MOBILE = 767;

/**
 * Quantos modais estao com a trava aplicada agora. Vive no modulo (nao no
 * componente) porque dois modais podem estar abertos ao mesmo tempo — ex.: um
 * ConfirmDialog por cima de um formulario — e fechar o de cima nao pode
 * destravar a pagina enquanto o de baixo continuar aberto.
 */
let travas = 0;

/**
 * Posicao de rolagem no instante em que a primeira trava foi aplicada. Tambem
 * vive no modulo: se ficasse no componente, o modal de cima restauraria a
 * posicao errada ao fechar.
 */
let scrollSalvo = 0;

function aplicarTrava() {
  scrollSalvo = window.scrollY;
  const { style } = document.body;
  style.position = 'fixed';
  style.top = `-${scrollSalvo}px`;
  style.left = '0';
  style.right = '0';
  style.width = '100%';
}

function removerTrava() {
  const { style } = document.body;
  style.position = '';
  style.top = '';
  style.left = '';
  style.right = '';
  style.width = '';
  window.scrollTo(0, scrollSalvo);
}

/**
 * Trava a rolagem da pagina de fundo enquanto um modal esta aberto e restaura a
 * posicao exata ao fechar.
 *
 * Usa `position: fixed` no body com offset negativo, em vez de apenas
 * `overflow: hidden` no html: essa e a unica tecnica que *garante* a
 * restauracao da posicao no iOS, em vez de depender do comportamento do
 * browser. A regra CSS `html:has(.bm-modal){overflow:hidden}` continua no
 * globals.css como rede de seguranca e nao conflita com esta trava.
 *
 * @param ativo Quando false, o hook nao faz nada. Necessario para componentes
 *   que fazem `if (!open) return null`: o hook precisa rodar em toda
 *   renderizacao (regras dos hooks) mas so deve agir com o modal visivel. Em
 *   modais que o componente pai monta e desmonta condicionalmente, chamar sem
 *   argumento basta.
 * @param opcoes.apenasMobile Quando true, so trava abaixo de 768px. Usado pelos
 *   modais marcados com `md:hidden`, que nem existem no desktop — travar a
 *   pagina la seria um bug (foi exatamente o que aconteceu com o painel
 *   Detalhes da Agenda antes da variante `.bm-modal-mobile`).
 */
export function useScrollLock(
  ativo: boolean = true,
  opcoes?: { apenasMobile?: boolean },
): void {
  const apenasMobile = opcoes?.apenasMobile ?? false;

  useEffect(() => {
    if (!ativo) return;
    if (apenasMobile && window.innerWidth > BREAKPOINT_MOBILE) return;

    if (travas === 0) aplicarTrava();
    travas += 1;

    return () => {
      travas -= 1;
      if (travas === 0) removerTrava();
    };
  }, [ativo, apenasMobile]);
}
