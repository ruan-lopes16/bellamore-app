'use client';

import {
  eachDayOfInterval,
  endOfMonth,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

export type FinanceMonthCalendarProps = {
  month: Date;
  isOpen: boolean;
  isNextDisabled: boolean;
  onToggle: () => void;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
};

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];

function monthLabel(month: Date) {
  return format(month, 'MMMM yyyy', { locale: ptBR });
}

function monthGrid(month: Date) {
  const start = startOfWeek(startOfMonth(month), { weekStartsOn: 0 });
  const end = new Date(start);
  end.setDate(start.getDate() + 41);

  return eachDayOfInterval({ start, end });
}

/**
 * Visual-only month calendar for Financeiro; the page still filters by month.
 */
export function FinanceMonthCalendar({
  month,
  isOpen,
  isNextDisabled,
  onToggle,
  onPreviousMonth,
  onNextMonth,
}: FinanceMonthCalendarProps) {
  const label = monthLabel(month);
  const labelTitle = label.charAt(0).toUpperCase() + label.slice(1);
  const rangeLabel = `${format(startOfMonth(month), 'dd/MM')} - ${format(endOfMonth(month), 'dd/MM')}`;
  const gridDays = monthGrid(month);

  return (
    <div className="flex flex-col items-center mb-6">
      <div className="bg-surface border border-border rounded-[20px] flex items-center gap-2 px-3 py-2 shadow-sm">
        <button
          type="button"
          onClick={onPreviousMonth}
          aria-label="Mes anterior"
          className="min-h-11 min-w-11 rounded-[12px] flex items-center justify-center text-text-3 hover:bg-bg focus:outline-none focus:ring-2 focus:ring-primary/20 transition"
        >
          <ChevronLeft size={16} />
        </button>

        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          aria-controls="finance-month-calendar-grid"
          aria-label={`${isOpen ? 'Fechar' : 'Abrir'} calendario de ${labelTitle}`}
          className="min-h-11 min-w-[180px] px-3 rounded-[14px] text-center hover:bg-bg focus:outline-none focus:ring-2 focus:ring-primary/20 transition"
        >
          <span className="flex items-center justify-center gap-1.5 text-sm font-semibold capitalize text-text">
            {label}
            <ChevronDown
              size={14}
              aria-hidden="true"
              className={`text-text-4 transition ${isOpen ? 'rotate-180' : ''}`}
            />
          </span>
          <span className="block text-xs mt-0.5 text-text-4">{rangeLabel}</span>
        </button>

        <button
          type="button"
          onClick={onNextMonth}
          disabled={isNextDisabled}
          aria-label="Proximo mes"
          className="min-h-11 min-w-11 rounded-[12px] flex items-center justify-center text-text-3 hover:bg-bg focus:outline-none focus:ring-2 focus:ring-primary/20 transition disabled:opacity-30 disabled:pointer-events-none"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {isOpen && (
        <div className="mt-3 bg-surface border border-border rounded-2xl p-4 sm:p-5 w-full max-w-md shadow-sm">
          <div
            id="finance-month-calendar-grid"
            role="grid"
            aria-label={`Calendario de ${labelTitle}`}
            className="grid grid-cols-7 gap-1"
          >
            {WEEKDAYS.map(day => (
              <div
                key={day}
                role="columnheader"
                className="h-8 flex items-center justify-center text-[11px] font-semibold text-text-4"
              >
                {day}
              </div>
            ))}

            {gridDays.map(day => {
              const inCurrentMonth = isSameMonth(day, month);
              const isSelected = isSameDay(day, month);

              return (
                <div
                  key={day.toISOString()}
                  role="gridcell"
                  aria-label={format(day, "d 'de' MMMM 'de' yyyy", { locale: ptBR })}
                  aria-current={isSelected ? 'date' : undefined}
                  data-outside-month={inCurrentMonth ? undefined : 'true'}
                  className={`relative min-h-11 min-w-11 flex items-center justify-center rounded-xl text-sm font-bold transition
                    ${isSelected
                      ? 'bg-primary text-white shadow-sm'
                      : inCurrentMonth
                        ? 'text-text-2'
                        : 'text-text-4 opacity-60'}`}
                >
                  {format(day, 'd')}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
