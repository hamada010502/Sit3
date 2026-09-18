import { Shell } from '@/components/Shell';
import { requireAdmin } from '@/lib/guards';
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  requireAdmin();
  return <Shell wide>{children}</Shell>;
}
