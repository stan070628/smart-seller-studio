/**
 * unit-parser.ts
 * 상품명 문자열에서 단위 정보를 파싱하여 최소 단위 기준 단가 비교에 활용
 *
 * 지원 단위:
 *   - 중량: g, kg, mg → g 기준 정규화, 100g당 단가
 *   - 용량: ml, L      → ml 기준 정규화, 100ml당 단가
 *   - 낱개: 정/알/캡슐/개/봉/매/롤/장/포/입/팩/ct/pk → 1개당 단가
 */

// ─────────────────────────────────────────────────────────────────────────────
// 타입 정의
// ─────────────────────────────────────────────────────────────────────────────

export type UnitType = 'weight' | 'volume' | 'count';

export interface ParsedUnit {
  unitType: UnitType;
  /** 정규화된 총량 (g, ml, 또는 개) */
  totalQuantity: number;
  /** 기준 단위: 'g' | 'ml' | '개' */
  baseUnit: string;
  /** 단가 계산 나누기 값: weight/volume=100, count=1 */
  unitPriceDivisor: number;
  /** 단가 레이블: '100g당' | '100ml당' | '1개당' */
  unitPriceLabel: string;
}

export type ParseResult =
  | { success: true; parsed: ParsedUnit }
  | { success: false; reason: string };

// ─────────────────────────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────────────────────────

/** 중량 단위 → g 변환 계수 */
const WEIGHT_TO_GRAM: Record<string, number> = {
  mg: 0.001,
  g: 1,
  kg: 1000,
};

/** 용량 단위 → ml 변환 계수 */
const VOLUME_TO_ML: Record<string, number> = {
  ml: 1,
  ML: 1,
  l: 1000,
  L: 1000,
};

/**
 * 낱개 단위 패턴 (소문자로 매칭, 한글+영문 혼용)
 * 주의: 'g', 'l', 'ml', 'kg' 등 중량·용량 단위와 충돌하지 않는 단어만 포함
 */
const COUNT_UNITS_PATTERN =
  /정|알|캡슐|캡|개|봉|매|롤|장|포|입|팩|정제|ct\b|pk\b/i;

/** x 곱셈 연산자 패턴 (공백 허용) */
const MULTIPLY_PATTERN = /[xX×]\s*(\d+(?:\.\d+)?)/g;

/** + 덧셈 연산자 패턴 (공백 허용) */
const PLUS_PATTERN = /[+]\s*(\d+(?:\.\d+)?)\s*(g|kg|mg|ml|mL|ML|l|L|정|알|캡슐|캡|개|봉|매|롤|장|포|입|팩)/gi;

// ─────────────────────────────────────────────────────────────────────────────
// 내부 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 괄호·대괄호 내용 제거 후 문자열 반환
 * 예: "아몬드 (무염) [1.36kg]" → "아몬드   "
 */
function removeBrackets(text: string): string {
  return text
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ');
}

/**
 * 문자열 내 수량 곱셈 합산
 * "x 24 x 3" → 첫 번째 값(baseQty)에 곱셈 적용 후 반환
 *
 * @param afterUnit 단위 이후의 나머지 문자열
 * @param baseQty   단위 앞에서 파싱된 기본 수량
 * @returns 최종 수량 (곱셈 없으면 baseQty 그대로)
 */
function applyMultipliers(afterUnit: string, baseQty: number): number {
  let result = baseQty;

  // ── 1. "x N" 명시적 곱셈 ─────────────────────────────────────────────────
  const xRegex = /[xX×]\s*(\d+(?:\.\d+)?)/g;
  let match: RegExpExecArray | null;
  while ((match = xRegex.exec(afterUnit)) !== null) {
    const factor = parseFloat(match[1]);
    if (!isNaN(factor) && factor > 0) {
      result *= factor;
    }
  }

  // ── 2. "Nt" 묶음 수 (티백/스틱 단위) — x 없이 나오는 경우 ────────────────
  // 예: "11.7g 20T, 1개" → ×20
  // "x 210T" 와 혼동 방지: x 구문 제거 후 검색
  const afterStripped = afterUnit.replace(/[xX×]\s*\d+(?:\.\d+)?/g, ' ');
  const tRegex = /\b(\d+)\s*[Tt]\b/g;
  while ((match = tRegex.exec(afterStripped)) !== null) {
    const factor = parseFloat(match[1]);
    if (!isNaN(factor) && factor > 1) {
      result *= factor;
    }
  }

  return result;
}

