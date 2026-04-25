import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTheme } from '../hooks/useTheme';

const mockLocalStorage: Record<string, string> = {};

beforeEach(() => {
  Object.keys(mockLocalStorage).forEach((k) => delete mockLocalStorage[k]);
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => mockLocalStorage[key] ?? null);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string, value: string) => {
    mockLocalStorage[key] = value;
  });
  document.documentElement.classList.remove('dark', 'light');
  document.body.className = '';
});

describe('useTheme', () => {
  it('defaults to dark theme', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('dark');
    expect(result.current.isDark).toBe(true);
  });

  it('reads persisted theme from localStorage', () => {
    mockLocalStorage['datapulse-theme'] = 'light';
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('light');
    expect(result.current.isDark).toBe(false);
  });

  it('toggles from dark to light', () => {
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.toggle();
    });

    expect(result.current.theme).toBe('light');
    expect(result.current.isDark).toBe(false);
  });

  it('toggles back from light to dark', () => {
    mockLocalStorage['datapulse-theme'] = 'light';
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.toggle();
    });

    expect(result.current.theme).toBe('dark');
    expect(result.current.isDark).toBe(true);
  });

  it('persists theme to localStorage', () => {
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.toggle();
    });

    expect(mockLocalStorage['datapulse-theme']).toBe('light');
  });

  it('adds dark class to document root in dark mode', () => {
    renderHook(() => useTheme());
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(false);
  });

  it('adds light class to document root in light mode', () => {
    mockLocalStorage['datapulse-theme'] = 'light';
    renderHook(() => useTheme());
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
