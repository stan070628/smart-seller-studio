'use client';

import { useState, useRef, useEffect, useId } from 'react';
import CosmeticLabel2x3Preview from './CosmeticLabel2x3Preview';
import LabelSaveLoad from './LabelSaveLoad';
import {
  migrateCosmeticFields,
  type CosmeticFields,
  type CosmeticItem,
} from '@/lib/label/cosmetic-fields';
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

/** 호주 비누 컬렉션 프리셋 — 확장 이전 기본값을 그대로 유지한다 */
const SOAP_PRESETS: Record<'floral' | 'creamy', CosmeticItem[]> = {
  floral: [
    { en: 'Aloe Vera with Green Tea Extract', ko: '알로에 베라 + 그린 티', ingredients: BASE_INGREDIENTS + ', 알로에베라잎즙, 녹차잎추출물' },
    { en: 'Wild Berry Crush', ko: '와일드 베리 크러쉬', ingredients: BASE_INGREDIENTS },
    { en: 'Frangipani with Evening Primrose Oil', ko: '프란지파니 + 이브닝 프림로즈', ingredients: BASE_INGREDIENTS + ', 오에노데라비엔니스(이브닝프림로즈)오일' },
    { en: 'Pink Lychee with Pawpaw Extract', ko: '핑크 리치 + 포포 익스트랙트', ingredients: BASE_INGREDIENTS + ', 카리카파파야열매추출물, 리치추출물' },
  ],
  creamy: [
    { en: 'Goats Milk with Soya Bean Oil', ko: '고츠 밀크 + 소야 빈 오일', ingredients: BASE_INGREDIENTS + ', 카프라에락(염소우유), 글리신소야씨오일' },
    { en: 'Peaches and Cream', ko: '피치 앤 크림', ingredients: BASE_INGREDIENTS + ', 프루누스페르시카(복숭아)열매추출물' },
    { en: 'Lilly Pilly with Wattleseed Extract', ko: '릴리 필리 + 왓틀씨드', ingredients: BASE_INGREDIENTS + ', 아카시아씨앗추출물(왓틀씨드)' },
    { en: 'Honey and Milk', ko: '허니 앤 밀크', ingredients: BASE_INGREDIENTS + ', 멜(꿀), 락(우유)' },
  ],
};

const SOAP_META = {
  brandHeader: 'Australian Botanical',
  countryOfOrigin: '호주 (Australia)',
  manufacturer: 'Australian Botanical Soap · 143 Scanlon Drive, Epping VIC 3076, Australia',
  usage: '물에 적셔 거품을 낸 후 세정 부위에 고르게 펴 바르고 깨끗한 물로 헹구어 냅니다. 사용 후 건조한 곳에 보관하세요.',
  caution: '1. 눈에 들어갔을 때는 즉시 씻어내십시오. 2. 어린이 손이 닿지 않는 곳에 보관하십시오. 3. 직사광선을 피해 보관하십시오. 4. 이상이 나타나면 사용을 중단하고 전문의와 상담하십시오. 5. 상처가 있는 부위에는 사용을 자제하십시오.',
  expiryNote: '또는 개봉 후 24개월',
  weight: '200 g (건조 중량 약 176~178 g)',
  footerNote: 'Made in Australia',
  recycleMark: '♻종이/PE',
};

/** 화장품법 표시 문구 — 소분·재포장 판매 시 공통으로 들어가는 주의사항 */
const KOREA_COSMETIC_CAUTION =
  '1. 화장품 사용 시 또는 사용 후 직사광선에 의하여 사용부위가 붉은 반점, 부어오름 또는 가려움증 등의 이상 증상이나 부작용이 있는 경우 전문의 등과 상담할 것 2. 상처가 있는 부위 등에는 사용을 자제할 것 3. 보관 및 취급 시의 주의사항 — 가) 어린이의 손이 닿지 않는 곳에 보관할 것 나) 직사광선을 피해서 보관할 것';

