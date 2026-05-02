'use client';

import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useListingStore } from '@/store/useListingStore';
import { C } from '@/lib/design-tokens';
import type { NormalizedProduct } from '@/lib/auto-register/types';
import { calcRecommendedSalePrice, DOMEGGOOK_TARGET_MARGIN_RATE } from '@/lib/sourcing/shared/channel-policy';

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  fontSize: '14px',
  border: `1px solid ${C.border}`,
  borderRadius: '10px',
  outline: 'none',
  color: C.text,
  backgroundColor: '#fff',
  boxSizing: 'border-box',
};

function isValidHttpUrl(input: string): boolean {
  try {
    const u = new URL(input);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export default function Step1SourceSelect() {
  const { updateSharedDraft, goNextStep } = useListingStore();
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const canSubmit = url.trim().length > 0 && !loading;

  const handleSubmit = async () => {
    setError(null);
    const trimmed = url.trim();
    if (!trimmed) return;
    if (!isValidHttpUrl(trimmed)) {
      setError('올바른 URL 형식이 아닙니다 (http:// 또는 https://로 시작해야 합니다).');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auto-register/parse-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      });

      const json = await res.json() as { product?: NormalizedProduct; error?: string };

      if (!res.ok || !json.product) {
        setError(json.error ?? '상품 정보를 가져오는 중 오류가 발생했습니다.');
        return;
      }

      const p = json.product;

      // 파싱된 상품 데이터를 sharedDraft에 저장
      // 소싱 원가 → 추천 판매가 역산 (목표 마진 10%)
      const costPrice = p.price > 0 ? p.price : 0;
      const targetProfit = Math.round(costPrice * DOMEGGOOK_TARGET_MARGIN_RATE);
      const recommendedSalePrice = costPrice > 0
        ? calcRecommendedSalePrice(costPrice, targetProfit, 'coupang')
        : 0;
      // 정가: 소싱처 소비자가 우선, 없으면 추천가 × 1.25 올림
      const rawOriginal = p.originalPrice ?? 0;
      const computedOriginal = rawOriginal > recommendedSalePrice
        ? rawOriginal
        : recommendedSalePrice > 0
          ? Math.ceil((recommendedSalePrice * 1.25) / 1000) * 1000
          : 0;

      updateSharedDraft({
        name: p.title,
        costPrice: costPrice > 0 ? String(costPrice) : '',
        salePrice: recommendedSalePrice > 0 ? String(recommendedSalePrice) : '',
        originalPrice: computedOriginal > 0 ? String(computedOriginal) : '',
        thumbnailImages: p.imageUrls ?? [],
        detailImages: p.detailImageUrls ?? [],
        description: p.detailHtml ?? '',
        tags: p.suggestedTags ?? [],
        categoryHint: p.categoryHint ?? '',
        certification: p.certification,
        manufacturer: p.manufacturer ?? p.brand,
        countryOfOrigin: p.countryOfOrigin,
        productSpecText: p.specText || (p.description && !p.description.startsWith('<') ? p.description : undefined),
        detailPageStatus: 'idle',
        detailPageSkipped: !p.detailHtml,
      });

      goNextStep();
    } catch {
      setError('네트워크 오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      maxWidth: '720px',
      margin: '40px auto',
      padding: '32px',
      backgroundColor: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: '14px',
      display: 'flex',
      flexDirection: 'column',
      gap: '20px',
    }}>
      <div>
        <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: C.text }}>
          상품 URL 입력
        </h2>
        <p style={{ fontSize: '13px', color: C.textSub, margin: '6px 0 0' }}>
          상품 페이지 URL을 붙여넣으세요. 도매꾹·쿠팡·코스트코 등의 URL을 자동으로 인식합니다.
        </p>
      </div>

      <input
        type="url"
        style={inputStyle}
        value={url}
        onChange={(e) => { setUrl(e.target.value); setError(null); }}
        onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
        placeholder="https://"
        autoFocus
        disabled={loading}
      />

      {error && (
        <div style={{
          padding: '10px 14px',
          backgroundColor: '#fee2e2',
          color: '#b91c1c',
          fontSize: '13px',
          borderRadius: '8px',
        }}>
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          padding: '12px 20px',
          fontSize: '14px',
          fontWeight: 700,
          backgroundColor: canSubmit ? C.accent : C.border,
          color: canSubmit ? '#fff' : C.textSub,
          border: 'none',
          borderRadius: '10px',
          cursor: canSubmit ? 'pointer' : 'not-allowed',
        }}
      >
        {loading && <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />}
        {loading ? '상품 정보 가져오는 중...' : '자동 처리 시작'}
      </button>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
