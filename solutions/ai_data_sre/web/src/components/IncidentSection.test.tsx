import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IncidentSection } from './IncidentSection';
import { makeSummary } from '../test/fixtures';

describe('IncidentSection', () => {
  const defaultProps = {
    title: 'Active Incidents',
    icon: <span data-testid="section-icon">!</span>,
    count: 2,
    accentColor: 'border-danger/40',
    incidents: [
      makeSummary({ id: 'inc-1', title: 'First incident' }),
      makeSummary({ id: 'inc-2', title: 'Second incident' }),
    ],
    onOpen: vi.fn(),
  };

  it('renders section title', () => {
    render(<IncidentSection {...defaultProps} />);
    expect(screen.getByText('Active Incidents')).toBeInTheDocument();
  });

  it('renders count badge', () => {
    render(<IncidentSection {...defaultProps} />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders all incident cards', () => {
    render(<IncidentSection {...defaultProps} />);
    expect(screen.getByText('First incident')).toBeInTheDocument();
    expect(screen.getByText('Second incident')).toBeInTheDocument();
  });

  it('renders section icon', () => {
    render(<IncidentSection {...defaultProps} />);
    expect(screen.getByTestId('section-icon')).toBeInTheDocument();
  });

  it('calls onOpen when incident card clicked', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<IncidentSection {...defaultProps} onOpen={onOpen} />);

    await user.click(screen.getByText('First incident'));
    expect(onOpen).toHaveBeenCalledWith('inc-1');
  });
});
