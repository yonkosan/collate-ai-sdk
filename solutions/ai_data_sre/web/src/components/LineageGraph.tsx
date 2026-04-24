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

      <div className="flex justify-center gap-6 mt-4 text-xs text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-blue-500/30 border border-blue-500/50" />
          Upstream
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-red-500/30 border border-red-500/50" />
          Root Cause
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-orange-500/30 border border-orange-500/50" />
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
    upstream: 'bg-blue-500/10 border-blue-500/40 hover:border-blue-400',
    root: 'bg-red-500/15 border-red-500/50 hover:border-red-400 ring-2 ring-red-500/20',
    downstream: 'bg-orange-500/10 border-orange-500/40 hover:border-orange-400',
  };

  return (
    <a
      href={`${omBaseUrl}/table/${fqn}`}
      target="_blank"
      rel="noopener noreferrer"
      className={`block border rounded-lg p-3 min-w-[140px] text-center transition-colors ${styles[variant]}`}
    >
      <p className="text-sm font-semibold text-white">{name}</p>
      {column && (
        <p className="text-xs text-red-300 mt-0.5">⚠ {column}</p>
      )}
      {tier && (
        <span className="inline-block text-xs px-1.5 py-0.5 mt-1 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded">
          {tier.replace('Tier.', '')}
        </span>
      )}
      {owners.length > 0 && (
        <p className="text-xs text-gray-500 mt-1">{owners.join(', ')}</p>
      )}
    </a>
  );
}

function Arrow() {
  return (
    <div className="flex items-center text-gray-500">
      <div className="w-8 h-px bg-gray-600" />
      <svg viewBox="0 0 8 12" className="w-2 h-3 fill-gray-500">
        <polygon points="0,0 8,6 0,12" />
      </svg>
    </div>
  );
}
