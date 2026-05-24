'use client';

/**
 * MobileCodeSearchCard
 * 상품코드를 입력받아 3단계(상품조회 → 가격입력 → 비교)를 인라인으로 처리하는 카드 컴포넌트
 */

import { useState, useEffect, useCallback } from 'react';
import type { LookupResult } from '@/app/api/sourcing/costco/lookup/route';
import type { NaverCompareResponse } from '@/app/api/sourcing/costco/naver-compare/route';

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  code: string;
  onClose: () => void;
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

export default function MobileCodeSearchCard({ code, onClose }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [product, setProduct] = useState<LookupResult | null>(null);
  const [isLoadingProduct, setIsLoadingProduct] = useState(true);
  const [lookupError, setLookupError] = useState<string | null>(null);
  // Issue 2 & 3: 오류 유형을 별도로 추적하여 retry 버튼 렌더링에 활용
  const [lookupErrorType, setLookupErrorType] = useState<'not_found' | 'error' | null>(null);
  // Issue 2 & 3: lookupKey 증가 시 useEffect 재실행으로 재조회(retry) 구현
  const [lookupKey, setLookupKey] = useState(0);
  const [offlinePrice, setOfflinePrice] = useState('');
  const [naverResult, setNaverResult] = useState<NaverCompareResponse | null>(null);
  const [isLoadingNaver, setIsLoadingNaver] = useState(false);
  // Issue 4 & 5: 네이버 API 실패 여부 추적
  const [naverFailed, setNaverFailed] = useState(false);

  // code 또는 lookupKey 변경 시 상태 초기화 후 상품 조회
  useEffect(() => {
    const controller = new AbortController();
    setIsLoadingProduct(true);
    setLookupError(null);
    setLookupErrorType(null);
    setProduct(null);
    setStep(1);
    setOfflinePrice('');
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

  // 오프라인 단위가 계산 (온라인 단위가 기준 환산)
  const offlineUnitPrice =
    isValidPrice && product.unitPrice > 0 && product.onlinePrice > 0
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
                  네이버 최저가{product.unitPriceLabel ? ` (${product.unitPriceLabel})` : ''}
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>
                  {product.marketLowestPrice
                    ? (product.marketUnitPrice
                        ? fmt(Math.round(product.marketUnitPrice))
                        : fmt(product.marketLowestPrice))
                    : <span style={{ fontSize: 13, fontWeight: 400, color: C.sub }}>정보 없음</span>
                  }
                  {product.marketLowestPrice && (
                    <span style={{ fontSize: 10, fontWeight: 400, color: C.sub }}>
                      원{product.unitPriceLabel ? `/${product.unitPriceLabel}` : ''}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* 절감율 뱃지 — 양쪽 단위가가 모두 있을 때만 계산 */}
            {offlineUnitPrice && product.marketUnitPrice && (() => {
              const rate = calcSavingRate(product.marketUnitPrice, offlineUnitPrice);
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

          {/* 네이버 실시간 조회 로딩 */}
          {isLoadingNaver && (
            <div style={{ fontSize: 12, color: C.sub, textAlign: 'center', padding: '8px 0' }}>
              네이버 실시간 조회 중...
            </div>
          )}

          {/* 네이버 비교 상품 목록 */}
          {naverResult && naverResult.items.length > 0 && (
            <>
              <div style={{ fontSize: 10, color: C.sub, marginBottom: 6 }}>
                비교 기준 네이버 상품 <span style={{ color: '#9ca3af' }}>(탭해서 이동)</span>
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
