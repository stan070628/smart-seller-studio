/**
 * 코스트코 모바일 라우트 로딩 UI
 * MobileSkeletonCard 6개를 pulse 애니메이션으로 표시
 */

function MobileSkeletonCard() {
  return (
    <div
      style={{
        height: '120px',
        backgroundColor: '#e5e7eb',
        borderRadius: '12px',
        marginBottom: '12px',
        animation: 'pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      }}
    />
  );
}

export default function MobileCostcoLoading() {
  return (
    <>
      {/* pulse 키프레임 인라인 정의 */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>

      <div style={{ padding: '16px' }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <MobileSkeletonCard key={i} />
        ))}
      </div>
    </>
  );
}
