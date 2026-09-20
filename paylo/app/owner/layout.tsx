import Link from 'next/link';
import { requireOwner } from '@/lib/guards';

/**
 * Deliberately NOT using components/Nav.tsx or components/Shell.tsx — this keeps
 * /owner from ever being reachable through the shared navigation used by admin,
 * seller, and buyer pages, and keeps this layout free of any accidental link back
 * into it from elsewhere. Nothing in this app links here; the URL has to be known.
 */
export default function OwnerLayout({ children }: { children: React.ReactNode }) {
  requireOwner();
  return (
    <div className="min-h-screen flex flex-col bg-cream">
      <header className="border-b border-ink/10 bg-ink text-cream">
        <div className="mx-auto max-w-7xl px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6 text-sm">
            <span className="font-semibold tracking-tight">Paylo — Owner</span>
            <Link href="/owner" className="text-cream/70 hover:text-cream">Overview</Link>
            <Link href="/owner/registrations" className="text-cream/70 hover:text-cream">Registrations</Link>
            <Link href="/owner/analytics" className="text-cream/70 hover:text-cream">Market analytics</Link>
          </div>
          <form action="/logout" method="post">
            <button className="text-sm text-cream/70 hover:text-cream">Log out</button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-7xl w-full px-4 py-8 flex-1">{children}</main>
    </div>
  );
}
