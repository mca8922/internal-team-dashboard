'use client';

// Error boundary for every authenticated route. A failed data fetch or a
// thrown render previously left a blank screen; this catches it inside the
// app shell and offers a retry (reset re-renders the segment) plus a path
// back to a page that's still working. Deliberately plain — just an icon, a
// one-line message, and two buttons.
import { useEffect } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/Icon';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the error in the browser console / Vercel logs for debugging.
    console.error(error);
  }, [error]);

  return (
    <div className="error-page">
      <div className="error-state">
        <span className="error-state-icon">
          <Icon name="bot" size={40} stroke={1.4} />
        </span>
        <h3>Something went wrong</h3>
        <p>This page ran into an error. Try again, or head back to the dashboard.</p>
        <div className="error-simple-actions">
          <button type="button" className="btn" onClick={reset}>
            Try again
          </button>
          <Link href="/dashboard" className="btn btn-secondary">
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
