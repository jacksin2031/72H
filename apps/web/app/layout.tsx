import type { Metadata, Viewport } from 'next';
import './globals.css';
import './tokens.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import { SimulationProvider } from '@/lib/simulation-session';
import { THEME_BOOT_SCRIPT } from '@/lib/theme-boot';
export const metadata: Metadata = {
  title: '72H — 警報から、行動へ。',
  description: 'Evidence-backed disaster action planning. Synthetic earthquake demonstration.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg' },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0B0D10' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ja" data-theme="dark" suppressHydrationWarning>
    <head><script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} /></head>
    <body><SimulationProvider>{children}</SimulationProvider></body>
  </html>;
}
