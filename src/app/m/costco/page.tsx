/**
 * 코스트코 모바일 메인 페이지
 * searchParams를 MobileCostcoList로 전달, Suspense로 감싸서 스트리밍 렌더링
 */
import { Suspense } from 'react';
import MobileCostcoList, {
  MobileCostcoListSkeleton,
} from '@/components/sourcing/mobile/MobileCostcoList';

interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function MobileCostcoPage({ searchParams }: PageProps) {
  // Next.js 15+: searchParams는 비동기 Promise
  const resolvedSearchParams = await searchParams;

  return (
    <Suspense fallback={<MobileCostcoListSkeleton />}>
      <MobileCostcoList initialSearch={resolvedSearchParams} />
    </Suspense>
  );
}
