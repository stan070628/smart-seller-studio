'use client';

/**
 * DomeggookPreparePanel.tsx
 * 도매꾹 상품 불러오기 패널
 *
 * UI 흐름: Step 1(입력) → Step 2(로딩) → Step 3(결과 프리뷰 + 액션)
 * 스타일: 인라인 style 사용, ListingDashboard C 팔레트 동일
 */

import React, { useState, useEffect, useRef } from 'react';
import { X, AlertTriangle, CheckCircle, RefreshCw, ChevronRight, Upload } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// 색상 상수 (ListingDashboard 동일)
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  bg: '#f9f9f9',
  card: '#ffffff',
  border: '#eeeeee',
  text: '#1a1c1c',
  textSub: '#926f6b',
  accent: '#be0014',
  tableHeader: '#f3f3f3',
  btnPrimaryBg: '#be0014',
  btnPrimaryText: '#ffffff',
  btnSecondaryBg: '#f3f3f3',
  btnSecondaryText: '#1a1c1c',
};

// ─────────────────────────────────────────────────────────────────────────────
// 공통 스타일
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// localStorage 키 + 저장/복원 유틸
// ─────────────────────────────────────────────────────────────────────────────
const SELLER_DEFAULTS_KEY = 'sss_domeggook_seller_defaults';

interface SellerDefaults {
  sellerName: string;
  sellerBrandName: string;
  csPhone: string;
  csHours: string;
  returnAddress: string;
}

function loadSellerDefaults(): SellerDefaults {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(SELLER_DEFAULTS_KEY) : null;
    if (raw) return JSON.parse(raw) as SellerDefaults;
  } catch { /* ignore */ }
  return { sellerName: '', sellerBrandName: '', csPhone: '', csHours: '', returnAddress: '' };
}

