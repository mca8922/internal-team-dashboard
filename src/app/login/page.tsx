import { LoginForm } from './LoginForm';

export const metadata = { title: 'Sign in · Mahesh Chandra & Associates' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ forgot?: string }>;
}) {
  // `?forgot=1` (from an expired reset link) opens the reset-request view.
  const { forgot } = await searchParams;
  return <LoginForm initialMode={forgot ? 'forgot' : 'signin'} />;
}
