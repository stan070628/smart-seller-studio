import InboundChecklistForm from '@/components/sourcing/InboundChecklistForm';

export const metadata = {
  title: '1688 입고 체크리스트',
  description: '회송 위험을 줄이기 위한 SKU별 입고 전 자체 검수 체크리스트',
};

export default function InboundChecklistPage() {
  return (
    <main className="container mx-auto px-4 py-8">
      <h1 className="mb-2 text-2xl font-bold">1688 입고 체크리스트</h1>
      <p className="mb-6 text-sm text-gray-600">
        SKU 정보를 입력하면 채널 영상 "회송 당합니다" 3편(포장·사이즈·바코드) 기준
        체크리스트가 자동 생성됩니다. 다음 페이지에서 브라우저 인쇄(Cmd+P) → PDF로 저장하세요.
        (전략 v2 §6.4)
      </p>
      <InboundChecklistForm />
    </main>
  );
}
