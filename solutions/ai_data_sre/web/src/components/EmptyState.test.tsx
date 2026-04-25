import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('renders title', () => {
    render(<EmptyState onRun={() => {}} loading={false} />);
    expect(screen.getByText('DataPulse Command Center')).toBeInTheDocument();
  });

  it('renders run button', () => {
    render(<EmptyState onRun={() => {}} loading={false} />);
    expect(screen.getByText(/run incident pipeline/i)).toBeInTheDocument();
  });

  it('calls onRun when button clicked', async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();
    render(<EmptyState onRun={onRun} loading={false} />);

    await user.click(screen.getByText(/run incident pipeline/i));
    expect(onRun).toHaveBeenCalledOnce();
  });

  it('shows loading state', () => {
    render(<EmptyState onRun={() => {}} loading={true} />);
    expect(screen.getByText(/running/i)).toBeInTheDocument();
  });

  it('disables button when loading', () => {
    render(<EmptyState onRun={() => {}} loading={true} />);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
  });
});
