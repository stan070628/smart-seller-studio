'use client';

import React from 'react';
import { Loader2 } from 'lucide-react';
import { useRegisterForm } from '@/hooks/useRegisterForm';
import Section from './Section';
import BasicInfoSection from './sections/BasicInfoSection';
import PricingSection from './sections/PricingSection';
import ImagesSection from './sections/ImagesSection';
import DescriptionSection from './sections/DescriptionSection';
import DeliverySection from './sections/DeliverySection';
import KeywordsSection from './sections/KeywordsSection';

// 디자인 토큰
const C = {
  border: '#e5e5e5',
  text: '#18181b',
  textSub: '#71717a',
  accent: '#be0014',
  card: '#ffffff',
  tableHeader: '#f3f3f3',
  btnPrimaryBg: '#be0014',
  btnPrimaryText: '#ffffff',
  btnSecondaryBg: '#f3f3f3',
  btnSecondaryText: '#18181b',
} as const;

interface Props {
  onSuccess: () => void;
  onCancel: () => void;
}

export default function RegisterFormSections({ onSuccess, onCancel }: Props) {
  const {
    handleSubmit,
    handlePreview,
    isPreviewing,
    isRegistering,
    isDone,
    bothRegistration,
    resetBothRegistration,
    platform,
  } = useRegisterForm({ onSuccess });

  // 취소 시 등록 상태 초기화 후 부모 핸들러 호출
  const handleCancel = () => {
    resetBothRegistration();
    onCancel();
  };

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}
      style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
    >
      {/* 6개 섹션 아코디언 */}
      <Section title="기본정보" required defaultOpen={true}><BasicInfoSection /></Section>
      <Section title="가격/재고" required defaultOpen={true}><PricingSection /></Section>
      <Section title="이미지" required defaultOpen={true}><ImagesSection /></Section>
      <Section title="상세설명" defaultOpen={false}><DescriptionSection /></Section>
      <Section title="배송" defaultOpen={false}><DeliverySection /></Section>
      <Section title="검색어/키워드" defaultOpen={false}><KeywordsSection /></Section>

      {/* 등록 결과 상태 카드 */}
      {isDone && (
        <div style={{
          display: 'flex', flexDirection: 'column', gap: '8px',
          padding: '16px', backgroundColor: C.card,
          borderRadius: '10px', border: `1px solid ${C.border}`,
        }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: C.text, marginBottom: '4px' }}>등록 결과</div>

          {/* 쿠팡 결과 */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            padding: '10px 14px', borderRadius: '8px',
            backgroundColor: bothRegistration.coupang.status === 'success'
              ? 'rgba(21,128,61,0.06)' : bothRegistration.coupang.status === 'error'
              ? '#fee2e2' : C.tableHeader,
          }}>
            <span style={{
              fontSize: '10px', fontWeight: 700, color: '#fff',
              backgroundColor: '#be0014', padding: '2px 7px',
              borderRadius: '4px', flexShrink: 0,
            }}>쿠팡</span>
            {bothRegistration.coupang.status === 'success' && (
              <span style={{ fontSize: '13px', color: '#15803d' }}>
                ✅ 등록 완료 — 상품번호 <strong>{bothRegistration.coupang.sellerProductId}</strong>
              </span>
            )}
            {bothRegistration.coupang.status === 'error' && (
              <span style={{ fontSize: '13px', color: '#b91c1c' }}>
                ❌ 실패 — {bothRegistration.coupang.error}
              </span>
            )}
            {bothRegistration.coupang.status === 'loading' && (
              <span style={{ fontSize: '13px', color: C.textSub, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Loader2 size={13} /> 등록 중...
              </span>
            )}
          </div>

          {/* 네이버 결과 */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            padding: '10px 14px', borderRadius: '8px',
            backgroundColor: bothRegistration.naver.status === 'success'
              ? 'rgba(21,128,61,0.06)' : bothRegistration.naver.status === 'error'
              ? '#fee2e2' : bothRegistration.naver.status === 'draft'
              ? 'rgba(234,179,8,0.08)' : C.tableHeader,
          }}>
            <span style={{
              fontSize: '10px', fontWeight: 700, color: '#fff',
              backgroundColor: '#03c75a', padding: '2px 7px',
              borderRadius: '4px', flexShrink: 0,
            }}>네이버</span>
            {bothRegistration.naver.status === 'success' && (
              <span style={{ fontSize: '13px', color: '#15803d' }}>
                ✅ 등록 완료 — 원상품번호 <strong>{bothRegistration.naver.originProductNo}</strong>
                {bothRegistration.naver.channelProductNo && (
                  <span style={{ color: C.textSub, fontWeight: 400 }}>
                    {' '}/ 채널 <strong style={{ color: '#15803d' }}>{bothRegistration.naver.channelProductNo}</strong>
                  </span>
                )}
              </span>
            )}
            {bothRegistration.naver.status === 'draft' && (
              <span style={{ fontSize: '13px', color: '#92400e' }}>
                ⚠️ 임시저장 완료 — 카테고리 판매 권한 필요. 스마트스토어센터에서 권한 신청 후 수기 등록해주세요.
                {bothRegistration.naver.draftId && (
                  <span style={{ color: C.textSub, fontSize: '11px', display: 'block', marginTop: '2px' }}>
                    임시저장 ID: {bothRegistration.naver.draftId}
                  </span>
                )}
              </span>
            )}
            {bothRegistration.naver.status === 'error' && (
              <span style={{ fontSize: '13px', color: '#b91c1c' }}>
                ❌ 실패 — {bothRegistration.naver.error}
              </span>
            )}
            {bothRegistration.naver.status === 'loading' && (
              <span style={{ fontSize: '13px', color: C.textSub, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Loader2 size={13} /> 등록 중...
              </span>
            )}
          </div>
        </div>
      )}

      {/* 액션 바 */}
      <div style={{
        display: 'flex', gap: '8px', justifyContent: 'flex-end',
        padding: '16px 0', borderTop: `1px solid ${C.border}`,
      }}>
        {/* 취소 버튼 */}
        <button
          type="button"
          onClick={handleCancel}
          style={{
            padding: '10px 24px', fontSize: '13px', fontWeight: 600,
            backgroundColor: C.btnSecondaryBg, color: C.btnSecondaryText,
            border: `1px solid ${C.border}`, borderRadius: '8px', cursor: 'pointer',
          }}
        >
          취소
        </button>

        {/* 등록 정보 확인 버튼 */}
        <button
          type="button"
          onClick={handlePreview}
          disabled={isPreviewing || isRegistering}
          style={{
            padding: '10px 24px', fontSize: '13px', fontWeight: 600,
            backgroundColor: isPreviewing ? '#d4d4d8' : '#f0f0f0', color: '#333',
            border: `1px solid ${C.border}`, borderRadius: '8px',
            cursor: (isPreviewing || isRegistering) ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', gap: '6px',
          }}
        >
          {isPreviewing
            ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> 확인 중...</>
            : '등록 정보 확인'}
        </button>

        {/* 등록 실행 버튼 */}
        <button
          type="submit"
          disabled={isRegistering}
          style={{
            padding: '10px 32px', fontSize: '13px', fontWeight: 600,
            backgroundColor: isRegistering ? '#d4d4d8' : C.btnPrimaryBg,
            color: C.btnPrimaryText,
            border: 'none', borderRadius: '8px',
            cursor: isRegistering ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', gap: '8px',
          }}
        >
          {isRegistering
            ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> 등록 중...</>
            : platform === 'coupang' ? '쿠팡 등록'
            : platform === 'naver' ? '네이버 등록'
            : '쿠팡+네이버 동시 등록'}
        </button>
      </div>
    </form>
  );
}
