'use client';

import React, { useState, useEffect } from 'react';
import { useProductDiscoveryStore } from '@/store/useProductDiscoveryStore';
import { C as BASE_C } from '@/lib/design-tokens';

const C = { ...BASE_C, accent: '#7c3aed' };

export default function StepProductInput() {
  const {
    productInfo, aiSuggestedKeywords, selectedKeywords,
    isExtractingAI, isValidating, isParsingUrl, error,
    setProductInfo, parseUrl, extractAIKeywords,
    toggleKeyword, addKeyword, removeKeyword,
    startValidation,
  } = useProductDiscoveryStore();

  const [mode, setMode] = useState<'text' | 'url'>('text');
  const [titleDraft, setTitleDraft] = useState('');
  const [urlDraft, setUrlDraft] = useState('');
  const [keywordDraft, setKeywordDraft] = useState('');

  // store reset (= productInfo가 null) 감지 시 로컬 입력 필드도 초기화
  useEffect(() => {
    if (!productInfo && aiSuggestedKeywords.length === 0 && selectedKeywords.length === 0) {
      setTitleDraft('');
      setUrlDraft('');
      setKeywordDraft('');
    }
  }, [productInfo, aiSuggestedKeywords.length, selectedKeywords.length]);

  const handleTextSubmit = () => {
    const t = titleDraft.trim();
    if (!t) return;
    setProductInfo({ source: 'manual', title: t });
  };

  const handleUrlSubmit = async () => {
    const u = urlDraft.trim();
    if (!u) return;
    await parseUrl(u);
  };

  const canExtract = productInfo !== null && !isExtractingAI;
  const canStart = selectedKeywords.length > 0 && !isValidating;

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>
        Step 1 — 상품 입력 + AI 키워드 후보 추출
      </div>

      {/* 모드 토글 */}
      <div style={{ display: 'flex', gap: 6 }}>
        {(['text', 'url'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            style={{
              padding: '6px 14px', borderRadius: 5,
              border: `1px solid ${mode === m ? C.accent : '#e5e7eb'}`,
              background: mode === m ? '#f5f0ff' : '#fff',
              color: mode === m ? C.accent : '#374151',
              fontSize: 11, fontWeight: 700, cursor: 'pointer',
            }}
          >
            {m === 'text' ? '✏️ 상품명 직접 입력' : '🔗 도매꾹 URL 붙여넣기'}
          </button>
        ))}
      </div>

      {mode === 'text' && (
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type="text" value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            placeholder="예: 16cm 펜트리수납함 슬라이드형"
            style={{ flex: 1, padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 5, fontSize: 12, outline: 'none' }}
          />
          <button
            onClick={handleTextSubmit}
            disabled={!titleDraft.trim()}
            style={{
              padding: '7px 14px', borderRadius: 5, border: 'none',
              background: titleDraft.trim() ? '#1d4ed8' : '#e5e7eb',
              color: '#fff', fontSize: 12, fontWeight: 700,
              cursor: titleDraft.trim() ? 'pointer' : 'not-allowed',
            }}
          >확정</button>
        </div>
      )}

      {mode === 'url' && (
        <div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="text" value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              placeholder="https://domeggook.com/main/item.php?id=..."
              style={{ flex: 1, padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 5, fontSize: 12, outline: 'none' }}
            />
            <button
              onClick={handleUrlSubmit}
              disabled={!urlDraft.trim() || isParsingUrl}
              style={{
                padding: '7px 14px', borderRadius: 5, border: 'none',
                background: urlDraft.trim() && !isParsingUrl ? '#1d4ed8' : '#e5e7eb',
                color: '#fff', fontSize: 12, fontWeight: 700,
                cursor: urlDraft.trim() && !isParsingUrl ? 'pointer' : 'not-allowed',
              }}
            >{isParsingUrl ? '파싱 중...' : '파싱'}</button>
          </div>
          <div style={{ fontSize: 10, color: '#6b7280', marginTop: 4 }}>
            현재 도매꾹 URL만 자동 파싱. 다른 사이트는 상품명을 텍스트로 입력하세요.
          </div>
        </div>
      )}

      {/* 상품 정보 표시 */}
      {productInfo && (
        <div style={{ padding: 12, background: '#f9fafb', borderRadius: 6, border: '1px solid #e5e7eb', display: 'flex', gap: 10, alignItems: 'center' }}>
          {productInfo.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={productInfo.image} alt="" style={{ width: 50, height: 50, objectFit: 'cover', borderRadius: 4 }} />
          )}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{productInfo.title}</div>
            <div style={{ fontSize: 10, color: '#6b7280' }}>
              {productInfo.source === 'domeggook' ? '도매꾹' : '직접 입력'}
              {productInfo.price ? ` · ${productInfo.price.toLocaleString()}원` : ''}
            </div>
          </div>
          <button
            onClick={extractAIKeywords}
            disabled={!canExtract}
            style={{
              padding: '6px 12px', borderRadius: 5, border: 'none',
              background: canExtract ? C.accent : '#e5e7eb',
              color: '#fff', fontSize: 11, fontWeight: 700,
              cursor: canExtract ? 'pointer' : 'not-allowed',
            }}
          >{isExtractingAI ? '추출 중...' : '🤖 AI 키워드 추출'}</button>
        </div>
      )}

      {/* AI 추천 + 사용자 편집 */}
      {(aiSuggestedKeywords.length > 0 || selectedKeywords.length > 0) && (
        <div style={{ padding: 12, background: '#fdfcff', borderRadius: 6, border: '1px solid #e0d4ff' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', marginBottom: 8 }}>
            키워드 후보 — 채택할 것을 선택 + 직접 추가
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {Array.from(new Set([...aiSuggestedKeywords, ...selectedKeywords])).map((kw) => {
              const isSel = selectedKeywords.includes(kw);
              const isAi = aiSuggestedKeywords.includes(kw);
              return (
                <button
                  key={kw}
                  onClick={() => toggleKeyword(kw)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '4px 10px', borderRadius: 100, fontSize: 11,
                    border: `1px solid ${isSel ? C.accent : '#e5e7eb'}`,
                    background: isSel ? '#f5f0ff' : '#fff',
                    color: isSel ? C.accent : '#9ca3af',
                    fontWeight: isSel ? 700 : 400, cursor: 'pointer',
                  }}
                >
                  {isAi && <span>🤖</span>}{kw}
                  {!isAi && (
                    <span
                      onClick={(e) => { e.stopPropagation(); removeKeyword(kw); }}
                      style={{ marginLeft: 2, opacity: 0.6 }}
                    >×</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* 직접 추가 */}
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="text" value={keywordDraft}
              onChange={(e) => setKeywordDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && keywordDraft.trim()) {
                  e.preventDefault();
                  addKeyword(keywordDraft.trim());
                  setKeywordDraft('');
                }
              }}
              placeholder="키워드 직접 추가 (Enter)"
              style={{ flex: 1, padding: '5px 10px', border: '1px solid #d1d5db', borderRadius: 5, fontSize: 11, outline: 'none' }}
            />
            <button
              onClick={() => { addKeyword(keywordDraft.trim()); setKeywordDraft(''); }}
              disabled={!keywordDraft.trim()}
              style={{
                padding: '5px 12px', borderRadius: 5, border: 'none',
                background: keywordDraft.trim() ? '#7c3aed' : '#e5e7eb',
                color: '#fff', fontSize: 10, fontWeight: 700,
                cursor: keywordDraft.trim() ? 'pointer' : 'not-allowed',
              }}
            >+ 추가</button>
          </div>
          <div style={{ fontSize: 10, color: '#6b7280', marginTop: 6 }}>
            🤖 = AI 추천. 채택할 것 클릭. {selectedKeywords.length}개 선택됨.
          </div>
        </div>
      )}

      {error && (
        <div style={{ padding: 8, background: '#fee2e2', color: '#dc2626', fontSize: 11, borderRadius: 5 }}>
          ⚠️ {error}
        </div>
      )}

      <button
        onClick={() => startValidation()}
        disabled={!canStart}
        style={{
          padding: '8px 18px', borderRadius: 6, border: 'none',
          background: canStart ? C.accent : '#e5e7eb',
          color: '#fff', fontSize: 12, fontWeight: 700,
          cursor: canStart ? 'pointer' : 'not-allowed',
          alignSelf: 'flex-start',
        }}
      >
        {isValidating ? '검증 중...' : `▶ ${selectedKeywords.length}개 키워드 검증 시작`}
      </button>
    </div>
  );
}
