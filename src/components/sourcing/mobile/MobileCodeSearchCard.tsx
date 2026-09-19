'use client';

/**
 * MobileCodeSearchCard
 * 상품코드를 입력받아 3단계(상품조회 → 가격입력 → 비교)를 인라인으로 처리하는 카드 컴포넌트
 */

import { useState, useEffect, useCallback } from 'react';
import type { LookupResult } from '@/app/api/sourcing/costco/lookup/route';
import type { NaverCompareResponse } from '@/app/api/sourcing/costco/naver-compare/route';
import { calcCostcoPrice, PACKING_COST, calcNetProfit, calcNetMarginRate, calcMinSalePrice, getLogisticsCost, CHANNEL_FEE, VAT_RATE, calcNetProfitSimplified, calcNetMarginRateSimplified, calcMinSalePriceSimplified, SIMPLIFIED_VAT_RATE, getCoupangFeeRate } from '@/lib/sourcing/costco-pricing';

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  code: string;
  onClose: () => void;
  /**
   * 가격표 촬영으로 판독된 매장가. 있으면 매장가 입력칸의 초기값으로 넣어
   * 타이핑을 없앤다 — 판독은 이미 price를 뽑고 있었는데 버리고 있었다(2026-09-06).
   * 판독이 틀릴 수 있으므로 사용자가 그대로 고칠 수 있게 편집은 막지 않는다.
   */
  scannedPrice?: number | null;
}

type Step = 1 | 2 | 3;

// ─────────────────────────────────────────────────────────────────────────────
// 색상 상수
// ─────────────────────────────────────────────────────────────────────────────

