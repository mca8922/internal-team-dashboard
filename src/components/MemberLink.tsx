// A teammate's avatar + name that opens their employee page (/team/[id]) —
// the same destination as clicking their card on the Team page. Used in the
// Team Analytics tables so a row leads straight to that person's analytics.
import Link from 'next/link';
import { Avatar } from '@/components/ui';

export function MemberLink({
  id,
  name,
  avatarUrl,
}: {
  id: string;
  name: string;
  avatarUrl?: string | null;
}) {
  return (
    <Link href={`/team/${id}`} className="member-link fw-medium" title={`Open ${name}'s analytics`}>
      <Avatar name={name} size="sm" src={avatarUrl ?? undefined} />
      <span className="member-link-name">{name}</span>
    </Link>
  );
}