const EMPTY_ITEM: CosmeticItem = { en: '', ko: '', ingredients: '' };

const EMPTY_FIELDS: CosmeticFields = migrateCosmeticFields({
  collection: 'floral',
  items: SOAP_PRESETS.floral,
  weight: SOAP_META.weight,
  phone: '1899-5900',
});

function Field({
  label, value, onChange, textarea,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  textarea?: boolean;
}) {
  // label과 입력 요소를 id로 묶어야 스크린리더와 테스트가 둘을 연결할 수 있다.
  const id = useId();
  return (
    <div style={{ marginBottom: 8 }}>
      <label htmlFor={id} style={LABEL}>{label}</label>
      {textarea ? (
        <textarea
          id={id}
          style={TEXTAREA}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          id={id}
          style={INPUT}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

function ItemSection({
  num, item, onChange,
}: {
  num: number;
  item: CosmeticItem;
  onChange: (patch: Partial<CosmeticItem>) => void;
}) {
  return (
    <div style={{
      border: `1px solid ${C.border}`, borderRadius: 6,
      padding: 10, marginBottom: 10, background: '#fafafa',
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#6366f1', marginBottom: 8 }}>
        품목 {num}
      </div>
      <Field label={`품목 ${num} 영문명`} value={item.en} onChange={(v) => onChange({ en: v })} />
      <Field label={`품목 ${num} 한국명`} value={item.ko} onChange={(v) => onChange({ ko: v })} />
      <Field label={`품목 ${num} 전성분`} value={item.ingredients} onChange={(v) => onChange({ ingredients: v })} textarea />
    </div>
  );
}

export default function CosmeticLabel2x3Editor() {
  const [fields, setFields] = useState<CosmeticFields>(EMPTY_FIELDS);
  const previewRef = useRef<HTMLDivElement>(null);
  const itemCountId = useId();
  const fontScaleId = useId();
  // 배율은 숫자 상태 하나로는 소수점을 칠 수 없다. "1."은 숫자로 1이라
  // 입력칸이 즉시 "1"로 되돌아가 뒷자리를 이어 칠 수 없기 때문이다.
  // 타이핑 중에는 문자열 초안을 그대로 보여주고, 포커스를 잃으면 숫자 상태로 되돌린다.
  const [fontScaleDraft, setFontScaleDraft] = useState<string | null>(null);

  // 마운트 후 1회 복원. 확장 이전에 저장된 비누 4종 구조도 마이그레이션을 거쳐 그대로 살아난다.
  useEffect(() => {
    const saved = loadPersistedState<Record<string, unknown>>(STORAGE_KEY);
    if (Object.keys(saved).length > 0) setFields(migrateCosmeticFields(saved));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => savePersistedState(STORAGE_KEY, fields), CALC_SAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [fields]);

  const set = <K extends keyof CosmeticFields>(key: K, value: CosmeticFields[K]) =>
    setFields((prev) => ({ ...prev, [key]: value }));

  const setItem = (index: number, patch: Partial<CosmeticItem>) =>
    setFields((prev) => ({
      ...prev,
      items: prev.items.map((it, i) => (i === index ? { ...it, ...patch } : it)),
    }));

  const setItemCount = (count: number) =>
    setFields((prev) => {
      const items = Array.from({ length: count }, (_, i) => prev.items[i] ?? { ...EMPTY_ITEM });
      return { ...prev, itemCount: count, items };
    });

  const applySoapPreset = (col: 'floral' | 'creamy') => {
    setFontScaleDraft(null);
    setFields((prev) => ({
      ...prev,
      ...SOAP_META,
      collection: col,
      items: SOAP_PRESETS[col],
      itemCount: 4,
      collectionLabel: col === 'floral' ? '플로럴 컬렉션 Variety Pack 4종' : '크리미 컬렉션 Variety Pack 4종',
      optionLabel: col === 'floral' ? 'Option 01 · Floral' : 'Option 02 · Creamy',
    }));
  };

  // 국내 소분 판매용 단일 품목 골격. 표시사항 값은 원 제품 라벨을 보고 채운다.
  const applySingleItemPreset = () => {
    setFontScaleDraft(null);
    setFields((prev) => ({
      ...prev,
      collection: 'custom',
      brandHeader: '',
      collectionLabel: '',
      optionLabel: '',
      itemCount: 1,
      items: [{ ...EMPTY_ITEM }],
      weight: '',
      lotNumber: '',
      expiryDate: '',
      expiryNote: '',
      countryOfOrigin: '대한민국',
      manufacturer: '',
      usage: '',
      caution: KOREA_COSMETIC_CAUTION,
      footerNote: 'Made in Korea',
      recycleMark: '',
      // 4종을 나눠 담던 폰트 기준값은 단일 품목에선 너무 작아 셀 절반이 빈다.
      // 배율 s를 걸면 줄 수와 줄 높이가 함께 늘어 텍스트 높이는 s²에 비례한다.
      // 전성분이 긴 제품에서도 잘리지 않는 선으로 1.4에서 출발하고, 나머지는 슬라이더로 맞춘다.
      fontScale: 1.4,
    }));
  };

  const handlePdf = async () => { if (previewRef.current) await generatePdf(previewRef.current); };
  const handlePrint = () => { if (previewRef.current) printLabel(previewRef.current); };

  // 제조번호와 사용기한은 매입 로트마다 바뀌어 템플릿에 담아둘 수 없는 값이다.
  // 둘 다 화장품법 필수 기재사항이라, 빈 채로 인쇄하면 표시 위반이 된다.
  const missingRequired = [
    !fields.lotNumber.trim() && '제조번호(LOT)',
    !fields.expiryDate.trim() && '사용기한',
  ].filter((v): v is string => typeof v === 'string');

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
              onLoad={(data) => { setFontScaleDraft(null); setFields(migrateCosmeticFields(data)); }}
            />
          </div>

          {/* 프리셋 */}
          <div style={SECTION}>
            <div style={SECTION_TITLE}>프리셋</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['floral', 'creamy'] as const).map((col) => (
                <button
                  key={col}
                  onClick={() => applySoapPreset(col)}
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
            <button
              onClick={applySingleItemPreset}
              style={{
                width: '100%', marginTop: 6, padding: '6px 0', borderRadius: 6,
                border: '1px solid', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                borderColor: fields.collection === 'custom' ? '#6366f1' : '#d1d5db',
                background: fields.collection === 'custom' ? '#eef2ff' : '#fff',
                color: fields.collection === 'custom' ? '#6366f1' : '#6b7280',
              }}
            >
              🧴 단일 품목 (국내 소분)
            </button>
            <p style={{ fontSize: 10, color: '#9ca3af', marginTop: 4 }}>
              비누 프리셋은 4종 기본값이 자동 입력됩니다. 단일 품목은 화장품법 주의사항만 채우고 나머지는 비웁니다.
            </p>
          </div>

          {/* 품목 */}
          <div style={SECTION}>
            <div style={SECTION_TITLE}>품목</div>
            <div style={{ marginBottom: 8 }}>
              <label htmlFor={itemCountId} style={LABEL}>품목 수</label>
              <select
                id={itemCountId}
                style={INPUT}
                value={fields.items.length}
                onChange={(e) => setItemCount(Number(e.target.value))}
              >
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>{n}종</option>
                ))}
              </select>
            </div>
            {fields.items.map((item, i) => (
              <ItemSection
                key={i}
                num={i + 1}
                item={item}
                onChange={(patch) => setItem(i, patch)}
              />
            ))}
          </div>

          {/* 글자 크기 */}
          <div style={SECTION}>
            <div style={SECTION_TITLE}>글자 크기</div>
            <div style={{ marginBottom: 4 }}>
              <label htmlFor={fontScaleId} style={LABEL}>글자 크기 배율 (1 = 기본)</label>
              <input
                id={fontScaleId}
                type="number"
                step={0.1}
                min={0.5}
                max={3}
                style={INPUT}
                value={fontScaleDraft ?? fields.fontScale}
                onChange={(e) => {
                  setFontScaleDraft(e.target.value);
                  const n = Number(e.target.value);
                  if (Number.isFinite(n) && n > 0) set('fontScale', n);
                }}
                onBlur={() => setFontScaleDraft(null)}
              />
            </div>
            <input
              type="range"
              aria-label="글자 크기 배율 슬라이더"
              min={0.5}
              max={3}
              step={0.1}
              value={fields.fontScale}
              onChange={(e) => { setFontScaleDraft(null); set('fontScale', Number(e.target.value)); }}
              style={{ width: '100%' }}
            />
            <p style={{ fontSize: 10, color: '#9ca3af', marginTop: 4 }}>
              품목이 적으면 셀에 여백이 남습니다. 배율을 올려 채우되, 미리보기에서 내용이
              잘리지 않는지 확인하세요.
            </p>
          </div>

          {/* 제품 정보 */}
          <div style={SECTION}>
            <div style={SECTION_TITLE}>제품 정보</div>
            <Field label="브랜드 (헤더)" value={fields.brandHeader} onChange={(v) => set('brandHeader', v)} />
            <Field label="제품 라인 (부제)" value={fields.collectionLabel} onChange={(v) => set('collectionLabel', v)} />
            <Field label="우측 상단 표기" value={fields.optionLabel} onChange={(v) => set('optionLabel', v)} />
            <Field label="내용량" value={fields.weight} onChange={(v) => set('weight', v)} />
            <Field label="제조번호 (LOT)" value={fields.lotNumber} onChange={(v) => set('lotNumber', v)} />
            <Field label="사용기한 (예: 2026-09)" value={fields.expiryDate} onChange={(v) => set('expiryDate', v)} />
            <Field label="개봉 후 사용기간 문구" value={fields.expiryNote} onChange={(v) => set('expiryNote', v)} />
            <Field label="제조국" value={fields.countryOfOrigin} onChange={(v) => set('countryOfOrigin', v)} />
            <Field label="제조원" value={fields.manufacturer} onChange={(v) => set('manufacturer', v)} textarea />
          </div>

          {/* 사용방법 · 주의사항 */}
          <div style={SECTION}>
            <div style={SECTION_TITLE}>사용방법 · 주의사항</div>
            <Field label="사용방법" value={fields.usage} onChange={(v) => set('usage', v)} textarea />
            <Field label="사용 시 주의사항" value={fields.caution} onChange={(v) => set('caution', v)} textarea />
          </div>

          {/* 판매자 정보 */}
          <div style={SECTION}>
            <div style={SECTION_TITLE}>판매자 정보</div>
            <Field label="책임판매업자 (수입사)" value={fields.importer} onChange={(v) => set('importer', v)} />
            <Field label="주소" value={fields.importerAddress} onChange={(v) => set('importerAddress', v)} />
            <Field label="전화" value={fields.phone} onChange={(v) => set('phone', v)} />
            <Field label="분리배출 표기" value={fields.recycleMark} onChange={(v) => set('recycleMark', v)} />
            <Field label="원산지 표기 (우측 하단)" value={fields.footerNote} onChange={(v) => set('footerNote', v)} />
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

          {missingRequired.length > 0 && (
            <div
              role="alert"
              style={{
                padding: '8px 16px',
                background: '#fef2f2',
                borderBottom: '1px solid #fecaca',
                color: '#b91c1c',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              ⚠ {missingRequired.join(' · ')}이(가) 비어 있습니다 — 화장품법상 필수 기재사항이라
              이대로 인쇄하면 라벨에 &ldquo;—&rdquo;로 찍힙니다.
            </div>
          )}

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
