'use client';
import { useFormStatus } from 'react-dom';
import Loader from './Loader';

/** While a server action is in flight the label is replaced by the shared loader beat. */
export function SubmitButton({ children, className = 'btn-primary', pendingText }: { children: React.ReactNode; className?: string; pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? (
        <span className="inline-flex items-center gap-2">
          <Loader variant="dots" className="text-current" />
          {pendingText && <span>{pendingText}</span>}
        </span>
      ) : children}
    </button>
  );
}
