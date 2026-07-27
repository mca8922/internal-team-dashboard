'use client';
import React from 'react';
import { Avatar } from '@/components/ui';

export function AvatarLightbox({
  name,
  avatarUrl,
  roleBadge,
  jobTitle,
  department,
  joinedLabel,
  online,
  lastSeenLabel,
  triggerSize = 'xl',
  hintAlign = 'center',
}: {
  name: string;
  avatarUrl: string | null;
  /** "Founder" | "Director" | null — omitted for regular members */
  roleBadge: string | null;
  jobTitle: string | null;
  department: string;
  joinedLabel: string;
  online: boolean;
  lastSeenLabel: string;
  /** Size of the clickable avatar trigger. Defaults to 'xl'. */
  triggerSize?: 'sm' | 'md' | 'lg' | 'xl';
  /** Which edge the pop-down tooltip anchors to. Use 'right' when the avatar is near the viewport edge. */
  hintAlign?: 'center' | 'right';
}) {
  const [open, setOpen] = React.useState(false);
  const initial = name.trim().charAt(0).toUpperCase();

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  React.useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  return (
    <>
      <button
        type="button"
        className={`avatar-lb-trigger${hintAlign === 'right' ? ' avatar-lb-trigger--right' : ''}`}
        onClick={() => setOpen(true)}
        title="View profile"
      >
        <Avatar name={name} size={triggerSize} src={avatarUrl} />
        <span className="avatar-lb-hint" aria-hidden>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
          {hintAlign === 'right' ? 'View profile' : null}
        </span>
      </button>

      {open && (
        <div
          className="avatar-lb-overlay"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal
          aria-label={`${name}'s profile`}
        >
          <div className="avatar-lb-card" onClick={(e) => e.stopPropagation()}>
            <div className="avatar-lb-top-accent" />
            <div className="avatar-lb-dotgrid" aria-hidden />
            <div className="avatar-lb-blob avatar-lb-blob--a" aria-hidden />
            <div className="avatar-lb-blob avatar-lb-blob--b" aria-hidden />
            <div className="avatar-lb-watermark" aria-hidden>{initial}</div>

            <div className="avatar-lb-corner-brand" aria-hidden>
              {(['M','C','A'] as const).map((ch, i) => (
                <span key={i}>{ch}</span>
              ))}
            </div>

            <button
              type="button"
              className="avatar-lb-close"
              onClick={() => setOpen(false)}
              aria-label="Close"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>

            <div className="avatar-lb-body">
              <div className="avatar-lb-photo-wrap">
                <div className="avatar-lb-photo-glow" />
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={avatarUrl}
                    alt={name}
                    className="avatar-lb-img"
                    draggable={false}
                  />
                ) : (
                  <div className="avatar-lb-initials-wrap">
                    <Avatar name={name} size="xl" src={null} />
                  </div>
                )}
                <span className={`avatar-lb-status-dot ${online ? 'is-online' : ''}`} />
              </div>

              <div className="avatar-lb-info">
                <div className="avatar-lb-badges">
                  {roleBadge ? (
                    <span className="avatar-lb-badge avatar-lb-badge--role">{roleBadge}</span>
                  ) : null}
                  <span className="avatar-lb-badge">{department}</span>
                </div>

                <div className="avatar-lb-name">{name}</div>
                {jobTitle ? <div className="avatar-lb-jobtitle">{jobTitle}</div> : null}

                <div className="avatar-lb-divider" />

                <div className="avatar-lb-facts">
                  <div className="avatar-lb-fact">
                    <span className={`dot ${online ? 'dot-green' : 'dot-grey'}`} />
                    {online ? 'Online now · in the dashboard' : lastSeenLabel}
                  </div>
                  <div className="avatar-lb-fact">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                    </svg>
                    Member since {joinedLabel}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
