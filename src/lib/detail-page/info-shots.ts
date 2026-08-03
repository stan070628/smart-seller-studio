// src/lib/detail-page/info-shots.ts
//
// "정보 사진" 촬영 가이드 — 상세페이지에 실릴 사진이 아니라, 상세페이지의 재료가 되는
// 사진을 안내한다.
//
// 왜 필요한가: 2026-08-02~03 코스트코 의류 2종을 상품화하며, 완성된 상세페이지의
// 설득력을 만든 정보가 전부 라벨·태그 사진에서 나왔다. 그런데 도구는 그 사진을
// 요구한 적이 없다.
//
//   케어라벨   → 소재 96%/4% · 제조국 · 수입자
//   행택 앞    → 정식 제품명 · 현지 정가 · 품번
//   행택 뒤    → 판매 포인트 4개(STRETCH·QUICK DRY·SECURITY POCKET·FLEX WAIST)
//   인증택     → 정품 근거(홀로그램 일련번호)
//   매대 가격표 → 매입가 · 할인 종료일
//
// 행택 뒷면 한 장이 반바지 판매 포인트를 통째로 줬다. AI가 제품 사진만 보고는
// 만들 수 없는 내용이다.
//
// shot-guide.ts와 무엇이 다른가:
//   shot-guide  = 레이아웃 생성 "후", detail_closeup 슬롯의 빈 칸을 채울 연출 사진
//   info-shots  = 레이아웃 생성 "전", 카피와 고시정보의 재료가 될 정보 사진
// 순서가 반대다. 정보 사진이 먼저 있어야 쓸 수 있는 카피가 나온다.
//
// required-specs.ts와의 관계: 그쪽은 "값이 없다"고 경고만 하고, 여기는 "어디를 찍으면
// 그 값을 얻는지"를 알려준다. 카테고리 판정 키워드를 공유한다.

/** 찍어야 할 정보 사진 한 장 */
export interface InfoShot {
  /** 무엇을 찍는가 */
  subject: string;
  /** 제품의 어디에 있는가 — 못 찾는 것이 가장 흔한 실패다 */
  where: string;
  /** 이 사진에서 무엇을 얻는가 */
  yields: string[];
  /**
   * 없으면 등록 자체가 막히는가.
   * true면 고시정보 필수 항목이라 촬영을 건너뛰면 나중에 손으로 채워야 한다.
   */
  required: boolean;
}

interface ShotRule {
  /** 카테고리 문자열이나 상품명에 이 중 하나가 있으면 적용 */
  keywords: string[];
  shots: InfoShot[];
}

/** 카테고리와 무관하게 항상 안내하는 것 */
const COMMON_SHOTS: InfoShot[] = [
  {
    subject: '가격표 · 영수증',
    where: '매장 진열대 가격표, 또는 구매 영수증',
    yields: ['매입가', '상품번호', '할인 기간(있으면)'],
    // 마진 계산의 입력이지 고시정보는 아니다. 다만 할인 종료일이 재사입 데드라인이 된다.
    required: false,
  },
];

const RULES: ShotRule[] = [
  {
    keywords: ['의류', '패션', '옷', '상의', '하의', '바지', '반바지', '티셔츠', '원피스', '자켓', '재킷', '홈웨어', '잠옷', '파자마', '이너', '언더웨어', '침구', '패브릭'],
    shots: [
      {
        subject: '케어라벨 (품질표시 라벨)',
        where: '옷 안쪽 — 보통 왼쪽 옆선 밑단 근처. 목 뒤에 없으면 옆선을 보세요',
        yields: ['소재 혼용률', '제조국', '수입자·제조사', '세탁 방법'],
        required: true,
      },
      {
        subject: '목 안쪽 라벨 · 브랜드 각인',
        where: '목 뒤 안쪽. 천 라벨이 없으면 프린트로 되어 있습니다',
        yields: ['브랜드명', '사이즈 표기', '원산지(표기된 경우)'],
        required: false,
      },
      {
        subject: '행택 (종이 태그) — 앞·뒤 모두',
        where: '제품에 매달린 종이 태그. **뒷면을 꼭 함께 찍으세요**',
        yields: ['정식 제품명', '정가(통화 포함)', '품번·바코드', '제품 기능 아이콘'],
        required: false,
      },
      {
        subject: '실측 (자를 대고 촬영)',
        where: '평평하게 놓고 어깨·가슴단면·총장 / 허리단면·총장·인심·밑위',
        yields: ['사이즈 실측치'],
        required: true,
      },
    ],
  },
  {
    keywords: ['식품', '먹거리', '간식', '음료', '건강식품', '농산', '수산', '축산'],
    shots: [
      {
        subject: '제품 뒷면 표시사항',
        where: '포장 뒷면 또는 옆면의 표시사항 박스',
        yields: ['원재료명', '원산지', '내용량', '보관방법', '제조사·수입자'],
        required: true,
      },
      {
        subject: '유통기한 각인',
        where: '포장 상단·하단 또는 밀봉부의 인쇄 각인',
        yields: ['유통기한·소비기한', '제조일자'],
        required: true,
      },
      {
        subject: '영양성분표',
        where: '표시사항 옆 또는 별도 박스',
        yields: ['열량', '나트륨·당류 등 영양정보'],
        required: false,
      },
    ],
  },
  {
    keywords: ['가전', '전자', '가전제품', '주방가전', '생활가전'],
    shots: [
      {
        subject: '정격 라벨 (에너지·전기 표시)',
        where: '제품 뒷면 또는 바닥면의 스티커',
        yields: ['정격전압', '소비전력', '모델명', '제조국', '제조사·수입자'],
        required: true,
      },
      {
        subject: 'KC 인증 마크',
        where: '정격 라벨 안 또는 그 옆',
        yields: ['KC 인증번호'],
        required: true,
      },
      {
        subject: '제품 크기 실측',
        where: '자를 대고 가로·세로·높이',
        yields: ['크기', '무게(저울)'],
        required: false,
      },
    ],
  },
];

