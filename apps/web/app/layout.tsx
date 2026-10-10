import type { Metadata, Viewport } from 'next';
import './globals.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import { SimulationProvider } from '@/lib/simulation-session';
export const metadata: Metadata = {
  title: '72H — 警報から、行動へ。',
  description: 'Evidence-backed disaster action planning. Synthetic earthquake demonstration.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg' },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#103b32' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ja"><body><SimulationProvider>{children}</SimulationProvider></body></html>;
}
