import { getCurrentProfile, getNotificationPrefs } from '@/lib/queries';
import { roleLabel, isManager } from '@/lib/roles';
import { SettingsView } from './SettingsView';

export const metadata = { title: 'Settings · reStrucAI' };

export default async function SettingsPage() {
  const profile = (await getCurrentProfile())!;
  const notificationPrefs = await getNotificationPrefs(profile.id);
  return (
    <SettingsView
      userId={profile.id}
      name={profile.name}
      email={profile.email}
      department={profile.department}
      roleText={roleLabel(profile.role)}
      avatarUrl={profile.avatar_url}
      notificationPrefs={notificationPrefs}
      isBoard={profile.role === 'board'}
      isManager={isManager(profile)}
    />
  );
}
