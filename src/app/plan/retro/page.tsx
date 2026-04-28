import InboundReturnForm from '@/components/retro/InboundReturnForm';

export const metadata = { title: '회고 + 학습' };

export default function RetroPage() {
  return (
    <main className="container mx-auto px-4 py-8 max-w-4xl">
      <h1 className="mb-2 text-2xl font-bold">회고 + 학습 대시보드</h1>
      <p className="mb-6 text-sm text-gray-600">
        회송 사례 / CS 패턴 / 채널 분배 누적 분석. (전략 v2 extension §2.D)
      </p>

      <section className="mb-8">
        <h2 className="mb-2 text-lg font-semibold">회송 사례 등록</h2>
        <InboundReturnForm />
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-lg font-semibold">CS 패턴 TOP 5</h2>
        <p className="text-sm text-gray-600">
          <a className="text-blue-600 underline" href="/api/retro/cs-patterns">/api/retro/cs-patterns</a>
          {' '}데이터 표시 (운영 후 클라 컴포넌트로 분리 예정)
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">채널별 분배 (지난 30일)</h2>
        <p className="text-sm text-gray-600">
          <a className="text-blue-600 underline" href="/api/retro/channel-distribution">/api/retro/channel-distribution</a>
          {' '}데이터 표시 (운영 후 차트 컴포넌트로 분리 예정)
        </p>
      </section>
    </main>
  );
}
