import KeywordSuggestionForm from '@/components/winner/KeywordSuggestionForm';

export const metadata = {
  title: '위너 SKU 키워드 최적화',
};

export default function KeywordOptimizerPage() {
  return (
    <main className="container mx-auto px-4 py-8">
      <h1 className="mb-2 text-2xl font-bold">위너 SKU 키워드 최적화</h1>
      <p className="mb-6 text-sm text-gray-600">
        검색 1페이지 진입 못 한 위너 SKU의 상품명을 AI로 재구성합니다.
        (전략 v2 extension §2.B 기능 5)
      </p>
      <KeywordSuggestionForm />
    </main>
  );
}
