'use client';
import { useState } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { deleteAddressAction } from './actions';
import { AddressForm } from './AddressForm';
import type { CustomerAddress } from '@/lib/types';

export function AddressList({ addresses }: { addresses: CustomerAddress[] }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-4">
      {addresses.length === 0 && <div className="alert-info">{t('account_no_addresses')}</div>}

      {addresses.map((a) => editing === a.id ? (
        <div key={a.id}><AddressForm existing={a} onDone={() => setEditing(null)} /></div>
      ) : (
        <div key={a.id} className="card-pad text-sm flex items-start justify-between gap-3">
          <div>
            <div className="font-semibold flex items-center gap-2">
              {a.label || a.governorate}
              {!!a.is_default && <span className="badge bg-ink/8 text-ink-soft">{t('account_default_address')}</span>}
            </div>
            <div className="text-ink-soft">{a.full_name} · <span dir="ltr">{a.phone}</span></div>
            <div className="text-ink-soft">{a.address}, {a.governorate}</div>
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            <button type="button" className="link text-sm" onClick={() => setEditing(a.id)}>{t('account_edit_address')}</button>
            <form action={deleteAddressAction.bind(null, a.id)}>
              <button type="submit" className="link text-sm text-cherry">{t('account_delete_address')}</button>
            </form>
          </div>
        </div>
      ))}

      {adding ? (
        <AddressForm onDone={() => setAdding(false)} />
      ) : (
        <button type="button" className="btn-secondary" onClick={() => setAdding(true)}>{t('account_add_address')}</button>
      )}
    </div>
  );
}
