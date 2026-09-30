'use client';
import { useRef } from 'react';
import { useFormState } from 'react-dom';
import { savePresetAction } from './actions';
import { useI18n } from '@/lib/i18n/client';
import { Field } from '@/components/Field';
import { SubmitButton } from '@/components/SubmitButton';
import type { TKey } from '@/lib/i18n';
import type { VariationPreset } from '@/lib/types';

export function PresetForm({ preset }: { preset?: VariationPreset }) {
  const { t } = useI18n();
  const ref = useRef<HTMLFormElement>(null);
  const [state, action] = useFormState(async (p: { error?: string; ok?: boolean } | null, fd: FormData) => {
    const r = await savePresetAction(preset?.id ?? null, p, fd);
    if (r.ok && !preset) ref.current?.reset();
    return r;
  }, null);
  return (
    <form ref={ref} action={action} className="space-y-3" data-testid={preset ? `preset-${preset.name}` : 'preset-new'}>
      {state?.error && <div className="alert-error">{t(state.error as TKey)}</div>}
      <div className="grid sm:grid-cols-3 gap-3">
        <Field label={t('variation_name')}><input name="name" className="input" required defaultValue={preset?.name} placeholder="Size" /></Field>
        <div className="sm:col-span-2">
          <Field label={t('variation_values')} hint={t('variation_values_hint')}>
            <input name="values" className="input" required defaultValue={preset?.values.join(', ')} placeholder="S, M, L, XL" />
          </Field>
        </div>
      </div>
      <SubmitButton className="btn-primary btn-sm">{preset ? t('save') : t('variation_add')}</SubmitButton>
    </form>
  );
}