const C = {
  blue:   '#2563eb',
  green:  '#16a34a',
  red:    '#dc2626',
  sub:    '#6b7280',
  border: '#e5e7eb',
  text:   '#1a1c1c',
  bg:     '#f9fafb',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// 유틸 함수
// ─────────────────────────────────────────────────────────────────────────────

/** 한국어 숫자 포맷 */
function fmt(n: number) { return n.toLocaleString('ko-KR'); }

/** 절대값 백분율 포맷 */
function fmtRate(n: number) { return `${Math.abs(n).toFixed(1)}%`; }

/**
 * 오프라인 단위가 계산
 * 온라인 가격 대비 비율로 오프라인 단위가를 환산한다
 */
function calcOfflineUnitPrice(offlinePrice: number, onlinePrice: number, unitPrice: number) {
  return offlinePrice * (unitPrice / onlinePrice);
}

/**
 * 절감율 계산
 * 양수 → 코스트코가 더 저렴, 음수 → 코스트코가 더 비쌈
 */
function calcSavingRate(naverUnitPrice: number, offlineUnitPrice: number) {
  return (naverUnitPrice / offlineUnitPrice - 1) * 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────

export default function MobileCodeSearchCard({ code, onClose, scannedPrice }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [product, setProduct] = useState<LookupResult | null>(null);
  const [isLoadingProduct, setIsLoadingProduct] = useState(true);
  const [lookupError, setLookupError] = useState<string | null>(null);
  // Issue 2 & 3: 오류 유형을 별도로 추적하여 retry 버튼 렌더링에 활용
  const [lookupErrorType, setLookupErrorType] = useState<'not_found' | 'error' | null>(null);
  // Issue 2 & 3: lookupKey 증가 시 useEffect 재실행으로 재조회(retry) 구현
  const [lookupKey, setLookupKey] = useState(0);
  const [offlinePrice, setOfflinePrice] = useState(scannedPrice ? String(scannedPrice) : '');
  const [naverResult, setNaverResult] = useState<NaverCompareResponse | null>(null);
  const [isLoadingNaver, setIsLoadingNaver] = useState(false);
  // Issue 4 & 5: 네이버 API 실패 여부 추적
  const [naverFailed, setNaverFailed] = useState(false);

  // ── STEP 3 내 판매가 계산 ────────────────────────────────────────────────
  // 「마진 20%면 얼마에 팔아라」(STEP 2)의 반대 방향 — 「이 가격이면 얼마 남나」.
  // 비교하기를 누를 때 권장가로 시드해 타이핑 0으로 시작한다.
  const [myPrice, setMyPrice] = useState('');
  /** 산식을 펼친 카드 키. 탭으로 토글한다 — 매대에서 숫자가 의심스러울 때 근거를 본다 */
  const [openCalc, setOpenCalc] = useState<'wing' | 'growth' | null>(null);

  // code 또는 lookupKey 변경 시 상태 초기화 후 상품 조회
  useEffect(() => {
    const controller = new AbortController();
    setIsLoadingProduct(true);
    setLookupError(null);
    setLookupErrorType(null);
    setProduct(null);
    setStep(1);
    setOfflinePrice(scannedPrice ? String(scannedPrice) : '');
    setMyPrice('');
    setOpenCalc(null);
    setNaverResult(null);
    setNaverFailed(false);

    fetch(`/api/sourcing/costco/lookup?code=${encodeURIComponent(code)}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.status === 404) {
          setLookupError('해당 상품코드를 찾을 수 없습니다');
          setLookupErrorType('not_found');
          return;
        }
        if (!res.ok) {
          setLookupError('조회 중 오류가 발생했습니다. 다시 시도해주세요');
          setLookupErrorType('error');
          return;
        }
        const data: LookupResult = await res.json();
        setProduct(data);
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setLookupError('조회 중 오류가 발생했습니다. 다시 시도해주세요');
        setLookupErrorType('error');
      })
      .finally(() => setIsLoadingProduct(false));

    return () => controller.abort();
  }, [code, lookupKey]);

  // 네이버 비교 요청 — step 3으로 전환하면서 비동기 조회
  const handleCompare = useCallback(async () => {
    if (!product || !offlinePrice || isLoadingNaver) return;

    // 권장가로 시드한다. 렌더 스코프의 naverRec을 쓰면 deps가 누락되므로 여기서 직접 계산한다.
    const buy = Number(offlinePrice);
    if (buy > 0) {
      const seedWeightKg =
        product.unitType === 'weight' && product.totalQuantity !== null && product.totalQuantity > 0
          ? product.totalQuantity / 1000
          : null;
      const seed = calcCostcoPrice({
        buyPrice: buy,
        packQty: 1,
        categoryName: product.categoryName ?? null,
        channel: 'naver',
        weightKg: seedWeightKg,
        targetRate: 0.2,
      });
      setMyPrice(String(seed.recommendedPrice));
    }

    setStep(3);
    setIsLoadingNaver(true);
    // Issue 4: 재조회 시 이전 실패 상태 초기화
    setNaverFailed(false);
    try {
      const params = new URLSearchParams({ title: product.title, code });
      const res = await fetch(`/api/sourcing/costco/naver-compare?${params}`);
      if (res.ok) {
        const data = await res.json() as NaverCompareResponse;
        setNaverResult(data);
      } else {
        // 네이버 API 비정상 응답 시 실패 플래그 설정
        setNaverFailed(true);
      }
    } catch {
      // 네트워크 수준 오류 시 실패 플래그 설정
      setNaverFailed(true);
    } finally {
      setIsLoadingNaver(false);
    }
  }, [product, offlinePrice, code]);

  // 입력된 오프라인 가격을 정수로 파싱
  const offlinePriceNum = Number(offlinePrice);
  const isValidPrice = !isNaN(offlinePriceNum) && offlinePriceNum > 0;

  // 오프라인가 기반 weightKg 파생 (LookupResult 필드 기준)
  const offlineWeightKg =
    product?.unitType === 'weight' &&
    product.totalQuantity !== null &&
    product.totalQuantity > 0
      ? product.totalQuantity / 1000
      : null;

  const naverRec = isValidPrice && product
    ? calcCostcoPrice({
        buyPrice: offlinePriceNum,
        packQty: 1,
        categoryName: product.categoryName ?? null,
        channel: 'naver',
        weightKg: offlineWeightKg,
        targetRate: 0.2,
      })
    : null;

  const coupangRec = isValidPrice && product
    ? calcCostcoPrice({
        buyPrice: offlinePriceNum,
        packQty: 1,
        categoryName: product.categoryName ?? null,
        channel: 'coupang',
        weightKg: offlineWeightKg,
        targetRate: 0.2,
      })
    : null;

  // ── 로딩 상태 ────────────────────────────────────────────────────────────

  if (isLoadingProduct) {
    return (
      <div style={{ margin: '10px 12px', background: '#fff', borderRadius: 12, padding: 16, border: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 13, color: C.sub, textAlign: 'center' }}>상품 조회 중...</div>
      </div>
    );
  }

  // ── 오류 상태 ─────────────────────────────────────────────────────────────

  if (lookupError) {
    return (
      <div style={{ margin: '10px 12px', background: '#fff', borderRadius: 12, padding: 16, border: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 13, color: C.red, marginBottom: 12 }}>{lookupError}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {/* 404(not_found)는 재시도해도 의미 없으므로 retry 버튼을 숨김 */}
          {lookupErrorType === 'error' && (
            <button
              onClick={() => { setLookupError(null); setLookupKey(k => k + 1); }}
              style={{
                fontSize: 12, color: '#fff', background: C.blue,
                border: 'none', borderRadius: 6, cursor: 'pointer',
                padding: '6px 12px', fontWeight: 600,
              }}
            >
              다시 시도
            </button>
          )}
          <button
            onClick={onClose}
            style={{ fontSize: 12, color: C.sub, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            ← 목록으로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  if (!product) return null;

  // 🔴 2026-09-06: 「네이버 최저가」 칸이 DB 저장값(marketLowestPrice)을 보여주는데
  //    그 값은 2026-04-11자로 5개월 묵었고 대부분 비어 있어 「정보 없음」만 떴다.
  //    네이버 쇼핑 API 종료로 갱신도 불가하다. 다나와 실시간 결과가 있으면 그것을 우선한다.
  const liveLowest = naverResult?.items?.length
    ? Math.min(...naverResult.items.map((i) => i.totalPrice))
    : null;
  /** 화면에 쓸 시세 총액 — 실시간 우선, 없으면 DB 캐시 */
  const marketTotal = liveLowest ?? product.marketLowestPrice ?? null;
  /** 시세 단위가 — 실시간 총액을 코스트코와 같은 기준으로 환산한다 */
  const marketUnit =
    liveLowest && product.onlinePrice && product.unitPrice
      ? calcOfflineUnitPrice(liveLowest, product.onlinePrice, product.unitPrice)
      : product.marketUnitPrice ?? null;
  const isLiveMarket = liveLowest !== null;

  // 오프라인 단위가 계산 (온라인 단위가 기준 환산)
  const offlineUnitPrice =
    isValidPrice && product.unitPrice !== null && product.unitPrice > 0 && product.onlinePrice > 0
      ? calcOfflineUnitPrice(offlinePriceNum, product.onlinePrice, product.unitPrice)
      : null;

  return (
    <div style={{
      margin: '10px 12px',
      background: '#fff',
      borderRadius: 12,
      overflow: 'hidden',
      boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
      border: `1px solid ${C.border}`,
    }}>

      {/* ── STEP 1 + STEP 2: 상품 정보 & 가격 입력 ─────────────────────── */}
      {step < 3 ? (
        <>
          {/* STEP 1: 코스트코 온라인 상품 정보 */}
          <div style={{ padding: 12 }}>
            <div style={{ fontSize: 10, color: C.sub, marginBottom: 8, fontWeight: 600, letterSpacing: '0.5px' }}>
              STEP 1 · 코스트코 온라인
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              {/* 상품 이미지 */}
              <div style={{
                width: 56, height: 56, borderRadius: 8, overflow: 'hidden',
                background: '#f3f4f6', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {product.imageUrl
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={product.imageUrl} alt={product.title} width={56} height={56} style={{ objectFit: 'cover', width: '100%', height: '100%' }} />
                  : <span style={{ fontSize: 24 }}>📦</span>}
              </div>
              {/* 상품명 & 카테고리 & 별점 & 온라인가 */}
              <div style={{ flex: 1 }}>
                <p style={{
                  margin: 0, fontSize: 13, fontWeight: 600, color: C.text, lineHeight: 1.4,
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                }}>
                  {product.title}
                </p>
                {product.categoryName && (
                  <p style={{ margin: '2px 0 0', fontSize: 11, color: C.sub }}>{product.categoryName}</p>
                )}
                {/* Issue 1: 별점(rating) 표시 — averageRating이 null이 아닐 때만 노출 */}
                {product.averageRating !== null && (
                  <p style={{ margin: '2px 0 0', fontSize: 11, color: C.sub }}>
                    ★ {product.averageRating.toFixed(1)} ({product.reviewCount})
                  </p>
                )}
                <div style={{ marginTop: 4, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: C.sub }}>온라인가</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{fmt(product.onlinePrice)}원</span>
                </div>
              </div>
            </div>
          </div>

          <div style={{ height: 1, background: '#f3f4f6', margin: '0 12px' }} />

          {/* STEP 2: 매장 가격 입력 */}
          <div style={{ padding: 12 }}>
            <div style={{ fontSize: 10, color: C.sub, marginBottom: 8, fontWeight: 600, letterSpacing: '0.5px' }}>
              STEP 2 · 매장 가격 입력
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ flex: 1, position: 'relative' }}>
                <input
                  type="number"
                  value={offlinePrice}
                  onChange={(e) => setOfflinePrice(e.target.value)}
                  placeholder="예: 29900"
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    background: C.bg, border: `1.5px solid ${C.border}`, borderRadius: 8,
                    padding: '9px 36px 9px 12px', fontSize: 14, fontWeight: 600, color: C.text, outline: 'none',
                  }}
                />
                <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: C.sub }}>원</span>
              </div>
              <button
                onClick={handleCompare}
                disabled={!isValidPrice}
                style={{
                  background: isValidPrice ? C.text : '#d1d5db',
                  color: '#fff', border: 'none', borderRadius: 8,
                  padding: '9px 16px', fontSize: 13, fontWeight: 700,
                  cursor: isValidPrice ? 'pointer' : 'not-allowed',
                  whiteSpace: 'nowrap', flexShrink: 0,
                }}
              >
                비교하기
              </button>
            </div>
            <div style={{ marginTop: 6, fontSize: 10, color: '#9ca3af' }}>
              온라인과 다른 실제 매장 가격을 입력하세요
            </div>
            {/* 추천 판매가 블록 — isValidPrice일 때만 표시 */}
            {naverRec && coupangRec && (
              <div style={{
                marginTop: 10,
                background: '#f0fdf4',
                borderRadius: 8,
                padding: '10px 12px',
                border: '1px solid #bbf7d0',
              }}>
                {/* 블록 제목 */}
                <div style={{ fontSize: 10, fontWeight: 700, color: '#16a34a', marginBottom: 8, letterSpacing: '0.3px' }}>
                  추천 판매가 (마진 20%)
                </div>

                {/* 네이버·쿠팡 2열 */}
                <div style={{ display: 'flex', gap: 8 }}>
                  {/* 네이버 */}
                  <div style={{
                    flex: 1, background: '#fff', borderRadius: 6, padding: '8px 10px',
                    border: '1px solid #e5e7eb',
                  }}>
                    <div style={{ fontSize: 10, color: '#03c75a', fontWeight: 700, marginBottom: 4 }}>네이버 쇼핑</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: '#1a1c1c' }}>
                      {naverRec.recommendedPrice.toLocaleString('ko-KR')}원
                    </div>
                    <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                      마진율 <span style={{ color: '#16a34a', fontWeight: 700 }}>{naverRec.realMarginRate.toFixed(1)}%</span>
                    </div>
                    <div style={{ fontSize: 11, color: '#6b7280' }}>
                      순이익 <span style={{ color: '#1a1c1c', fontWeight: 600 }}>{naverRec.netProfit.toLocaleString('ko-KR')}원</span>
                    </div>
                  </div>

                  {/* 쿠팡 */}
                  <div style={{
                    flex: 1, background: '#fff', borderRadius: 6, padding: '8px 10px',
                    border: '1px solid #e5e7eb',
                  }}>
                    <div style={{ fontSize: 10, color: '#e52222', fontWeight: 700, marginBottom: 4 }}>쿠팡</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: '#1a1c1c' }}>
                      {coupangRec.recommendedPrice.toLocaleString('ko-KR')}원
                    </div>
                    <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                      마진율 <span style={{ color: '#16a34a', fontWeight: 700 }}>{coupangRec.realMarginRate.toFixed(1)}%</span>
                    </div>
                    <div style={{ fontSize: 11, color: '#6b7280' }}>
                      순이익 <span style={{ color: '#1a1c1c', fontWeight: 600 }}>{coupangRec.netProfit.toLocaleString('ko-KR')}원</span>
                    </div>
                  </div>
                </div>

                {/* 배송비·포장비 안내 */}
                <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 8 }}>
                  배송비 {naverRec.shippingCost.toLocaleString('ko-KR')}원 + 포장비 {PACKING_COST.toLocaleString('ko-KR')}원 포함
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        /* ── STEP 3 헤더: 요약 정보 (수정 버튼 포함) ────────────────────── */
        <div style={{
          padding: '10px 12px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          borderBottom: `1px solid ${C.border}`,
        }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {/* 축소 이미지 */}
            <div style={{
              width: 32, height: 32, borderRadius: 6, overflow: 'hidden',
              background: '#f3f4f6', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {product.imageUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={product.imageUrl} alt={product.title} width={32} height={32} style={{ objectFit: 'cover', width: '100%', height: '100%' }} />
                : <span style={{ fontSize: 14 }}>📦</span>}
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 12, color: C.text }}>
                {product.title.slice(0, 20)}{product.title.length > 20 ? '...' : ''}
              </div>
              <div style={{ fontSize: 10, color: C.sub }}>
                매장가 <b style={{ color: C.text }}>{fmt(offlinePriceNum)}원</b>
              </div>
            </div>
          </div>
          {/* step 1로 돌아가서 가격 수정 */}
          <button
            onClick={() => setStep(1)}
            style={{ fontSize: 11, color: C.blue, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            수정
          </button>
        </div>
      )}

      {/* ── STEP 3: 네이버 비교 결과 ─────────────────────────────────────── */}
      {step === 3 && (
        <div style={{ padding: 12 }}>
          <div style={{ fontSize: 10, color: C.sub, marginBottom: 8, fontWeight: 600, letterSpacing: '0.5px' }}>
            STEP 3 · 네이버 비교
          </div>

          {/* Issue 5: 네이버 API 실패 시 DB 캐시 기준 안내 메시지 */}
          {naverResult === null && naverFailed && !isLoadingNaver && (
            <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 8 }}>
              실시간 조회 실패 — DB 캐시 기준으로 표시합니다
            </div>
          )}

          {/* Issue 6: vs/vs 블록을 항상 표시 — marketLowestPrice가 null이면 정보 없음 표시 */}
          <div style={{ background: '#f9fafb', borderRadius: 8, padding: 10, marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              {/* 코스트코 오프라인 단위가 */}
              <div>
                <div style={{ fontSize: 10, color: C.sub }}>
                  코스트코{product.unitPriceLabel ? ` (${product.unitPriceLabel})` : ''}
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>
                  {offlineUnitPrice ? fmt(Math.round(offlineUnitPrice)) : fmt(offlinePriceNum)}
                  <span style={{ fontSize: 10, fontWeight: 400, color: C.sub }}>
                    원{product.unitPriceLabel ? `/${product.unitPriceLabel}` : ''}
                  </span>
                </div>
              </div>
              <div style={{ fontSize: 18, color: '#d1d5db' }}>vs</div>
              {/* 네이버 최저 단위가 — marketLowestPrice가 없으면 정보 없음 표시 */}
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 10, color: C.sub }}>
                  {isLiveMarket ? '다나와 최저가' : '시세(캐시)'}
                  {product.unitPriceLabel ? ` (${product.unitPriceLabel})` : ''}
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>
                  {marketTotal
                    ? (marketUnit ? fmt(Math.round(marketUnit)) : fmt(marketTotal))
                    : <span style={{ fontSize: 13, fontWeight: 400, color: C.sub }}>조회 중</span>
                  }
                  {marketTotal && (
                    <span style={{ fontSize: 10, fontWeight: 400, color: C.sub }}>
                      원{product.unitPriceLabel ? `/${product.unitPriceLabel}` : ''}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* 🔴 캐시 시세 경고 — DB 값은 2026-04-11자이고 실측에서 2.3배 오차가 났다 */}
            {!isLiveMarket && marketTotal && (
              <div style={{
                background: '#fef3c7', color: '#92400e', borderRadius: 6,
                padding: '5px 8px', fontSize: 10, marginBottom: 6, textAlign: 'center',
              }}>
                묵은 캐시 값입니다 · 아래 실시간 목록으로 확인하세요
              </div>
            )}

            {/* 절감율 뱃지 — 양쪽 단위가가 모두 있을 때만 계산 */}
            {offlineUnitPrice && marketUnit && (() => {
              const rate = calcSavingRate(marketUnit, offlineUnitPrice);
              return (
                <div style={{
                  background: rate >= 0 ? '#dcfce7' : '#fee2e2',
                  borderRadius: 6, padding: '6px 10px',
                  textAlign: 'center', fontSize: 12, fontWeight: 700,
                  color: rate >= 0 ? C.green : C.red,
                }}>
                  {rate >= 0 ? `▼ ${fmtRate(rate)} 더 저렴` : `▲ ${fmtRate(rate)} 더 비쌈`}
                </div>
              );
            })()}
          </div>

          {/* ── 내 판매가 계산 — 「이 가격이면 얼마 남나」 ─────────────────── */}
          {naverRec && (() => {
            const myPriceNum = Number(myPrice);
            const valid = !isNaN(myPriceNum) && myPriceNum > 0;
            const chips: Array<{ label: string; value: number }> = [
              { label: '권장가', value: naverRec.recommendedPrice },
            ];
            if (liveLowest && liveLowest > 10) chips.push({ label: '최저가-10원', value: liveLowest - 10 });

            return (
              <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                <div style={{ fontSize: 10, color: C.sub, marginBottom: 6 }}>내 판매가로 계산</div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={myPrice}
                    onChange={(e) => setMyPrice(e.target.value)}
                    placeholder="판매가"
                    style={{
                      flex: 1, height: 38, padding: '0 10px', fontSize: 15, fontWeight: 700,
                      border: `1px solid ${C.border}`, borderRadius: 8, outline: 'none',
                      color: C.text, background: '#fff', boxSizing: 'border-box',
                    }}
                  />
                  <span style={{ fontSize: 12, color: C.sub }}>원</span>
                </div>

                {/* 원탭 칩 — 비동기로 온 최저가를 input에 자동 주입하지 않는다(입력 중인 값 보호) */}
                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                  {chips.map((c) => (
                    <button
                      key={c.label}
                      type="button"
                      onClick={() => setMyPrice(String(c.value))}
                      style={{
                        flex: 1, height: 26, fontSize: 10, color: '#1d4ed8',
                        background: '#fff', border: '1px solid #bfdbfe', borderRadius: 6, cursor: 'pointer',
                      }}
                    >
                      {c.label} {fmt(c.value)}
                    </button>
                  ))}
                </div>

                {valid ? (
                  <div style={{ display: 'flex', gap: 6, flexDirection: openCalc ? 'column' : 'row' }}>
                    {([
                      { key: 'wing' as const, label: '윙(판매자배송)', ch: 'coupang' as const },
                      { key: 'growth' as const, label: '로켓그로스', ch: 'coupang' as const },
                    ]).map(({ key, label, ch }) => {
                      // 🔴 윙과 그로스는 물류비 구조가 다르다 — 위키 실측(SOHO 3,179 / 그로스 극소형 3,080)
                      const logi = getLogisticsCost(offlineWeightKg, key, 1);
                      const cost = offlinePriceNum + logi + (key === 'wing' ? PACKING_COST : 0);
                      // 🔴 간이과세자 기준 — 매출세액 1.5%, 수수료는 VAT 포함(×1.1)
                      // 🔴 쿠팡 정률은 카테고리 실측값을 쓴다 — 폴백 11%는 실측 어느 값보다 높다
                      const feeRate = getCoupangFeeRate(product.categoryName);
                      const profit = calcNetProfitSimplified(myPriceNum, cost, ch, feeRate);
                      const rate = calcNetMarginRateSimplified(myPriceNum, cost, ch, feeRate);
                      const be = calcMinSalePriceSimplified(cost, ch, feeRate);
                      // 권장가는 100원 반올림이라 20.0%에 살짝 못 미칠 수 있다 → 경계에 여유를 둔다
                      const color = rate >= 19.5 ? C.green : rate >= 13 ? '#d97706' : C.red;
                      const isOpen = openCalc === key;
                      return (
                        <div
                          key={key}
                          onClick={() => setOpenCalc(isOpen ? null : key)}
                          role="button"
                          style={{
                            flex: 1, background: '#fff', borderRadius: 6, padding: 8,
                            border: `1px solid ${isOpen ? '#93c5fd' : 'transparent'}`,
                            cursor: 'pointer',
                          }}
                        >
                          <div style={{ fontSize: 10, color: C.sub, marginBottom: 3, display: 'flex', justifyContent: 'space-between' }}>
                            <span>{label}</span>
                            <span style={{ color: '#9ca3af' }}>{isOpen ? '▲' : '▼'}</span>
                          </div>
                          <div style={{ fontSize: 15, fontWeight: 700, color }}>
                            {rate.toFixed(1)}<span style={{ fontSize: 10, fontWeight: 400 }}>%</span>
                          </div>
                          <div style={{ fontSize: 12, fontWeight: 700, color, marginTop: 1 }}>
                            {profit >= 0 ? `${fmt(profit)}원` : `${fmt(Math.abs(profit))}원 손실`}
                          </div>
                          <div style={{ fontSize: 9, color: C.sub, marginTop: 3 }}>
                            손익분기 {fmt(be)}원
                          </div>
                          <div style={{ fontSize: 9, color: '#9ca3af', marginTop: 1 }}>
                            물류 {fmt(logi)}{key === 'wing' ? `+포장 ${fmt(PACKING_COST)}` : ''}
                          </div>

                          {/* 탭하면 산식 — 매대에서 숫자가 의심스러울 때 근거를 본다 */}
                          {isOpen && (() => {
                            const feeWithVat = feeRate * 1.1;
                            const feeAmt = Math.round(myPriceNum * feeWithVat);
                            const taxAmt = Math.round(myPriceNum * SIMPLIFIED_VAT_RATE);
                            const revenue = myPriceNum - feeAmt - taxAmt;
                            const row = (l: string, v: string) => (
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 4 }}>
                                <span style={{ color: C.sub }}>{l}</span>
                                <span style={{ color: C.text, fontVariantNumeric: 'tabular-nums' }}>{v}</span>
                              </div>
                            );
                            return (
                              <div style={{
                                marginTop: 6, paddingTop: 6, borderTop: `1px dashed ${C.border}`,
                                fontSize: 9, lineHeight: 1.55,
                              }}>
                                <div style={{ color: '#6b7280', marginBottom: 3 }}>총원가</div>
                                {row('매입가', fmt(offlinePriceNum))}
                                {row(key === 'wing' ? '택배(SOHO)' : '입출고+배송', `+${fmt(logi)}`)}
                                {key === 'wing' && row('포장재', `+${fmt(PACKING_COST)}`)}
                                {row('= 총원가', fmt(cost))}

                                <div style={{ color: '#6b7280', margin: '5px 0 3px' }}>정산</div>
                                {row('판매가', fmt(myPriceNum))}
                                {row(`− 수수료 ${(feeWithVat * 100).toFixed(1)}%`, `−${fmt(feeAmt)}`)}
                                {row('− 매출세액 1.5%', `−${fmt(taxAmt)}`)}
                                {row('= 정산액', fmt(revenue))}

                                <div style={{ marginTop: 5, paddingTop: 4, borderTop: `1px solid ${C.border}` }}>
                                  {row('정산액 − 총원가', `${fmt(profit)}원`)}
                                  {row('÷ 판매가', `${rate.toFixed(1)}%`)}
                                </div>

                                <div style={{ color: '#9ca3af', marginTop: 5, fontSize: 8, lineHeight: 1.4 }}>
                                  {key === 'wing'
                                    ? '롯데 SOHO 계약 실측(VAT 포함)'
                                    : '2026-08-13 실청구 · 입출고는 낱개당, 배송은 건당'}
                                  <br />간이과세 · 정률 {(feeRate * 100).toFixed(1)}%({product.categoryName ?? '미분류'}) × VAT 1.1
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: C.sub, textAlign: 'center', padding: '6px 0' }}>
                    판매가를 입력하면 마진과 순이익이 나옵니다
                  </div>
                )}
              </div>
            );
          })()}

          {/* 네이버 실시간 조회 로딩 */}
          {isLoadingNaver && (
            <div style={{ fontSize: 12, color: C.sub, textAlign: 'center', padding: '8px 0' }}>
              시세 조회 중...
            </div>
          )}

          {/* 네이버 비교 상품 목록 */}
          {naverResult && naverResult.items.length > 0 && (
            <>
              <div style={{ fontSize: 10, color: C.sub, marginBottom: 6 }}>
                비교 기준 상품 <span style={{ color: '#9ca3af' }}>(탭해서 이동)</span>
              </div>
              {naverResult.items.map((item) => (
                <a
                  key={item.link}
                  href={item.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    border: `1px solid ${C.border}`, borderRadius: 8,
                    padding: '8px 10px', marginBottom: 6, textDecoration: 'none',
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: C.text }}>
                      {item.title.slice(0, 30)}{item.title.length > 30 ? '...' : ''}
                    </div>
                    <div style={{ fontSize: 10, color: C.sub, marginTop: 1 }}>
                      {fmt(item.totalPrice)}원
                    </div>
                  </div>
                  <div style={{
                    background: '#03C75A', color: '#fff', borderRadius: 6,
                    padding: '4px 8px', fontSize: 10, fontWeight: 700,
                    whiteSpace: 'nowrap', flexShrink: 0,
                  }}>
                    N 이동
                  </div>
                </a>
              ))}
            </>
          )}

          {/* 비교 상품 없음 */}
          {naverResult && naverResult.items.length === 0 && !isLoadingNaver && (
            <div style={{ fontSize: 12, color: C.sub, textAlign: 'center', padding: '8px 0' }}>
              네이버 비교 상품을 찾지 못했습니다
            </div>
          )}
        </div>
      )}
    </div>
  );
}
