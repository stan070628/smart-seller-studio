'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Loader2 } from 'lucide-react';

// 디자인 토큰 (BothRegisterForm 기준)
const C = {
  border: '#e5e5e5',
  text: '#18181b',
  textSub: '#71717a',
  accent: '#be0014',
} as const;

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  fontSize: '13px',
  border: `1px solid ${C.border}`,
  borderRadius: '8px',
  outline: 'none',
  color: C.text,
  backgroundColor: '#fff',
  boxSizing: 'border-box',
};

// 플랫폼별 배경색 (선택된 카테고리 표시 영역)
const PLATFORM_STYLE = {
  coupang: {
    color: '#be0014',
    bg: 'rgba(190,0,20,0.05)',
    border: 'rgba(190,0,20,0.1)',
    badgeColor: '#be0014',
    label: '쿠팡',
  },
  naver: {
    color: '#03c75a',
    bg: 'rgba(3,199,90,0.05)',
    border: 'rgba(3,199,90,0.15)',
    badgeColor: '#03c75a',
    label: '네이버',
  },
} as const;

interface CategoryResult {
  code: string;
  name: string;
  path: string;
}

export interface CategoryPickerProps {
  platform: 'coupang' | 'naver';
  selectedCode: string;
  selectedPath: string;
  onChange: (code: string, path: string) => void;
  error?: string;
}

export default function CategoryPicker({
  platform,
  selectedCode,
  selectedPath,
  onChange,
  error,
}: CategoryPickerProps) {
  // 컴포넌트 내부 검색 상태 — 플랫폼별 독립 유지
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<CategoryResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearch, setShowSearch] = useState(!selectedCode);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // unmount 시 타이머 정리 — 메모리 누수 방지
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const ps = PLATFORM_STYLE[platform];
  const apiPath =
    platform === 'coupang'
      ? '/api/listing/coupang/categories'
      : '/api/listing/naver/categories';

  // 디바운스 검색 (300ms)
  const search = (kw: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!kw.trim()) {
      setResults([]);
      return;
    }
    timerRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(`${apiPath}?keyword=${encodeURIComponent(kw.trim())}`);
        const json = await res.json();
        const raw = json.success ? (json.data ?? []).slice(0, 8) : [];
        // 쿠팡은 code가 number, 네이버는 string — string으로 통일
        setResults(
          raw.map((item: { code: number | string; name: string; path: string }) => ({
            code: String(item.code),
            name: item.name,
            path: item.path,
          })),
        );
      } catch {
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
  };

  const handleSelect = (item: CategoryResult) => {
    onChange(item.code, item.path);
    setShowSearch(false);
    setKeyword('');
    setResults([]);
  };

  return (
    <div>
      {/* 플랫폼 레이블 + 에러 메시지 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          marginBottom: '8px',
          fontSize: '13px',
          fontWeight: 600,
          color: C.text,
        }}
      >
        <span
          style={{
            fontSize: '10px',
            fontWeight: 700,
            color: '#fff',
            backgroundColor: ps.badgeColor,
            padding: '2px 7px',
            borderRadius: '4px',
          }}
        >
          {ps.label}
        </span>
        카테고리
        {error && (
          <span style={{ fontSize: '11px', color: '#b91c1c', fontWeight: 400 }}>
            — {error}
          </span>
        )}
      </div>

      {/* 선택된 카테고리가 있고 확인 모드인 경우 */}
      {selectedCode && !showSearch ? (
        <div
          style={{
            fontSize: '12px',
            color: ps.color,
            padding: '8px 12px',
            backgroundColor: ps.bg,
            borderRadius: '6px',
            border: `1px solid ${ps.border}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '8px',
          }}
        >
          <div>
            <div style={{ fontSize: '11px', color: '#aaa', marginBottom: '2px' }}>선택됨</div>
            <div style={{ lineHeight: 1.4 }}>{selectedPath}</div>
            <div
              style={{
                fontSize: '10px',
                fontFamily: 'monospace',
                color: C.textSub,
                marginTop: '2px',
              }}
            >
              ({selectedCode})
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowSearch(true)}
            style={{
              fontSize: '11px',
              fontWeight: 600,
              color: C.textSub,
              background: 'none',
              border: `1px solid ${C.border}`,
              borderRadius: '6px',
              padding: '3px 10px',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            변경
          </button>
        </div>
      ) : (
        /* 검색 모드 */
        <>
          {/* 검색 중에도 현재 선택 카테고리 유지 표시 */}
          {selectedCode && (
            <div
              style={{
                fontSize: '12px',
                color: ps.color,
                padding: '8px 12px',
                backgroundColor: ps.bg,
                borderRadius: '6px',
                border: `1px solid ${ps.border}`,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '8px',
              }}
            >
              <span style={{ lineHeight: 1.4 }}>{selectedPath}</span>
              <span style={{ fontSize: '10px', fontFamily: 'monospace', color: C.textSub }}>
                {selectedCode}
              </span>
            </div>
          )}

          {/* 키워드 검색 입력 */}
          <div style={{ position: 'relative', marginBottom: '8px' }}>
            <input
              style={inputStyle}
              value={keyword}
              onChange={(e) => {
                setKeyword(e.target.value);
                search(e.target.value);
              }}
              placeholder="카테고리 키워드 검색 (예: 고데기)"
            />
            {isSearching && (
              <span
                style={{
                  position: 'absolute',
                  right: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '11px',
                  color: C.textSub,
                }}
              >
                <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
                검색 중...
              </span>
            )}
          </div>

          {/* 검색 결과 목록 */}
          {results.length > 0 && (
            <div
              style={{
                border: `1px solid ${C.border}`,
                borderRadius: '8px',
                backgroundColor: '#fff',
                overflow: 'hidden',
                marginBottom: '8px',
              }}
            >
              {results.map((item) => {
                const isSelected = item.code === selectedCode;
                return (
                  <div
                    key={item.code}
                    onClick={() => handleSelect(item)}
                    style={{
                      padding: '10px 14px',
                      fontSize: '12px',
                      cursor: 'pointer',
                      borderBottom: `1px solid ${C.border}`,
                      backgroundColor: isSelected ? ps.bg : '#fff',
                      color: isSelected ? ps.color : C.text,
                    }}
                  >
                    <div style={{ fontWeight: isSelected ? 600 : 400 }}>{item.name}</div>
                    <div style={{ fontSize: '10px', color: C.textSub, marginTop: '2px' }}>
                      {item.path}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {keyword && !isSearching && results.length === 0 && (
            <div style={{ fontSize: '12px', color: C.textSub, padding: '8px', textAlign: 'center' }}>
              검색 결과가 없습니다.
            </div>
          )}

          {/* 카테고리가 이미 선택된 경우 취소 버튼 */}
          {selectedCode && (
            <button
              type="button"
              onClick={() => setShowSearch(false)}
              style={{
                fontSize: '11px',
                color: C.textSub,
                background: 'none',
                border: `1px solid ${C.border}`,
                borderRadius: '6px',
                padding: '4px 10px',
                cursor: 'pointer',
                marginTop: '4px',
              }}
            >
              취소
            </button>
          )}
        </>
      )}
    </div>
  );
}