/**
 * 덧셈 표기 총량 계산
 * "정 + 60정" 형태에서 추가 수량을 파싱
 *
 * @param text     원본 문자열 (단위 이후 부분)
 * @param baseQty  기본 수량
 * @param unitKey  현재 단위 키 (g, ml, 개 등)
 * @returns 덧셈 포함 총량
 */
function applyAdditions(text: string, baseQty: number, unitType: UnitType): number {
  let result = baseQty;

  // +숫자+단위 패턴에서 같은 타입의 추가 수량만 합산
  const plusRegex = /[+]\s*(\d+(?:\.\d+)?)\s*(g|kg|mg|ml|mL|ML|l|L|정|알|캡슐|캡|개|봉|매|롤|장|포|입|팩)/gi;
  let match: RegExpExecArray | null;

  while ((match = plusRegex.exec(text)) !== null) {
    const addQty = parseFloat(match[1]);
    const addUnitRaw = match[2].toLowerCase();
    if (isNaN(addQty) || addQty <= 0) continue;

    if (unitType === 'weight' && addUnitRaw in WEIGHT_TO_GRAM) {
      result += addQty * WEIGHT_TO_GRAM[addUnitRaw];
    } else if (unitType === 'volume' && addUnitRaw in VOLUME_TO_ML) {
      result += addQty * VOLUME_TO_ML[addUnitRaw];
    } else if (unitType === 'count') {
      // 낱개 단위 덧셈
      if (COUNT_UNITS_PATTERN.test(match[2])) {
        result += addQty;
      }
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// 핵심 파서
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 상품명에서 단위 정보를 파싱합니다.
 *
 * 파싱 우선순위:
 *   1. 중량 (g, kg, mg) → weight
 *   2. 용량 (ml, L)     → volume
 *   3. 낱개 (정, 알, 캡슐 등) → count
 *
 * 성공 시 ParseResult.success = true, 실패 시 false (throw 없음)
 *
 * @example
 * parseProductUnit("베지밀 두유 190ml x 24 x 3")
 *   → { success: true, parsed: { unitType: 'volume', totalQuantity: 13680, ... } }
 *
 * parseProductUnit("커클랜드 아몬드 1.36kg")
 *   → { success: true, parsed: { unitType: 'weight', totalQuantity: 1360, ... } }
 *
 * parseProductUnit("센트룸 비타민 300정 + 60정")
 *   → { success: true, parsed: { unitType: 'count', totalQuantity: 360, ... } }
 */
export function parseProductUnit(title: string): ParseResult {
  if (!title || title.trim().length === 0) {
    return { success: false, reason: '빈 상품명' };
  }

  // 괄호·대괄호 내용 제거
  const cleaned = removeBrackets(title);

  // ── 1. 중량 패턴 매칭 (g, kg, mg) ─────────────────────────────────────────
  // 패턴: 숫자 + 중량단위 (예: 1.36kg, 500g, 200mg)
  const weightRegex = /(\d+(?:\.\d+)?)\s*(kg|mg|g)(?!\w)/gi;
  let weightMatch: RegExpExecArray | null;

  while ((weightMatch = weightRegex.exec(cleaned)) !== null) {
    const rawQty = parseFloat(weightMatch[1]);
    const unitKey = weightMatch[2].toLowerCase();

    if (isNaN(rawQty) || rawQty <= 0) continue;
    if (!(unitKey in WEIGHT_TO_GRAM)) continue;

    // g 단위로 정규화
    let baseGrams = rawQty * WEIGHT_TO_GRAM[unitKey];

    // "N개/N입 Mg" 형식: 중량 앞에 낱개 수량이 있으면 곱셈 적용
    // 예: "220입 11.7g" → 220 × 11.7g = 2574g
    //     "6병 330ml" (중량 형식은 아니지만 동일 패턴)
    const beforeUnit = cleaned.slice(0, weightMatch.index);
    const precedingCountMatch = beforeUnit.match(
      /(\d+(?:\.\d+)?)\s*(개|입|팩|봉|포|병|캔|통|[Tt]\b|ct\b|pk\b)\s*$/i,
    );
    if (precedingCountMatch) {
      const precedingFactor = parseFloat(precedingCountMatch[1]);
      if (!isNaN(precedingFactor) && precedingFactor > 1) {
        baseGrams *= precedingFactor;
      }
    }

    // 단위 이후 문자열에서 곱셈·덧셈 적용
    const afterUnit = cleaned.slice(weightMatch.index + weightMatch[0].length);
    const withMultipliers = applyMultipliers(afterUnit, baseGrams);
    const totalQuantity = applyAdditions(afterUnit, withMultipliers, 'weight');

    if (totalQuantity <= 0) continue;

    return {
      success: true,
      parsed: {
        unitType: 'weight',
        totalQuantity: Math.round(totalQuantity * 1000) / 1000,
        baseUnit: 'g',
        unitPriceDivisor: 100,
        unitPriceLabel: '100g당',
      },
    };
  }

  // ── 2. 용량 패턴 매칭 (ml, L) ─────────────────────────────────────────────
  // 패턴: 숫자 + 용량단위 (예: 190ml, 2L, 1.5L)
  const volumeRegex = /(\d+(?:\.\d+)?)\s*(ml|mL|ML|l|L)(?!\w)/g;
  let volumeMatch: RegExpExecArray | null;

  while ((volumeMatch = volumeRegex.exec(cleaned)) !== null) {
    const rawQty = parseFloat(volumeMatch[1]);
    const unitKey = volumeMatch[2];

    if (isNaN(rawQty) || rawQty <= 0) continue;

    const unitKeyNorm = unitKey === 'ml' || unitKey === 'mL' || unitKey === 'ML' ? 'ml' : 'L';
    if (!(unitKeyNorm in VOLUME_TO_ML)) continue;

    // ml 단위로 정규화
    let baseML = rawQty * VOLUME_TO_ML[unitKeyNorm];

    // "N병/N팩 Xml" 형식: 용량 앞에 낱개 수량이 있으면 곱셈 적용
    // 예: "6병 330ml" → 6 × 330ml = 1980ml
    const beforeVolUnit = cleaned.slice(0, volumeMatch.index);
    const precedingVolCount = beforeVolUnit.match(
      /(\d+(?:\.\d+)?)\s*(개|입|팩|봉|포|병|캔|통|[Tt]\b|ct\b|pk\b)\s*$/i,
    );
    if (precedingVolCount) {
      const factor = parseFloat(precedingVolCount[1]);
      if (!isNaN(factor) && factor > 1) {
        baseML *= factor;
      }
    }

    const afterUnit = cleaned.slice(volumeMatch.index + volumeMatch[0].length);
    const withMultipliers = applyMultipliers(afterUnit, baseML);
    const totalQuantity = applyAdditions(afterUnit, withMultipliers, 'volume');

    if (totalQuantity <= 0) continue;

    return {
      success: true,
      parsed: {
        unitType: 'volume',
        totalQuantity: Math.round(totalQuantity * 1000) / 1000,
        baseUnit: 'ml',
        unitPriceDivisor: 100,
        unitPriceLabel: '100ml당',
      },
    };
  }

  // ── 3. 낱개 단위 패턴 매칭 ────────────────────────────────────────────────
  // 패턴: 숫자 + 낱개단위 (예: 300정, 120캡슐, 150매, 12롤)
  // 여러 패턴이 있을 때 가장 먼저 매칭된 것을 기준으로 합산
  const countUnitsGroup =
    '(정제|캡슐|캡|알|ct|pk|개|봉|매|롤|장|포|입|팩|정)';
  const countRegex = new RegExp(
    `(\\d+(?:\\.\\d+)?)\\s*${countUnitsGroup}`,
    'gi',
  );
  let countMatch: RegExpExecArray | null;

  while ((countMatch = countRegex.exec(cleaned)) !== null) {
    const rawQty = parseFloat(countMatch[1]);

    if (isNaN(rawQty) || rawQty <= 0) continue;

    const afterUnit = cleaned.slice(countMatch.index + countMatch[0].length);
    const withMultipliers = applyMultipliers(afterUnit, rawQty);
    const totalQuantity = applyAdditions(afterUnit, withMultipliers, 'count');

    if (totalQuantity <= 0) continue;

    return {
      success: true,
      parsed: {
        unitType: 'count',
        totalQuantity: Math.round(totalQuantity * 1000) / 1000,
        baseUnit: '개',
        unitPriceDivisor: 1,
        unitPriceLabel: '1개당',
      },
    };
  }

  return { success: false, reason: '단위 파싱 불가' };
}