function saveSellerDefaults(vals: SellerDefaults) {
  try {
    localStorage.setItem(SELLER_DEFAULTS_KEY, JSON.stringify(vals));
  } catch { /* ignore */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// API 응답 타입
// ─────────────────────────────────────────────────────────────────────────────
interface ChannelPricing {
  minPrice: number;
  recommendedPrice: number;
  feeRate: number;
}

interface PrepareResult {
  thumbnail: { processedUrl: string };
  detail: { processedHtml: string; failedImageCount: number };
  source: { title: string; licenseUsable: boolean };
  pricing: {
    priceDome: number;
    moq: number;
    costTotal: number;
    strategy: string | null;
    deliWho: string | null;
    deliFee: number | null;
    naver: ChannelPricing;
    coupang: ChannelPricing;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// XSS 방어: script 태그 제거
// ─────────────────────────────────────────────────────────────────────────────
function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<script[^>]*>/gi, '')
    .replace(/on\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/on\w+\s*=\s*'[^']*'/gi, '')
    .replace(/javascript:/gi, '');
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 — 입력 폼
// ─────────────────────────────────────────────────────────────────────────────
interface FormState {
  itemNo: string;
  sellerName: string;
  sellerBrandName: string;
  csPhone: string;
  csHours: string;
  returnAddress: string;
  shippingDays: string;
}

function InputForm({
  form,
  onChange,
  onSubmit,
  isLoading,
}: {
  form: FormState;
  onChange: (key: keyof FormState, value: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
}) {
  const isValid =
    form.itemNo.trim() !== '' &&
    form.sellerName.trim() !== '' &&
    form.csPhone.trim() !== '' &&
    form.csHours.trim() !== '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 상품번호 섹션 */}
      <div
        style={{
          backgroundColor: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: '10px',
          padding: '20px',
        }}
      >
        <div style={{ fontSize: '14px', fontWeight: 700, color: C.text, marginBottom: '16px' }}>
          도매꾹 상품 정보
        </div>
        <div>
          <label style={labelStyle}>
            상품번호 <span style={{ color: C.accent }}>*</span>
          </label>
          <input
            style={inputStyle}
            type="number"
            value={form.itemNo}
            onChange={(e) => onChange('itemNo', e.target.value)}
            placeholder="도매꾹 상품번호 (숫자)"
            min="1"
          />
          <div style={{ fontSize: '11px', color: C.textSub, marginTop: '4px' }}>
            도매꾹 상품 상세 페이지 URL에서 확인할 수 있습니다.
          </div>
        </div>
        <div style={{ marginTop: '12px' }}>
          <label style={labelStyle}>배송 소요일 (선택)</label>
          <input
            style={{ ...inputStyle, width: '120px' }}
            type="number"
            value={form.shippingDays}
            onChange={(e) => onChange('shippingDays', e.target.value)}
            min="1"
            max="30"
            placeholder="3"
          />
        </div>
      </div>

      {/* 셀러 정보 섹션 */}
      <div
        style={{
          backgroundColor: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: '10px',
          padding: '20px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '16px',
          }}
        >
          <div style={{ fontSize: '14px', fontWeight: 700, color: C.text }}>셀러 정보</div>
          <div
            style={{
              fontSize: '11px',
              color: C.textSub,
              backgroundColor: C.tableHeader,
              padding: '3px 8px',
              borderRadius: '4px',
            }}
          >
            자동 저장됨
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          {/* 셀러명 */}
          <div>
            <label style={labelStyle}>
              셀러명 <span style={{ color: C.accent }}>*</span>
            </label>
            <input
              style={inputStyle}
              value={form.sellerName}
              onChange={(e) => onChange('sellerName', e.target.value)}
              placeholder="상점명 또는 판매자 이름"
            />
          </div>
          {/* 브랜드명/워터마크 */}
          <div>
            <label style={labelStyle}>
              브랜드명 / 워터마크 <span style={{ color: '#999', fontWeight: 400 }}>(선택)</span>
            </label>
            <input
              style={inputStyle}
              value={form.sellerBrandName}
              onChange={(e) => onChange('sellerBrandName', e.target.value)}
              placeholder="비워두면 워터마크 없이 저장됩니다"
            />
          </div>
          {/* CS 연락처 */}
          <div>
            <label style={labelStyle}>
              CS 연락처 <span style={{ color: C.accent }}>*</span>
            </label>
            <input
              style={inputStyle}
              value={form.csPhone}
              onChange={(e) => onChange('csPhone', e.target.value)}
              placeholder="예: 1566-0000"
            />
          </div>
          {/* CS 운영시간 */}
          <div>
            <label style={labelStyle}>
              CS 운영시간 <span style={{ color: C.accent }}>*</span>
            </label>
            <input
              style={inputStyle}
              value={form.csHours}
              onChange={(e) => onChange('csHours', e.target.value)}
              placeholder="평일 10:00~17:00 (점심 12:00~13:00)"
            />
          </div>
          {/* 반품 주소 */}
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>반품 주소 (선택)</label>
            <input
              style={inputStyle}
              value={form.returnAddress}
              onChange={(e) => onChange('returnAddress', e.target.value)}
              placeholder="미입력 시 기본 반품지 적용"
            />
          </div>
        </div>
      </div>

      {/* 불러오기 버튼 */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={onSubmit}
          disabled={!isValid || isLoading}
          title={!isValid ? '필수 항목을 모두 입력해주세요.' : undefined}
          style={{
            padding: '11px 32px',
            fontSize: '14px',
            fontWeight: 700,
            backgroundColor: isValid && !isLoading ? C.btnPrimaryBg : '#ccc',
            color: C.btnPrimaryText,
            border: 'none',
            borderRadius: '8px',
            cursor: isValid && !isLoading ? 'pointer' : 'not-allowed',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            transition: 'background-color 0.15s',
          }}
        >
          <ChevronRight size={16} />
          도매꾹에서 불러오기
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 — 로딩 상태
// ─────────────────────────────────────────────────────────────────────────────
const LOADING_STEPS = [
  '도매꾹 상품 조회 중...',
  '이미지 처리 중...',
  '업로드 중...',
];

function LoadingPanel() {
  const [stepIndex, setStepIndex] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setStepIndex((prev) => (prev < LOADING_STEPS.length - 1 ? prev + 1 : prev));
    }, 1200);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '80px 24px',
        gap: '32px',
      }}
    >
      {/* 스피너 */}
      <div
        style={{
          width: '52px',
          height: '52px',
          border: '4px solid #f0f0f0',
          borderTop: `4px solid ${C.accent}`,
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }}
      />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* 단계 목록 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'flex-start' }}>
        {LOADING_STEPS.map((step, i) => {
          const isDone = i < stepIndex;
          const isCurrent = i === stepIndex;
          return (
            <div
              key={step}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                opacity: i > stepIndex ? 0.3 : 1,
                transition: 'opacity 0.3s',
              }}
            >
              {/* 아이콘 */}
              <div
                style={{
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  backgroundColor: isDone ? '#15803d' : isCurrent ? C.accent : '#e0e0e0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  transition: 'background-color 0.3s',
                }}
              >
                {isDone ? (
                  <CheckCircle size={12} color="#fff" />
                ) : (
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#fff', display: 'block' }} />
                )}
              </div>
              <span
                style={{
                  fontSize: '14px',
                  fontWeight: isCurrent ? 700 : 500,
                  color: isDone ? '#15803d' : isCurrent ? C.text : C.textSub,
                  transition: 'color 0.3s',
                }}
              >
                {step}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3 — 결과 프리뷰
// ─────────────────────────────────────────────────────────────────────────────
function ResultPanel({
  result,
  onContinue,
  onRetry,
  onClose,
}: {
  result: PrepareResult;
  onContinue: (result: PrepareResult, overrideThumbnailUrl: string | undefined, mode: 'both' | 'coupang' | 'naver') => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  const { thumbnail, detail, source } = result;
  const sanitized = sanitizeHtml(detail.processedHtml);

  // AI 이미지 수정 로컬 상태
  const [isEditingThumbnail, setIsEditingThumbnail] = useState(false);
  const [editPrompt, setEditPrompt] = useState('');
  const [isAiProcessing, setIsAiProcessing] = useState(false);
  const [aiEditError, setAiEditError] = useState<string | null>(null);
  const [originalThumbnailUrl, setOriginalThumbnailUrl] = useState<string | null>(null);
  const [currentThumbnailUrl, setCurrentThumbnailUrl] = useState(thumbnail.processedUrl);

  // AI 이미지 수정 API 호출
  const handleAiEdit = async () => {
    if (!editPrompt.trim() || isAiProcessing) return;
    setIsAiProcessing(true);
    setAiEditError(null);
    try {
      const res = await fetch('/api/ai/edit-thumbnail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: currentThumbnailUrl, prompt: editPrompt.trim() }),
      });
      const json = await res.json();
      if (res.ok && json.success && json.data?.editedUrl) {
        // 최초 수정 시에만 원본 URL 보존
        if (!originalThumbnailUrl) setOriginalThumbnailUrl(currentThumbnailUrl);
        setCurrentThumbnailUrl(json.data.editedUrl);
        setIsEditingThumbnail(false);
        setEditPrompt('');
      } else {
        setAiEditError(json.error ?? 'AI 수정에 실패했습니다. 다시 시도해주세요.');
      }
    } catch {
      setAiEditError('네트워크 오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
      setIsAiProcessing(false);
    }
  };

  // PC 이미지 첨부용 ref
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // 파일 유효성 검사
    if (!file.type.startsWith('image/')) return;
    if (file.size > 10 * 1024 * 1024) return; // 10MB 제한

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('usageContext', 'listing_thumbnail');

      const res = await fetch('/api/listing/upload-image', {
        method: 'POST',
        body: formData,
      });
      const json = await res.json();
      if (res.ok && json.success && json.data?.url) {
        if (!originalThumbnailUrl) setOriginalThumbnailUrl(currentThumbnailUrl);
        setCurrentThumbnailUrl(json.data.url);
      }
    } catch { /* 에러 무시 */ } finally {
      setIsUploading(false);
      // input 초기화 (같은 파일 재선택 가능)
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // 프리셋 퀵 액션 목록
  const presets = [
    { label: '흰 배경', prompt: '배경을 깨끗한 흰색으로 변경해주세요' },
    { label: '밝게', prompt: '이미지를 더 밝고 선명하게 보정해주세요' },
    { label: '그림자 추가', prompt: '상품 아래에 자연스러운 그림자를 추가해주세요' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 스피너 키프레임 — 인라인 스타일 한계 보완 */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      {/* 실패 이미지 경고 배너 */}
      {detail.failedImageCount > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '12px 16px',
            backgroundColor: '#fef9c3',
            border: '1px solid #fde047',
            borderRadius: '8px',
            fontSize: '13px',
            color: '#92400e',
          }}
        >
          <AlertTriangle size={16} color="#d97706" />
          <span>
            <strong>{detail.failedImageCount}개</strong> 이미지를 불러오지 못했습니다. 해당 이미지는 빈 칸으로 표시됩니다.
          </span>
        </div>
      )}

      {/* 상단 정보 영역 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '200px 1fr',
          gap: '20px',
          backgroundColor: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: '10px',
          padding: '20px',
        }}
      >
        {/* 대표이미지 프리뷰 */}
        <div>
          <div style={{ fontSize: '12px', fontWeight: 600, color: C.textSub, marginBottom: '8px' }}>
            대표이미지
          </div>
          {/* 썸네일 + 스피너 오버레이 */}
          <div style={{ position: 'relative', width: '200px', marginBottom: '8px' }}>
            <div
              style={{
                width: '200px',
                height: '200px',
                borderRadius: '8px',
                border: `1px solid ${C.border}`,
                overflow: 'hidden',
                backgroundColor: C.tableHeader,
              }}
            >
              <img
                src={currentThumbnailUrl}
                alt="대표이미지"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </div>
            {/* AI 처리 중 스피너 오버레이 */}
            {isAiProcessing && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: '8px',
                  backgroundColor: 'rgba(255,255,255,0.75)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                }}
              >
                {/* CSS 스피너 */}
                <div
                  style={{
                    width: '28px',
                    height: '28px',
                    border: `3px solid ${C.border}`,
                    borderTopColor: C.accent,
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                  }}
                />
                <span style={{ fontSize: '11px', color: C.textSub, fontWeight: 600 }}>AI 수정 중...</span>
              </div>
            )}
          </div>

          {/* 되돌리기 링크 (원본이 저장된 경우에만) */}
          {originalThumbnailUrl && (
            <div style={{ marginBottom: '6px' }}>
              <button
                onClick={() => {
                  setCurrentThumbnailUrl(originalThumbnailUrl);
                  setOriginalThumbnailUrl(null);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  fontSize: '11px',
                  color: C.textSub,
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                ↩ 되돌리기
              </button>
            </div>
          )}

          {/* AI 수정 버튼 */}
          <button
            onClick={() => setIsEditingThumbnail((v) => !v)}
            disabled={isAiProcessing}
            style={{
              width: '200px',
              padding: '7px 0',
              fontSize: '12px',
              fontWeight: 600,
              backgroundColor: C.btnSecondaryBg,
              color: C.btnSecondaryText,
              border: `1px solid ${C.border}`,
              borderRadius: '7px',
              cursor: isAiProcessing ? 'not-allowed' : 'pointer',
              textAlign: 'center',
            }}
          >
            ✨ AI 수정
          </button>

          {/* PC 이미지 첨부 버튼 */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            style={{ display: 'none' }}
            onChange={handleFileUpload}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isAiProcessing || isUploading}
            style={{
              width: '200px',
              padding: '7px 0',
              fontSize: '12px',
              fontWeight: 600,
              backgroundColor: C.btnSecondaryBg,
              color: C.btnSecondaryText,
              border: `1px solid ${C.border}`,
              borderRadius: '7px',
              cursor: isAiProcessing || isUploading ? 'not-allowed' : 'pointer',
              textAlign: 'center',
              marginTop: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
          >
            <Upload size={13} />
            {isUploading ? '업로드 중...' : 'PC에서 이미지 변경'}
          </button>

          {/* 인라인 수정 패널 */}
          {isEditingThumbnail && (
            <div
              style={{
                marginTop: '10px',
                width: '200px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              {/* 프리셋 칩 버튼 */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {presets.map((p) => (
                  <button
                    key={p.label}
                    onClick={() => setEditPrompt(p.prompt)}
                    style={{
                      padding: '3px 8px',
                      fontSize: '11px',
                      fontWeight: 500,
                      backgroundColor: editPrompt === p.prompt ? C.accent : C.tableHeader,
                      color: editPrompt === p.prompt ? '#fff' : C.text,
                      border: `1px solid ${editPrompt === p.prompt ? C.accent : C.border}`,
                      borderRadius: '100px',
                      cursor: 'pointer',
                      transition: 'background-color 0.15s, color 0.15s',
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              {/* 프롬프트 입력 */}
              <input
                style={{ ...inputStyle, fontSize: '12px', padding: '7px 10px' }}
                value={editPrompt}
                onChange={(e) => setEditPrompt(e.target.value)}
                placeholder="예: 배경을 흰색으로 변경"
                onKeyDown={(e) => { if (e.key === 'Enter') handleAiEdit(); }}
              />
              {/* AI 에러 메시지 */}
              {aiEditError && (
                <div style={{ fontSize: '11px', color: C.accent, padding: '4px 6px', backgroundColor: '#fee2e2', borderRadius: '4px', lineHeight: 1.4 }}>
                  {aiEditError}
                </div>
              )}
              {/* 수정하기 / 취소 버튼 */}
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  onClick={handleAiEdit}
                  disabled={!editPrompt.trim()}
                  style={{
                    flex: 1,
                    padding: '7px 0',
                    fontSize: '12px',
                    fontWeight: 600,
                    backgroundColor: editPrompt.trim() ? C.btnPrimaryBg : '#e0e0e0',
                    color: editPrompt.trim() ? C.btnPrimaryText : '#999',
                    border: 'none',
                    borderRadius: '7px',
                    cursor: editPrompt.trim() ? 'pointer' : 'not-allowed',
                  }}
                >
                  수정하기
                </button>
                <button
                  onClick={() => { setIsEditingThumbnail(false); setEditPrompt(''); }}
                  style={{
                    padding: '7px 10px',
                    fontSize: '12px',
                    fontWeight: 600,
                    backgroundColor: C.btnSecondaryBg,
                    color: C.btnSecondaryText,
                    border: `1px solid ${C.border}`,
                    borderRadius: '7px',
                    cursor: 'pointer',
                  }}
                >
                  취소
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 상품 정보 요약 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: C.textSub, marginBottom: '4px' }}>
            상품 정보 요약
          </div>
          <div>
            <div style={{ fontSize: '11px', color: C.textSub, marginBottom: '4px' }}>상품명</div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: C.text, lineHeight: 1.4 }}>
              {source.title}
            </div>
          </div>
          {/* 가격 정보 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* 원가 라인 */}
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: '11px', color: C.textSub, marginBottom: '2px' }}>도매가</div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: C.text }}>
                  {result.pricing.priceDome.toLocaleString()}원
                  {result.pricing.moq > 1 && (
                    <span style={{ fontSize: '12px', color: C.textSub, fontWeight: 400, marginLeft: '4px' }}>
                      × {result.pricing.moq}개
                    </span>
                  )}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '11px', color: C.textSub, marginBottom: '2px' }}>원가 합계 (배송비 포함)</div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: C.text }}>
                  {result.pricing.costTotal.toLocaleString()}원
                  {result.pricing.strategy && (
                    <span style={{
                      fontSize: '11px', fontWeight: 600, color: '#4a90e2',
                      marginLeft: '6px', padding: '2px 6px',
                      backgroundColor: '#e8f0fe', borderRadius: '4px',
                    }}>
                      {result.pricing.strategy}
                    </span>
                  )}
                </div>
              </div>
            </div>
            {/* 채널별 추천가 */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px',
              padding: '12px', backgroundColor: '#f8f8f8', borderRadius: '8px',
              border: `1px solid ${C.border}`,
            }}>
              <div>
                <div style={{ fontSize: '11px', color: '#15803d', fontWeight: 600, marginBottom: '4px' }}>
                  네이버 추천가 <span style={{ fontWeight: 400, color: C.textSub }}>(수수료 {(result.pricing.naver.feeRate * 100).toFixed(0)}%)</span>
                </div>
                <div style={{ fontSize: '16px', fontWeight: 700, color: '#15803d' }}>
                  {result.pricing.naver.recommendedPrice.toLocaleString()}원
                </div>
                <div style={{ fontSize: '11px', color: C.textSub, marginTop: '2px' }}>
                  최소 {result.pricing.naver.minPrice.toLocaleString()}원
                </div>
              </div>
              <div>
                <div style={{ fontSize: '11px', color: '#6d28d9', fontWeight: 600, marginBottom: '4px' }}>
                  쿠팡 추천가 <span style={{ fontWeight: 400, color: C.textSub }}>(수수료 {(result.pricing.coupang.feeRate * 100).toFixed(0)}%)</span>
                </div>
                <div style={{ fontSize: '16px', fontWeight: 700, color: '#6d28d9' }}>
                  {result.pricing.coupang.recommendedPrice.toLocaleString()}원
                </div>
                <div style={{ fontSize: '11px', color: C.textSub, marginTop: '2px' }}>
                  최소 {result.pricing.coupang.minPrice.toLocaleString()}원
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 10px',
                borderRadius: '100px',
                fontSize: '12px',
                fontWeight: 600,
                backgroundColor: source.licenseUsable ? '#dcfce7' : '#fee2e2',
                color: source.licenseUsable ? '#15803d' : '#b91c1c',
              }}
            >
              {source.licenseUsable ? (
                <CheckCircle size={12} />
              ) : (
                <AlertTriangle size={12} />
              )}
              이미지 라이선스 {source.licenseUsable ? '사용 가능' : '사용 불가'}
            </div>
            {detail.failedImageCount === 0 && (
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '4px 10px',
                  borderRadius: '100px',
                  fontSize: '12px',
                  fontWeight: 600,
                  backgroundColor: '#dcfce7',
                  color: '#15803d',
                }}
              >
                <CheckCircle size={12} />
                전체 이미지 처리 완료
              </div>
            )}
          </div>
          <div style={{ fontSize: '12px', color: C.textSub, marginTop: 'auto' }}>
            상세 HTML 프리뷰는 아래를 확인해주세요.
          </div>
        </div>
      </div>

      {/* 상세 HTML 프리뷰 */}
      <div
        style={{
          backgroundColor: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: '10px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 20px',
            borderBottom: `1px solid ${C.border}`,
            backgroundColor: C.tableHeader,
          }}
        >
          <div style={{ fontSize: '13px', fontWeight: 700, color: C.text }}>상세페이지 미리보기</div>
          <div
            style={{
              fontSize: '11px',
              color: C.textSub,
              backgroundColor: '#fff',
              border: `1px solid ${C.border}`,
              borderRadius: '4px',
              padding: '3px 8px',
            }}
          >
            실제 마켓 표시와 다를 수 있습니다
          </div>
        </div>
        <div
          style={{
            maxHeight: '500px',
            overflowY: 'auto',
            padding: '20px',
          }}
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: sanitized }}
        />
      </div>

      {/* 액션 버튼 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '16px 0',
          borderTop: `1px solid ${C.border}`,
          flexWrap: 'wrap',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={onRetry}
            style={{
              padding: '9px 18px',
              fontSize: '13px',
              fontWeight: 600,
              backgroundColor: C.btnSecondaryBg,
              color: C.btnSecondaryText,
              border: `1px solid ${C.border}`,
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <RefreshCw size={13} />
            다시 불러오기
          </button>
          <button
            onClick={onClose}
            style={{
              padding: '9px 18px',
              fontSize: '13px',
              fontWeight: 600,
              backgroundColor: '#fff',
              color: C.textSub,
              border: `1px solid ${C.border}`,
              borderRadius: '8px',
              cursor: 'pointer',
            }}
          >
            닫기
          </button>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {/* 쿠팡 단독 등록 */}
          <button
            onClick={() => onContinue(result, currentThumbnailUrl, 'coupang')}
            style={{
              padding: '9px 20px',
              fontSize: '13px',
              fontWeight: 600,
              backgroundColor: '#fff',
              color: C.btnPrimaryBg,
              border: `2px solid ${C.btnPrimaryBg}`,
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            쿠팡만 등록
          </button>
          {/* 네이버 단독 등록 */}
          <button
            onClick={() => onContinue(result, currentThumbnailUrl, 'naver')}
            style={{
              padding: '9px 20px',
              fontSize: '13px',
              fontWeight: 600,
              backgroundColor: '#fff',
              color: '#03c75a',
              border: '2px solid #03c75a',
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            네이버만 등록
          </button>
          {/* 동시 등록 (기존) */}
          <button
            onClick={() => onContinue(result, currentThumbnailUrl, 'both')}
            style={{
              padding: '10px 24px',
              fontSize: '13px',
              fontWeight: 700,
              backgroundColor: C.btnPrimaryBg,
              color: C.btnPrimaryText,
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            쿠팡+네이버 동시등록
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 에러 코드 → 메시지 변환
// ─────────────────────────────────────────────────────────────────────────────
function getErrorMessage(code: string | undefined): { message: string; isLicense: boolean } {
  if (code === 'LICENSE_NOT_USABLE') {
    return {
      message:
        '이 상품의 이미지는 판매자가 재사용을 허가하지 않았습니다. 직접 촬영한 이미지를 업로드해 주세요.',
      isLicense: true,
    };
  }
  if (code === 'ITEM_NOT_FOUND') {
    return { message: '상품번호를 확인해주세요. 해당 상품을 찾을 수 없습니다.', isLicense: false };
  }
  if (code === 'THUMBNAIL_DOWNLOAD_FAILED') {
    return {
      message: '대표이미지를 다운로드하지 못했습니다. 잠시 후 다시 시도해주세요.',
      isLicense: false,
    };
  }
  if (code === 'IMAGE_PROCESSING_FAILED') {
    return {
      message: '이미지 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
      isLicense: false,
    };
  }
  return { message: '처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.', isLicense: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────
export interface DomeggookPrefillData {
  thumbnailUrl: string;
  detailHtml: string;
  title: string;
  naverPrice: number;       // 네이버 추천판매가 (마진 포함)
  coupangPrice: number;     // 쿠팡 추천판매가 (마진 포함)
  itemNo: number;           // 도매꾹 상품번호 (옵션 자동 불러오기용)
  costBase: number;         // 순수 원가 (도매가 × MOQ, 배송비 제외)
  effectiveDeliFee: number; // 실효 배송비 (판매자 선불 시 0, 구매자 부담 시 실제 금액)
}

interface DomeggookPreparePanelProps {
  onClose: () => void;
  onContinueToRegister: (data: DomeggookPrefillData, mode: 'both' | 'coupang' | 'naver') => void;
  initialItemNo?: string;  // 소싱탭에서 넘겨받은 상품번호
}

// ─────────────────────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────
type PanelStep = 'input' | 'loading' | 'result';

export default function DomeggookPreparePanel({ onClose, onContinueToRegister, initialItemNo }: DomeggookPreparePanelProps) {
  const defaults = loadSellerDefaults();

  const [form, setForm] = useState<FormState>({
    itemNo: initialItemNo ?? '',
    sellerName: defaults.sellerName,
    sellerBrandName: defaults.sellerBrandName,
    csPhone: defaults.csPhone,
    csHours: defaults.csHours,
    returnAddress: defaults.returnAddress,
    shippingDays: '3',
  });

  const [step, setStep] = useState<PanelStep>('input');
  const [result, setResult] = useState<PrepareResult | null>(null);
  const [errorCode, setErrorCode] = useState<string | undefined>(undefined);

  // initialItemNo가 있고 셀러 정보가 채워져 있으면 자동 제출
  const autoSubmitted = useRef(false);
  useEffect(() => {
    if (
      initialItemNo &&
      !autoSubmitted.current &&
      defaults.sellerName &&
      defaults.csPhone &&
      defaults.csHours
    ) {
      autoSubmitted.current = true;
      handleSubmit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialItemNo]);

  // 셀러 정보 필드가 바뀌면 localStorage에 저장
  const handleFormChange = (key: keyof FormState, value: string) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      // 셀러 정보 필드만 저장
      const sellerFields: Array<keyof FormState> = [
        'sellerName',
        'sellerBrandName',
        'csPhone',
        'csHours',
        'returnAddress',
      ];
      if (sellerFields.includes(key)) {
        saveSellerDefaults({
          sellerName: key === 'sellerName' ? value : next.sellerName,
          sellerBrandName: key === 'sellerBrandName' ? value : next.sellerBrandName,
          csPhone: key === 'csPhone' ? value : next.csPhone,
          csHours: key === 'csHours' ? value : next.csHours,
          returnAddress: key === 'returnAddress' ? value : next.returnAddress,
        });
      }
      return next;
    });
  };

  // API 호출
  const handleSubmit = async () => {
    setStep('loading');
    setErrorCode(undefined);

    try {
      const body: Record<string, unknown> = {
        itemNo: parseInt(form.itemNo, 10),
        sellerName: form.sellerName.trim(),
        csPhone: form.csPhone.trim(),
        csHours: form.csHours.trim(),
      };
      if (form.sellerBrandName.trim()) body.sellerBrandName = form.sellerBrandName.trim();
      if (form.returnAddress.trim()) body.returnAddress = form.returnAddress.trim();
      if (form.shippingDays.trim()) body.shippingDays = parseInt(form.shippingDays, 10);

      const res = await fetch('/api/listing/domeggook/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        setErrorCode(json.errorCode ?? json.error ?? undefined);
        setStep('input');
        return;
      }

      setResult(json.data as PrepareResult);
      setStep('result');
    } catch {
      setErrorCode(undefined);
      setStep('input');
    }
  };

  // "다시 불러오기" → Step 1로 초기화 (form 값은 유지)
  const handleRetry = () => {
    setResult(null);
    setErrorCode(undefined);
    setStep('input');
  };

  // "등록으로 이어가기" — mode에 따라 단독/동시 등록 분기
  const handleContinue = (res: PrepareResult, overrideThumbnailUrl: string | undefined, mode: 'both' | 'coupang' | 'naver') => {
    const effectiveDeliFee = res.pricing.deliWho === 'S' ? 0 : (res.pricing.deliFee ?? 0);
    onContinueToRegister({
      thumbnailUrl: overrideThumbnailUrl ?? res.thumbnail.processedUrl,
      detailHtml: res.detail.processedHtml,
      title: res.source.title,
      naverPrice: res.pricing.naver.recommendedPrice,
      coupangPrice: res.pricing.coupang.recommendedPrice,
      itemNo: parseInt(form.itemNo, 10),
      costBase: res.pricing.priceDome * res.pricing.moq,
      effectiveDeliFee,
    }, mode);
  };

  const errorInfo = errorCode !== undefined ? getErrorMessage(errorCode) : null;

  return (
    <div
      style={{
        maxWidth: '860px',
        margin: '0 auto',
        paddingBottom: '40px',
      }}
    >
      {/* 패널 헤더 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '24px',
        }}
      >
        <div>
          <h2
            style={{
              margin: 0,
              fontSize: '18px',
              fontWeight: 700,
              color: C.text,
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <span
              style={{
                display: 'flex',
                width: '28px',
                height: '28px',
                borderRadius: '8px',
                backgroundColor: 'rgba(190,0,20,0.1)',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '16px',
                flexShrink: 0,
              }}
            >
              🏪
            </span>
            도매꾹 상품 불러오기
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: '12px', color: C.textSub }}>
            도매꾹 상품번호를 입력하면 이미지와 상세페이지를 자동으로 가져옵니다.
          </p>
        </div>
        <button
          onClick={onClose}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '32px',
            height: '32px',
            background: 'none',
            border: `1px solid ${C.border}`,
            borderRadius: '8px',
            cursor: 'pointer',
            color: C.textSub,
            flexShrink: 0,
          }}
        >
          <X size={16} />
        </button>
      </div>

      {/* 스텝 인디케이터 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0',
          marginBottom: '24px',
          backgroundColor: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: '10px',
          padding: '12px 20px',
        }}
      >
        {(['input', 'loading', 'result'] as PanelStep[]).map((s, i) => {
          const labels: Record<PanelStep, string> = {
            input: '정보 입력',
            loading: '처리 중',
            result: '결과 확인',
          };
          const stepOrder: Record<PanelStep, number> = { input: 0, loading: 1, result: 2 };
          const currentOrder = stepOrder[step];
          const thisOrder = stepOrder[s];
          const isDone = currentOrder > thisOrder;
          const isCurrent = s === step;
          return (
            <React.Fragment key={s}>
              {i > 0 && (
                <div
                  style={{
                    flex: 1,
                    height: '2px',
                    backgroundColor: isDone || isCurrent ? C.accent : C.border,
                    margin: '0 12px',
                    transition: 'background-color 0.3s',
                  }}
                />
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                <div
                  style={{
                    width: '22px',
                    height: '22px',
                    borderRadius: '50%',
                    backgroundColor:
                      isDone ? '#15803d' : isCurrent ? C.accent : C.border,
                    color: '#fff',
                    fontSize: '11px',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    transition: 'background-color 0.3s',
                  }}
                >
                  {isDone ? <CheckCircle size={12} /> : i + 1}
                </div>
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: isCurrent ? 700 : 500,
                    color: isCurrent ? C.text : isDone ? '#15803d' : C.textSub,
                    transition: 'color 0.3s',
                  }}
                >
                  {labels[s]}
                </span>
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {/* 에러 배너 (Step 1에 API 에러가 있을 때) */}
      {step === 'input' && errorInfo && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            padding: '14px 16px',
            marginBottom: '20px',
            backgroundColor: '#fee2e2',
            border: '1px solid #fca5a5',
            borderRadius: '8px',
            fontSize: '13px',
            color: '#b91c1c',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertTriangle size={15} color="#b91c1c" />
            <span>{errorInfo.message}</span>
          </div>
          {errorInfo.isLicense && (
            <button
              disabled
              title="직접 이미지 업로드 기능은 준비 중입니다."
              style={{
                alignSelf: 'flex-start',
                padding: '7px 16px',
                fontSize: '12px',
                fontWeight: 600,
                backgroundColor: '#f3f3f3',
                color: '#9ca3af',
                border: '1px solid #e0e0e0',
                borderRadius: '6px',
                cursor: 'not-allowed',
              }}
            >
              수동 이미지 업로드 (준비중)
            </button>
          )}
        </div>
      )}

      {/* 콘텐츠 영역 */}
      {step === 'input' && (
        <InputForm
          form={form}
          onChange={handleFormChange}
          onSubmit={handleSubmit}
          isLoading={false}
        />
      )}
      {step === 'loading' && <LoadingPanel />}
      {step === 'result' && result && (
        <ResultPanel
          result={result}
          onContinue={handleContinue}
          onRetry={handleRetry}
          onClose={onClose}
        />
      )}
    </div>
  );
}
