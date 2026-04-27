import { GitBranch, Settings } from 'lucide-react';

function PlaceholderPage({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center">
      <div className="w-16 h-16 mb-4 rounded-2xl bg-primary-500/10 border border-border-subtle flex items-center justify-center">
        {icon}
      </div>
      <h2 className="text-lg font-bold text-content-primary mb-2">{title}</h2>
      <p className="text-sm text-content-muted max-w-sm">{description}</p>
    </div>
  );
}

export function LineagePage() {
  return (
    <PlaceholderPage
      icon={<GitBranch className="w-8 h-8 text-primary-400" />}
      title="Lineage Explorer"
      description="Full lineage graph coming soon. Run the pipeline and click into an incident to see blast radius lineage."
    />
  );
}

export function SettingsPage() {
  return (
    <PlaceholderPage
      icon={<Settings className="w-8 h-8 text-primary-400" />}
      title="Settings"
      description="Configure OpenMetadata connection, Slack integration, and pipeline schedule."
    />
  );
}
