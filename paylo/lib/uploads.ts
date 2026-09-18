import path from 'path';
/** Uploaded product images live outside `public/` so they work at runtime in production (Next snapshots `public/` at build time). */
export const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'data', 'uploads');
export const UPLOAD_NAME_RE = /^[a-f0-9]{20}\.(jpg|png|webp)$/;
export const MIME: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
