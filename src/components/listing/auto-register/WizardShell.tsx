'use client';

const STEP_LABELS = [
  '기본 정보',
  '가격 · 재고',
  '이미지',
  '상세페이지',
  '배송 · 반품',
  '태그 · 등록',
];

interface WizardShellProps {
  currentStep: number; // 1-indexed
  children: React.ReactNode;
}

export function WizardShell({ currentStep, children }: WizardShellProps) {
  return (
    <div className="flex flex-col gap-6">
      {/* 단계 진행 표시 */}
      <div className="flex items-center gap-0">
        {STEP_LABELS.map((label, idx) => {
          const step = idx + 1;
          const isCompleted = step < currentStep;
          const isCurrent = step === currentStep;
          return (
            <div key={step} className="flex items-center">
              <div className="flex flex-col items-center gap-1">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                    isCompleted
                      ? 'bg-blue-600 text-white'
                      : isCurrent
                        ? 'bg-blue-100 text-blue-700 border-2 border-blue-600'
                        : 'bg-gray-100 text-gray-400'
                  }`}
                >
                  {isCompleted ? '✓' : step}
                </div>
                <span
                  className={`text-xs whitespace-nowrap ${
                    isCurrent ? 'text-blue-700 font-medium' : 'text-gray-400'
                  }`}
                >
                  {label}
                </span>
              </div>
              {idx < STEP_LABELS.length - 1 && (
                <div
                  className={`h-0.5 w-8 mx-1 mb-4 ${isCompleted ? 'bg-blue-600' : 'bg-gray-200'}`}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* 단계 콘텐츠 */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">{children}</div>
    </div>
  );
}
