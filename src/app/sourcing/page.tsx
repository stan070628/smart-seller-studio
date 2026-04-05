/**
 * /sourcing 페이지
 * 서버 컴포넌트: metadata 설정 후 SourcingDashboard 클라이언트 컴포넌트를 렌더
 */

import type { Metadata } from 'next';
import SourcingDashboard from '@/components/sourcing/SourcingDashboard';

export const metadata: Metadata = {
  title: '소싱 대시보드 | SmartSellerStudio',
  description: '도매꾹 상품 재고 및 판매 추이를 분석하는 소싱 대시보드',
};

export default function SourcingPage() {
  return <SourcingDashboard />;
}
