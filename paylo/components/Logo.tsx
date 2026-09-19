/**
 * Paylo logo system.
 * The mark is a ring holding an upward chevron and a dot — the same primitive vocabulary
 * as the product glyphs. It is vertically symmetric, so RTL needs no mirrored variant,
 * and the ring lets it stand in for the "o" of Paylo in headline use.
 */
export type Mono = 'cream' | 'ink' | 'cherry';
const INK = { cream: '#EFE6DE', ink: '#2A1A17', cherry: '#9A0002' } as const;

interface MarkProps { size?: number; mono?: Mono; onDark?: boolean; title?: string }

export function LogoMark({ size = 34, mono, onDark = false, title }: MarkProps) {
  const ring = mono ? INK[mono] : onDark ? '#EFE6DE' : '#2A1A17';
  const mark = mono ? INK[mono] : onDark ? '#EFE6DE' : '#9A0002';
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" role={title ? 'img' : 'presentation'} aria-label={title} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <circle cx="50" cy="50" r="37" stroke={ring} strokeWidth="9" />
      <path d="M34 57 L50 38 L66 57" stroke={mark} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="50" cy="70" r="5.5" fill={mark} />
    </svg>
  );
}

export function Logo({ size = 32, onDark = false, mono, wordmark = true }: { size?: number; onDark?: boolean; mono?: Mono; wordmark?: boolean }) {
  const word = mono ? INK[mono] : onDark ? '#EFE6DE' : '#2A1A17';
  return (
    <span className="inline-flex items-center gap-2.5 align-middle">
      <LogoMark size={size} mono={mono} onDark={onDark} title="Paylo" />
      {wordmark && <span style={{ color: word, fontSize: size * 0.7, letterSpacing: '-0.03em' }} className="font-semibold leading-none">Paylo</span>}
    </span>
  );
}

/** Headline treatment: the mark stands in for the "o". */
export function WordmarkWithMark({ size = 56, onDark = false }: { size?: number; onDark?: boolean }) {
  return (
    <span className="inline-flex items-center align-middle" style={{ fontSize: size, letterSpacing: '-0.03em' }}>
      <span className="font-semibold leading-none" style={{ color: onDark ? '#EFE6DE' : '#2A1A17' }}>Payl</span>
      <LogoMark size={size * 0.84} onDark={onDark} title="Paylo" />
    </span>
  );
}
