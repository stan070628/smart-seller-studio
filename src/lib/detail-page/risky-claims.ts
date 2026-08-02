// src/lib/detail-page/risky-claims.ts
//
// 생성된 상세페이지 문구에서 표시광고법 위험 표현을 찾아 셀러에게 경고한다.
//
// 왜 필요한가: 2026-08-02 나이키 다저스 티셔츠 실사용에서 AI가 "가품과 갈리는 곳"이라는
// 섹션 제목을 스스로 만들었다. 셀러가 입력한 Key points에는 그 단어가 없었다.
// 상세페이지에서 "가품"을 먼저 꺼내면 없던 의심을 만들고, "정품 보장"류는 그 자체로
// 제재 대상이다.
//
// 왜 Violation이 아니라 warning인가: required-specs.ts와 같은 이유다. error로 올리면
// repair 패스가 문구를 강제로 바꾸는데, 무엇으로 바꿔야 옳은지는 상품마다 다르다
// (예: 브랜드 정품 리셀은 "나이키 정품"이 정확한 사실이고 지워선 안 된다).
// 판단은 셀러에게 남기고 위치만 알려준다.
//
// 오탐을 어디까지 허용하는가: "정품"이라는 단어 자체는 막지 않는다. "나이키 정품",
// "MLB 공식 정품 인증 홀로그램"은 검증 가능한 사실 서술이다. 막는 것은 판매자가
// 스스로 품질을 보증하는 형태("정품 보장", "100% 정품")와, 입증 없이 최상급을
// 주장하는 형태다.

/** 위험 표현 한 종류 */
interface RiskyPattern {
  /** 매칭 정규식. 전역 플래그를 붙이지 않는다 — test/match를 반복 호출하면 lastIndex가 꼬인다 */
  re: RegExp;
  /** 셀러에게 보여줄 이유 */
  reason: string;
}

const PATTERNS: RiskyPattern[] = [
  {
    // "가품", "짝퉁", "이미테이션". 상세페이지에서 판매자가 먼저 꺼낼 말이 아니다.
    re: /가품|짝퉁|이미테이션|모조품/,
    reason: '"가품·짝퉁"은 상세페이지에서 없던 의심을 만듭니다. 정품 근거(인증 택·라벨 사진)를 보여주는 쪽이 강합니다.',
  },
  {
    // "정품 보장", "정품 100%", "100% 정품", "정품 확실". 판매자의 자기 보증은 제재 대상이다.
    // "나이키 정품"·"정품 인증 홀로그램"처럼 사실을 가리키는 용법은 걸리지 않게
    // 보증 어휘가 붙은 경우만 잡는다.
    re: /정품\s*(보장|보증|확실|100\s*%)|100\s*%\s*정품/,
    reason: '"정품 보장/100% 정품"은 표시광고법 제재 대상입니다. 인증 택·라벨 사진으로 대체하세요.',
  },
  {
    // 입증 불가능한 최상급. 시스템 프롬프트에 "역대급·혁명적" 금지가 있으나
    // 가격·유통 관련 최상급은 별도로 다룬다 — 근거가 있어도 상시 유지가 불가능하다.
    re: /최저가|최저\s*가격|국내\s*최저|최저\s*판매/,
    reason: '"최저가"는 상시 입증이 불가능해 표시광고법 위반이 됩니다.',
  },
  {
    re: /국내\s*유일|세계\s*유일|단독\s*판매|독점\s*판매/,
    reason: '"유일·단독 판매"는 입증 책임이 판매자에게 있습니다. 사실이어도 경쟁사 등장 시 위반이 됩니다.',
  },
  {
    // 해외 정가를 국내 정가처럼 적으면 허위 할인율이 된다.
    // "정가 55,000원"처럼 통화 기호 없이 원화로 적힌 정가를 잡는다.
    // "일본 현지 정가 ¥6,000"처럼 국가나 외화 표기가 붙으면 통과시킨다.
    re: /(?<!(일본|미국|중국|현지|해외)\s{0,4})정가\s*\d[\d,]*\s*원/,
    reason: '해외 정가를 원화로만 적으면 국내 정가로 오인됩니다. "일본 현지 정가 ¥6,000"처럼 국가와 통화를 함께 쓰세요.',
  },
];

/** 섹션에서 사람이 읽는 문자열만 모은다. 키 이름은 보지 않는다. */
function collectText(node: unknown, out: string[], depth = 0): void {
  // 깊이 제한은 순환 참조 방어용이다. 실제 섹션 트리는 5단을 넘지 않는다.
  if (depth > 12 || node == null) return;
  if (typeof node === 'string') {
    out.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const v of node) collectText(v, out, depth + 1);
    return;
  }
  if (typeof node === 'object') {
    for (const v of Object.values(node as Record<string, unknown>)) {
      collectText(v, out, depth + 1);
    }
  }
}

/**
 * 생성된 섹션에서 위험 표현을 찾아 경고 문구를 만든다.
 *
 * 같은 종류가 여러 번 나와도 경고는 한 줄로 합친다 — 같은 이유를 반복해 보여주면
 * 셀러가 경고 전체를 읽지 않게 된다. 대신 발견된 표현을 함께 실어 어디를 고칠지
 * 알 수 있게 한다.
 */
export function riskyClaimWarnings(sections: unknown): string[] {
  const texts: string[] = [];
  collectText(sections, texts);
  if (texts.length === 0) return [];

  const joined = texts.join('\n');
  const warnings: string[] = [];

  for (const { re, reason } of PATTERNS) {
    const m = joined.match(re);
    if (!m) continue;
    warnings.push(`문구 확인 필요 — "${m[0].trim()}": ${reason}`);
  }

  return warnings;
}
