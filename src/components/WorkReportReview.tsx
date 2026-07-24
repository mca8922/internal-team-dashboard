'use client';

import * as React from 'react';
import { Avatar, Button } from './ui';
import { Icon } from './Icon';
import { useToast } from './Toast';
import { reviewerLabel } from '@/lib/roles';
import { fmtShort } from '@/lib/dates';
import { submitWorkReportReview } from '@/lib/actions';
import { RichTextEditor, RichText } from './RichTextEditor';
import type { WorkReportReview, UserRole } from '@/lib/types';

export interface ReviewerInfo {
  id: string;
  name: string;
  avatar_url: string | null;
  role: UserRole;
  is_manager: boolean | null;
}

// Five stars, filled up to `value`. Interactive when `onChange` is given.
export function StarRating({
  value,
  onChange,
  size = 16,
  ariaLabel = 'Rating',
}: {
  value: number;
  onChange?: (n: number) => void;
  size?: number;
  ariaLabel?: string;
}) {
  const [hover, setHover] = React.useState(0);
  const interactive = !!onChange;
  const shown = hover || value;
  if (!interactive) {
    return (
      <span className="star-rating" role="img" aria-label={`${value} out of 5 stars`}>
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} className={n <= value ? 'star-on' : 'star-off'}>
            <Icon name={n <= value ? 'star-filled' : 'star'} size={size} />
          </span>
        ))}
      </span>
    );
  }
  return (
    <span
      className="star-rating star-rating-input"
      role="radiogroup"
      aria-label={ariaLabel}
      onMouseLeave={() => setHover(0)}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={`star-btn${n <= shown ? ' star-on' : ' star-off'}`}
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          onMouseEnter={() => setHover(n)}
          onFocus={() => setHover(n)}
          onBlur={() => setHover(0)}
          onClick={() => onChange(n)}
        >
          <Icon name={n <= shown ? 'star-filled' : 'star'} size={size} />
        </button>
      ))}
    </span>
  );
}

// Read-only list of every review. currentUserId's card gets an Edit button.
export function WorkReportReviews({
  reviews,
  reviewerById,
  currentUserId,
  onEditOwn,
}: {
  reviews: WorkReportReview[];
  reviewerById: Record<string, ReviewerInfo>;
  currentUserId?: string;
  onEditOwn?: () => void;
}) {
  if (!reviews.length) return null;
  const ordered = [...reviews].sort((a, b) => a.created_at.localeCompare(b.created_at));
  return (
    <div className="wr-reviews">
      {ordered.map((r) => {
        const who = reviewerById[r.reviewer_id];
        const name = who?.name ?? 'A reviewer';
        const label = who
          ? reviewerLabel({ role: who.role, is_manager: who.is_manager })
          : 'Reviewer';
        const isOwn = currentUserId && r.reviewer_id === currentUserId;
        return (
          <div className={`wr-review${r.stars === 5 ? ' wr-review-top' : ''}`} key={r.id}>
            <Avatar name={name} size="sm" src={who?.avatar_url ?? null} />
            <div className="wr-review-body">
              <div className="wr-review-head">
                <span className="wr-review-name">{name}</span>
                <span className="wr-review-role">{label}</span>
                <StarRating value={r.stars} size={13} />
                <span className="wr-review-time">{fmtShort(r.created_at)}</span>
              </div>
              {r.comment ? (
                <div className="wr-review-comment">
                  <RichText value={r.comment} />
                </div>
              ) : null}
              {isOwn && onEditOwn && (
                <div className="wr-review-footer">
                  <button
                    type="button"
                    className="wr-edit-btn"
                    onClick={onEditOwn}
                    aria-label="Edit your review"
                  >
                    <Icon name="edit" size={12} />
                    <span>Edit</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// The rate + comment editor. Shown to Managers / Board Members.
// `onClose` is called after a successful submit or when the user cancels.
function ReportReviewForm({
  reportId,
  existing,
  onClose,
}: {
  reportId: string;
  existing: WorkReportReview | null;
  onClose?: () => void;
}) {
  const toast = useToast();
  const [, startTransition] = React.useTransition();
  const [stars, setStars] = React.useState(existing?.stars ?? 0);
  const [comment, setComment] = React.useState(existing?.comment ?? '');
  const [saving, setSaving] = React.useState(false);

  // Sync if the underlying review changes via realtime.
  React.useEffect(() => {
    setStars(existing?.stars ?? 0);
    setComment(existing?.comment ?? '');
  }, [existing?.id, existing?.stars, existing?.comment]);

  const submit = () => {
    if (stars < 1) { toast('Pick a rating from 1 to 5 stars.', 'error'); return; }
    setSaving(true);
    startTransition(async () => {
      try {
        const res = await submitWorkReportReview(reportId, stars, comment);
        if (!res.ok) throw new Error(res.error || 'Could not save your review.');
        toast(existing ? 'Review updated.' : 'Review sent.', 'success');
        onClose?.();
      } catch (e) {
        toast((e as Error).message || 'Could not save your review.', 'error');
      } finally {
        setSaving(false);
      }
    });
  };

  const cancel = () => {
    setStars(existing?.stars ?? 0);
    setComment(existing?.comment ?? '');
    onClose?.();
  };

  return (
    <div className="wr-review-form">
      <div className="wr-review-form-head">
        <Icon name="star" size={13} />
        <span>{existing ? 'Edit your review' : 'Rate & comment'}</span>
        {existing && (
          <button type="button" className="wr-cancel-btn" onClick={cancel}>
            Cancel
          </button>
        )}
      </div>
      <StarRating value={stars} onChange={setStars} size={22} ariaLabel="Your rating" />
      {/* Same rich-text editor as goal descriptions and work reports, so a
          reviewer's bold/italic/lists render consistently everywhere instead
          of leaking raw markdown syntax. */}
      <RichTextEditor
        value={comment}
        onChange={setComment}
        placeholder="Add a comment for this report…"
        ariaLabel="Review comment"
      />
      <div className="wr-review-form-actions">
        <Button size="sm" icon="check" onClick={submit} loading={saving}>
          {existing ? 'Save changes' : 'Send review'}
        </Button>
      </div>
    </div>
  );
}

// Combined component used in BoardChecklistPanel.
// Shows the review list (with Edit on own card) + the form when editing.
export function ReportReviewSection({
  reportId,
  reviews,
  reviewerById,
  currentUserId,
}: {
  reportId: string;
  reviews: WorkReportReview[];
  reviewerById: Record<string, ReviewerInfo>;
  currentUserId: string;
}) {
  const myReview = reviews.find((r) => r.reviewer_id === currentUserId) ?? null;
  const [editing, setEditing] = React.useState(false);

  // Collapse edit form if a review appears/disappears (realtime).
  React.useEffect(() => {
    if (!myReview) setEditing(false);
  }, [myReview?.id]);

  return (
    <>
      <WorkReportReviews
        reviews={reviews}
        reviewerById={reviewerById}
        currentUserId={currentUserId}
        onEditOwn={myReview && !editing ? () => setEditing(true) : undefined}
      />
      {(!myReview || editing) && (
        <ReportReviewForm
          reportId={reportId}
          existing={myReview}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  );
}
