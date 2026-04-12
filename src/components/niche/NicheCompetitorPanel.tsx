'use client';

/**
 * NicheCompetitorPanel.tsx
 * 경쟁 상품 등록 + 관리 + 전일 판매 스냅샷 입력 통합 패널
 *
 * 구조:
 *   1. 시장 요약 카드 (추적 상품수, 일 판매량, 평균가, 로켓배송 비율)
 *   2. 경쟁 상품 등록 폼 (상품명 + 플랫폼 + URL)
 *   3. 경쟁 상품 테이블 (목록 + 스냅샷 인라인 입력 + 추적 토글)
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  Plus, Trash2, Eye, EyeOff, ExternalLink,
  Loader2, Save, ChevronDown, ChevronUp,
} from 'lucide-react';
import { useCompetitorStore } from '@/store/useCompetitorStore';
import type { CompetitorPlatform } from '@/types/niche';

// ─────────────────────────────────────────────────────────────────────────────
// 색상 상수
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  card: '#ffffff',
  border: '#eeeeee',
  text: '#1a1c1c',
  textSub: '#926f6b',
  bg: '#f9f9f9',
  accent: '#be0014',
  green: '#16a34a',
  blue: '#2563eb',
  red: '#dc2626',
};

const PLATFORM_LABELS: Record<CompetitorPlatform, string> = {
  coupang: '쿠팡',
  naver: '네이버',
  gmarket: 'G마켓',
  auction: '옥션',
  etc: '기타',
};

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────
interface NicheCompetitorPanelProps {
  keyword: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 스냅샷 입력 행 (인라인)
// ─────────────────────────────────────────────────────────────────────────────
function SnapshotInputRow({
  competitorId,
  keyword,
  platform,
}: {
  competitorId: string;
  keyword: string;
  platform: string;
}) {
  const { saveSnapshot, isSaving } = useCompetitorStore();
  const [price, setPrice] = useState('');
  const [reviewCount, setReviewCount] = useState('');
  const [salesCount, setSalesCount] = useState('');
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    const ok = await saveSnapshot({
      competitorId,
      keyword,
      platform,
      price: price ? parseInt(price, 10) : undefined,
      reviewCount: reviewCount ? parseInt(reviewCount, 10) : undefined,
      salesCount: salesCount ? parseInt(salesCount, 10) : undefined,
    });
    if (ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '80px',
    padding: '5px 8px',
    border: `1px solid ${C.border}`,
    borderRadius: '6px',
    fontSize: '12px',
    textAlign: 'right' as const,
    outline: 'none',
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
      <span style={{ fontSize: '11px', color: C.textSub, width: '40px', flexShrink: 0 }}>
        오늘
      </span>
      <input
        type="number"
        placeholder="판매가"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        style={inputStyle}
      />
      <input
        type="number"
        placeholder="리뷰수"
        value={reviewCount}
        onChange={(e) => setReviewCount(e.target.value)}
        style={inputStyle}
      />
      <input
        type="number"
        placeholder="판매량"
        value={salesCount}
        onChange={(e) => setSalesCount(e.target.value)}
        style={inputStyle}
      />
      <button
        onClick={handleSave}
        disabled={isSaving || (!price && !reviewCount && !salesCount)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          padding: '5px 10px',
          borderRadius: '6px',
          border: 'none',
          fontSize: '11px',
          fontWeight: 600,
          cursor: isSaving ? 'default' : 'pointer',
          backgroundColor: saved ? 'rgba(22, 163, 74, 0.1)' : C.accent,
          color: saved ? C.green : '#fff',
          opacity: isSaving || (!price && !reviewCount && !salesCount) ? 0.5 : 1,
        }}
      >
        {isSaving ? (
          <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />
        ) : saved ? (
          '저장됨'
        ) : (
          <>
            <Save size={11} /> 저장
          </>
        )}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────
export default function NicheCompetitorPanel({ keyword }: NicheCompetitorPanelProps) {
  const {
    competitors,
    summary,
    marketSummary,
    isLoading,
    isSaving,
    error,
    fetchCompetitors,
    fetchSummary,
    addCompetitor,
    removeCompetitor,
    toggleTracking,
    clearError,
  } = useCompetitorStore();

  // 등록 폼
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [formPlatform, setFormPlatform] = useState<CompetitorPlatform>('coupang');
  const [formUrl, setFormUrl] = useState('');
  const [formSeller, setFormSeller] = useState('');
  const [formRocket, setFormRocket] = useState(false);
  const [formRank, setFormRank] = useState('');

  // 펼침/접힘
  const [isExpanded, setIsExpanded] = useState(true);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // 마운트 시 데이터 로드
  useEffect(() => {
    fetchCompetitors(keyword);
    fetchSummary(keyword);
  }, [keyword, fetchCompetitors, fetchSummary]);

  const handleAdd = useCallback(async () => {
    if (!formName.trim()) return;
    const ok = await addCompetitor({
      keyword,
      productName: formName.trim(),
      platform: formPlatform,
      productUrl: formUrl.trim() || undefined,
      sellerName: formSeller.trim() || undefined,
      isRocket: formRocket,
      rankPosition: formRank ? parseInt(formRank, 10) : undefined,
    });
    if (ok) {
      setFormName('');
      setFormUrl('');
      setFormSeller('');
      setFormRocket(false);
      setFormRank('');
      setShowForm(false);
      fetchSummary(keyword);
    }
  }, [formName, formPlatform, formUrl, formSeller, formRocket, formRank, keyword, addCompetitor, fetchSummary]);

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // summary에서 해당 상품의 최신 데이터 찾기
  const getSummaryFor = (id: string) => summary.find((s) => s.competitorId === id);

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
      {/* ── 헤더 ─────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: isExpanded ? '16px' : 0,
          cursor: 'pointer',
        }}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <h3 style={{ margin: 0, fontSize: '14px', fontWeight: '700', color: C.text }}>
          경쟁 상품 추적
          {competitors.length > 0 && (
            <span style={{ fontSize: '12px', fontWeight: 500, color: C.textSub, marginLeft: '8px' }}>
              {competitors.length}개 상품
            </span>
          )}
        </h3>
        {isExpanded ? <ChevronUp size={16} color={C.textSub} /> : <ChevronDown size={16} color={C.textSub} />}
      </div>

      {!isExpanded ? null : (
        <>
          {/* ── 시장 요약 ──────────────────────────────────────────────────── */}
          {marketSummary && marketSummary.trackedProducts > 0 && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
                gap: '10px',
                marginBottom: '16px',
              }}
            >
              {[
                { label: '추적 상품', value: `${marketSummary.trackedProducts}개` },
                { label: '일 총판매', value: `${marketSummary.totalDailySales.toLocaleString()}개` },
                { label: '평균가', value: `${marketSummary.avgPrice.toLocaleString()}원` },
                { label: '로켓배송', value: `${marketSummary.rocketRatio}%`, color: marketSummary.rocketRatio > 50 ? C.red : C.green },
              ].map((stat) => (
                <div
                  key={stat.label}
                  style={{
                    padding: '10px 12px',
                    backgroundColor: C.bg,
                    borderRadius: '8px',
                    border: `1px solid ${C.border}`,
                  }}
                >
                  <p style={{ margin: 0, fontSize: '11px', color: C.textSub }}>{stat.label}</p>
                  <p
                    style={{
                      margin: '2px 0 0',
                      fontSize: '16px',
                      fontWeight: 700,
                      color: stat.color ?? C.text,
                    }}
                  >
                    {stat.value}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* ── 에러 메시지 ────────────────────────────────────────────────── */}
          {error && (
            <div
              style={{
                padding: '10px 12px',
                backgroundColor: 'rgba(220, 38, 38, 0.06)',
                borderRadius: '8px',
                border: '1px solid rgba(220, 38, 38, 0.15)',
                marginBottom: '12px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span style={{ fontSize: '12px', color: C.red }}>{error}</span>
              <button
                onClick={clearError}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', color: C.textSub }}
              >
                닫기
              </button>
            </div>
          )}

          {/* ── 경쟁 상품 목록 ─────────────────────────────────────────────── */}
          {isLoading && competitors.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px', color: C.textSub, fontSize: '13px' }}>
              <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', marginBottom: '8px' }} />
              <p style={{ margin: 0 }}>경쟁 상품 로딩 중...</p>
            </div>
          ) : competitors.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '24px',
                backgroundColor: C.bg,
                borderRadius: '8px',
                border: `1px solid ${C.border}`,
                marginBottom: '12px',
              }}
            >
              <p style={{ margin: '0 0 8px', fontSize: '13px', color: C.text }}>
                아직 추적 중인 경쟁 상품이 없습니다.
              </p>
              <p style={{ margin: 0, fontSize: '12px', color: C.textSub }}>
                쿠팡에서 상위 상품을 확인하고 등록해보세요.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
              {competitors.map((comp) => {
                const s = getSummaryFor(comp.id);
                const isRowExpanded = expandedRows.has(comp.id);

                return (
                  <div
                    key={comp.id}
                    style={{
                      padding: '12px 14px',
                      backgroundColor: comp.isTracking ? C.bg : '#fafafa',
                      borderRadius: '8px',
                      border: `1px solid ${comp.isTracking ? C.border : '#e0e0e0'}`,
                      opacity: comp.isTracking ? 1 : 0.6,
                    }}
                  >
                    {/* 상품 헤더 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      {/* 플랫폼 뱃지 */}
                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: 700,
                          padding: '2px 6px',
                          borderRadius: '4px',
                          backgroundColor: comp.isRocket ? 'rgba(190, 0, 20, 0.08)' : 'rgba(37, 99, 235, 0.08)',
                          color: comp.isRocket ? C.accent : C.blue,
                          flexShrink: 0,
                        }}
                      >
                        {PLATFORM_LABELS[comp.platform as CompetitorPlatform] ?? comp.platform}
                        {comp.isRocket ? ' R' : ''}
                      </span>

                      {/* 상품명 */}
                      <span
                        style={{
                          fontSize: '13px',
                          fontWeight: 600,
                          color: C.text,
                          flex: 1,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          cursor: 'pointer',
                        }}
                        onClick={() => toggleRow(comp.id)}
                      >
                        {comp.rankPosition && (
                          <span style={{ color: C.textSub, fontWeight: 400, marginRight: '6px' }}>
                            #{comp.rankPosition}
                          </span>
                        )}
                        {comp.productName}
                      </span>

                      {/* 최신 데이터 미니 표시 */}
                      {s?.price && (
                        <span style={{ fontSize: '12px', fontWeight: 600, color: C.text, flexShrink: 0 }}>
                          {s.price.toLocaleString()}원
                          {s.priceChange !== null && s.priceChange !== 0 && (
                            <span
                              style={{
                                fontSize: '10px',
                                marginLeft: '3px',
                                color: (s.priceChange ?? 0) > 0 ? C.red : C.blue,
                              }}
                            >
                              {(s.priceChange ?? 0) > 0 ? '+' : ''}{s.priceChange?.toLocaleString()}
                            </span>
                          )}
                        </span>
                      )}

                      {/* 액션 버튼 */}
                      <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                        {comp.productUrl && (
                          <a
                            href={comp.productUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: C.textSub, padding: '2px' }}
                            title="상품 페이지"
                          >
                            <ExternalLink size={13} />
                          </a>
                        )}
                        <button
                          onClick={() => toggleTracking(comp.id, !comp.isTracking)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textSub, padding: '2px' }}
                          title={comp.isTracking ? '추적 중지' : '추적 재개'}
                        >
                          {comp.isTracking ? <Eye size={13} /> : <EyeOff size={13} />}
                        </button>
                        <button
                          onClick={() => removeCompetitor(comp.id)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.red, padding: '2px', opacity: 0.6 }}
                          title="삭제"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>

                    {/* 최신 스냅샷 요약 */}
                    {s && (
                      <div style={{ display: 'flex', gap: '12px', marginTop: '6px', fontSize: '11px', color: C.textSub }}>
                        {s.reviewCount !== null && (
                          <span>
                            리뷰 {s.reviewCount.toLocaleString()}
                            {s.reviewChange !== null && s.reviewChange !== 0 && (
                              <span style={{ color: (s.reviewChange ?? 0) > 0 ? C.green : C.textSub }}>
                                {' '}(+{s.reviewChange})
                              </span>
                            )}
                          </span>
                        )}
                        {s.salesCount !== null && <span>판매 {s.salesCount}개/일</span>}
                        {s.rating !== null && <span>평점 {s.rating}</span>}
                      </div>
                    )}

                    {/* 펼침: 스냅샷 입력 */}
                    {isRowExpanded && comp.isTracking && (
                      <SnapshotInputRow
                        competitorId={comp.id}
                        keyword={keyword}
                        platform={comp.platform}
                      />
                    )}

                    {/* 클릭 힌트 */}
                    {!isRowExpanded && comp.isTracking && (
                      <button
                        onClick={() => toggleRow(comp.id)}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          fontSize: '11px',
                          color: C.blue,
                          padding: '4px 0 0',
                          opacity: 0.7,
                        }}
                      >
                        오늘 데이터 입력
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── 등록 폼 ────────────────────────────────────────────────────── */}
          {showForm ? (
            <div
              style={{
                padding: '14px',
                backgroundColor: C.bg,
                borderRadius: '8px',
                border: `1px solid ${C.border}`,
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {/* 1행: 상품명 + 플랫폼 */}
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    placeholder="상품명 *"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    style={{
                      flex: 1,
                      padding: '8px 10px',
                      border: `1px solid ${C.border}`,
                      borderRadius: '6px',
                      fontSize: '13px',
                      outline: 'none',
                    }}
                  />
                  <select
                    value={formPlatform}
                    onChange={(e) => setFormPlatform(e.target.value as CompetitorPlatform)}
                    style={{
                      padding: '8px 10px',
                      border: `1px solid ${C.border}`,
                      borderRadius: '6px',
                      fontSize: '13px',
                      backgroundColor: '#fff',
                    }}
                  >
                    {Object.entries(PLATFORM_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>

                {/* 2행: URL + 판매자 */}
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="url"
                    placeholder="상품 URL (선택)"
                    value={formUrl}
                    onChange={(e) => setFormUrl(e.target.value)}
                    style={{
                      flex: 1,
                      padding: '8px 10px',
                      border: `1px solid ${C.border}`,
                      borderRadius: '6px',
                      fontSize: '13px',
                      outline: 'none',
                    }}
                  />
                  <input
                    type="text"
                    placeholder="판매자명 (선택)"
                    value={formSeller}
                    onChange={(e) => setFormSeller(e.target.value)}
                    style={{
                      width: '120px',
                      padding: '8px 10px',
                      border: `1px solid ${C.border}`,
                      borderRadius: '6px',
                      fontSize: '13px',
                      outline: 'none',
                    }}
                  />
                </div>

                {/* 3행: 옵션 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: C.text, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={formRocket}
                      onChange={(e) => setFormRocket(e.target.checked)}
                    />
                    로켓배송
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ fontSize: '12px', color: C.textSub }}>순위</span>
                    <input
                      type="number"
                      placeholder="#"
                      value={formRank}
                      onChange={(e) => setFormRank(e.target.value)}
                      style={{
                        width: '50px',
                        padding: '4px 6px',
                        border: `1px solid ${C.border}`,
                        borderRadius: '4px',
                        fontSize: '12px',
                        textAlign: 'center',
                      }}
                    />
                  </div>

                  <div style={{ flex: 1 }} />

                  <button
                    onClick={() => setShowForm(false)}
                    style={{
                      padding: '7px 14px',
                      borderRadius: '6px',
                      border: `1px solid ${C.border}`,
                      background: '#fff',
                      fontSize: '12px',
                      cursor: 'pointer',
                      color: C.textSub,
                    }}
                  >
                    취소
                  </button>
                  <button
                    onClick={handleAdd}
                    disabled={!formName.trim() || isSaving}
                    style={{
                      padding: '7px 14px',
                      borderRadius: '6px',
                      border: 'none',
                      backgroundColor: C.accent,
                      color: '#fff',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: !formName.trim() || isSaving ? 'default' : 'pointer',
                      opacity: !formName.trim() || isSaving ? 0.5 : 1,
                    }}
                  >
                    {isSaving ? '등록 중...' : '등록'}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowForm(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                width: '100%',
                padding: '10px',
                borderRadius: '8px',
                border: `1px dashed ${C.border}`,
                background: 'none',
                cursor: 'pointer',
                fontSize: '13px',
                color: C.textSub,
                fontWeight: 500,
              }}
            >
              <Plus size={14} />
              경쟁 상품 추가
            </button>
          )}
        </>
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
