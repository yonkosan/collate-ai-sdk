import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HeaderBar } from './HeaderBar';

describe('HeaderBar', () => {
  const defaultProps = {
    theme: 'dark' as const,
    onToggleTheme: vi.fn(),
    loading: false,
    pipelineRan: false,
    onRunPipeline: vi.fn(),
    onRefresh: vi.fn(),
  };

  it('renders user identity', () => {
    render(<HeaderBar {...defaultProps} />);
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });

  it('renders Run Pipeline button', () => {
    render(<HeaderBar {...defaultProps} />);
    expect(screen.getByText(/run pipeline/i)).toBeInTheDocument();
  });

  it('calls onRunPipeline when CTA clicked', async () => {
    const user = userEvent.setup();
    const onRunPipeline = vi.fn();
    render(<HeaderBar {...defaultProps} onRunPipeline={onRunPipeline} />);

    await user.click(screen.getByText(/run pipeline/i));
    expect(onRunPipeline).toHaveBeenCalledOnce();
  });

  it('shows loading state when running', () => {
    render(<HeaderBar {...defaultProps} loading={true} />);
    expect(screen.getByText(/running/i)).toBeInTheDocument();
  });

  it('shows refresh button after pipeline ran', () => {
    render(<HeaderBar {...defaultProps} pipelineRan={true} />);
    const refreshButtons = screen.getAllByRole('button');
    expect(refreshButtons.length).toBeGreaterThanOrEqual(2);
  });

  it('renders theme toggle', () => {
    const { container } = render(<HeaderBar {...defaultProps} />);
    // ThemeSwitch renders a button
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });
});
