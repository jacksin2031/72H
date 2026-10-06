import { notFound } from 'next/navigation';
import { Dashboard } from '@/components/dashboard';
import { LiveDashboard } from '@/components/live-dashboard';
export function generateStaticParams() {
  return ['dashboard', 'plan', 'more', 'sources', 'trace', 'demo', 'notifications'].map(view => ({ view }));
}
export default async function Page({ params }: { params: Promise<{ view: string }> }) {
  const { view } = await params;
  if (!['dashboard', 'plan', 'more', 'sources', 'trace', 'demo', 'notifications'].includes(view)) notFound();
  return ['demo', 'trace'].includes(view) ? <Dashboard view={view} /> : <LiveDashboard view={view} />;
}
