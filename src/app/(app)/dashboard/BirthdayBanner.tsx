'use client';

// Dashboard birthday banner. Two very different cards share this file:
//   - BystanderCard: shown to everyone else on a teammate's birthday. They
//     can send a wish and see WHO else has wished (name + avatar chips) —
//     never the message text. That's private between the sender and the
//     celebrant (see migration 0056_birthday_privacy.sql).
//   - CelebrantCard: shown to the birthday person themselves. A persistent
//     confetti shower, and the same name/avatar chips, but clickable — each
//     opens a popup with that person's actual message and a private reply
//     box (delivered to the sender as a notification, never posted publicly).
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Avatar, Button, Modal } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { sendBirthdayWish, replyToBirthdayWish } from '@/lib/actions';
import { fmtSince } from '@/lib/dates';
import type { BirthdayWish } from '@/lib/types';

interface Celebrant {
  id: string;
  name: string;
  avatar_url: string | null;
  department: string;
  isViewerCelebrant: boolean;
  wishes: BirthdayWish[];
}

function ComposeRow({
  placeholder,
  onSend,
}: {
  placeholder: string;
  onSend: (message: string) => Promise<void>;
}) {
  const toast = useToast();
  const [message, setMessage] = React.useState('');
  const [pending, startTransition] = React.useTransition();

  const send = () => {
    const clean = message.trim();
    if (!clean) return;
    startTransition(async () => {
      try {
        await onSend(clean);
        setMessage('');
      } catch (e) {
        toast((e as Error).message, 'error');
      }
    });
  };

  return (
    <div className="birthday-compose">
      <input
        className="input"
        placeholder={placeholder}
        value={message}
        maxLength={240}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && send()}
        disabled={pending}
      />
      <Button size="sm" icon="arrow-right" onClick={send} disabled={pending || !message.trim()}>
        Send
      </Button>
    </div>
  );
}

