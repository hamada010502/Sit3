import Link from 'next/link';

type Icon = 'box' | 'folder' | 'tag' | 'sliders' | 'return' | 'receipt';
const PATHS: Record<Icon, string> = {
  box: 'M3 7l9-4 9 4-9 4-9-4zm0 0v10l9 4 9-4V7M12 11v10',
  folder: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z',
  tag: 'M3 12V4h8l10 10-8 8L3 12zm5-4h.01',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  return: 'M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-4',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3zm3 5h6M9 12h6',
};

/** One empty-state pattern for every seller list: what this page is for, and the next step. */
export function EmptyState({ icon, title, body, action }: { icon: Icon; title: string; body: string; action?: { href: string; label: string } }) {
  return (
    <div className="card-pad text-center py-10 px-6" data-testid="empty-state">
      <svg viewBox="0 0 24 24" className="mx-auto h-10 w-10 text-cherry/70" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={PATHS[icon]} />
      </svg>
      <h2 className="mt-3 font-bold text-lg">{title}</h2>
      <p className="mt-1 text-sm text-ink-soft max-w-md mx-auto">{body}</p>
      {action && <Link href={action.href} className="btn-primary mt-5">{action.label}</Link>}
    </div>
  );
}
