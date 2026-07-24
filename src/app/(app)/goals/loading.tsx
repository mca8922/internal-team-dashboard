import { PageSkeleton } from '@/components/PageSkeleton';

export default function Loading() {
  return <PageSkeleton cards={5} columns={1} />;
}