function BystanderCard({ celebrant, viewerId }: { celebrant: Celebrant; viewerId: string }) {
  const router = useRouter();
  const toast = useToast();

  const myWish = celebrant.wishes.find((w) => w.sender_id === viewerId) ?? null;
  // A fresh reply opens expanded by default — that's the exciting bit — but
  // the toggle lets the sender collapse it back once they've read it.
  const [replyOpen, setReplyOpen] = React.useState(true);

  const sendWish = async (message: string) => {
    await sendBirthdayWish(celebrant.id, message);
    toast('Wish sent 🎉');
    router.refresh();
  };

  return (
    <div className="birthday-card">
      <div className="birthday-card-head">
        <Avatar name={celebrant.name} src={celebrant.avatar_url} size="md" />
        <div>
          <div className="birthday-card-title">🎂 It&apos;s {celebrant.name}&apos;s birthday today!</div>
          <div className="text-xs text-grey">{celebrant.department}</div>
        </div>
      </div>

      {celebrant.wishes.length > 0 ? (
        <div className="birthday-wishers">
          <span className="birthday-wishers-label">Already wished:</span>
          {celebrant.wishes.map((w) => (
            <span
              key={w.id}
              className={`birthday-wisher-chip${w.sender_id === viewerId ? ' mine' : ''}`}
              title={w.sender_id === viewerId ? 'You sent a birthday wish' : `${w.sender_name} sent a birthday wish`}
            >
              <Avatar name={w.sender_name} src={w.sender_avatar_url} size="sm" />
              {w.sender_name}
            </span>
          ))}
        </div>
      ) : null}

      {myWish ? (
        <div className={`birthday-sent-wrap${myWish.reply ? ' has-reply' : ''}`}>
          <div
            className={`birthday-sent-confirm${myWish.reply ? ' clickable' : ''}`}
            onClick={myWish.reply ? () => setReplyOpen((v) => !v) : undefined}
            role={myWish.reply ? 'button' : undefined}
            tabIndex={myWish.reply ? 0 : undefined}
          >
            <Icon name="check" size={14} />
            <span>{'You wished ' + celebrant.name.split(' ')[0] + ': '}</span>
            <span className="birthday-sent-confirm-msg">{myWish.message}</span>
            {myWish.reply ? (
              <span className="birthday-reply-toggle">
                <Icon
                  name="chevron-down"
                  size={13}
                  style={{ transform: replyOpen ? 'rotate(180deg)' : 'none', transition: 'transform 200ms ease' }}
                />
                {celebrant.name.split(' ')[0]} replied
              </span>
            ) : null}
          </div>
          {myWish.reply && replyOpen ? (
            <div className="birthday-reply-reveal">
              <Avatar name={celebrant.name} src={celebrant.avatar_url} size="sm" />
              <div>
                <div className="birthday-reply-reveal-meta">
                  {celebrant.name} · {fmtSince(myWish.reply.created_at)}
                </div>
                <div className="birthday-reply-reveal-msg">{myWish.reply.message}</div>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <ComposeRow placeholder={`Wish ${celebrant.name.split(' ')[0]} a happy birthday…`} onSend={sendWish} />
      )}
    </div>
  );
}

function BirthdayGroupRow({
  celebrant,
  viewerId,
  expanded,
  onToggle,
}: {
  celebrant: Celebrant;
  viewerId: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const router = useRouter();
  const toast = useToast();

  const myWish = celebrant.wishes.find((w) => w.sender_id === viewerId) ?? null;

  const sendWish = async (message: string) => {
    await sendBirthdayWish(celebrant.id, message);
    toast('Wish sent 🎉');
    router.refresh();
  };

  return (
    <div className={`birthday-group-row${expanded ? ' expanded' : ''}`}>
      <button type="button" className="birthday-group-row-head" onClick={onToggle}>
        <Avatar name={celebrant.name} src={celebrant.avatar_url} size="sm" />
        <span className="birthday-group-row-name">{celebrant.name}</span>
        <span className="text-xs text-grey">{celebrant.department}</span>
        {myWish ? (
          <span className="birthday-group-row-check">
            <Icon name="check" size={13} />
          </span>
        ) : null}
        <span className="birthday-group-row-chevron">
          <Icon
            name="chevron-down"
            size={13}
            style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 200ms ease' }}
          />
        </span>
      </button>
      {expanded ? (
        <div className="birthday-group-row-body">
          {celebrant.wishes.length > 0 ? (
            <div className="birthday-wishers">
              <span className="birthday-wishers-label">Already wished:</span>
              {celebrant.wishes.map((w) => (
                <span
                  key={w.id}
                  className={`birthday-wisher-chip${w.sender_id === viewerId ? ' mine' : ''}`}
                  title={w.sender_id === viewerId ? 'You sent a birthday wish' : `${w.sender_name} sent a birthday wish`}
                >
                  <Avatar name={w.sender_name} src={w.sender_avatar_url} size="sm" />
                  {w.sender_name}
                </span>
              ))}
            </div>
          ) : null}

          {myWish ? (
            <div className="birthday-sent-wrap">
              <div className="birthday-sent-confirm">
                <Icon name="check" size={14} />
                <span>{'You wished ' + celebrant.name.split(' ')[0] + ': '}</span>
                <span className="birthday-sent-confirm-msg">{myWish.message}</span>
              </div>
              {myWish.reply ? (
                <div className="birthday-reply-reveal">
                  <Avatar name={celebrant.name} src={celebrant.avatar_url} size="sm" />
                  <div>
                    <div className="birthday-reply-reveal-meta">
                      {celebrant.name} · {fmtSince(myWish.reply.created_at)}
                    </div>
                    <div className="birthday-reply-reveal-msg">{myWish.reply.message}</div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <ComposeRow placeholder={`Wish ${celebrant.name.split(' ')[0]} a happy birthday…`} onSend={sendWish} />
          )}
        </div>
      ) : null}
    </div>
  );
}

function BirthdayGroupCard({ celebrants, viewerId }: { celebrants: Celebrant[]; viewerId: string }) {
  const [expandedId, setExpandedId] = React.useState<string | null>(null);

  return (
    <div className="birthday-card">
      <div className="birthday-card-head">
        <div className="birthday-group-emoji" aria-hidden>
          🎉
        </div>
        <div>
          <div className="birthday-card-title">{celebrants.length} birthdays today!</div>
          <div className="text-xs text-grey">Tap a name to send your wishes</div>
        </div>
      </div>

      <div className="birthday-group-list">
        {celebrants.map((c) => (
          <BirthdayGroupRow
            key={c.id}
            celebrant={c}
            viewerId={viewerId}
            expanded={expandedId === c.id}
            onToggle={() => setExpandedId((id) => (id === c.id ? null : c.id))}
          />
        ))}
      </div>
    </div>
  );
}

const SHOWER_COLORS = ['#ffd166', '#ef476f', '#ffffff', '#c9a7ff', '#7fd1a8', '#5cc8ff'];

// Exported so HolidayCelebration.tsx can reuse the same falling-confetti
// effect for "today's a company holiday" celebrations.
export function BirthdayShower() {
  const pieces = React.useMemo(
    () =>
      Array.from({ length: 32 }, (_, i) => ({
        id: i,
        left: Math.round(Math.random() * 100),
        size: 5 + Math.round(Math.random() * 5),
        color: SHOWER_COLORS[(Math.random() * SHOWER_COLORS.length) | 0],
        dur: (2.4 + Math.random() * 1.8).toFixed(2),
        delay: (-Math.random() * 4).toFixed(2),
        rot: Math.round(180 + Math.random() * 360),
        round: Math.random() < 0.5,
      })),
    [],
  );
  return (
    <span className="bday-shower" aria-hidden>
      {pieces.map((p) => (
        <span
          key={p.id}
          className={`bday-shower-piece${p.round ? ' round' : ''}`}
          style={
            {
              left: `${p.left}%`,
              width: `${p.size}px`,
              height: `${p.size}px`,
              background: p.color,
              animationDuration: `${p.dur}s`,
              animationDelay: `${p.delay}s`,
              '--rot': `${p.rot}deg`,
            } as React.CSSProperties & Record<string, string>
          }
        />
      ))}
    </span>
  );
}

function WishModal({ wish, onClose }: { wish: BirthdayWish; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();

  const sendReply = async (message: string) => {
    await replyToBirthdayWish(wish.id, message);
    toast('Reply sent');
    router.refresh();
    onClose();
  };

  return (
    <Modal open onClose={onClose} width={440}>
      <button type="button" className="icon-btn wish-modal-close" onClick={onClose} aria-label="Close">
        <Icon name="x" size={16} />
      </button>

      <div className="wish-modal-header">
        <Avatar name={wish.sender_name} src={wish.sender_avatar_url} size="lg" />
        <div>
          <div className="wish-modal-name">{wish.sender_name}</div>
          <div className="wish-modal-meta">
            🎉 sent you a birthday wish · {fmtSince(wish.created_at)}
          </div>
        </div>
      </div>

      <div className="wish-modal-bubble">{wish.message}</div>

      {wish.reply ? (
        <div className="wish-modal-section">
          <div className="wish-modal-label">
            <Icon name="check" size={12} />
            Your reply
          </div>
          <div className="wish-modal-reply">{wish.reply.message}</div>
        </div>
      ) : (
        <div className="wish-modal-section">
          <div className="wish-modal-label">Reply privately</div>
          <ComposeRow
            placeholder={`Reply to ${wish.sender_name.split(' ')[0]}…`}
            onSend={sendReply}
          />
        </div>
      )}
    </Modal>
  );
}

function CelebrantCard({ celebrant }: { celebrant: Celebrant }) {
  const [openWishId, setOpenWishId] = React.useState<string | null>(null);
  const openWish = celebrant.wishes.find((w) => w.id === openWishId) ?? null;

  return (
    <div className="birthday-card birthday-card-celebrant">
      <BirthdayShower />
      <div className="birthday-card-head birthday-card-content">
        <div className="birthday-celebrant-emoji" aria-hidden>
          🎉
        </div>
        <div>
          <div className="birthday-card-title">Celebrating you today at Mahesh Chandra &amp; Associates!</div>
          <div className="text-xs text-grey">Tap a name below to read their wish</div>
        </div>
      </div>

      {celebrant.wishes.length > 0 ? (
        <div className="birthday-wishers birthday-card-content">
          {celebrant.wishes.map((w) => (
            <button
              key={w.id}
              type="button"
              className={`birthday-wisher-chip birthday-wisher-chip-clickable${w.reply ? ' replied' : ''}`}
              onClick={() => setOpenWishId(w.id)}
            >
              <Avatar name={w.sender_name} src={w.sender_avatar_url} size="sm" />
              {w.sender_name}
            </button>
          ))}
        </div>
      ) : (
        <div className="text-xs text-grey birthday-card-content">No wishes yet. Check back soon.</div>
      )}

      {openWish ? <WishModal wish={openWish} onClose={() => setOpenWishId(null)} /> : null}
    </div>
  );
}

export function BirthdayBanner({ celebrants, viewerId }: { celebrants: Celebrant[]; viewerId: string }) {
  if (celebrants.length === 0) return null;

  const mine = celebrants.filter((c) => c.isViewerCelebrant);
  const others = celebrants.filter((c) => !c.isViewerCelebrant);

  return (
    <div className="birthday-banner">
      {mine.map((c) => (
        <CelebrantCard key={c.id} celebrant={c} />
      ))}
      {others.length === 1 ? (
        <BystanderCard celebrant={others[0]} viewerId={viewerId} />
      ) : others.length > 1 ? (
        <BirthdayGroupCard celebrants={others} viewerId={viewerId} />
      ) : null}
    </div>
  );
}
