// Inline lucide-style icon set — ported verbatim from the prototype.
import * as React from 'react';

export type IconName =
  | 'home' | 'clock' | 'edit' | 'target' | 'users' | 'chart' | 'plane' | 'settings'
  | 'logout' | 'play' | 'pause' | 'plus' | 'minus' | 'check' | 'x' | 'chevron-down'
  | 'chevron-right' | 'chevron-left' | 'chevron-up' | 'menu' | 'sidebar' | 'sun' | 'moon' | 'bell'
  | 'calendar' | 'flag' | 'trash' | 'eye' | 'eye-off' | 'search' | 'fire' | 'sparkles' | 'lock'
  | 'mail' | 'user' | 'grip' | 'building' | 'bolt' | 'arrow-right' | 'arrow-left' | 'archive'
  | 'monitor' | 'help-circle' | 'bot' | 'refresh' | 'copy' | 'more-vertical'
  | 'crown' | 'shield' | 'inbox' | 'corner-down-right'
  | 'star' | 'star-filled' | 'list' | 'layers' | 'network'
  | 'lightbulb' | 'thumbs-up' | 'thumbs-down' | 'maximize' | 'minimize';

interface IconProps {
  name: IconName;
  size?: number;
  stroke?: number;
  style?: React.CSSProperties;
}

