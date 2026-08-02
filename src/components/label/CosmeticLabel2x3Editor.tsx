'use client';

import { useState, useRef, useEffect } from 'react';
import CosmeticLabel2x3Preview from './CosmeticLabel2x3Preview';
import LabelSaveLoad from './LabelSaveLoad';
import type { CosmeticFields } from '@/lib/label/label-templates';
import { generatePdf, printLabel } from '@/lib/label/label-pdf';
// 계산기(src/components/calculator/persist.ts)의 검증된 SSR-safe localStorage 헬퍼를 재사용한다.
import { loadCalcState as loadPersistedState, saveCalcState as savePersistedState, CALC_SAVE_DEBOUNCE_MS } from '@/components/calculator/persist';

const STORAGE_KEY = 'sss_label_cosmetic';

const C = { border: '#e5e7eb', bg: '#f9fafb' };

const SECTION_TITLE: React.CSSProperties = {
  fontWeight: 700, fontSize: 12, marginBottom: 8, color: '#374151',
};
const SECTION: React.CSSProperties = { marginBottom: 16 };

const BTN_PRIMARY: React.CSSProperties = {
  padding: '7px 16px', borderRadius: 6, border: 'none',
  fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#fff',
};

const INPUT: React.CSSProperties = {
  width: '100%', padding: '5px 8px', borderRadius: 4,
  border: '1px solid #d1d5db', fontSize: 12,
  background: '#fff', color: '#111', boxSizing: 'border-box',
};

const TEXTAREA: React.CSSProperties = {
  ...INPUT as object,
  resize: 'vertical' as const,
  minHeight: 56,
  fontFamily: 'inherit',
  lineHeight: 1.5,
} as React.CSSProperties;

const LABEL: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 600,
  color: '#6b7280', marginBottom: 3,
};

const BASE_INGREDIENTS =
  '소듐팔메이트, 소듐팜커넬레이트, 정제수, 향료, 글리세린, 소듐클로라이드, 소듐글루코네이트, 사이트릭애씨드, 티타늄디옥사이드';

const DEFAULTS: Record<'floral' | 'creamy', Pick<CosmeticFields,
  'soap1En' | 'soap1Ko' | 'soap1Ingredients' |
  'soap2En' | 'soap2Ko' | 'soap2Ingredients' |
  'soap3En' | 'soap3Ko' | 'soap3Ingredients' |
  'soap4En' | 'soap4Ko' | 'soap4Ingredients'
>> = {
  floral: {
    soap1En: 'Aloe Vera with Green Tea Extract',
    soap1Ko: '알로에 베라 + 그린 티',
    soap1Ingredients: BASE_INGREDIENTS + ', 알로에베라잎즙, 녹차잎추출물',
    soap2En: 'Wild Berry Crush',
    soap2Ko: '와일드 베리 크러쉬',
    soap2Ingredients: BASE_INGREDIENTS,
    soap3En: 'Frangipani with Evening Primrose Oil',
    soap3Ko: '프란지파니 + 이브닝 프림로즈',
    soap3Ingredients: BASE_INGREDIENTS + ', 오에노데라비엔니스(이브닝프림로즈)오일',
    soap4En: 'Pink Lychee with Pawpaw Extract',
    soap4Ko: '핑크 리치 + 포포 익스트랙트',
    soap4Ingredients: BASE_INGREDIENTS + ', 카리카파파야열매추출물, 리치추출물',
  },
  creamy: {
    soap1En: 'Goats Milk with Soya Bean Oil',
    soap1Ko: '고츠 밀크 + 소야 빈 오일',
    soap1Ingredients: BASE_INGREDIENTS + ', 카프라에락(염소우유), 글리신소야씨오일',
    soap2En: 'Peaches and Cream',
    soap2Ko: '피치 앤 크림',
    soap2Ingredients: BASE_INGREDIENTS + ', 프루누스페르시카(복숭아)열매추출물',
    soap3En: 'Lilly Pilly with Wattleseed Extract',
    soap3Ko: '릴리 필리 + 왓틀씨드',
    soap3Ingredients: BASE_INGREDIENTS + ', 아카시아씨앗추출물(왓틀씨드)',
    soap4En: 'Honey and Milk',
    soap4Ko: '허니 앤 밀크',
    soap4Ingredients: BASE_INGREDIENTS + ', 멜(꿀), 락(우유)',
  },
};

