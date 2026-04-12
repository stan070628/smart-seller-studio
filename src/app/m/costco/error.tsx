'use client';

/**
 * 코스트코 모바일 라우트 에러 UI
 * error.tsx는 반드시 클라이언트 컴포넌트여야 함
 */

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function MobileCostcoError({ error, reset }: ErrorProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 'calc(100dvh - 52px)',
        padding: '24px',
        textAlign: 'center',
      }}
    >
      {/* 에러 아이콘 */}
      <div
        style={{
          width: '48px',
          height: '48px',
          borderRadius: '50%',
          backgroundColor: '#fee2e2',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '16px',
          fontSize: '24px',
        }}
      >
        !
      </div>

      {/* 에러 제목 */}
      <p
        style={{
          fontSize: '16px',
          fontWeight: 700,
          color: '#1a1c1c',
          marginBottom: '8px',
        }}
      >
        데이터를 불러오지 못했습니다
      </p>

      {/* 에러 메시지 */}
      <p
        style={{
          fontSize: '13px',
          color: '#6b7280',
          marginBottom: '24px',
          wordBreak: 'break-word',
          maxWidth: '280px',
        }}
      >
        {error.message || '알 수 없는 오류가 발생했습니다.'}
      </p>

      {/* 다시 시도 버튼 */}
      <button
        onClick={reset}
        style={{
          padding: '12px 32px',
          backgroundColor: '#be0014',
          color: '#ffffff',
          border: 'none',
          borderRadius: '8px',
          fontSize: '14px',
          fontWeight: 600,
          cursor: 'pointer',
          letterSpacing: '-0.2px',
        }}
      >
        다시 시도
      </button>
    </div>
  );
}
