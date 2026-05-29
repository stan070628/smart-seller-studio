'use client';

import React, { useState } from 'react';
import { Search } from 'lucide-react';
import { C } from '@/lib/design-tokens';

export default function DeepKeywordEngine() {
  const [query, setQuery] = useState('');

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: '0 0 4px' }}>
          🔍 딥 키워드 추천 엔진
        </h2>
        <p style={{ fontSize: 12, color: C.textSub, margin: 0 }}>
          대표 키워드를 입력하면 공략 가능한 하위 키워드와 계절 점수를 분석합니다.
          (예: 텀블러 → 사무실 텀블러, 차량용 텀블러)
        </p>
      </div>

      {/* 검색 인풋 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="예: 텀블러"
          style={{
            flex: 1, padding: '10px 14px', fontSize: 14,
            border: `1px solid ${C.border}`, borderRadius: 8,
            outline: 'none', color: C.text, background: '#fff',
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
        />
        <button
          disabled
          style={{
            padding: '10px 20px', fontSize: 14, fontWeight: 600,
            background: '#d4d4d8', color: '#fff',
            border: 'none', borderRadius: 8, cursor: 'not-allowed',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          <Search size={14} />
          분석 (준비 중)
        </button>
      </div>

      {/* 준비 중 안내 */}
      <div style={{
        border: `1px dashed ${C.border}`, borderRadius: 12,
        padding: '40px 24px', textAlign: 'center', color: C.textMuted,
      }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🚧</div>
        <p style={{ fontSize: 14, fontWeight: 600, color: C.textSub, margin: '0 0 8px' }}>
          Phase 2에서 구현 예정
        </p>
        <p style={{ fontSize: 12, margin: 0 }}>
          네이버 자동완성 API + 클로바 데이터랩으로<br />
          키워드 계층 트리 · 계절 점수 · 경쟁 강도를 분석합니다
        </p>

        {/* Skeleton preview */}
        <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left' }}>
          {[80, 60, 70, 50].map((w, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <div style={{ width: `${w}%`, height: 14, background: '#e4e4e7', borderRadius: 4 }} />
              <div style={{ width: 40, height: 14, background: '#e4e4e7', borderRadius: 4 }} />
              <div style={{ width: 32, height: 14, background: '#e4e4e7', borderRadius: 4 }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
