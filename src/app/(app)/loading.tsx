// Shown instantly when navigating to any authenticated route, while the
// page's Server Component fetches its data — replaces the old "frozen on the
// previous page" feel. Section-specific loading.tsx files override this.
import { PageSkeleton } from '@/components/PageSkeleton';

export default function Loading() {
  return <PageSkeleton cards={4} columns={2} />;
}
