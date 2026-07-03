'use client';

import { useEffect, useRef } from 'react';

/**
 * ClickSpark — pequenas faíscas que se espalham do ponto de clique,
 * montado uma vez no layout raiz (efeito global, sem depender de cada página).
 * Ignorado por completo quando prefers-reduced-motion: reduce.
 */
export function ClickSpark() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    function resize() {
      canvas!.width = window.innerWidth;
      canvas!.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    type Spark = { x: number; y: number; angle: number; born: number; cor: string };
    let sparks: Spark[] = [];
    const DURACAO = 450;
    const QTD     = 7;
    const RAIO    = 16;

    function onClick(e: MouseEvent) {
      // Ignora cliques em inputs de texto/textarea (sem feedback visual ali)
      const alvo = e.target as HTMLElement;
      if (alvo.closest('input, textarea, select')) return;

      const cor = getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim() || '#2C1750';
      const now = performance.now();
      for (let i = 0; i < QTD; i++) {
        sparks.push({ x: e.clientX, y: e.clientY, angle: (Math.PI * 2 * i) / QTD + Math.random() * 0.3, born: now, cor });
      }
    }
    window.addEventListener('click', onClick);

    let raf: number;
    function tick() {
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
      const now = performance.now();
      sparks = sparks.filter(s => now - s.born < DURACAO);
      for (const s of sparks) {
        const t     = (now - s.born) / DURACAO;
        const dist  = t * RAIO * 1.8;
        const alpha = 1 - t;
        const x1 = s.x + Math.cos(s.angle) * dist;
        const y1 = s.y + Math.sin(s.angle) * dist;
        const x2 = s.x + Math.cos(s.angle) * (dist + RAIO * (1 - t));
        const y2 = s.y + Math.sin(s.angle) * (dist + RAIO * (1 - t));
        ctx!.strokeStyle = s.cor.startsWith('#') || s.cor.startsWith('oklch') || s.cor.startsWith('rgb')
          ? s.cor : `#2C1750`;
        ctx!.globalAlpha = Math.max(alpha, 0);
        ctx!.lineWidth = 2;
        ctx!.lineCap = 'round';
        ctx!.beginPath();
        ctx!.moveTo(x1, y1);
        ctx!.lineTo(x2, y2);
        ctx!.stroke();
      }
      ctx!.globalAlpha = 1;
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('click', onClick);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999 }}
    />
  );
}
