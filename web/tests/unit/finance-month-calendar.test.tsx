import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FinanceMonthCalendar } from '@/components/FinanceMonthCalendar';

describe('FinanceMonthCalendar', () => {
  const july2026 = new Date(2026, 6, 16);

  it('renders the compact month selector before opening the calendar', () => {
    render(
      <FinanceMonthCalendar
        month={july2026}
        isOpen={false}
        isNextDisabled={true}
        onToggle={vi.fn()}
        onPreviousMonth={vi.fn()}
        onNextMonth={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /abrir calendario de julho 2026/i })).toBeInTheDocument();
    expect(screen.getByText('01/07 - 31/07')).toBeInTheDocument();
    expect(screen.queryByRole('grid', { name: /calendario de julho 2026/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /proximo mes/i })).toBeDisabled();
  });

  it('shows the month grid with dimmed outside days when opened', () => {
    render(
      <FinanceMonthCalendar
        month={july2026}
        isOpen={true}
        isNextDisabled={false}
        onToggle={vi.fn()}
        onPreviousMonth={vi.fn()}
        onNextMonth={vi.fn()}
      />,
    );

    expect(screen.getByRole('grid', { name: /calendario de julho 2026/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Dom' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Sab' })).toBeInTheDocument();
    expect(screen.getByRole('gridcell', { name: /16 de julho de 2026/i })).toHaveAttribute('aria-current', 'date');
    expect(screen.getByRole('gridcell', { name: /28 de junho de 2026/i })).toHaveAttribute('data-outside-month', 'true');
    expect(screen.getByRole('gridcell', { name: /1 de agosto de 2026/i })).toHaveAttribute('data-outside-month', 'true');
  });

  it('calls the supplied navigation and toggle handlers', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const onPreviousMonth = vi.fn();
    const onNextMonth = vi.fn();

    render(
      <FinanceMonthCalendar
        month={july2026}
        isOpen={false}
        isNextDisabled={false}
        onToggle={onToggle}
        onPreviousMonth={onPreviousMonth}
        onNextMonth={onNextMonth}
      />,
    );

    await user.click(screen.getByRole('button', { name: /mes anterior/i }));
    await user.click(screen.getByRole('button', { name: /abrir calendario/i }));
    await user.click(screen.getByRole('button', { name: /proximo mes/i }));

    expect(onPreviousMonth).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onNextMonth).toHaveBeenCalledTimes(1);
  });
});
