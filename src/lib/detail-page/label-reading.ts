// src/lib/detail-page/label-reading.ts
//
// 라벨·태그 사진에서 읽어낸 값의 타입과 파싱·검증.
//
// 왜 "읽은 값"과 "추론한 값"을 구분하는가:
// 2026-08-02 나이키 티셔츠에서 소재 표기가 어디에도 없어, 웹 검색으로 찾은 `綿100%`를
// 쓸지 판단해야 했다. 쓰지 않았다 — 외부에서 찾은 값을 라벨에서 읽은 것처럼 내놓으면
// 표시광고법 위반이 되고 책임은 판매자에게 간다.
//
// 그래서 이 모듈은 **사진에 실제로 적혀 있는 글자만** 담는다. AI가 "아마 면일 것"
// 같은 추론을 내놓으면 버린다. 값이 없으면 없는 채로 두고 셀러가 판단한다.

/** 라벨에서 읽어낸 한 항목 */
export interface LabelField {
  /** 사진에 적힌 그대로. 번역하지 않은 원문을 유지한다 */
  raw: string;
  /** 한국어로 정리한 값. 원문이 이미 한국어면 raw와 같다 */
  value: string;
  /** 몇 번째 사진에서 읽었는가 (0-based). 셀러가 대조할 수 있어야 한다 */
  imageIndex: number;
}

/** 라벨 판독 결과 — 없는 항목은 undefined로 둔다 */
export interface LabelReading {
  /** 겉감 폴리에스터 96%, 폴리우레탄 4% */
  material?: LabelField;
  /** 방글라데시 */
  origin?: LabelField;
  /** (주)코스트코 코리아 */
  importer?: LabelField;
  /** ENGLISH LAUNDRY */
  brand?: LabelField;
  /** VENT AIR SHORT */
  officialName?: LabelField;
  /** 통화·국가가 붙은 정가. "¥6,000 (일본)" */
  listPrice?: LabelField;
  /** 32, XL 등 라벨에 적힌 사이즈 표기 */
  sizeLabel?: LabelField;
  /** 30℃ 이하 세탁 · 표백 금지 ... */
  careInstructions?: LabelField;
  /** 행택의 기능 아이콘. STRETCH FABRIC · QUICK DRY ... */
  features: LabelField[];
  /** 정품 인증·KC 등. 일련번호는 담지 않는다 (개체마다 다름) */
  certifications: LabelField[];
  /** 품번·바코드 */
  itemCode?: LabelField;
}

/** 고시정보 9칸 중 라벨에서 채울 수 있는 것 */
export interface NoticeDraft {
  material: string;
  origin: string;
  manufacturer: string;
  careInstructions: string;
}

const EMPTY: LabelReading = { features: [], certifications: [] };

/**
 * 값 앞에 붙은 항목명을 떼어낸다.
 *
 * 프롬프트로 금지해도 모델이 라벨에 인쇄된 항목명을 값에 함께 담는 일이 잦다
 * (실측: "제조국 방글라데시", "수입자 (주)코스트코…", "품번 1956428").
 * 고시정보 칸에 그대로 들어가면 "제조국: 제조국 방글라데시"가 된다.
 *
 * raw는 건드리지 않는다 — 라벨에 그렇게 적혀 있는 것이 사실이고, 셀러가 사진과
 * 대조할 때 원문이 그대로여야 한다.
 */
// 항목명 뒤에는 반드시 구분자(콜론)나 공백이 와야 한다. 그 조건이 없으면
// "수입자명 (주)…"에서 "수입자"만 떼어내 "명 (주)…"이 남는다(실측).
// 선택적 '명'을 함께 흡수하고, 뒤에 아무것도 없으면(항목명 단독) 매칭하지 않는다.
const FIELD_LABEL_PREFIX =
  /^(제조국|원산지|수입자|판매원|제조자|제조사|품번|품명|모델명|소재|혼용률|색상|사이즈|치수)명?\s*(?:[:：]\s*|\s+)/;

function stripFieldLabel(s: string): string {
  const out = s.replace(FIELD_LABEL_PREFIX, '').trim();
  // 전부 지워지면 원문이 항목명뿐이었다는 뜻이다. 값이 없는 것으로 본다.
  return out || s.trim();
}

