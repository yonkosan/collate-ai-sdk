import {
  Bell,
  Play,
  RefreshCw,
  Search,
  User,
} from 'lucide-react';
import { ThemeSwitch } from './ThemeSwitch';

interface HeaderBarProps {
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  loading: boolean;
  pipelineRan: boolean;
  onRunPipeline: () => void;
  onRefresh: () => void;
}

export function HeaderBar({
  theme,
  onToggleTheme,
  loading,
  pipelineRan,
  onRunPipeline,
  onRefresh,
}: HeaderBarProps) {
  return (
    <header className="sticky top-0 z-20 border-b border-border-subtle glass">
      <div className="flex items-center justify-between px-6 py-3 lg:px-8">
        {/* Left: user identity */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-primary flex items-center justify-center">
            <User className="w-4 h-4 text-white" />
          </div>
          <div className="hidden sm:block">
            <p className="text-sm font-medium text-content-primary">Admin</p>
            <p className="text-xs text-content-muted">Data Engineer</p>
          </div>
        </div>

        {/* Center: primary CTA */}
        <div className="flex items-center gap-3">
          {pipelineRan && (
            <button
              onClick={onRefresh}
              className="flex items-center gap-2 px-3 py-2 text-sm text-content-secondary border border-border-subtle rounded-xl hover:text-content-primary hover:bg-surface-soft hover:border-border-strong transition-all"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          )}
          <button
            onClick={onRunPipeline}
            disabled={loading}
            className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-gradient-cta rounded-xl shadow-glow hover:shadow-glow-strong transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span className="hidden sm:inline">Running…</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Run Pipeline
              </>
            )}
          </button>
        </div>

        {/* Right: utilities */}
        <div className="flex items-center gap-2">
          <IconButton icon={<Search className="w-4 h-4" />} label="Search" />
          <IconButton icon={<Bell className="w-4 h-4" />} label="Notifications" />
          <ThemeSwitch theme={theme} onToggle={onToggleTheme} />
        </div>
      </div>
    </header>
  );
}

function IconButton({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <button
      aria-label={label}
      className="p-2 rounded-lg text-content-muted hover:text-content-primary hover:bg-surface-soft border border-transparent hover:border-border-subtle transition-all"
    >
      {icon}
    </button>
  );
}
