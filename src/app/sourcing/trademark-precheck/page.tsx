import TrademarkPrecheckForm from '@/components/sourcing/TrademarkPrecheckForm';

export const metadata = {
  title: '1688 발주 사전체크',
  description: '상품명을 KIPRIS 등록상표 DB에 사전 검사하여 발주 차단 여부를 판단합니다.',
};

export default function TrademarkPrecheckPage() {
  return (
    <main className="container mx-auto px-4 py-8">
      <h1 className="mb-2 text-2xl font-bold">1688 발주 사전체크</h1>
      <p className="mb-6 text-sm text-gray-600">
        위너 후보 상품명을 입력하면 KIPRIS 등록상표를 검사합니다.
        등록상표 충돌 시 1688 검색 링크가 자동 차단됩니다.
        (전략 v2 §6.2)
      </p>
      <TrademarkPrecheckForm />
    </main>
  );
}
