import { Moon, Sun } from 'lucide-react';

interface ThemeSwitchProps {
  theme: 'dark' | 'light';
  onToggle: () => void;
}

export function ThemeSwitch({ theme, onToggle }: ThemeSwitchProps) {
  const isDark = theme === 'dark';

  return (
    <button
      onClick={onToggle}
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
      className="relative flex items-center w-14 h-7 rounded-full border border-border-subtle bg-surface-inset transition-colors hover:border-primary-400/40"
    >
      {/* Track icons */}
      <Sun className="absolute left-1.5 w-3.5 h-3.5 text-warning opacity-60" />
      <Moon className="absolute right-1.5 w-3.5 h-3.5 text-primary-300 opacity-60" />

      {/* Thumb */}
      <span
        className={`absolute top-0.5 w-6 h-6 rounded-full bg-gradient-cta shadow-glow transition-transform duration-300 ${
          isDark ? 'translate-x-7' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}
