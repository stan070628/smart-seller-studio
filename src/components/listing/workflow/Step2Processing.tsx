'use client';

/**
 * Step2Processing.tsx
 * Step 2 — 이미지 큐레이션 + 카테고리/재고 입력 + 스팩 미리보기
 * (HTML 생성은 Step 3에서 수행)
 */

import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Search, Loader2, ExternalLink } from 'lucide-react';
import { useListingStore } from '@/store/useListingStore';
import { C } from '@/lib/design-tokens';
import Step2ImagePicker from './Step2ImagePicker';

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

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '12px',
  fontWeight: 600,
  color: C.textSub,
  marginBottom: '6px',
};

export default function Step2Processing() {
  const { sharedDraft, updateSharedDraft, goPrevStep, goNextStep } = useListingStore();
  const { description } = sharedDraft;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* 2컬럼 레이아웃 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>

        {/* ── 좌측: 이미지 관리 ──────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <Step2ImagePicker />
        </div>

        {/* ── 우측: 카테고리·재고 + 스팩 미리보기 ────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* 카테고리·재고 카드 */}
          <div
            style={{
              backgroundColor: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: '12px',
              padding: '20px',
            }}
          >
            <div style={{ fontSize: '14px', fontWeight: 700, color: C.text, marginBottom: '16px' }}>
              카테고리 · 재고
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <CategorySearch />
              <div>
                <label style={labelStyle}>재고 수량</label>
                <input
                  style={inputStyle}
                  type="number"
                  value={sharedDraft.stock}
                  onChange={(e) => updateSharedDraft({ stock: e.target.value })}
                  min={0}
                  placeholder="999"
                />
              </div>
            </div>
          </div>

          {/* 원본 스팩 미리보기 (description이 있을 때) */}
          {description && (
            <div
              style={{
                backgroundColor: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: '12px',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  borderBottom: `1px solid ${C.border}`,
                  backgroundColor: C.tableHeader,
                }}
              >
                <span style={{ fontSize: '13px', fontWeight: 700, color: C.text }}>원본 스팩 미리보기</span>
                <button
                  onClick={() => {
                    const blob = new Blob([description], { type: 'text/html; charset=utf-8' });
                    window.open(URL.createObjectURL(blob), '_blank');
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '4px',
                    padding: '4px 10px', fontSize: '11px', fontWeight: 600,
                    backgroundColor: '#fff', color: C.textSub,
                    border: `1px solid ${C.border}`, borderRadius: '6px', cursor: 'pointer',
                  }}
                >
                  <ExternalLink size={11} />
                  전체 보기
                </button>
              </div>
              <iframe
                srcDoc={description}
                style={{ width: '100%', height: '320px', border: 'none', display: 'block' }}
                title="원본 스팩 미리보기"
                sandbox="allow-same-origin"
              />
            </div>
          )}
        </div>
      </div>

      {/* 하단 네비게이션 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button
          onClick={goPrevStep}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '10px 20px', fontSize: '13px', fontWeight: 600,
            backgroundColor: '#fff', color: C.textSub,
            border: `1px solid ${C.border}`, borderRadius: '8px', cursor: 'pointer',
          }}
        >
          <ChevronLeft size={15} />
          이전
        </button>

        <button
          onClick={goNextStep}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '10px 24px', fontSize: '13px', fontWeight: 700,
            backgroundColor: C.accent, color: '#fff',
            border: 'none', borderRadius: '8px', cursor: 'pointer',
          }}
        >
          다음 단계
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 서브 컴포넌트: 카테고리 키워드 검색 (쿠팡 + 네이버 동시)
// ─────────────────────────────────────────────────────────────────────────────

interface CoupangCat { code: number; name: string; path: string; }
interface NaverCat { id: string; name: string; path: string; }

function CategorySearch() {
  const { sharedDraft, updateSharedDraft } = useListingStore();
  const hint = sharedDraft.categoryHint;
  const usableHint = hint && hint !== '기타' && hint.length > 2 ? hint : '';
  const autoKeyword = usableHint || sharedDraft.name.split(/\s+/)[0] || '';
  const [keyword, setKeyword] = useState(autoKeyword);
  const [isSearching, setIsSearching] = useState(false);
  const [coupangResults, setCoupangResults] = useState<CoupangCat[]>([]);
  const [naverResults, setNaverResults] = useState<NaverCat[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isComposingRef = useRef(false);
  const didAutoSearch = useRef(false);

  const search = (kw: string, immediate = false) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!kw.trim()) { setCoupangResults([]); setNaverResults([]); return; }

    const delay = immediate ? 0 : 350;
    timerRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const enc = encodeURIComponent(kw.trim());
        const [cr, nr] = await Promise.all([
          fetch(`/api/listing/coupang/categories?keyword=${enc}`),
          fetch(`/api/listing/naver/categories?keyword=${enc}`),
        ]);
        const [cj, nj] = await Promise.all([cr.json(), nr.json()]);
        setCoupangResults(cj.success ? (cj.data as CoupangCat[]).slice(0, 6) : []);
        setNaverResults(nj.success ? (nj.data as NaverCat[]).slice(0, 6) : []);
      } catch {
        setCoupangResults([]);
        setNaverResults([]);
      } finally {
        setIsSearching(false);
      }
    }, delay);
  };

  useEffect(() => {
    if (didAutoSearch.current) return;
    if (sharedDraft.coupangCategoryCode || sharedDraft.naverCategoryId) return;
    if (!autoKeyword) return;
    didAutoSearch.current = true;
    search(autoKeyword, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rowStyle = (selected: boolean): React.CSSProperties => ({
    padding: '7px 10px', borderRadius: '6px', cursor: 'pointer',
    fontSize: '12px', lineHeight: 1.4,
    backgroundColor: selected ? 'rgba(190,0,20,0.07)' : 'transparent',
    border: selected ? `1px solid rgba(190,0,20,0.25)` : '1px solid transparent',
    color: C.text,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <label style={labelStyle}>카테고리 검색 (쿠팡 + 네이버 동시)</label>

      <div style={{ position: 'relative' }}>
        <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: C.textSub }} />
        <input
          style={{ ...inputStyle, paddingLeft: '30px', paddingRight: isSearching ? '30px' : '12px' }}
          type="text"
          placeholder="예: 고데기, 등산가방, 블루투스 이어폰"
          value={keyword}
          onCompositionStart={() => { isComposingRef.current = true; }}
          onCompositionEnd={(e) => {
            isComposingRef.current = false;
            const v = (e.target as HTMLInputElement).value;
            setKeyword(v);
            search(v);
          }}
          onChange={(e) => {
            setKeyword(e.target.value);
            if (!isComposingRef.current) search(e.target.value);
          }}
        />
        {isSearching && (
          <Loader2 size={14} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', color: C.textSub, animation: 'spin 1s linear infinite' }} />
        )}
      </div>

      {(sharedDraft.coupangCategoryCode || sharedDraft.naverCategoryId) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {sharedDraft.coupangCategoryCode && (
            <div style={{ fontSize: '11px', color: '#16a34a', background: '#dcfce7', borderRadius: '5px', padding: '4px 8px' }}>
              쿠팡 ✓ {sharedDraft.coupangCategoryPath.split(' > ').slice(-2).join(' > ')}
            </div>
          )}
          {sharedDraft.naverCategoryId && (
            <div style={{ fontSize: '11px', color: '#1d4ed8', background: '#dbeafe', borderRadius: '5px', padding: '4px 8px' }}>
              네이버 ✓ {sharedDraft.naverCategoryPath.split('>').slice(-2).join(' > ')}
            </div>
          )}
        </div>
      )}

      {(coupangResults.length > 0 || naverResults.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 600, color: C.textSub, marginBottom: '4px' }}>쿠팡</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '200px', overflowY: 'auto' }}>
              {coupangResults.length === 0
                ? <div style={{ fontSize: '12px', color: C.textSub, padding: '8px 0' }}>결과 없음</div>
                : coupangResults.map((item) => (
                  <button key={item.code} type="button"
                    onClick={() => updateSharedDraft({ coupangCategoryCode: String(item.code), coupangCategoryPath: item.path })}
                    style={rowStyle(String(item.code) === sharedDraft.coupangCategoryCode)}
                  >
                    <div style={{ fontWeight: 600 }}>{item.name}</div>
                    <div style={{ fontSize: '10px', color: C.textSub, marginTop: '1px' }}>{item.path}</div>
                  </button>
                ))
              }
            </div>
          </div>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 600, color: C.textSub, marginBottom: '4px' }}>네이버</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '200px', overflowY: 'auto' }}>
              {naverResults.length === 0
                ? <div style={{ fontSize: '12px', color: C.textSub, padding: '8px 0' }}>결과 없음</div>
                : naverResults.map((item) => (
                  <button key={item.id} type="button"
                    onClick={() => updateSharedDraft({ naverCategoryId: item.id, naverCategoryPath: item.path })}
                    style={rowStyle(item.id === sharedDraft.naverCategoryId)}
                  >
                    <div style={{ fontWeight: 600 }}>{item.name}</div>
                    <div style={{ fontSize: '10px', color: C.textSub, marginTop: '1px' }}>{item.path}</div>
                  </button>
                ))
              }
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
