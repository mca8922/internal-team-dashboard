'use client';

// Last-resort boundary: catches errors thrown in the root layout itself, where
// the in-app (app)/error.tsx cannot help because the shell never mounted. It
// replaces the root layout, so it must render its own <html>/<body>, and it
// cannot rely on globals.css being loaded — styles are inlined.
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          fontFamily: 'system-ui, sans-serif',
          background: '#0B0B0B',
          color: '#FAFAF9',
          textAlign: 'center',
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 380 }}>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>🤖 Well, that&apos;s embarrassing.</h1>
          <p style={{ fontSize: 14, opacity: 0.7, marginBottom: 24, lineHeight: 1.5 }}>
            The app hit an unexpected error while loading. Please try again.
          </p>
          <button
            onClick={reset}
            style={{
              background: '#1F5C3E',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '10px 20px',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
