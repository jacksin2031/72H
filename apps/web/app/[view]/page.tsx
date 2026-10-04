import { notFound } from 'next/navigation';
import { Dashboard } from '@/components/dashboard';
export function generateStaticParams() {
  return ['dashboard', 'plan', 'sources', 'trace', 'demo'].map(view => ({ view }));
}
export default async function Page({ params }: { params: Promise<{ view: string }> }) {
  const { view } = await params;
  if (!['dashboard', 'plan', 'sources', 'trace', 'demo'].includes(view)) notFound();
  return <Dashboard view={view} />;
}
