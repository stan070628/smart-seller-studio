import { RoiPageClient } from '@/components/roi/RoiPageClient';
import type { SkuRoiData } from '@/lib/roi/types';

export const dynamic = 'force-dynamic';

export default async function RoiPage() {
  const initialData: SkuRoiData[] = [];
  return <RoiPageClient initialData={initialData} />;
}