const EMPTY_FIELDS: CosmeticFields = {
  collection: 'floral',
  ...DEFAULTS.floral,
  weight: '200 g (건조 중량 약 176~178 g)',
  lotNumber: '',
  expiryDate: '',
  importer: '',
  importerAddress: '',
  phone: '1899-5900',
};

function Field({
  label, value, onChange, textarea,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  textarea?: boolean;
}) {
  return (
    <div style={{ marginBottom: 8 }}>
      <label style={LABEL}>{label}</label>
      {textarea ? (
        <textarea
          style={TEXTAREA}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          style={INPUT}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

function SoapSection({
  num, enName, koName, ingredients,
  onEnName, onKoName, onIngredients,
}: {
  num: number;
  enName: string; koName: string; ingredients: string;
  onEnName: (v: string) => void;
  onKoName: (v: string) => void;
  onIngredients: (v: string) => void;
}) {
  return (
    <div style={{
      border: `1px solid ${C.border}`, borderRadius: 6,
      padding: 10, marginBottom: 10, background: '#fafafa',
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#6366f1', marginBottom: 8 }}>
        비누 {num}
      </div>
      <Field label="영문명" value={enName} onChange={onEnName} />
      <Field label="한국명" value={koName} onChange={onKoName} />
      <Field label="전성분" value={ingredients} onChange={onIngredients} textarea />
    </div>
  );
}

export default function CosmeticLabel2x3Editor() {
  const [fields, setFields] = useState<CosmeticFields>(EMPTY_FIELDS);
  const previewRef = useRef<HTMLDivElement>(null);

  // 마운트 후 1회 복원. 저장된 값이 없으면 EMPTY_FIELDS(플로럴 컬렉션 기본값)를 그대로 쓴다.
  useEffect(() => {
    const saved = loadPersistedState<Partial<CosmeticFields>>(STORAGE_KEY);
    if (Object.keys(saved).length > 0) setFields((prev) => ({ ...prev, ...saved }));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => savePersistedState(STORAGE_KEY, fields), CALC_SAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [fields]);

  const set = <K extends keyof CosmeticFields>(key: K, value: CosmeticFields[K]) =>
    setFields((prev) => ({ ...prev, [key]: value }));

  const handleCollectionChange = (col: 'floral' | 'creamy') => {
    setFields((prev) => ({ ...prev, collection: col, ...DEFAULTS[col] }));
  };

  const handlePdf = async () => { if (previewRef.current) await generatePdf(previewRef.current); };
  const handlePrint = () => { if (previewRef.current) printLabel(previewRef.current); };

  return (
    <>
      <style>{`
        @media print {
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
          body * { visibility: hidden; }
          #cosmetic-label-2x3-preview, #cosmetic-label-2x3-preview * { visibility: visible; }
          #cosmetic-label-2x3-preview { position: fixed; top: 0; left: 0; margin: 0; }
          @page { margin: 0; size: A4; }
        }
      `}</style>

      <div style={{ display: 'flex', height: '100%', background: C.bg }}>
        {/* 좌측 폼 */}
        <div style={{
          width: 300, flexShrink: 0,
          background: '#fff', color: '#111', colorScheme: 'light',
          borderRight: `1px solid ${C.border}`,
          padding: 16, overflowY: 'auto',
        }}>
          {/* 저장 / 불러오기 */}
          <div style={SECTION}>
            <div style={SECTION_TITLE}>저장 / 불러오기</div>
            <LabelSaveLoad
              labelType="cosmetic2x3"
              currentData={fields as unknown as Record<string, unknown>}
              onLoad={(data) => setFields({ ...EMPTY_FIELDS, ...(data as Partial<CosmeticFields>) })}
            />
          </div>

          {/* 컬렉션 선택 */}
          <div style={SECTION}>
            <div style={SECTION_TITLE}>컬렉션 선택</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['floral', 'creamy'] as const).map((col) => (
                <button
                  key={col}
                  onClick={() => handleCollectionChange(col)}
                  style={{
                    flex: 1, padding: '6px 0', borderRadius: 6, border: '1px solid',
                    fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    borderColor: fields.collection === col ? '#6366f1' : '#d1d5db',
                    background: fields.collection === col ? '#eef2ff' : '#fff',
                    color: fields.collection === col ? '#6366f1' : '#6b7280',
                  }}
                >
                  {col === 'floral' ? '🌿 플로럴' : '🍯 크리미'}
                </button>
              ))}
            </div>
            <p style={{ fontSize: 10, color: '#9ca3af', marginTop: 4 }}>
              선택 시 비누 4종 기본값이 자동 입력됩니다.
            </p>
          </div>

          {/* 공통 정보 */}
          <div style={SECTION}>
            <div style={SECTION_TITLE}>공통 정보</div>
            <Field label="내용량" value={fields.weight} onChange={(v) => set('weight', v)} />
            <Field label="제조번호 (LOT)" value={fields.lotNumber} onChange={(v) => set('lotNumber', v)} />
            <Field label="사용기한 (예: 2026-09)" value={fields.expiryDate} onChange={(v) => set('expiryDate', v)} />
            <Field label="책임판매업자 (수입사)" value={fields.importer} onChange={(v) => set('importer', v)} />
            <Field label="주소" value={fields.importerAddress} onChange={(v) => set('importerAddress', v)} />
            <Field label="전화" value={fields.phone} onChange={(v) => set('phone', v)} />
          </div>

          {/* 비누 4종 */}
          <div style={SECTION}>
            <div style={SECTION_TITLE}>비누 4종</div>
            <SoapSection
              num={1}
              enName={fields.soap1En} koName={fields.soap1Ko} ingredients={fields.soap1Ingredients}
              onEnName={(v) => set('soap1En', v)}
              onKoName={(v) => set('soap1Ko', v)}
              onIngredients={(v) => set('soap1Ingredients', v)}
            />
            <SoapSection
              num={2}
              enName={fields.soap2En} koName={fields.soap2Ko} ingredients={fields.soap2Ingredients}
              onEnName={(v) => set('soap2En', v)}
              onKoName={(v) => set('soap2Ko', v)}
              onIngredients={(v) => set('soap2Ingredients', v)}
            />
            <SoapSection
              num={3}
              enName={fields.soap3En} koName={fields.soap3Ko} ingredients={fields.soap3Ingredients}
              onEnName={(v) => set('soap3En', v)}
              onKoName={(v) => set('soap3Ko', v)}
              onIngredients={(v) => set('soap3Ingredients', v)}
            />
            <SoapSection
              num={4}
              enName={fields.soap4En} koName={fields.soap4Ko} ingredients={fields.soap4Ingredients}
              onEnName={(v) => set('soap4En', v)}
              onKoName={(v) => set('soap4Ko', v)}
              onIngredients={(v) => set('soap4Ingredients', v)}
            />
          </div>
        </div>

        {/* 우측 미리보기 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{
            padding: '10px 16px', borderBottom: `1px solid ${C.border}`,
            background: '#fff', display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ flex: 1, fontSize: 12, color: '#6b7280' }}>
              미리보기 — A4 · 2×3 (화장품 표시사항 라벨)
            </span>
            <button style={{ ...BTN_PRIMARY, background: '#6366f1' }} onClick={handlePdf}>⬇ PDF 저장</button>
            <button style={{ ...BTN_PRIMARY, background: '#059669' }} onClick={handlePrint}>🖨 바로 인쇄</button>
          </div>

          <div style={{
            flex: 1, overflow: 'auto', padding: 20,
            background: '#e5e7eb', display: 'flex', justifyContent: 'center',
          }}>
            <CosmeticLabel2x3Preview ref={previewRef} fields={fields} />
          </div>
        </div>
      </div>
    </>
  );
}
