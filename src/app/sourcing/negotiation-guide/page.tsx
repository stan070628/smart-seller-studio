import { NEGOTIATION_STEPS } from '@/lib/sourcing/negotiation-guide';

export const metadata = { title: '1688 가격 협상 가이드' };

export default function NegotiationGuidePage() {
  return (
    <main className="container mx-auto px-4 py-8 max-w-3xl">
      <h1 className="mb-2 text-2xl font-bold">1688 가격 협상 가이드</h1>
      <p className="mb-6 text-sm text-gray-600">
        채널 영상 "1688 네고 흥정 팁 (2025-06-22)" 기반.
        발주 단계별 협상 전략. (전략 v2 extension §2.C 기능 7)
      </p>
      <ol className="space-y-4">
        {NEGOTIATION_STEPS.map((step) => (
          <li key={step.order} className="rounded border border-gray-200 p-4">
            <h3 className="mb-1 text-base font-semibold">
              {step.order}. {step.title}
            </h3>
            <p className="text-sm text-gray-700">{step.detail}</p>
            {step.tip && (
              <div className="mt-2 rounded bg-yellow-50 border border-yellow-200 p-2 text-sm text-yellow-900">
                💡 {step.tip}
              </div>
            )}
          </li>
        ))}
      </ol>
    </main>
  );
}
