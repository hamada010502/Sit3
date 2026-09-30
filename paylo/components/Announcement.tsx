export function Announcement({ text }: { text: string | null }) {
  if (!text) return null;
  return <div className="rounded-xl bg-ink text-cream px-4 py-2.5 text-sm text-center mb-4" role="status" data-testid="store-announcement">{text}</div>;
}
