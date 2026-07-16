import { endOfMonth, format, startOfMonth } from 'date-fns';

export function getMonthQueryBounds(month: Date) {
  const start = startOfMonth(month);
  const end = endOfMonth(month);

  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    startDate: format(start, 'yyyy-MM-dd'),
    endDate: format(end, 'yyyy-MM-dd'),
  };
}
