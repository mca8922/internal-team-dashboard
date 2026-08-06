import 'server-only';

// The two values that make this module client-specific. Everything else in the
// folder is identical across every fork, which is the whole point.
//
// SUPPORT_API_KEY is intentionally NOT prefixed NEXT_PUBLIC_: the `server-only`
// import above makes the build fail if anything in this folder is ever pulled
// into a Client Component, so the key cannot reach a browser by accident.

export interface SupportConfig {
  apiUrl: string;
  apiKey: string;
}

// Returns null rather than throwing when unconfigured. A fork mid-setup should
// render a "support is not configured yet" message, not a crashed page — and
// the crash page is exactly where someone would be trying to reach support.
export function supportConfig(): SupportConfig | null {
  const apiUrl = process.env.SUPPORT_API_URL;
  const apiKey = process.env.SUPPORT_API_KEY;
  if (!apiUrl || !apiKey) return null;
  return { apiUrl: apiUrl.replace(/\/$/, ''), apiKey };
}