export function Icon({ name, size = 16, stroke = 1.6, style }: IconProps) {
  const props = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: stroke,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    style,
  };
  switch (name) {
    case 'home': return <svg {...props}><path d="M3 12 12 3l9 9" /><path d="M5 10v10h14V10" /></svg>;
    case 'clock': return <svg {...props}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
    case 'edit': return <svg {...props}><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>;
    case 'target': return <svg {...props}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /></svg>;
    case 'users': return <svg {...props}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>;
    case 'chart': return <svg {...props}><path d="M3 3v18h18" /><path d="M7 16v-5" /><path d="M12 16V8" /><path d="M17 16v-3" /></svg>;
    case 'plane': return <svg {...props}><path d="M22 12c0-3-2-4-4-4l-2 1-6-6-2 1 3 6-4 1-3-3-1 1 3 4-3 2 1 2 5-2 5 5 1-2-3-4 4-1 2 3 1-2-3-3 5-1" /></svg>;
    case 'settings': return <svg {...props}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>;
    case 'logout': return <svg {...props}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></svg>;
    case 'play': return <svg {...props}><polygon points="5 3 19 12 5 21 5 3" fill="currentColor" stroke="none" /></svg>;
    case 'pause': return <svg {...props}><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>;
    case 'plus': return <svg {...props}><path d="M12 5v14M5 12h14" /></svg>;
    case 'minus': return <svg {...props}><path d="M5 12h14" /></svg>;
    case 'check': return <svg {...props}><path d="M20 6 9 17l-5-5" /></svg>;
    case 'x': return <svg {...props}><path d="M18 6 6 18M6 6l12 12" /></svg>;
    case 'chevron-down': return <svg {...props}><path d="m6 9 6 6 6-6" /></svg>;
    case 'chevron-up': return <svg {...props}><path d="m18 15-6-6-6 6" /></svg>;
    case 'chevron-right': return <svg {...props}><path d="m9 18 6-6-6-6" /></svg>;
    case 'chevron-left': return <svg {...props}><path d="m15 18-6-6 6-6" /></svg>;
    case 'menu': return <svg {...props}><path d="M3 6h18M3 12h18M3 18h18" /></svg>;
    case 'sidebar': return <svg {...props}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /></svg>;
    case 'sun': return <svg {...props}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></svg>;
    case 'moon': return <svg {...props}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>;
    case 'bell': return <svg {...props}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>;
    case 'calendar': return <svg {...props}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>;
    case 'flag': return <svg {...props}><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><path d="M4 22V15" /></svg>;
    case 'trash': return <svg {...props}><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /></svg>;
    case 'eye': return <svg {...props}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" /><circle cx="12" cy="12" r="3" /></svg>;
    case 'eye-off': return <svg {...props}><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a20.3 20.3 0 0 1 5.06-5.94M9.9 4.24A10.4 10.4 0 0 1 12 4c7 0 11 8 11 8a20.42 20.42 0 0 1-2.16 3.19" /><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" /><path d="M1 1l22 22" /></svg>;
    case 'search': return <svg {...props}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>;
    case 'fire': return <svg {...props}><path d="M8.5 14.5A2.5 2.5 0 0 0 11 17c1.5 0 2.5-1.25 2.5-2.5 0-2-2-3-2-5 0-1.5 1-3 3-3 1 2.5 5 4 5 8.5a7.5 7.5 0 0 1-15 0c0-2.5 1.5-4.5 3-5.5C7 11 8.5 12 8.5 14.5z" /></svg>;
    case 'sparkles': return <svg {...props}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" /></svg>;
    case 'lock': return <svg {...props}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>;
    case 'mail': return <svg {...props}><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 6-10 7L2 6" /></svg>;
    case 'user': return <svg {...props}><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" /></svg>;
    case 'grip': return <svg {...props}><circle cx="9" cy="6" r="1" fill="currentColor" /><circle cx="9" cy="12" r="1" fill="currentColor" /><circle cx="9" cy="18" r="1" fill="currentColor" /><circle cx="15" cy="6" r="1" fill="currentColor" /><circle cx="15" cy="12" r="1" fill="currentColor" /><circle cx="15" cy="18" r="1" fill="currentColor" /></svg>;
    case 'building': return <svg {...props}><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M8 10h.01M16 10h.01M8 14h.01M16 14h.01" /></svg>;
    case 'bolt': return <svg {...props}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>;
    case 'arrow-right': return <svg {...props}><path d="M5 12h14M13 5l7 7-7 7" /></svg>;
    case 'arrow-left': return <svg {...props}><path d="M19 12H5M12 19l-7-7 7-7" /></svg>;
    case 'archive': return <svg {...props}><rect x="2" y="3" width="20" height="5" rx="1" /><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" /><path d="M10 12h4" /></svg>;
    case 'monitor': return <svg {...props}><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></svg>;
    case 'help-circle': return <svg {...props}><circle cx="12" cy="12" r="9" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><circle cx="12" cy="17" r="0.5" fill="currentColor" /></svg>;
    case 'bot': return <svg {...props}><rect x="3" y="8" width="18" height="12" rx="2" /><path d="M12 8V4" /><circle cx="12" cy="3" r="1" /><path d="M8 12h.01M16 12h.01" /><path d="M8 16h8" /></svg>;
    case 'refresh': return <svg {...props}><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M3 21v-5h5" /></svg>;
    case 'copy': return <svg {...props}><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>;
    case 'more-vertical': return <svg {...props}><circle cx="12" cy="5" r="1.5" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none" /></svg>;
    case 'crown': return <svg {...props}><path d="M2 18h20" /><path d="M3 7l5 5 4-7 4 7 5-5-2 11H5L3 7z" /></svg>;
    case 'shield': return <svg {...props}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>;
    case 'corner-down-right': return <svg {...props}><path d="M15 10l5 5-5 5" /><path d="M4 4v7a4 4 0 0 0 4 4h12" /></svg>;
    case 'inbox': return <svg {...props}><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></svg>;
    case 'star': return <svg {...props}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>;
    case 'star-filled': return <svg {...props}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="currentColor" /></svg>;
    case 'list': return <svg {...props}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>;
    case 'layers': return <svg {...props}><path d="M12 2 2 7l10 5 10-5-10-5z" /><path d="m2 17 10 5 10-5" /><path d="m2 12 10 5 10-5" /></svg>;
    case 'network': return <svg {...props}><circle cx="5" cy="6" r="2.5" /><circle cx="5" cy="18" r="2.5" /><circle cx="19" cy="12" r="2.5" /><path d="M7.2 7.2 16.8 11M7.2 16.8 16.8 13" /></svg>;
    case 'lightbulb': return <svg {...props}><path d="M9 18h6" /><path d="M10 22h4" /><path d="M12 2a7 7 0 0 0-4 12.74c.6.42.9 1.1.9 1.85V17a1 1 0 0 0 1 1h4.2a1 1 0 0 0 1-1v-.41c0-.75.3-1.43.9-1.85A7 7 0 0 0 12 2Z" /><path d="M10.3 9.6c.55-.9 1.25-.9 1.7 0s1.15.9 1.7 0" strokeWidth={stroke * 0.85} /></svg>;
    case 'thumbs-up': return <svg {...props}><path d="M7 10v12" /><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h2.76a2 2 0 0 0 1.79-1.11L12 3a2.5 2.5 0 0 1 3 2.88Z" /></svg>;
    case 'thumbs-down': return <svg {...props}><path d="M17 14V2" /><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-2.76a2 2 0 0 0-1.79 1.11L12 21a2.5 2.5 0 0 1-3-2.88Z" /></svg>;
    case 'maximize': return <svg {...props}><path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M16 3h3a2 2 0 0 1 2 2v3" /><path d="M21 16v3a2 2 0 0 1-2 2h-3" /><path d="M8 21H5a2 2 0 0 1-2-2v-3" /></svg>;
    case 'minimize': return <svg {...props}><path d="M9 3v3a2 2 0 0 1-2 2H4" /><path d="M15 3v3a2 2 0 0 0 2 2h3" /><path d="M21 15h-3a2 2 0 0 0-2 2v3" /><path d="M3 15h3a2 2 0 0 1 2 2v3" /></svg>;
    default: return null;
  }
}