/** 브랜드 상품이면 추가로 안내한다 — 정품 검증에서 요구받는다 */
const BRAND_SHOT: InfoShot = {
  subject: '정품 인증 택 · 홀로그램',
  where: '제품에 부착된 별도 인증 태그. 브랜드·라이선스 상품에 붙습니다',
  yields: ['정품 인증 근거', '고유 일련번호'],
  required: false,
};

/**
 * 카테고리·상품명으로 찍어야 할 정보 사진 목록을 만든다.
 *
 * hasBrand는 브랜드 입력 여부다. 브랜드 상품은 쿠팡 정품 검증에서 구매·정품 증빙을
 * 요구받는 경우가 많아, 인증 택 촬영을 미리 안내한다.
 *
 * 카테고리가 비어 있으면 상품명만으로 판정한다 — PRO 업로드 화면에서는 카테고리를
 * 입력하지 않는 경우가 많다.
 */
export function infoShotsFor(category: string, productName: string, hasBrand = false): InfoShot[] {
  const haystack = `${category} ${productName}`;
  const out: InfoShot[] = [];

  for (const rule of RULES) {
    if (!rule.keywords.some((k) => haystack.includes(k))) continue;
    for (const s of rule.shots) {
      // 카테고리 규칙이 겹칠 수 있다(의류+패브릭). subject로 중복을 접는다.
      if (!out.some((x) => x.subject === s.subject)) out.push(s);
    }
  }

  // 카테고리를 못 알아본 경우에도 최소한의 안내는 한다.
  // 빈 화면보다 "표시사항을 찍으세요" 한 줄이 낫다.
  if (out.length === 0) {
    out.push({
      subject: '제품 표시사항 라벨',
      where: '제품 또는 포장의 표시사항 스티커·라벨',
      yields: ['소재·성분', '제조국', '제조사·수입자'],
      required: true,
    });
  }

  if (hasBrand && !out.some((x) => x.subject === BRAND_SHOT.subject)) out.push(BRAND_SHOT);
  out.push(...COMMON_SHOTS);
  return out;
}

/** 폰으로 보며 촬영할 텍스트 체크리스트 */
export function serializeInfoShotChecklist(shots: InfoShot[]): string {
  if (shots.length === 0) return '촬영할 정보 사진이 없습니다.';
  const lines: string[] = ['📋 정보 사진 촬영 가이드', ''];
  lines.push('상세페이지에 실릴 사진이 아니라, 상세페이지의 재료가 되는 사진입니다.');
  lines.push('이 사진들에서 소재·원산지·정가·판매 포인트가 나옵니다.', '');
  shots.forEach((s, i) => {
    lines.push(`## ${i + 1}. ${s.subject}${s.required ? '  ⭐ 필수' : ''}`);
    lines.push(`- [ ] 위치: ${s.where}`);
    lines.push(`- 얻는 것: ${s.yields.join(' · ')}`);
    lines.push('');
  });
  lines.push('— 촬영 팁 —');
  lines.push('· 글자가 읽힐 만큼 가까이. 흐리면 아무것도 못 얻습니다');
  lines.push('· 라벨을 펴서 평평하게. 접힌 채로 찍으면 글자가 왜곡됩니다');
  lines.push('· 밝은 곳에서. 그림자가 글자를 덮지 않게');
  return lines.join('\n');
}
