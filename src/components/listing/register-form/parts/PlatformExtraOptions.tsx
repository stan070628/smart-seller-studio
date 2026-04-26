'use client';

import React from 'react';
import { useRegisterForm } from '@/hooks/useRegisterForm';
import Section from '../Section';

// CoupangItemDefaults와 동일한 타입 (훅 내부 타입을 inline으로 정의)
type TaxType = 'TAX' | 'TAX_FREE' | 'ZERO_TAX';
type AdultOnly = 'EVERYONE' | 'ADULTS_ONLY';
type OverseasPurchased = 'NOT_OVERSEAS_PURCHASED' | 'OVERSEAS_PURCHASED';
type ParallelImported = 'NOT_PARALLEL_IMPORTED' | 'PARALLEL_IMPORTED' | 'CONFIRMED_CARRIED_OUT';

const C = {
  border: '#e5e5e5',
  text: '#18181b',
  textSub: '#71717a',
  accent: '#be0014',
} as const;

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', fontSize: '13px',
  border: `1px solid ${C.border}`, borderRadius: '8px',
  outline: 'none', color: C.text, backgroundColor: '#fff',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '12px', fontWeight: 600,
  color: C.textSub, marginBottom: '6px',
};

const dividerStyle: React.CSSProperties = {
  fontSize: '11px', fontWeight: 700, color: C.textSub,
  borderBottom: `1px solid ${C.border}`, paddingBottom: '6px',
  marginTop: '4px',
};

/**
 * PlatformExtraOptions
 * 쿠팡 전용 브랜드/배송사/세금/상품정보고시 등을 접힘 영역으로 분리
 */
