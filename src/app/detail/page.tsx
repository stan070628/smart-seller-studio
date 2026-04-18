import { Suspense } from 'react';
import type { Metadata } from 'next';
import DetailClient from './DetailClient';

export const metadata: Metadata = {
  title: '상세 페이지 생성 | Smart Seller Studio',
  description: '상품 사진을 업로드하면 AI가 쿠팡 상세 페이지 HTML을 자동 생성합니다.',
};

export default function DetailPage() {
  return (
    <Suspense>
      <DetailClient />
    </Suspense>
  );
}
