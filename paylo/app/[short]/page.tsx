import { notFound, redirect } from 'next/navigation';
import { getDb } from '@/lib/db';

/**
 * Short numeric product links: /<7 digits> → /p/<id>. Static routes always win over
 * this dynamic segment, so it only ever sees paths nothing else claimed; anything
 * that is not a known code is a plain 404.
 */
export default function ShortLink({ params }: { params: { short: string } }) {
  if (!/^\d{7}$/.test(params.short)) notFound();
  const p = getDb().prepare("SELECT id FROM products WHERE short_code = ? AND status != 'removed'").get(Number(params.short)) as { id: string } | undefined;
  if (!p) notFound();
  redirect(`/p/${p.id}`);
}
