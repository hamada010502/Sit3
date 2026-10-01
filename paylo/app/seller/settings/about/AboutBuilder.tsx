'use client';
/* eslint-disable @next/next/no-img-element */
import { useState } from 'react';
import { useFormState } from 'react-dom';
import { saveAboutAction } from './actions';
import { useI18n } from '@/lib/i18n/client';
import { SubmitButton } from '@/components/SubmitButton';
import type { TKey } from '@/lib/i18n';
import type { AboutSection } from '@/lib/types';

interface Row extends AboutSection { uid: string }
const uid = () => Math.random().toString(36).slice(2, 10);

export function AboutBuilder({ initial, max, previewHref }: { initial: AboutSection[]; max: number; previewHref: string }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<Row[]>(initial.map((s) => ({ ...s, uid: uid() })));
  const [state, action] = useFormState(saveAboutAction, null);
  const set = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, d: -1 | 1) => setRows((r) => {
    const j = i + d; if (j < 0 || j >= r.length) return r;
    const n = [...r]; [n[i], n[j]] = [n[j], n[i]]; return n;
  });
  return (
    <form action={action} className="space-y-4" encType="multipart/form-data">
      {state?.error && <div className="alert-error">{t(state.error as TKey)}</div>}
      {state?.ok && <div className="alert-success">{t('settings_saved')} · <a href={previewHref} target="_blank" rel="noreferrer" className="link">{t('about_view')}</a></div>}
      {rows.map((r, i) => (
        <div key={r.uid} className="card-pad space-y-3" data-about-row>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-ink-soft">{t('about_section')} {i + 1}</span>
            <div className="flex gap-1">
              <button type="button" className="btn-ghost btn-sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t('about_move_up')}>↑</button>
              <button type="button" className="btn-ghost btn-sm" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label={t('about_move_down')}>↓</button>
              <button type="button" className="btn-ghost btn-sm text-danger" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>{t('delete')}</button>
            </div>
          </div>
          <input className="input" placeholder={t('about_heading')} value={r.heading} maxLength={80} onChange={(e) => set(i, { heading: e.target.value })} aria-label={t('about_heading')} />
          <textarea className="input" rows={4} placeholder={t('about_body')} value={r.body} maxLength={2000} onChange={(e) => set(i, { body: e.target.value })} aria-label={t('about_body')} />
          {r.image ? (
            <div className="flex items-center gap-3">
              <img src={r.image} alt="" className="h-16 w-24 rounded object-cover border border-ink/10" />
              <button type="button" className="btn-ghost btn-sm" onClick={() => set(i, { image: null })}>{t('remove')}</button>
            </div>
          ) : <input type="file" name={`about_image_${r.uid}`} accept="image/jpeg,image/png,image/webp" className="text-sm" />}
        </div>
      ))}
      {rows.length < max && (
        <button type="button" className="btn-secondary" onClick={() => setRows((r) => [...r, { uid: uid(), heading: '', body: '', image: null }])}>+ {t('about_add_section')}</button>
      )}
      <input type="hidden" name="sections" value={JSON.stringify(rows)} />
      <div><SubmitButton className="btn-primary">{t('save')}</SubmitButton></div>
    </form>
  );
}
