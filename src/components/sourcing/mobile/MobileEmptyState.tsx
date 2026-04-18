'use client';

/**
 * 코스트코 모바일 빈 상태 컴포넌트
 * 필터 적용 여부에 따라 다른 메시지 표시
 */

interface MobileEmptyStateProps {
  hasFilter: boolean;
  onResetFilter: () => void;
  searchTerm?: string;
}

export default function MobileEmptyState({ hasFilter, onResetFilter, searchTerm }: MobileEmptyStateProps) {
  const isSearchResult = !!searchTerm;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '64px 24px',
        textAlign: 'center',
        gap: '12px',
      }}
    >
      {/* 아이콘 */}
      <div style={{ fontSize: '40px', lineHeight: 1 }}>
        {isSearchResult || hasFilter ? '🔍' : '📦'}
      </div>

      {/* 메시지 */}
      <p
        style={{
          fontSize: '15px',
          fontWeight: 600,
          color: '#374151',
          margin: 0,
        }}
      >
        {isSearchResult
          ? `"${searchTerm}" 검색 결과가 없어요`
          : hasFilter
          ? '조건에 맞는 상품이 없어요'
          : '수집된 상품이 없어요'}
      </p>
      <p
        style={{
          fontSize: '13px',
          color: '#9ca3af',
          margin: 0,
        }}
      >
        {isSearchResult
          ? '코스트코에서 수집되지 않은 브랜드일 수 있어요'
          : hasFilter
          ? '필터를 변경하거나 초기화해 보세요'
          : '데스크탑에서 코스트코 상품을 수집해 주세요'}
      </p>

      {/* 버튼 */}
      {isSearchResult || hasFilter ? (
        <button
          onClick={onResetFilter}
          style={{
            marginTop: '8px',
            padding: '10px 20px',
            backgroundColor: '#1a1c1c',
            color: '#ffffff',
            fontSize: '14px',
            fontWeight: 600,
            borderRadius: '8px',
            border: 'none',
            cursor: 'pointer',
            minHeight: '44px',
          }}
        >
          {isSearchResult ? '검색 초기화' : '필터 초기화'}
        </button>
      ) : (
        <button
          disabled
          style={{
            marginTop: '8px',
            padding: '10px 20px',
            backgroundColor: '#e5e7eb',
            color: '#9ca3af',
            fontSize: '14px',
            fontWeight: 600,
            borderRadius: '8px',
            border: 'none',
            cursor: 'not-allowed',
            minHeight: '44px',
          }}
        >
          코스트코 상품 수집하기
        </button>
      )}
    </div>
  );
}
