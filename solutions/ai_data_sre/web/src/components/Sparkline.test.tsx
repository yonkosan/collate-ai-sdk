import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Sparkline } from './Sparkline';

describe('Sparkline', () => {
  it('renders an SVG element', () => {
    const { container } = render(
      <Sparkline data={[1, 2, 3, 4, 5]} color="#8b5cf6" />
    );
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('renders path elements for line and area', () => {
    const { container } = render(
      <Sparkline data={[1, 2, 3, 4, 5]} color="#8b5cf6" />
    );
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBeGreaterThanOrEqual(2); // area fill + stroke line
  });

  it('renders glowing endpoint circle', () => {
    const { container } = render(
      <Sparkline data={[10, 20, 30]} color="#ff0000" />
    );
    const circles = container.querySelectorAll('circle');
    expect(circles.length).toBeGreaterThanOrEqual(1);
  });

  it('returns null for single data point (needs at least 2)', () => {
    const { container } = render(
      <Sparkline data={[5]} color="#000" />
    );
    // Sparkline requires 2+ points to draw a line
    expect(container.querySelector('svg')).toBeNull();
  });

  it('handles flat data (all same values)', () => {
    const { container } = render(
      <Sparkline data={[3, 3, 3, 3]} color="#000" />
    );
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('respects custom width and height', () => {
    const { container } = render(
      <Sparkline data={[1, 2, 3]} color="#000" width={200} height={60} />
    );
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 200 60');
  });
});