export default function PlatformExtraOptions() {
  const { brand, setBrand, coupangDefaults, setCoupangDefaults, coupangMounted } = useRegisterForm();

  return (
    <Section title="플랫폼별 추가 옵션 (쿠팡)" defaultOpen={false}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

        {/* 브랜드명 */}
        <div>
          <label style={labelStyle}>브랜드명 (쿠팡 전용)</label>
          <input
            style={inputStyle}
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            placeholder="브랜드명 (없으면 비워두세요)"
          />
        </div>

        {/* 마운트 후 localStorage 값으로 렌더 — SSR 하이드레이션 불일치 방지 */}
        {coupangMounted && (
          <>
            <div style={dividerStyle}>쿠팡 세부 설정</div>

            {/* 배송/세금/성인/해외직구/병행수입 — 2열 래핑 그리드 */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
              {/* 택배사 */}
              <div style={{ flex: '1 1 calc(50% - 6px)', minWidth: '140px' }}>
                <label style={labelStyle}>택배사</label>
                <select
                  style={inputStyle}
                  value={coupangDefaults.deliveryCompanyCode}
                  onChange={(e) =>
                    setCoupangDefaults((prev) => ({ ...prev, deliveryCompanyCode: e.target.value }))
                  }
                >
                  <option value="LOTTE">롯데택배</option>
                  <option value="CJ">CJ대한통운</option>
                  <option value="HANJIN">한진택배</option>
                  <option value="EPOST">우체국택배</option>
                  <option value="CVSNET">GS편의점(CU/GS25)</option>
                  <option value="DAESIN">대신택배</option>
                  <option value="HDEXP">홈픽</option>
                  <option value="ILYANG">일양로지스</option>
                  <option value="KGL">KGL네트웍스</option>
                  <option value="KDEXP">경동택배</option>
                  <option value="CHUNIL">천일택배</option>
                  <option value="SFEXPRESS">SF익스프레스</option>
                </select>
              </div>

              {/* 출고 소요일 */}
              <div style={{ flex: '1 1 calc(50% - 6px)', minWidth: '140px' }}>
                <label style={labelStyle}>출고 소요일 (일)</label>
                <input
                  type="number"
                  min={1}
                  max={30}
                  style={inputStyle}
                  value={coupangDefaults.outboundShippingTimeDay}
                  onChange={(e) =>
                    setCoupangDefaults((prev) => ({ ...prev, outboundShippingTimeDay: Number(e.target.value) }))
                  }
                />
              </div>

              {/* 과세 유형 */}
              <div style={{ flex: '1 1 calc(50% - 6px)', minWidth: '140px' }}>
                <label style={labelStyle}>과세 유형</label>
                <select
                  style={inputStyle}
                  value={coupangDefaults.taxType}
                  onChange={(e) =>
                    setCoupangDefaults((prev) => ({ ...prev, taxType: e.target.value as TaxType }))
                  }
                >
                  <option value="TAX">과세</option>
                  <option value="TAX_FREE">면세</option>
                  <option value="ZERO_TAX">영세율</option>
                </select>
              </div>

              {/* 성인상품 여부 */}
              <div style={{ flex: '1 1 calc(50% - 6px)', minWidth: '140px' }}>
                <label style={labelStyle}>성인상품 여부</label>
                <select
                  style={inputStyle}
                  value={coupangDefaults.adultOnly}
                  onChange={(e) =>
                    setCoupangDefaults((prev) => ({ ...prev, adultOnly: e.target.value as AdultOnly }))
                  }
                >
                  <option value="EVERYONE">전체</option>
                  <option value="ADULTS_ONLY">성인전용</option>
                </select>
              </div>

              {/* 해외직구 여부 */}
              <div style={{ flex: '1 1 calc(50% - 6px)', minWidth: '140px' }}>
                <label style={labelStyle}>해외직구 여부</label>
                <select
                  style={inputStyle}
                  value={coupangDefaults.overseasPurchased}
                  onChange={(e) =>
                    setCoupangDefaults((prev) => ({
                      ...prev,
                      overseasPurchased: e.target.value as OverseasPurchased,
                    }))
                  }
                >
                  <option value="NOT_OVERSEAS_PURCHASED">국내</option>
                  <option value="OVERSEAS_PURCHASED">해외직구</option>
                </select>
              </div>

              {/* 병행수입 여부 */}
              <div style={{ flex: '1 1 calc(50% - 6px)', minWidth: '140px' }}>
                <label style={labelStyle}>병행수입 여부</label>
                <select
                  style={inputStyle}
                  value={coupangDefaults.parallelImported}
                  onChange={(e) =>
                    setCoupangDefaults((prev) => ({
                      ...prev,
                      parallelImported: e.target.value as ParallelImported,
                    }))
                  }
                >
                  <option value="NOT_PARALLEL_IMPORTED">아님</option>
                  <option value="PARALLEL_IMPORTED">병행수입</option>
                  <option value="CONFIRMED_CARRIED_OUT">병행수입확인</option>
                </select>
              </div>
            </div>

            {/* 고시정보 (KC인증번호·원산지 등) */}
            <div>
              <label style={labelStyle}>고시정보 (KC인증번호·원산지 등)</label>
              {coupangDefaults.notices.map((notice, i) => (
                <div
                  key={i}
                  style={{ display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'center' }}
                >
                  <input
                    style={{ ...inputStyle, width: '40%' }}
                    placeholder="항목명 (예: 제조사)"
                    value={notice.noticeCategoryName}
                    onChange={(e) =>
                      setCoupangDefaults((prev) => ({
                        ...prev,
                        notices: prev.notices.map((n, idx) =>
                          idx === i ? { ...n, noticeCategoryName: e.target.value } : n
                        ),
                      }))
                    }
                  />
                  <input
                    style={{ ...inputStyle, flex: 1 }}
                    placeholder="내용 (예: 상세페이지 참조)"
                    value={notice.content}
                    onChange={(e) =>
                      setCoupangDefaults((prev) => ({
                        ...prev,
                        notices: prev.notices.map((n, idx) =>
                          idx === i ? { ...n, content: e.target.value } : n
                        ),
                      }))
                    }
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setCoupangDefaults((prev) => ({
                        ...prev,
                        notices: prev.notices.filter((_, idx) => idx !== i),
                      }))
                    }
                    style={{
                      flexShrink: 0, padding: '6px 10px', fontSize: '16px', lineHeight: 1,
                      color: C.textSub, background: 'none', border: `1px solid ${C.border}`,
                      borderRadius: '6px', cursor: 'pointer',
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setCoupangDefaults((prev) => ({
                    ...prev,
                    notices: [...prev.notices, { noticeCategoryName: '', content: '' }],
                  }))
                }
                style={{
                  fontSize: '12px', fontWeight: 600, color: C.textSub,
                  background: 'none', border: `1px solid ${C.border}`,
                  borderRadius: '6px', padding: '6px 12px', cursor: 'pointer',
                }}
              >
                + 고시정보 추가
              </button>
            </div>
          </>
        )}
      </div>
    </Section>
  );
}
