'use client';

import { format, isSameDay, isSameMonth, isToday } from 'date-fns';
import { DIAS_SEMANA_ABREV, chaveDiaExibido } from '@shared/periodos';
import { gradeDoMes } from './visoes';

/**
 * MesView — calendário mensal da Agenda (domingo primeiro, via `gradeDoMes`).
 * Ponto lilás = dia com atendimento; ponto rosa = dia com bloqueio. Mesmo filtro por
 * profissional da Timeline (quem chama passa as contagens e os dias já filtrados).
 */
export function MesView({
  mes, agsPorDia, diasBloqueados, diaSel, onDiaClick,
}: {
  mes: Date;
  /** Atendimentos por dia 'yyyy-MM-dd'. */
  agsPorDia: Map<string, number>;
  /** Dias 'yyyy-MM-dd' com algum bloqueio visível. */
  diasBloqueados: Set<string>;
  diaSel: Date;
  onDiaClick: (d: Date) => void;
}) {
  const dias = gradeDoMes(mes);

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {DIAS_SEMANA_ABREV.map(d => (
          <div key={d} className="text-center text-[10px] font-semibold text-text-4 py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {dias.map(d => {
          const key       = chaveDiaExibido(d);
          const count     = agsPorDia.get(key) ?? 0;
          const bloqueado = diasBloqueados.has(key);
          const selDia    = isSameDay(d, diaSel);
          const hojeDia   = isToday(d);
          const dMes      = isSameMonth(d, mes);
          const dica = [
            count > 0 ? `${count} ${count === 1 ? 'agendamento' : 'agendamentos'}` : '',
            bloqueado ? 'horário bloqueado' : '',
          ].filter(Boolean).join(' · ');
          return (
            <div key={key} className="relative group">
              <button
                onClick={() => onDiaClick(d)}
                aria-label={dica ? `${format(d, 'd')} — ${dica}` : undefined}
                className={`w-full aspect-square flex items-center justify-center rounded-lg text-sm font-bold transition
                  ${selDia  ? 'bg-primary text-white'
                  : hojeDia ? 'bg-primary-soft text-primary'
                  : dMes    ? 'hover:bg-bg text-text-2'
                  :           'text-text-4 hover:bg-bg'}`}
                style={bloqueado && !selDia ? { boxShadow: 'inset 0 0 0 1.5px var(--color-rose)' } : undefined}
              >
                {format(d, 'd')}
                {(count > 0 || bloqueado) && !selDia && (
                  <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 flex gap-0.5">
                    {count > 0 && <span className="w-1 h-1 rounded-full bg-accent" />}
                    {bloqueado && <span className="w-1 h-1 rounded-full" style={{ background: 'var(--color-rose)' }} />}
                  </span>
                )}
              </button>
              {/* tooltip no hover */}
              {dica && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-10
                  opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity
                  bg-text text-white text-[10px] font-semibold px-2 py-1 rounded-lg whitespace-nowrap shadow-lg">
                  {dica}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