/** 문자열 필드 하나를 안전하게 뽑는다. 빈 값·공백은 undefined */
function pickField(v: unknown, maxLen = 300): LabelField | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const raw = typeof o.raw === 'string' ? o.raw.trim().slice(0, maxLen) : '';
  const value = typeof o.value === 'string' ? o.value.trim().slice(0, maxLen) : '';
  if (!raw && !value) return undefined;
  const idx = typeof o.imageIndex === 'number' && Number.isInteger(o.imageIndex) && o.imageIndex >= 0
    ? o.imageIndex : 0;
  // raw만 있고 value가 없으면 원문을 그대로 값으로 쓴다 (한국어 라벨의 경우)
  return { raw: raw || value, value: stripFieldLabel(value || raw), imageIndex: idx };
}

function pickArray(v: unknown, max = 8): LabelField[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => pickField(x)).filter((x): x is LabelField => x !== undefined).slice(0, max);
}

/**
 * 모델 응답(JSON 텍스트) → LabelReading.
 *
 * 파싱 실패나 스키마 불일치에서 던지지 않는다 — 라벨 판독은 보조 기능이고,
 * 실패했다고 상품 등록 흐름 전체가 막히면 안 된다. 못 읽은 항목은 비워둔다.
 */
export function parseLabelReading(text: string): LabelReading {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return EMPTY;

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return EMPTY;
  }

  return {
    material: pickField(obj.material),
    origin: pickField(obj.origin),
    importer: pickField(obj.importer),
    brand: pickField(obj.brand),
    officialName: pickField(obj.officialName),
    listPrice: pickField(obj.listPrice),
    sizeLabel: pickField(obj.sizeLabel),
    careInstructions: pickField(obj.careInstructions, 500),
    features: pickArray(obj.features),
    certifications: pickArray(obj.certifications),
    itemCode: pickField(obj.itemCode),
  };
}

/**
 * 판매 포인트 후보 — 셀러가 Key points에 넣을 수 있는 형태.
 *
 * 정가는 반드시 국가·통화를 함께 쓴다. 해외 정가를 원화로만 적으면 국내 정가로
 * 오인되어 허위 할인율이 되며, 이는 risky-claims.ts가 사후에도 잡는 항목이다.
 * 여기서 미리 올바른 형태로 만들어 두면 셀러가 잘못 쓸 여지가 준다.
 */
export function toKeyPointCandidates(r: LabelReading): string[] {
  const out: string[] = [];
  if (r.brand && r.officialName) out.push(`${r.brand.value} ${r.officialName.value}`);
  else if (r.officialName) out.push(r.officialName.value);

  for (const f of r.features) out.push(f.value);

  if (r.material) out.push(r.material.value);
  if (r.listPrice) out.push(r.listPrice.value);

  // certifications는 넣지 않는다. 실측에서 종이 태그의 FSC 재생지 인증과
  // "상표는 EL Acquisition LLC 소유" 같은 라이선스 고지가 딸려 들어왔는데,
  // 둘 다 제품 특징이 아니라 태그 자체에 대한 표시다. 정품 근거로는 쓸모가
  // 있으므로 버리지 않고 reading.certifications에 남겨 따로 보여준다.

  // 중복 제거 — 브랜드명이 features에 또 들어오는 경우가 있다
  return [...new Set(out.map((s) => s.trim()).filter(Boolean))];
}

/**
 * 고시정보 초안. 값이 없는 칸은 빈 문자열로 둔다 — 자리표시 문구를 넣으면
 * 셀러가 그대로 저장해 잘못된 고시가 등록된다.
 */
export function toNoticeDraft(r: LabelReading): NoticeDraft {
  // 값에 이미 "수입자"가 들어 있으면 접두어를 또 붙이지 않는다.
  // stripFieldLabel이 대부분 떼어내지만 "수입자명 ..." 같은 변형이 남을 수 있다.
  const imp = r.importer?.value ?? '';
  const importerPart = imp ? (/^수입자/.test(imp) ? imp : `수입자 ${imp}`) : '';

  return {
    material: r.material?.value ?? '',
    origin: r.origin?.value ?? '',
    manufacturer: [r.brand?.value, importerPart].filter(Boolean).join(' / '),
    careInstructions: r.careInstructions?.value ?? '',
  };
}

/** 읽어낸 항목 수 — 0이면 사진이 흐리거나 라벨이 아닐 가능성이 높다 */
export function countRead(r: LabelReading): number {
  const singles = [r.material, r.origin, r.importer, r.brand, r.officialName,
                   r.listPrice, r.sizeLabel, r.careInstructions, r.itemCode];
  return singles.filter(Boolean).length + r.features.length + r.certifications.length;
}
