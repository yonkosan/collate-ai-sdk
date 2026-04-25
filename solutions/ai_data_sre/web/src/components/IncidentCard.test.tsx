import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IncidentCard } from './IncidentCard';
import { makeSummary } from '../test/fixtures';

describe('IncidentCard', () => {
  it('renders incident title', () => {
    render(<IncidentCard incident={makeSummary()} onClick={() => {}} />);
    expect(screen.getByText('DQ failures in raw_orders')).toBeInTheDocument();
  });

  it('renders severity badge', () => {
    render(<IncidentCard incident={makeSummary({ severity: 'HIGH' })} onClick={() => {}} />);
    expect(screen.getByText('HIGH')).toBeInTheDocument();
  });

  it('renders failure count', () => {
    render(<IncidentCard incident={makeSummary({ failure_count: 5 })} onClick={() => {}} />);
    expect(screen.getByText(/5/)).toBeInTheDocument();
  });

  it('calls onClick when clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<IncidentCard incident={makeSummary()} onClick={onClick} />);

    await user.click(screen.getByText('DQ failures in raw_orders'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('shows assigned_to when set', () => {
    render(
      <IncidentCard
        incident={makeSummary({ assigned_to: 'alice' })}
        onClick={() => {}}
      />
    );
    expect(screen.getByText(/alice/)).toBeInTheDocument();
  });

  it('shows recurring badge when has_recurring_failures', () => {
    render(
      <IncidentCard
        incident={makeSummary({ has_recurring_failures: true })}
        onClick={() => {}}
      />
    );
    expect(screen.getByText(/recurring/i)).toBeInTheDocument();
  });

  it('shows root cause table', () => {
    render(
      <IncidentCard
        incident={makeSummary({ root_cause_table: 'db.schema.my_table' })}
        onClick={() => {}}
      />
    );
    expect(screen.getByText(/my_table/)).toBeInTheDocument();
  });
});
