import DashboardClient from '@/components/dashboard/DashboardClient';

export const metadata = {
  title: '대시보드 — SmartSellerStudio',
  description: '전체 현황을 한눈에 확인하세요',
};

export default function DashboardPage() {
  return <DashboardClient />;
}
