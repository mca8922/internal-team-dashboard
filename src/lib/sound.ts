// Notification sounds. The .wav assets live in public/sounds and are served
// from the site root (e.g. /sounds/goal_assign.wav). Browsers block audio
// until the user has interacted with the page — by the time a member is on the
// dashboard they have, so playback works. Every play() is wrapped so a blocked
// or missing sound never throws.
//
// Three distinct voices so a member can tell events apart without looking:
//   • playChime()         — goal_assign.wav: actionable notifications
//                           (goal assigned, leave, reminders, …).
//   • playPresenceChime() — when_online.wav: a teammate comes online.
//   • playPunchChime()    — punch_notifications.wav: a teammate punches in/out.
const SOUNDS = {
  goal: '/sounds/goal_assign.wav',
  online: '/sounds/when_online.wav',
  punch: '/sounds/punch_notifications.wav',
} as const;

// Preloaded base elements, one per file. We clone on each play so overlapping
// events (two punches at once) don't cut each other off.
const cache = new Map<string, HTMLAudioElement>();

function play(src: string) {
  if (typeof window === 'undefined') return;
  try {
    let base = cache.get(src);
    if (!base) {
      base = new Audio(src);
      base.preload = 'auto';
      cache.set(src, base);
    }
    const node = base.cloneNode() as HTMLAudioElement;
    node.volume = 0.6;
    node.play().catch(() => {});
  } catch {
    // Audio unavailable or still blocked — stay silent.
  }
}

function isSoundEnabled(pref: 'soundNotification' | 'soundPresence' | 'soundPunch'): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = localStorage.getItem('restruc:prefs');
    if (!raw) return true;
    const prefs = JSON.parse(raw) as Record<string, unknown>;
    return prefs[pref] !== false;
  } catch {
    return true;
  }
}

// Actionable notifications: goal assigned, log reminder, leave decision, etc.
export function playChime() {
  if (isSoundEnabled('soundNotification')) play(SOUNDS.goal);
}

// A teammate connecting to the dashboard (Supabase presence).
export function playPresenceChime() {
  if (isSoundEnabled('soundPresence')) play(SOUNDS.online);
}

// A teammate punching in or out.
export function playPunchChime() {
  if (isSoundEnabled('soundPunch')) play(SOUNDS.punch);
}
