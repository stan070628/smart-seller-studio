'use client';

/**
 * NicheSourcingLinks.tsx
 * 중국어 검색어 칩 + 소싱 플랫폼 링크 버튼 통합 패널
 *
 * NicheScorePanel 내부에서 사용.
 * - 마운트 시 중국어 검색어 자동 fetch
 * - 중국어 로딩 중에도 한국어 기반 링크 먼저 표시
 * - 실패 시 한국어 검색어로 조용한 폴백
 */

import React, { useEffect, useState, useCallback } from 'react';
import { ExternalLink, Copy, Check, RefreshCw, Loader2 } from 'lucide-react';
import { useNicheStore } from '@/store/useNicheStore';
import { generateSourcingLinks } from '@/lib/niche/sourcing-links';
import type { SourcingLink } from '@/lib/niche/sourcing-links';

// ─────────────────────────────────────────────────────────────────────────────
// 색상 상수 (NicheScorePanel 동일 테마)
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  card: '#ffffff',
  border: '#eeeeee',
  text: '#1a1c1c',
  textSub: '#926f6b',
  bg: '#f9f9f9',
};

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────
interface NicheSourcingLinksProps {
  keyword: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────
export default function NicheSourcingLinks({ keyword }: NicheSourcingLinksProps) {
  const {
    chineseQueries,
    isChineseLoading,
    chineseError,
    fetchChineseQueries,
  } = useNicheStore();

  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [activeQuery, setActiveQuery] = useState<string | null>(null);

  // 마운트 시 중국어 검색어 fetch
  useEffect(() => {
    fetchChineseQueries(keyword);
  }, [keyword, fetchChineseQueries]);

  // 활성 중국어 검색어 결정 (첫 번째 기본)
  const currentChineseQuery = activeQuery ?? chineseQueries[0] ?? null;

  // 소싱 링크 생성
  const links: SourcingLink[] = generateSourcingLinks(
    keyword,
    currentChineseQuery ?? undefined,
  );

  // 클립보드 복사
  const handleCopy = useCallback(async (text: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1500);
    } catch {
      // 클립보드 API 불가 시 무시
    }
  }, []);

  // 재생성
  const handleRefresh = useCallback(() => {
    setActiveQuery(null);
    fetchChineseQueries(keyword, true);
  }, [keyword, fetchChineseQueries]);

  return (
    <div
      style={{
        backgroundColor: C.card,
        borderRadius: '12px',
        border: `1px solid ${C.border}`,
        padding: '20px 24px',
        marginBottom: '16px',
      }}
    >
      <h3
        style={{
          margin: '0 0 16px',
          fontSize: '14px',
          fontWeight: '700',
          color: C.text,
        }}
      >
        소싱 검색
      </h3>

      {/* ── 중국어 검색어 칩 영역 ────────────────────────────────────── */}
      <div style={{ marginBottom: '16px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '10px',
          }}
        >
          <span style={{ fontSize: '12px', fontWeight: 600, color: C.textSub }}>
            중국어 검색어
          </span>
          <button
            onClick={handleRefresh}
            disabled={isChineseLoading}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              background: 'none',
              border: 'none',
              cursor: isChineseLoading ? 'default' : 'pointer',
              fontSize: '11px',
              color: C.textSub,
              padding: '2px 6px',
              borderRadius: '4px',
              opacity: isChineseLoading ? 0.5 : 1,
            }}
          >
            {isChineseLoading ? (
              <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
            ) : (
              <RefreshCw size={12} />
            )}
            {isChineseLoading ? '생성 중...' : '재생성'}
          </button>
        </div>

        {/* 칩 리스트 */}
        {isChineseLoading && chineseQueries.length === 0 ? (
          // 스켈레톤
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                style={{
                  height: '32px',
                  width: `${60 + i * 20}px`,
                  borderRadius: '16px',
                  backgroundColor: '#f3f3f3',
                  animation: 'pulse 1.5s ease-in-out infinite',
                }}
              />
            ))}
          </div>
        ) : chineseQueries.length > 0 ? (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {chineseQueries.map((query, idx) => {
              const isActive = query === currentChineseQuery;
              const isCopied = copiedIdx === idx;

              return (
                <div
                  key={idx}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 12px',
                    borderRadius: '16px',
                    backgroundColor: isActive ? 'rgba(190, 0, 20, 0.08)' : C.bg,
                    border: `1px solid ${isActive ? 'rgba(190, 0, 20, 0.3)' : C.border}`,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                  onClick={() => setActiveQuery(query)}
                >
                  <span
                    style={{
                      fontSize: '13px',
                      fontWeight: isActive ? 600 : 400,
                      color: isActive ? '#be0014' : C.text,
                    }}
                  >
                    {query}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCopy(query, idx);
                    }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: '2px',
                      color: isCopied ? '#16a34a' : C.textSub,
                    }}
                    title="복사"
                  >
                    {isCopied ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                </div>
              );
            })}
          </div>
        ) : chineseError ? (
          <p style={{ fontSize: '12px', color: C.textSub, margin: 0 }}>
            한국어 검색어로 링크를 생성합니다.
          </p>
        ) : null}
      </div>

      {/* ── 플랫폼 링크 버튼 그리드 ──────────────────────────────────── */}
      <div>
        <span
          style={{
            display: 'block',
            fontSize: '12px',
            fontWeight: 600,
            color: C.textSub,
            marginBottom: '10px',
          }}
        >
          플랫폼 검색
        </span>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: '8px',
          }}
        >
          {links.map((link) => (
            <a
              key={link.platform}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                padding: '10px 14px',
                borderRadius: '8px',
                backgroundColor: C.bg,
                border: `1px solid ${C.border}`,
                textDecoration: 'none',
                color: C.text,
                fontSize: '13px',
                fontWeight: 600,
                transition: 'all 0.15s',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = link.color;
                e.currentTarget.style.color = link.color;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = C.border;
                e.currentTarget.style.color = C.text;
              }}
            >
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: link.color,
                  flexShrink: 0,
                }}
              />
              {link.label}
              <ExternalLink size={12} style={{ opacity: 0.5 }} />
            </a>
          ))}
        </div>
        <p style={{ fontSize: '11px', color: C.textSub, margin: '8px 0 0' }}>
          {currentChineseQuery
            ? `1688, 타오바오는 "${currentChineseQuery}"로 검색합니다.`
            : '중국 플랫폼은 한국어 키워드로 검색합니다.'}
        </p>
      </div>

      {/* 애니메이션 keyframes */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}
