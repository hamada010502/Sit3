import fs from 'fs/promises';
import path from 'path';
import { MIME, UPLOAD_DIR, UPLOAD_NAME_RE } from '@/lib/uploads';

export async function GET(_req: Request, { params }: { params: { name: string } }) {
  const name = params.name;
  if (!UPLOAD_NAME_RE.test(name)) return new Response('Not found', { status: 404 });
  try {
    const buf = await fs.readFile(path.join(UPLOAD_DIR, name));
    const ext = name.split('.').pop()!;
    return new Response(buf, { headers: { 'content-type': MIME[ext], 'cache-control': 'public, max-age=31536000, immutable' } });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
