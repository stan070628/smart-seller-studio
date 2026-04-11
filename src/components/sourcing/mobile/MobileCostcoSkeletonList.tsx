'use client';

/**
 * 코스트코 모바일 목록 스켈레톤 로딩 컴포넌트
 * pulse 애니메이션 카드 N개 표시
 */

interface SkeletonListProps {
  count?: number;
}

export default function MobileCostcoSkeletonList({ count = 6 }: SkeletonListProps) {
  return (
    <>
      <style>{`
        @keyframes mobileSkeleton {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{
            height: '108px',
            backgroundColor: '#e5e7eb',
            borderRadius: '12px',
            margin: '8px 12px',
            animation: 'mobileSkeleton 1.5s ease-in-out infinite',
            animationDelay: `${i * 0.08}s`,
          }}
        />
      ))}
    </>
  );
}
