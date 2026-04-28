import AlertList from '@/components/alerts/AlertList';

export const metadata = { title: '알림 센터' };

export default function AlertsPage() {
  return (
    <main className="container mx-auto px-4 py-8">
      <h1 className="mb-2 text-2xl font-bold">알림 센터</h1>
      <p className="mb-6 text-sm text-gray-600">
        광고 ROAS / 재고 / 부정 리뷰 등 운영 알림 통합. (전략 v2 extension §2.A)
      </p>
      <AlertList />
    </main>
  );
}
