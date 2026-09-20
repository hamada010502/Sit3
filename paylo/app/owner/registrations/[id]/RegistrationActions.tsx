'use client';
import { useFormState } from 'react-dom';
import { approveAction, rejectAction, requestInfoAction, type RegActionState } from '../actions';
import { SubmitButton } from '@/components/SubmitButton';
import type { RegistrationStatus } from '@/lib/types';

export function RegistrationActions({ id, status }: { id: string; status: RegistrationStatus }) {
  const [approveState, approve] = useFormState(approveAction.bind(null, id), null as RegActionState | null);
  const [rejectState, reject] = useFormState(rejectAction.bind(null, id), null as RegActionState | null);
  const [infoState, requestInfo] = useFormState(requestInfoAction.bind(null, id), null as RegActionState | null);

  if (status === 'APPROVED' || status === 'REJECTED') {
    return <div className="alert-info">This request is closed — no further action available.</div>;
  }

  return (
    <div className="space-y-5">
      {approveState?.error && <div className="alert-error">{approveState.error}</div>}
      <form action={approve} className="card-pad border-success/25 bg-success/5">
        <h3 className="font-semibold">Approve</h3>
        <p className="text-sm text-ink-soft mt-1 mb-3">Creates the store immediately, live and approved. The applicant is emailed to log in with the password they registered with.</p>
        <SubmitButton className="btn-primary">Approve &amp; create store</SubmitButton>
      </form>

      {infoState?.error && <div className="alert-error">{infoState.error}</div>}
      <form action={requestInfo} className="card-pad border-warn/25 bg-warn/5 space-y-3">
        <h3 className="font-semibold">Request more information</h3>
        <p className="text-sm text-ink-soft">The applicant is always notified with this note.</p>
        <textarea name="note" className="input" rows={3} required placeholder="What's missing or unclear?" />
        <SubmitButton className="btn-secondary">Send request</SubmitButton>
      </form>

      {rejectState?.error && <div className="alert-error">{rejectState.error}</div>}
      <form action={reject} className="card-pad border-cherry/25 bg-cherry/5 space-y-3">
        <h3 className="font-semibold">Reject</h3>
        <textarea name="note" className="input" rows={3} required placeholder="Internal note (required)" />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="notify" className="accent-cherry h-4 w-4" defaultChecked />
          Notify the applicant by email
        </label>
        <SubmitButton className="btn-danger">Reject</SubmitButton>
      </form>
    </div>
  );
}
