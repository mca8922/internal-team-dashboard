import type { Metadata } from 'next';
import { Montserrat, JetBrains_Mono } from 'next/font/google';
import { NO_FLASH_SCRIPT } from '@/lib/theme';
import { FaviconSwitcher } from '@/components/FaviconSwitcher';
import './globals.css';

// Self-hosted via next/font — replaces the render-blocking Google Fonts
// <link>. `display: 'swap'` avoids invisible text; the CSS reads the fonts
// through the `--font-*` variables set on <html> below.
const montserrat = Montserrat({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-montserrat',
  display: 'swap',
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Mahesh Chandra & Associates · Internal Team Dashboard',
  description: 'Punch in, log work, ship goals. All in one place.',
  // Default favicon — the inline script + FaviconSwitcher then swap it to
  // the light/dark variant that matches the active theme.
  icons: {
    icon: '/logo-light.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${montserrat.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        {/* Apply the saved theme + favicon before first paint (no flash). */}
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
      </head>
      <body>
        <FaviconSwitcher />
        {children}
      </body>
    </html>
  );
}
