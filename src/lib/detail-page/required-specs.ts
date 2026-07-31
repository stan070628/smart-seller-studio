/**
 * 카테고리별 필수 스펙 커버리지 점검.
 *
 * 왜 validateProLayout의 Violation이 아니라 별도 모듈인가:
 * 필수 스펙 누락은 "생성 결과가 잘못됐다"가 아니라 "셀러가 입력을 안 했다"이다.
 * error severity로 올리면 repair 패스가 돌면서 Claude에게 없는 수치를 만들어내라고
 * 압박하는 꼴이 된다 — 정확히 피하려던 일이다. warning으로 올려도 route의
 * friendlyViolationWarnings가 error만 걸러 내보내서 셀러에게 닿지 않는다.
 * 그래서 검증 파이프라인 밖에서 계산해 warnings 배열에만 싣는다.
 */

/** 카테고리 판정용 키워드 → 그 카테고리에서 구매 결정에 직결되는 항목 */
interface SpecRule {
  /** 카테고리 문자열이나 상품명에 이 중 하나가 있으면 적용 */
  keywords: string[];
  /** 셀러에게 보여줄 항목 이름 */
  label: string;
  /**
   * Key points가 이 중 하나에 걸리면 입력된 것으로 본다.
   *
   * 부분문자열이 아니라 정규식인 이유: 단순 매칭은 오탐이 심하다. "면"은 "허리단면"에,
   * "%"는 "통기성 92%"에, "V"·"W"는 영문 단어 아무 곳에나 걸린다. 그렇게 되면 값이
   * 없는데도 있다고 판정해 경고가 영영 안 뜬다(미탐). 항목 이름과 숫자가 함께
   * 등장하는지를 본다.
   */
  hints: RegExp[];
}

const RULES: SpecRule[] = [
  {
    keywords: ['의류', '패션', '옷', '상의', '하의', '바지', '반바지', '티셔츠', '원피스', '자켓', '재킷', '홈웨어', '잠옷', '파자마', '이너', '언더웨어'],
    label: '사이즈 실측(허리단면·총장·밑위 등)',
    // 치수 이름 뒤 6자 이내에 숫자가 와야 한다. "소매가 없어 편하다" 같은 서술은 걸리지 않는다.
    hints: [/(단면|총장|밑위|밑단|어깨|가슴|소매|허리|실측)[^\d]{0,6}\d/],
  },
  {
    keywords: ['의류', '패션', '옷', '상의', '하의', '바지', '반바지', '티셔츠', '원피스', '자켓', '재킷', '홈웨어', '잠옷', '파자마', '이너', '언더웨어', '침구', '패브릭'],
    label: '소재 혼용률',
    // 섬유명 + 숫자 + % 가 붙어야 혼용률이다. 섬유명만 있으면 "면 소재라 시원함" 같은
    // 서술일 뿐 혼용률이 아니다.
    hints: [
      /혼용|혼방/,
      /(면|코튼|폴리[에스터르]*|나일론|레이온|스판[덱스]*|텐셀|모달|린넨|아크릴|울)\s*\d+\s*%/,
    ],
  },
  {
    keywords: ['식품', '먹거리', '간식', '음료', '건강식품', '농산', '수산', '축산'],
    label: '원산지 · 용량 · 보관방법 · 유통기한',
    hints: [/원산지|보관|유통기한|소비기한/, /(용량|중량|내용량)[^\d]{0,6}\d/],
  },
  {
    keywords: ['가전', '전자', '가전제품', '주방가전', '생활가전'],
    label: '정격전압 · 소비전력 · 크기 · 무게',
    hints: [/전압|소비전력|정격/, /\d+\s*(V|W|kg|g)\b/],
  },
];

/**
 * 이 상품에서 빠진 필수 스펙 항목 이름들.
 *
 * 판정 기준은 "Key points에 흔적이 있는가" 하나뿐이다. 결과에 spec_table이 실제로
 * 생성됐는지는 일부러 보지 않는다. 값이 입력됐는데 표가 없다고 재생성을 권하면,
 * C8이 허용하는 경로(실측 2개까지는 option_grid sublabel에 배치)로 잘 처리한
 * 경우에도 매번 경고가 뜬다. 그런 경고는 셀러가 경고 전체를 무시하게 만든다.
 * 여기서는 "셀러가 채워야 할 것이 실제로 비어 있는" 경우만 잡는다.
 */
export function missingRequiredSpecs(category: string, productName: string, points: string[]): string[] {
  const haystack = `${category} ${productName}`;
  const joined = points.join(' ');
  const missing: string[] = [];
  for (const rule of RULES) {
    if (!rule.keywords.some((k) => haystack.includes(k))) continue;
    if (rule.hints.some((h) => h.test(joined))) continue;
    if (!missing.includes(rule.label)) missing.push(rule.label);
  }
  return missing;
}

/** 셀러용 경고 문구. 빠진 항목이 없으면 빈 배열. */
export function requiredSpecWarnings(category: string, productName: string, points: string[]): string[] {
  const missing = missingRequiredSpecs(category, productName, points);
  if (missing.length === 0) return [];
  return [
    `구매 결정에 필요한 정보가 상품 정보에 없어 표를 만들지 못했습니다: ${missing.join(', ')}. ` +
    `입력하면 다음 생성부터 스펙 표로 들어갑니다.`,
  ];
}
