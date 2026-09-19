'use client';
import { useEffect, useState } from 'react';

/**
 * One loader, three variants, one cycle.
 *
 * Two loaders on a screen running at different tempos read as two unrelated things
 * loading, so the cycle length is exported and every variant shares it. Align any other
 * ambient motion to the same beat.
 *
 * The `bar` variant sweeps; it never fills. Determinate progress on a wait of unknown
 * length promises a finish time nobody knows. When a wait can run long, pass `showElapsed`
 * instead: real elapsed time is honest and still reassuring.
 */
export const AI_LOADER_CYCLE_SECONDS = 1.4;

export type LoaderVariant = 'dots' | 'bar' | 'grid';

interface Props {
  variant?: LoaderVariant;
  label?: string;
  showElapsed?: boolean;
  className?: string;
}

function Elapsed() {
  const [s, setS] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => setS(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  const mm = Math.floor(s / 60);
  return <span className="tabular-nums text-xs text-ink-soft">{mm ? `${mm}m ` : ''}{s % 60}s</span>;
}

export default function Loader({ variant = 'dots', label, showElapsed = false, className = '' }: Props) {
  const style = { '--ld-cycle': `${AI_LOADER_CYCLE_SECONDS}s` } as React.CSSProperties;
  return (
    <div role="status" aria-live="polite" className={`inline-flex items-center gap-3 text-cherry ${className}`} style={style}>
      {variant === 'dots' && <span className="ld" aria-hidden="true"><i className="ld-dot" /><i className="ld-dot" /><i className="ld-dot" /></span>}
      {variant === 'bar' && <span className="ld-track" aria-hidden="true"><i className="ld-sweep" /></span>}
      {variant === 'grid' && (
        <span className="ld-grid" aria-hidden="true">
          {Array.from({ length: 9 }, (_, i) => (
            <i key={i} className="ld-cell" style={{ animationDelay: `${(i % 3 + Math.floor(i / 3)) * (AI_LOADER_CYCLE_SECONDS / 9)}s` }} />
          ))}
        </span>
      )}
      {label && <span className="text-sm text-ink-soft">{label}</span>}
      {showElapsed && <Elapsed />}
      <span className="sr-only">{label || 'Loading'}</span>
    </div>
  );
}
