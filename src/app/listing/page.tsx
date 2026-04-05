/**
 * /listing 페이지
 * 서버 컴포넌트: metadata 설정 후 ListingDashboard 클라이언트 컴포넌트를 렌더
 */

import type { Metadata } from 'next';
import ListingDashboard from '@/components/listing/ListingDashboard';

export const metadata: Metadata = {
  title: '상품 자동등록 | SmartSellerStudio',
  description: '오픈마켓 플랫폼에 상품을 자동으로 등록하는 대시보드',
};

export default function ListingPage() {
  return <ListingDashboard />;
}
