import { SubmitButton } from '@/components/SubmitButton';
import { EmptyState } from '@/components/EmptyState';
import { requireApprovedSeller } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import { sellerPresets } from '@/lib/variations';
import { deletePresetAction } from './actions';
import { PresetForm } from './PresetForm';

export default function VariationsPage() {
  const { seller } = requireApprovedSeller();
  const { t } = getT();
  const presets = sellerPresets(seller.id);
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="section-title">{t('variations_title')}</h1>
        <p className="mt-1 text-sm text-ink-soft">{t('variations_sub')}</p>
      </div>
      <div className="card-pad"><PresetForm /></div>
      {presets.length === 0 ? <EmptyState icon="sliders" title={t('variations_none')} body={t('empty_variations_body')} /> : presets.map((p) => (
        <div key={p.id} className="card-pad space-y-3">
          <PresetForm preset={p} />
          <form action={deletePresetAction.bind(null, p.id)}><SubmitButton className="btn-ghost btn-sm text-cherry">{t('delete')}</SubmitButton></form>
        </div>
      ))}
    </div>
  );
}
