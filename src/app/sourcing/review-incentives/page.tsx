export const metadata = { title: '포토리뷰 적립금 자동화' };

export default function ReviewIncentivesPage() {
  return (
    <main className="container mx-auto px-4 py-8 max-w-3xl">
      <h1 className="mb-2 text-2xl font-bold">포토리뷰 적립금 자동화</h1>
      <p className="mb-6 text-sm text-gray-600">
        리뷰 50/100 도달 SKU 자동 추적 + 적립금 이벤트 갱신 가이드.
        (전략 v2 extension §2.E 기능 11)
      </p>

      <section className="mb-6 rounded border border-blue-200 bg-blue-50 p-4">
        <h2 className="mb-2 text-base font-semibold">📊 단계별 적립금 전략</h2>
        <table className="w-full text-sm">
          <thead className="bg-white">
            <tr>
              <th className="p-2 text-left">현재 리뷰 수</th>
              <th className="p-2 text-left">권장 적립금</th>
              <th className="p-2 text-left">목적</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t">
              <td className="p-2">0~10개</td>
              <td className="p-2 font-semibold">2,000원</td>
              <td className="p-2">초기 리뷰 확보 (가족 + 일반 고객)</td>
            </tr>
            <tr className="border-t">
              <td className="p-2">10~50개</td>
              <td className="p-2 font-semibold">2,000원 유지</td>
              <td className="p-2">전환율 안정화</td>
            </tr>
            <tr className="border-t">
              <td className="p-2">50~100개</td>
              <td className="p-2 font-semibold">3,000원으로 증액</td>
              <td className="p-2">100개 분기점 가속</td>
            </tr>
            <tr className="border-t">
              <td className="p-2">100개 이상</td>
              <td className="p-2 font-semibold">이벤트 종료</td>
              <td className="p-2">베스트 리뷰 자동 노출 활용</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-base font-semibold">🔔 자동 알림</h2>
        <p className="text-sm text-gray-700">
          매일 09:00 KST cron이 SKU별 리뷰 수를 추적하여 50/100 도달 시
          알림 센터에 자동 등록됩니다. <a href="/plan/alerts" className="text-blue-600 underline">알림 센터</a>에서 확인.
        </p>
      </section>

      <section className="rounded border border-yellow-200 bg-yellow-50 p-4">
        <h2 className="mb-1 text-base font-semibold">💡 채널 영상 인용</h2>
        <p className="text-sm text-gray-700">
          "리뷰 100개는 신뢰의 분기점. 50개 vs 100개 전환율 차이 30%."
          — 억대셀러 강연 (2025-09-29)
        </p>
      </section>
    </main>
  );
}
