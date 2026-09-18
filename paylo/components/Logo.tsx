export function LogoIcon({ size = 32 }: { size?: number }) {
  // Chevron (movement/delivery) resting on a bar (the link/transaction) — symmetric so it reads the same in RTL.
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#273248" />
      <path d="M20 40 L32 20 L44 40" fill="none" stroke="#FC7643" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 44 H50" stroke="#FFA364" strokeWidth="6" strokeLinecap="round" />
    </svg>
  );
}
export function Logo({ size = 32, wordmark = true, dark = false }: { size?: number; wordmark?: boolean; dark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <LogoIcon size={size} />
      {wordmark && <span className={`font-bold tracking-tight ${dark ? 'text-karry' : 'text-bluewood'}`} style={{ fontSize: size * 0.7 }}>Paylo</span>}
    </span>
  );
}
