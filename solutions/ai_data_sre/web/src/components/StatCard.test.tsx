import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatCard } from './StatCard';

describe('StatCard', () => {
  it('renders label and value', () => {
    render(
      <StatCard
        label="Total Incidents"
        value={42}
        icon={<span data-testid="icon">!</span>}
      />
    );
    expect(screen.getByText('Total Incidents')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('renders icon', () => {
    render(
      <StatCard
        label="Test"
        value={0}
        icon={<span data-testid="icon">I</span>}
      />
    );
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });

  it('renders positive delta with up arrow', () => {
    render(
      <StatCard
        label="Test"
        value={10}
        icon={<span>I</span>}
        delta={{ value: 15, label: 'vs last week' }}
      />
    );
    expect(screen.getByText(/15%/)).toBeInTheDocument();
    expect(screen.getByText('vs last week')).toBeInTheDocument();
  });

  it('renders negative delta', () => {
    render(
      <StatCard
        label="Test"
        value={5}
        icon={<span>I</span>}
        delta={{ value: -10, label: 'vs last scan' }}
      />
    );
    expect(screen.getByText(/10%/)).toBeInTheDocument();
  });

  it('renders without delta', () => {
    const { container } = render(
      <StatCard
        label="Test"
        value={7}
        icon={<span>I</span>}
      />
    );
    expect(container.querySelector('.text-success')).toBeNull();
  });

  it('renders sparkline when sparkData provided', () => {
    const { container } = render(
      <StatCard
        label="Test"
        value={7}
        icon={<span>I</span>}
        sparkData={[1, 2, 3, 4, 5]}
        sparkColor="#8b5cf6"
      />
    );
    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});
