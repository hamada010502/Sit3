/**
 * Paylo logo system (Full Spec v2 §1.2).
 * Mark: circular containment holding an upward directional chevron plus a dot —
 * geometric and vertically symmetric, so it reads identically in LTR and RTL lockups.
 *
 *  <LogoMark />                 icon / app icon / favicon
 *  <Logo />                     primary horizontal lockup (symbol + wordmark)
 *  <Logo mono="white" />        monochrome for dark or light surfaces
 *  <WordmarkWithMark />         the mark substituted for the "o" in Payl(o) — headline use
 *  <LogoLoader />               animated mark for loading states
 */
export type Mono = 'white' | 'black' | 'tide' | 'rose';
const INK = { white: '#FFFFFF', black: '#16203F', tide: '#384D95', rose: '#E63E88' } as const;

interface MarkProps { size?: number; mono?: Mono; ringColor?: string; markColor?: string; title?: string }

export function LogoMark({ size = 36, mono, ringColor = '#FFFFFF', markColor = '#E63E88', title }: MarkProps) {
  const ring = mono ? INK[mono] : ringColor;
  const mark = mono ? INK[mono] : markColor;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" role={title ? 'img' : 'presentation'} aria-label={title} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <circle cx="50" cy="50" r="37" stroke={ring} strokeWidth="10" />
      <path d="M33 57 L50 37 L67 57" stroke={mark} strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="50" cy="70" r="6" fill={mark} />
    </svg>
  );
}

/** Primary horizontal lockup. `onDark` flips the wordmark and ring for deep surfaces. */
export function Logo({ size = 34, onDark = false, mono, wordmark = true }: { size?: number; onDark?: boolean; mono?: Mono; wordmark?: boolean }) {
  const word = mono ? INK[mono] : onDark ? '#FFFFFF' : '#1E2748';
  return (
    <span className="inline-flex items-center gap-2.5 align-middle">
      <LogoMark size={size} mono={mono} ringColor={onDark ? '#FFFFFF' : '#384D95'} title="Paylo" />
      {wordmark && (
        <span style={{ color: word, fontSize: size * 0.72, letterSpacing: '-0.035em' }} className="font-extrabold leading-none">Paylo</span>
      )}
    </span>
  );
}

/** Headline treatment: the mark stands in for the "o" of Paylo. */
export function WordmarkWithMark({ size = 56, onDark = true }: { size?: number; onDark?: boolean }) {
  return (
    <span className="inline-flex items-center align-middle" style={{ fontSize: size, letterSpacing: '-0.035em' }}>
      <span className="font-extrabold leading-none" style={{ color: onDark ? '#FFFFFF' : '#1E2748' }}>Payl</span>
      <LogoMark size={size * 0.84} ringColor={onDark ? '#FFFFFF' : '#384D95'} title="Paylo" />
    </span>
  );
}

/** Loading state: the ring traces while the chevron breathes. Motion is subtle, never bouncy. */
export function LogoLoader({ size = 48, label }: { size?: number; label?: string }) {
  return (
    <div className="inline-flex flex-col items-center gap-3" role="status" aria-live="polite">
      <svg width={size} height={size} viewBox="0 0 100 100" fill="none" className="pl-loader" aria-hidden="true">
        <circle cx="50" cy="50" r="37" stroke="#384D95" strokeOpacity=".18" strokeWidth="10" />
        <circle cx="50" cy="50" r="37" stroke="#E63E88" strokeWidth="10" strokeLinecap="round" className="pl-loader-ring" />
        <path d="M33 57 L50 37 L67 57" stroke="#384D95" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" className="pl-loader-mark" />
        <circle cx="50" cy="70" r="6" fill="#384D95" className="pl-loader-mark" />
      </svg>
      {label && <span className="text-sm font-medium text-ink-soft">{label}</span>}
    </div>
  );
}
