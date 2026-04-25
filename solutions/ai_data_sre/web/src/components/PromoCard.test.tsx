import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PromoCard } from './PromoCard';

describe('PromoCard', () => {
  it('renders AI-Powered badge', () => {
    render(<PromoCard onRunPipeline={() => {}} loading={false} />);
    expect(screen.getAllByText(/ai-powered/i).length).toBeGreaterThanOrEqual(1);
  });

  it('renders start pipeline button', () => {
    render(<PromoCard onRunPipeline={() => {}} loading={false} />);
    expect(screen.getByText(/start pipeline/i)).toBeInTheDocument();
  });

  it('calls onRunPipeline when button clicked', async () => {
    const user = userEvent.setup();
    const onRunPipeline = vi.fn();
    render(<PromoCard onRunPipeline={onRunPipeline} loading={false} />);

    await user.click(screen.getByText(/start pipeline/i));
    expect(onRunPipeline).toHaveBeenCalledOnce();
  });

  it('shows loading state', () => {
    render(<PromoCard onRunPipeline={() => {}} loading={true} />);
    expect(screen.getByText(/running/i)).toBeInTheDocument();
  });
});
