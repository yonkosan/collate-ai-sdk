import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sidebar } from './Sidebar';
import { makeSummary } from '../test/fixtures';

describe('Sidebar', () => {
  const defaultProps = {
    incidents: [] as ReturnType<typeof makeSummary>[],
    activeNav: 'dashboard',
    onNavChange: vi.fn(),
    isOpen: true,
    onToggle: vi.fn(),
  };

  it('renders brand name', () => {
    render(<Sidebar {...defaultProps} />);
    expect(screen.getByText('DataPulse')).toBeInTheDocument();
  });

  it('renders nav items', () => {
    render(<Sidebar {...defaultProps} />);
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Incidents')).toBeInTheDocument();
    expect(screen.getByText('Lineage')).toBeInTheDocument();
    expect(screen.getByText('Reports')).toBeInTheDocument();
  });

  it('highlights active nav item', () => {
    render(<Sidebar {...defaultProps} activeNav="incidents" />);
    const incidentButton = screen.getByText('Incidents').closest('button');
    expect(incidentButton?.className).toContain('primary');
  });

  it('calls onNavChange when nav item clicked', async () => {
    const user = userEvent.setup();
    const onNavChange = vi.fn();
    render(<Sidebar {...defaultProps} onNavChange={onNavChange} />);

    await user.click(screen.getByText('Incidents'));
    expect(onNavChange).toHaveBeenCalledWith('incidents');
  });

  it('shows incident count when incidents exist', () => {
    const incidents = [
      makeSummary({ id: '1', status: 'detected' }),
      makeSummary({ id: '2', status: 'resolved' }),
    ];
    render(<Sidebar {...defaultProps} incidents={incidents} />);
    // Should show count of active (non-resolved) incidents
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('renders mobile toggle button', () => {
    render(<Sidebar {...defaultProps} isOpen={false} />);
    const toggleButton = screen.getByLabelText('Toggle sidebar');
    expect(toggleButton).toBeInTheDocument();
  });
});
