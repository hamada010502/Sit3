'use client';
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n/client';

const MAX = 5;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 4 * 1024 * 1024;

type Item = { key: string; kind: 'existing'; src: string } | { key: string; kind: 'new'; src: string; file: File };
let seq = 0;

/**
 * Drag-and-drop / multi-select image picker with reordering. The first image is the cover.
 * Posts `image_order` (existing paths and "new:<n>" tokens, in display order) plus the new
 * files in a hidden `images` input, rebuilt via DataTransfer so file n matches "new:<n>".
 * Reorder works by drag (mouse) and by ←/→ buttons (touch and keyboard).
 */
export function ImageManager({ initial }: { initial: string[] }) {
  const { t } = useI18n();
  const [items, setItems] = useState<Item[]>(initial.map((src) => ({ key: `e${seq++}`, kind: 'existing', src })));
  const [err, setErr] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const drag = useRef<number | null>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!filesInput.current || typeof DataTransfer === 'undefined') return;
    const dt = new DataTransfer();
    for (const it of items) if (it.kind === 'new') dt.items.add(it.file);
    filesInput.current.files = dt.files;
  }, [items]);

  const add = (files: FileList | File[]) => {
    const list = Array.from(files);
    const good = list.filter((f) => TYPES.includes(f.type) && f.size <= MAX_BYTES);
    const room = MAX - items.length;
    setItems((cur) => [...cur, ...good.slice(0, Math.max(0, MAX - cur.length)).map((file) => ({ key: `n${seq++}`, kind: 'new' as const, file, src: URL.createObjectURL(file) }))]);
    setErr(good.length < list.length ? t('images_bad_file') : good.length > room ? t('images_too_many', { n: MAX }) : null);
  };
  const move = (from: number, to: number) => setItems((cur) => {
    if (to < 0 || to >= cur.length || from === to) return cur;
    const n = [...cur]; const [x] = n.splice(from, 1); n.splice(to, 0, x); return n;
  });

  let newIdx = 0;
  const order = items.map((it) => (it.kind === 'existing' ? it.src : `new:${newIdx++}`));

  return (
    <div className="space-y-3" data-testid="image-manager">
      <input type="hidden" name="image_order" value={JSON.stringify(order)} />
      <input ref={filesInput} type="file" name="images" multiple className="hidden" tabIndex={-1} aria-hidden="true" />
      {items.length > 0 && (
        <ol className="grid grid-cols-3 sm:grid-cols-5 gap-3" aria-label={t('images_order')}>
          {items.map((it, i) => (
            <li key={it.key} draggable data-image-item={i}
              onDragStart={() => { drag.current = i; }} onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (drag.current !== null) move(drag.current, i); drag.current = null; }}
              className="relative rounded-lg border border-ink/10 bg-white overflow-hidden cursor-move">
              <img src={it.src} alt="" className="aspect-square w-full object-cover" />
              {i === 0 && <span className="absolute top-1 start-1 badge bg-ink text-white text-[10px]">{t('images_cover')}</span>}
              <div className="flex justify-between bg-white/90">
                <button type="button" className="tap px-2 text-sm disabled:opacity-30" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={t('images_move_earlier')}>‹</button>
                <button type="button" className="tap px-2 text-sm text-danger" onClick={() => setItems((c) => c.filter((_, j) => j !== i))} aria-label={t('remove')}>×</button>
                <button type="button" className="tap px-2 text-sm disabled:opacity-30" onClick={() => move(i, i + 1)} disabled={i === items.length - 1} aria-label={t('images_move_later')}>›</button>
              </div>
            </li>
          ))}
        </ol>
      )}
      {items.length < MAX && (
        <div role="button" tabIndex={0} data-testid="image-drop"
          onClick={() => picker.current?.click()} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); picker.current?.click(); } }}
          onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) add(e.dataTransfer.files); }}
          className={`rounded-xl border-2 border-dashed p-6 text-center text-sm cursor-pointer transition-colors ${over ? 'border-brand bg-brand/5' : 'border-ink/20 hover:border-ink/40'}`}>
          <strong className="block">{t('images_drop')}</strong>
          <span className="text-ink-soft">{t('images_hint')}</span>
          <input ref={picker} type="file" multiple accept={TYPES.join(',')} className="hidden" data-testid="image-picker"
            onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = ''; }} />
        </div>
      )}
      {err && <p className="text-sm text-danger" role="alert">{err}</p>}
      <p className="text-xs text-ink-soft">{t('images_reorder_hint')}</p>
    </div>
  );
}
