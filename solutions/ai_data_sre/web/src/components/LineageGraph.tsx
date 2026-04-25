import { useMemo } from 'react';
import type { BlastRadius } from '../types';

interface Props {
  blastRadius: BlastRadius;
  omBaseUrl: string;
}

export function LineageGraph({ blastRadius, omBaseUrl }: Props) {
  const rootTable = blastRadius.root_cause_table.split('.').pop() ?? blastRadius.root_cause_table;

  const upstream = useMemo(
    () =>
      blastRadius.upstream_chain.map((a) => ({
        name: a.fqn.split('.').pop() ?? a.fqn,
        fqn: a.fqn,
        tier: a.tier,
        owners: a.owners,
        depth: a.depth,
      })),
    [blastRadius.upstream_chain]
  );

  const downstream = useMemo(
    () =>
      blastRadius.downstream_impact.map((a) => ({
        name: a.fqn.split('.').pop() ?? a.fqn,
        fqn: a.fqn,
        tier: a.tier,
        owners: a.owners,
        depth: a.depth,
      })),
    [blastRadius.downstream_impact]
  );

  return (
    <div className="overflow-x-auto">
      <div className="flex items-center justify-center gap-2 min-w-max py-4">
        {/* Upstream nodes */}
        {upstream.map((node, i) => (
          <div key={`up-${i}`} className="flex items-center gap-2">
            <NodeBox
              name={node.name}
              fqn={node.fqn}
              tier={node.tier}
              owners={node.owners}
              variant="upstream"
              omBaseUrl={omBaseUrl}
            />
            <Arrow />
          </div>
        ))}

        {/* Root cause node */}
        <NodeBox
          name={rootTable}
          fqn={blastRadius.root_cause_table}
          tier={null}
          owners={[]}
          variant="root"
          omBaseUrl={omBaseUrl}
          column={blastRadius.root_cause_column ?? undefined}
        />

        {/* Downstream nodes */}
        {downstream.map((node, i) => (
          <div key={`down-${i}`} className="flex items-center gap-2">
            <Arrow />
            <NodeBox
              name={node.name}
              fqn={node.fqn}
              tier={node.tier}
              owners={node.owners}
              variant="downstream"
              omBaseUrl={omBaseUrl}
            />
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex justify-center gap-6 mt-4 text-xs text-content-muted">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-secondary-500/30 border border-secondary-500/50" />
          Upstream
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-danger/30 border border-danger/50" />
          Root Cause
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-warning/30 border border-warning/50" />
          Downstream
        </span>
      </div>
    </div>
  );
}

function NodeBox({
  name,
  fqn,
  tier,
  owners,
  variant,
  omBaseUrl,
  column,
}: {
  name: string;
  fqn: string;
  tier: string | null;
  owners: string[];
  variant: 'upstream' | 'root' | 'downstream';
  omBaseUrl: string;
  column?: string;
}) {
  const styles = {
    upstream: 'bg-secondary-500/10 border-secondary-500/40 hover:border-secondary-400',
    root: 'bg-danger/15 border-danger/50 hover:border-danger ring-2 ring-danger/20 shadow-glow',
    downstream: 'bg-warning/10 border-warning/40 hover:border-warning',
  };

  return (
    <a
      href={`${omBaseUrl}/table/${fqn}`}
      target="_blank"
      rel="noopener noreferrer"
      className={`block border rounded-xl p-3 min-w-[140px] text-center transition-all hover:shadow-card ${styles[variant]}`}
    >
      <p className="text-sm font-semibold text-content-primary">{name}</p>
      {column && (
        <p className="text-xs text-danger mt-0.5">⚠ {column}</p>
      )}
      {tier && (
        <span className="inline-block text-xs px-1.5 py-0.5 mt-1 bg-primary-500/10 text-primary-400 border border-primary-500/20 rounded-lg">
          {tier.replace('Tier.', '')}
        </span>
      )}
      {owners.length > 0 && (
        <p className="text-xs text-content-muted mt-1">{owners.join(', ')}</p>
      )}
    </a>
  );
}

function Arrow() {
  return (
    <div className="flex items-center text-content-faint">
      <div className="w-8 h-px bg-border-strong" />
      <svg viewBox="0 0 8 12" className="w-2 h-3 fill-content-faint">
        <polygon points="0,0 8,6 0,12" />
      </svg>
    </div>
  );
}
