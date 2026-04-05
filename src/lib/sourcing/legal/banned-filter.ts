/**
 * Layer 2: 플랫폼 금지어 필터
 *
 * 상품명 + 키워드에서 법적 금지품목, 과장광고, 타브랜드 무단사용 탐지
 * ILLEGAL → BLOCK / EXAGGERATION·BRAND_ABUSE → WARN
 */

import type { LegalIssue } from './types';

// ─── 법적 판매금지 품목 (전자상거래법, 약사법 등) ──────────────
const ILLEGAL_KEYWORDS = [
  // 의약품/의료기기 불법판매
  '처방전', '전문의약품', '마약', '대마',
  // 무기/위험물
  '전자충격기', '스턴건', '도검', '석궁', '실탄',
  // 위조/불법복제
  '정품아님', '레플리카', '이미테이션', '짝퉁',
  // 식품위생법 위반
  '미승인건강기능식품',
  // 개인정보/불법
  '주민등록', '신분증위조', '해킹',
  // 위험화학물질
  '염산', '황산', '질산', '시안화',
] as const;

// ─── 과장광고 표현 (표시광고법, 식품표시광고법) ──────────────
const EXAGGERATION_PATTERNS = [
  // 식품/건기식 과장
  /100%\s*(?:완치|치료|예방)/i,
  /암\s*(?:치료|예방|완치)/i,
  /(?:다이어트|살)\s*(?:100%|확실|보장)/i,
  /FDA\s*승인/i,  // 한국에서 FDA 언급은 과장
  /(?:세계\s*최초|국내\s*유일|업계\s*1위)/,
  /(?:기적|만능|만병통치|특효)/,
  // 화장품 과장
  /주름\s*(?:제거|완치|100%)/,
  /(?:미백|화이트닝)\s*(?:100%|완벽|확실)/,
  // 일반 과장
  /(?:평생|영구)\s*(?:보증|보장|무료)/,
  /(?:절대|100%)\s*(?:안전|무해|무독)/,
] as const;

// ─── 타브랜드 무단 사용 의심 패턴 ─────────────────────────────
const BRAND_ABUSE_PATTERNS = [
  // "XX 호환", "XX st", "XX 스타일" 등은 OK → 브랜드명 단독 사용만 감지
  /(?:다이슨|dyson)\s*(?:정품|순정)/i,
  /(?:애플|apple)\s*(?:정품|순정)/i,
  /(?:삼성|samsung)\s*(?:정품|순정)/i,
  /(?:LG)\s*(?:정품|순정)/i,
  /(?:나이키|nike)\s*(?:정품|순정)/i,
  /(?:아디다스|adidas)\s*(?:정품|순정)/i,
  /(?:구찌|gucci|샤넬|chanel|루이비통|louis\s*vuitton)/i,
] as const;

export function checkBannedKeywords(title: string): LegalIssue[] {
  const issues: LegalIssue[] = [];

  // 1. 법적 금지품목 → RED / BLOCK
  for (const kw of ILLEGAL_KEYWORDS) {
    if (title.toLowerCase().includes(kw.toLowerCase())) {
      issues.push({
        layer: 'banned',
        severity: 'RED',
        code: 'ILLEGAL_ITEM',
        message: `판매 금지 품목 의심: '${kw}'`,
        detail: { matched: kw },
      });
      break; // 하나만 잡아도 BLOCK
    }
  }

  // 2. 과장광고 → YELLOW / WARN
  for (const pattern of EXAGGERATION_PATTERNS) {
    const match = title.match(pattern);
    if (match) {
      issues.push({
        layer: 'banned',
        severity: 'YELLOW',
        code: 'EXAGGERATION',
        message: `과장광고 의심 표현: '${match[0]}'`,
        detail: { matched: match[0] },
      });
      break;
    }
  }

  // 3. 타브랜드 무단 사용 → YELLOW / WARN
  for (const pattern of BRAND_ABUSE_PATTERNS) {
    const match = title.match(pattern);
    if (match) {
      issues.push({
        layer: 'banned',
        severity: 'YELLOW',
        code: 'BRAND_ABUSE',
        message: `타브랜드 무단 사용 의심: '${match[0]}'`,
        detail: { matched: match[0] },
      });
      break;
    }
  }

  return issues;
}
