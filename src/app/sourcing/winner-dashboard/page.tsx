import WinnerOccupancyTable from '@/components/winner/WinnerOccupancyTable';

export const metadata = { title: '위너 대시보드' };

export default function WinnerDashboardPage() {
  return (
    <main className="container mx-auto px-4 py-8">
      <h1 className="mb-2 text-2xl font-bold">위너 대시보드</h1>
      <p className="mb-6 text-sm text-gray-600">
        SKU별 아이템위너 점유율 일별 추적. 빼앗김 발생 시 알림 센터에 표시됩니다.
        (전략 v2 extension §2.B 기능 4)
      </p>
      <WinnerOccupancyTable />
    </main>
  );
}
