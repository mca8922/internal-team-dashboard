import type { Metadata, Viewport } from 'next';
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

// Explicit viewport (Next's default omits viewport-fit, which the safe-area
// insets the bottom tab bar and "More" sheet rely on need to be non-zero on
// notched phones). `maximumScale`/`userScalable` are deliberately left alone —
// blocking pinch-zoom is an accessibility regression. The phone auto-zoom the
// app used to do on focus is fixed properly in globals.css by making form
// controls 16px on small screens, which is what actually triggers it on iOS.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
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
