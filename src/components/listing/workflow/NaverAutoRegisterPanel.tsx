'use client';

import React, { useEffect, useState } from 'react';
import { useListingStore } from '@/store/useListingStore';
import { C } from '@/lib/design-tokens';

interface NaverAutoRegisterPanelProps {
  onSuccess?: (originProductNo: number) => void;
}

const section: React.CSSProperties = {
  backgroundColor: C.card,
  border: `1px solid ${C.border}`,
  borderRadius: '12px',
  padding: '16px',
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
};

const sectionTitle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 700,
  color: C.text,
  margin: '0 0 4px',
};

const label: React.CSSProperties = {
  display: 'block',
  fontSize: '11px',
  fontWeight: 600,
  color: C.textSub,
  marginBottom: '4px',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  fontSize: '13px',
  color: C.text,
  backgroundColor: '#fff',
  border: `1px solid ${C.border}`,
  borderRadius: '8px',
  boxSizing: 'border-box',
};

interface NaverCategoryResult {
  id: string;
  name: string;
  path: string;
}

export default function NaverAutoRegisterPanel({ onSuccess }: NaverAutoRegisterPanelProps) {
  const { sharedDraft, updateSharedDraft } = useListingStore();

  // ── 기본 상태 ─────────────────────────────────────────────
  const [name, setName] = useState(sharedDraft.name ?? '');
  const [leafCategoryId, setLeafCategoryId] = useState(sharedDraft.naverCategoryId ?? '');
  const [leafCategoryPath, setLeafCategoryPath] = useState(sharedDraft.naverCategoryPath ?? '');
  const [salePrice, setSalePrice] = useState(
    Number(sharedDraft.naverPrice || sharedDraft.salePrice) || 0,
  );
  const [stock, setStock] = useState(Number(sharedDraft.stock) || 999);
  const [deliveryCharge, setDeliveryCharge] = useState(Number(sharedDraft.deliveryCharge) || 0);
  const [returnCharge, setReturnCharge] = useState(Number(sharedDraft.returnCharge) || 4000);
  const [tags, setTags] = useState<string[]>(sharedDraft.tags ?? []);
  const [tagInput, setTagInput] = useState('');

  // ── 카테고리 검색 ─────────────────────────────────────────
  const [categorySearch, setCategorySearch] = useState('');
  const [categoryResults, setCategoryResults] = useState<NaverCategoryResult[]>([]);
  const [isCategorySearching, setIsCategorySearching] = useState(false);

  // ── 드래프트 상태 ─────────────────────────────────────────
  const [draftId, setDraftId] = useState<string | null>(sharedDraft.naverDraftId ?? null);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [draftFeedback, setDraftFeedback] = useState<'saved' | 'error' | null>(null);
  const [draftSaveError, setDraftSaveError] = useState<string | null>(null);

  // ── 제출 상태 ─────────────────────────────────────────────
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // 상세설명: 네이버 전용 → 공통 순서로 폴백
  const hasDetailHtml = !!(sharedDraft.detailPageSnippetNaver || sharedDraft.detailPageSnippet);

  // sharedDraft 변경 시 동기화
  useEffect(() => {
    if (sharedDraft.name && !name) setName(sharedDraft.name);
  }, [sharedDraft.name]);

  // ── 카테고리 검색 ─────────────────────────────────────────
  async function handleCategorySearch() {
    const kw = categorySearch.trim();
    if (!kw) return;
    setIsCategorySearching(true);
    try {
      const res = await fetch(`/api/listing/naver/categories?keyword=${encodeURIComponent(kw)}`);
      const json = await res.json();
      setCategoryResults(json.data ?? []);
    } catch {
      setCategoryResults([]);
    } finally {
      setIsCategorySearching(false);
    }
  }

  // ── draft_data 조립 ───────────────────────────────────────
  function buildDraftData() {
    return {
      name,
      leafCategoryId,
      leafCategoryPath,
      salePrice,
      stock,
      thumbnailImages: sharedDraft.thumbnailImages ?? [],
      detailHtml: sharedDraft.detailPageSnippetNaver || sharedDraft.detailPageSnippet || '',
      tags,
      deliveryCharge,
      returnCharge,
      exchangeFee: returnCharge * 2,
    };
  }

  // ── 임시저장 ──────────────────────────────────────────────
  async function handleSaveDraft() {
    if (!name) return;
    setIsSavingDraft(true);
    setDraftFeedback(null);
    setDraftSaveError(null);

    const draftData = buildDraftData();

    try {
      if (draftId) {
        const res = await fetch(`/api/listing/naver/drafts/${draftId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productName: name, draftData }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? '업데이트 실패');
      } else {
        const res = await fetch('/api/listing/naver/drafts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            productName: name,
            sourceUrl: sharedDraft.sourceUrl ?? null,
            sourceType: 'costco',
            draftData,
          }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? '저장 실패');
        const json = await res.json();
        setDraftId(json.id);
        updateSharedDraft({ naverDraftId: json.id });
      }
      setDraftFeedback('saved');
      setTimeout(() => setDraftFeedback(null), 3000);
    } catch (err) {
      setDraftSaveError(err instanceof Error ? err.message : '저장 실패');
      setDraftFeedback('error');
    } finally {
      setIsSavingDraft(false);
    }
  }

  // ── 제출 ──────────────────────────────────────────────────
  async function handleSubmit() {
    if (!draftId) return;
    const confirmed = window.confirm(
      `"${name}" 상품을 네이버 스마트스토어에 제출하시겠습니까?\n이미지 업로드 후 실제 등록됩니다.`,
    );
    if (!confirmed) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const res = await fetch(`/api/listing/naver/drafts/${draftId}/submit`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? '제출 실패');
      onSuccess?.(json.originProductNo);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : '제출 중 오류가 발생했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', backgroundColor: '#f0fdf4', border: '1px solid #86efac', borderRadius: '12px' }}>
        <span style={{ fontSize: '18px' }}>🟢</span>
        <div>
          <p style={{ fontSize: '14px', fontWeight: 700, color: '#166534', margin: 0 }}>네이버 스마트스토어 등록</p>
          <p style={{ fontSize: '11px', color: '#15803d', margin: 0 }}>임시저장 후 네이버에 제출합니다</p>
        </div>
      </div>

      {/* ── 섹션 1: 상품명 + 카테고리 ─────────────────────────── */}
      <div style={section}>
        <p style={sectionTitle}>상품명 · 카테고리</p>
        <div>
          <label style={label}>상품명</label>
          <input
            style={inputStyle}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="네이버 스마트스토어 상품명"
          />
        </div>
        <div>
          <label style={label}>카테고리 검색</label>
          {leafCategoryId && (
            <div style={{ marginBottom: '6px', padding: '6px 10px', backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '6px', fontSize: '11px', color: '#1d4ed8', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span><strong>{leafCategoryId}</strong> — {leafCategoryPath}</span>
              <button type="button" onClick={() => { setLeafCategoryId(''); setLeafCategoryPath(''); }} style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', fontSize: '14px' }}>×</button>
            </div>
          )}
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              style={{ ...inputStyle, flex: 1 }}
              value={categorySearch}
              onChange={(e) => setCategorySearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleCategorySearch(); } }}
              placeholder="예: 선풍기, 텀블러, 헤어드라이어"
            />
            <button
              type="button"
              onClick={handleCategorySearch}
              disabled={isCategorySearching}
              style={{ padding: '9px 14px', fontSize: '12px', fontWeight: 600, backgroundColor: '#15803d', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              {isCategorySearching ? '검색 중...' : '검색'}
            </button>
          </div>
          {categoryResults.length > 0 && (
            <div style={{ border: `1px solid ${C.border}`, borderRadius: '8px', overflow: 'hidden', marginTop: '4px' }}>
              {categoryResults.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setLeafCategoryId(c.id);
                    setLeafCategoryPath(c.path);
                    setCategoryResults([]);
                    setCategorySearch('');
                  }}
                  style={{ width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: '12px', backgroundColor: '#fff', border: 'none', borderBottom: `1px solid ${C.border}`, cursor: 'pointer', color: C.text }}
                >
                  <strong>{c.id}</strong>
                  <span style={{ marginLeft: '8px', color: C.textSub }}>{c.path}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── 섹션 2: 가격·재고 ────────────────────────────────── */}
      <div style={section}>
        <p style={sectionTitle}>가격 · 재고</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
          <div>
            <label style={label}>판매가 (원)</label>
            <input style={inputStyle} type="number" value={salePrice} onChange={(e) => setSalePrice(Number(e.target.value))} min={0} />
          </div>
          <div>
            <label style={label}>재고</label>
            <input style={inputStyle} type="number" value={stock} onChange={(e) => setStock(Number(e.target.value))} min={0} />
          </div>
          <div>
            <label style={label}>배송비 (원)</label>
            <input style={inputStyle} type="number" value={deliveryCharge} onChange={(e) => setDeliveryCharge(Number(e.target.value))} min={0} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div>
            <label style={label}>반품 배송비 (원)</label>
            <input style={inputStyle} type="number" value={returnCharge} onChange={(e) => setReturnCharge(Number(e.target.value))} min={0} />
          </div>
          <div>
            <label style={label}>교환 배송비 (원)</label>
            <input style={{ ...inputStyle, backgroundColor: '#f3f4f6', color: C.textSub }} type="number" value={returnCharge * 2} readOnly />
          </div>
        </div>
      </div>

      {/* ── 섹션 3: 검색 태그 ────────────────────────────────── */}
      <div style={section}>
        <p style={sectionTitle}>검색 태그 (최대 10개)</p>
        <div style={{ display: 'flex', gap: '6px' }}>
          <input
            style={{ ...inputStyle, flex: 1 }}
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const t = tagInput.trim();
                if (t && !tags.includes(t) && tags.length < 10) {
                  setTags([...tags, t]);
                  setTagInput('');
                }
              }
            }}
            placeholder="태그 입력 후 Enter"
          />
          <button
            type="button"
            onClick={() => {
              const t = tagInput.trim();
              if (t && !tags.includes(t) && tags.length < 10) {
                setTags([...tags, t]);
                setTagInput('');
              }
            }}
            style={{ padding: '9px 14px', fontSize: '12px', fontWeight: 600, backgroundColor: C.tableHeader, color: C.text, border: `1px solid ${C.border}`, borderRadius: '8px', cursor: 'pointer' }}
          >
            추가
          </button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
          {tags.map((tag) => (
            <span
              key={tag}
              style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '3px 10px', backgroundColor: '#f0fdf4', color: '#166534', border: '1px solid #86efac', borderRadius: '100px', fontSize: '12px' }}
            >
              {tag}
              <button
                type="button"
                onClick={() => setTags(tags.filter((t) => t !== tag))}
                style={{ background: 'none', border: 'none', color: '#4ade80', cursor: 'pointer', padding: 0, fontSize: '14px', lineHeight: 1 }}
              >×</button>
            </span>
          ))}
        </div>
      </div>

      {/* ── 상세설명 없음 경고 ──────────────────────────────── */}
      {!hasDetailHtml && (
        <div style={{ padding: '10px 14px', backgroundColor: '#fef9c3', border: '1px solid #fde047', borderRadius: '8px', fontSize: '12px', color: '#854d0e' }}>
          ⚠ 상세설명이 없습니다. Step 3에서 AI 상세페이지를 먼저 생성해주세요.
        </div>
      )}

      {/* ── 액션 바 ──────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '4px' }}>
        {submitError && (
          <div style={{ padding: '10px 14px', backgroundColor: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '8px', fontSize: '12px', color: '#b91c1c' }}>
            {submitError}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <button
            type="button"
            onClick={handleSaveDraft}
            disabled={isSavingDraft || !name}
            style={{
              width: '100%', padding: '12px', fontSize: '13px', fontWeight: 600,
              backgroundColor: '#fff', color: C.text,
              border: `2px solid ${C.border}`, borderRadius: '10px',
              cursor: isSavingDraft || !name ? 'not-allowed' : 'pointer',
              opacity: !name ? 0.5 : 1,
            }}
          >
            {isSavingDraft ? '저장 중...' : draftId ? '임시저장 업데이트' : '임시저장'}
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '2px 0' }}>
            <div style={{ flex: 1, height: '1px', backgroundColor: '#e5e7eb' }} />
            <span style={{ fontSize: '10px', color: '#9ca3af', whiteSpace: 'nowrap' }}>저장 후 제출</span>
            <div style={{ flex: 1, height: '1px', backgroundColor: '#e5e7eb' }} />
          </div>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || !name || !draftId || !hasDetailHtml || !leafCategoryId}
            title={!draftId ? '먼저 임시저장하세요' : !leafCategoryId ? '카테고리를 선택하세요' : !hasDetailHtml ? '상세설명을 먼저 생성하세요' : ''}
            style={{
              width: '100%', padding: '12px', fontSize: '13px', fontWeight: 700,
              backgroundColor: isSubmitting || !draftId || !hasDetailHtml || !leafCategoryId
                ? '#e5e7eb'
                : '#15803d',
              color: isSubmitting || !draftId || !hasDetailHtml || !leafCategoryId ? C.textSub : '#fff',
              border: 'none', borderRadius: '10px',
              cursor: isSubmitting || !draftId || !hasDetailHtml || !leafCategoryId ? 'not-allowed' : 'pointer',
            }}
          >
            {isSubmitting ? '제출 중... (이미지 업로드 포함)' : '네이버에 제출'}
          </button>
        </div>
        {draftFeedback === 'saved' && (
          <p style={{ fontSize: '11px', textAlign: 'center', color: '#15803d', fontWeight: 600 }}>저장됐습니다</p>
        )}
        {draftFeedback === 'error' && (
          <p style={{ fontSize: '11px', textAlign: 'center', color: '#b91c1c' }}>{draftSaveError || '저장에 실패했습니다'}</p>
        )}
        {!draftFeedback && !draftId && (
          <p style={{ fontSize: '11px', textAlign: 'center', color: C.textSub }}>임시저장 후 네이버에 제출할 수 있습니다</p>
        )}
      </div>
    </div>
  );
}
