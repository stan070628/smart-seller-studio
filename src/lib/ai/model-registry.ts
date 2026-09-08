// src/lib/ai/model-registry.ts
/**
 * AI 모델(인물) 레지스트리 — 캐릭터 시트로 인물을 고정한다.
 *
 * 문제: 씬 생성이 섹션마다 독립 호출이라 한 상세페이지 안에서도 컷마다
 * 다른 사람이 나왔다. prompts.ts의 PERSON_QUALITY는 표정·자세만 지정하고
 * 그 사람이 누구인지는 지정하지 않기 때문이다.
 *
 * 해법: 한 인물의 정면·반측면·옆모습을 한 장에 담은 캐릭터 시트를 만들어
 * 두고, 인물이 필요한 모든 생성에 그 시트를 참조로 붙인다.
 *
 * 🔵 2026-08-27 실측으로 확인했다. 같은 씬 3종을 시트 참조 있음/없음으로
 * 각각 생성한 결과, 시트를 붙인 쪽은 세 컷의 인물이 동일했고 텍스트 설명만
 * 준 쪽은 세 컷이 전부 다른 사람이었다.
 *
 * 🔴 시트를 새로 만들 때는 generateFrameImage(imagen.ts)를 쓸 수 없다.
 * 그 함수의 singleFrameConstraint가 multi-view/collage를 절대 금지하는데
 * 캐릭터 시트는 정의상 multi-view다. 생성 스크립트는
 * `모델 페르소나/_scripts/charsheet2.mjs`에 있다.
 */

export type ModelSex = 'female' | 'male';

/**
 * 캐릭터 프로필 — 외모 프리셋에 정체성을 얹는다.
 *
 * MODEL_PERSONAS는 원래 얼굴만 고정했다. 유튜브 채널을 운영하려면 그 인물이
 * 누구인지가 필요하고, 그것이 영상 자막·카피의 말투까지 정한다.
 * 선택 필드인 이유는 5명 중 굴다부터 채우기 때문이다 — 나머지는 프리셋으로
 * 계속 동작해야 한다.
 */
export interface CharacterProfile {
  /** 이름 */
  name: string;
  /** 직함 — 채널 안에서의 위치 */
  title: string;
  /** 나이대 */
  ageBand: string;
  /** 한 줄 생활 배경 */
  setting: string;
  /** 말투 규칙 — buildCharacterVoice가 지시문으로 바꾼다 */
  voiceRules: string[];
  /** 금지 표현 */
  forbidden: string[];
}

export interface ModelPersona {
  /** 안정 식별자. Storage 파일명과 같아야 한다 */
  id: string;
  sex: ModelSex;
  /** UI에 보이는 이름 */
  label: string;
  /** 어떤 상품에 어울리는지 — 선택을 돕는 힌트 */
  bestFor: string;
  /** 캐릭터 시트 Storage 경로 (버킷 내부 경로). 얼굴 3뷰만 담는다 */
  sheetPath: string;
  /**
   * 얼굴 3뷰 + 전신을 한 장에 담은 합본 시트.
   *
   * 🔴 얼굴 시트만 주면 몸 비율 정보가 없어 씬마다 등신이 달라지고 다리가
   * 짧게 나온다(2026-08-31 굴다 c7 실측). 전신·상반신이 프레임에 들어오는
   * 컷에서는 이쪽을 참조로 준다. 없으면 sheetPath로 물러난다.
   */
  combinedSheetPath?: string;
  /**
   * 전신 턴어라운드 — 정면·측면·후면 3뷰.
   *
   * 🔴 의류 착용컷 전용이다. 백프린트나 뒷 핏이 파는 요소인 상품에서 후면 참조가
   * 없으면 AI가 뒷모습을 지어낸다. 일반 lifestyle 컷에는 combinedSheetPath를 쓴다 —
   * 뷰가 많을수록 뷰당 픽셀이 줄어 얼굴 재현이 나빠지기 때문이다.
   */
  turnaroundSheetPath?: string;
  /** 캐릭터 프로필. 없으면 외모 프리셋으로만 쓴다 */
  character?: CharacterProfile;
}

const BUCKET_PUBLIC_PREFIX = '/storage/v1/object/public/smart-seller-studio/';

export const MODEL_PERSONAS: readonly ModelPersona[] = [
  {
    id: 'model_f_a',
    sex: 'female',
    label: '여성 A · 화사한 웨이브',
    bestFor: '생활용품·아동·캐주얼 의류 — 밝고 친근한 인상',
    sheetPath: 'model-sheets/model_f_a.jpg',
  },
  {
    id: 'model_f_b',
    sex: 'female',
    label: '여성 B · 청순 단정',
    bestFor: '뷰티·홈리빙·이너웨어 — 차분하고 단정한 인상',
    sheetPath: 'model-sheets/model_f_b.jpg',
  },
  {
    id: 'model_f_c',
    sex: 'female',
    label: '여성 C · 건강 발랄',
    bestFor: '스포츠·아웃도어·식품 — 생기 있는 인상',
    sheetPath: 'model-sheets/model_f_c.jpg',
    combinedSheetPath: 'model-sheets/model_f_c_combined.jpg',
    turnaroundSheetPath: 'model-sheets/model_f_c_turnaround.jpg',
    character: {
      name: '굴다',
      title: '발굴템 연구소 연구원',
      ageBand: '30대 초반',
      setting: '코스트코 단골. 집이 주 무대이고 장보기·살림·정리가 일상이다. 잘 사는 사람이 아니라 사고 나서 후회도 하는 사람이다',
      voiceRules: [
        '높임말 구어체로 말한다 — ~잖아요, ~더라고요, ~거든요, ~네요',
        '문장 끝에 마침표를 찍지 않는다',
        '실패담과 후회를 숨기지 않는다. 좋은 점만 말하면 추천이 믿기지 않는다',
        '같은 어미를 세 번 연속 반복하지 않는다',
      ],
      forbidden: [
        '~습니다 정중체 (딱딱해진다)',
        '반말',
        '과장 단정 — 최고예요, 무조건, 강추',
        '번역투 — 소리 내 읽어서 걸리면 다시 쓴다',
        '부정문 제목',
      ],
    },
  },
  {
    id: 'model_f_d',
    sex: 'female',
    label: '여성 D · 절제된 고급 (유하)',
    bestFor: '뷰티·주얼리·향수·프리미엄 의류 — 정제되고 값비싼 인상',
    sheetPath: 'model-sheets/model_f_d.jpg',
    combinedSheetPath: 'model-sheets/model_f_d_combined.jpg',
    // 뷰티·주얼리뿐 아니라 프리미엄 의류·아우터에도 쓰므로 후면 참조를 함께 갖췄다(2026-09-08).
    turnaroundSheetPath: 'model-sheets/model_f_d_turnaround.jpg',
    // 연구소의 세 번째 자리 — 굴다가 찾고, 유하가 가르고, 이루가 알린다.
    //
    // 🔴 굴다와 말투가 겹치면 두 사람을 둘 이유가 없다. 굴다는 실패담과 후회로 신뢰를
    // 만들고, 유하는 기준과 근거로 만든다. 굴다가 "저도 처음엔 속았거든요"라면
    // 유하는 "밑단 마감이 접혀 들어가 있어요"다 — 같은 물건을 다른 각도에서 말한다.
    //
    // 🔴 절제된 인상이라고 형용사를 늘리면 정반대가 된다. 「우아한·고급스러운·세련된」을
    // 근거 없이 붙이는 것을 금지에 넣은 이유다 — 고급은 수식어가 아니라 관찰에서 나온다.
    //
    // 🔴 어미는 세 화자가 배타적으로 나눠 갖는다 — 굴다 `~잖아요`(경험 공유) · 이루 `~예요`(발견
    // 전달) · 유하 `~어요`(관찰 서술). 2026-08-30 판정이 굴다·이루 두 명을 가르며 세운 규칙이고,
    // 유하가 셋째로 들어오며 같은 규칙을 적용했다. `__tests__/model-registry.test.ts`가 고정한다.
    //
    // 매체는 상세페이지 카피와 스레드·인스타다. 유튜브 화자는 이루이고 여기 끼지 않는다.
    character: {
      name: '유하',
      title: '발굴템 연구소 감식 담당',
      ageBand: '20대 후반',
      setting:
        '굴다가 찾아온 물건을 두고 「이건 값을 하는가」를 판정하는 자리다. ' +
        '만져보고 뜯어보고 값을 따져 본 뒤에야 말한다. 비싼 것과 좋은 것을 같은 말로 쓰지 않는다',
      voiceRules: [
        '높임말 구어체로 말한다 — ~어요, ~아요, ~고요. 관찰한 것을 그대로 서술한다. 굴다보다 문장이 짧고 담백하다',
        '문장 끝에 마침표를 찍지 않는다',
        '형용사를 줄이고 관찰한 것을 말한다 — 「정말 고급스러워요」가 아니라 「밑단 마감이 접혀 들어가 있어요」',
        '좋다고 말하기 전에 기준을 먼저 댄다. 무엇과 비교해서 좋은지가 없으면 광고다',
        '값이 비싼 것과 좋은 것을 구분해서 말한다. 비싸서 좋다고 하지 않는다',
        '감탄사로 띄우지 않는다. 조용히 말해도 근거가 있으면 읽힌다',
        '스레드·인스타에서는 후크를 첫 줄에 둔다. 완곡한 질문으로 시작하지 않는다',
        '같은 어미를 세 번 연속 반복하지 않는다',
      ],
      forbidden: [
        '~예요·~죠 — 이루의 어미다. 한 연구소의 세 사람이 같은 어미를 쓰면 구분되지 않는다',
        '~잖아요·~더라고요 — 굴다의 어미다',
        '근거 없는 감성 수식 — 우아한, 고급스러운, 세련된, 감각적인을 그냥 붙이기',
        '과장 단정 — 최고예요, 무조건, 강추, 인생템',
        '~습니다 정중체 (딱딱해진다)',
        '반말',
        '번역투 — 소리 내 읽어서 걸리면 다시 쓴다',
        '부정문 제목',
        '판매자 내부 사정을 본문에 쓰기 — 재고·마진·배송 사정은 독자의 관심사가 아니다',
        '앱·코드 내부 용어를 그대로 쓰기',
      ],
    },
  },
  {
    id: 'model_m_a',
    sex: 'male',
    label: '남성 A · 조각형 세련 (무진)',
    bestFor: '남성 의류·시계·가전 — 정통 캠페인 모델',
    sheetPath: 'model-sheets/model_m_a.jpg',
    combinedSheetPath: 'model-sheets/model_m_a_combined.jpg',
    // 의류 착용컷용. 이 페르소나는 의류가 주 용도라 턴어라운드를 먼저 갖췄다(2026-09-06).
    turnaroundSheetPath: 'model-sheets/model_m_a_turnaround.jpg',
  },
  {
    id: 'model_m_b',
    sex: 'male',
    label: '남성 B · 부드러운 미남',
    bestFor: '캐주얼·라이프스타일·2030 타깃 — 친근한 인상',
    sheetPath: 'model-sheets/model_m_b.jpg',
    combinedSheetPath: 'model-sheets/model_m_b_combined.jpg',
    turnaroundSheetPath: 'model-sheets/model_m_b_turnaround.jpg',
    // 유튜브 「발굴템 연구소」 진행자. 굴다와 소속은 같고 매체가 다르다 —
    // 굴다는 커머스 상세페이지의 인물컷, 알리는 유튜브 영상의 화자다.
    //
    // 🔴 얼굴은 내보내되 립싱크는 하지 않는다. 2026-08-30 아바타 판정이
    // 기각한 것은 토킹헤드이며 근거는 컷 속도였다(립싱크 3.6초 대 쇼츠 1.0초).
    // 입을 맞추지 않는 얼굴 컷은 그 제약에 걸리지 않는다.
    //
    // 🔴 브랜드 스토리 다큐(코스트코편 등)의 화자가 아니다. 그쪽은 인격 없는
    // 다큐 내레이션이고 어미가 ~습니다체이며 화면에 사람이 없다. 알리는 제품 설명과
    // AI 툴 소개 포맷의 화자이고 밝은 구어체를 쓴다. 두 톤을 섞지 않는다.
    character: {
      name: '이루',
      title: '「이루가 해봤어요」 진행자',
      ageBand: '20대 후반',
      setting:
        '연구소가 찾아낸 물건과 직접 만든 도구를 밖에 알리는 일을 한다. ' +
        '써보고 판단해서 권하고, 만든 것은 직접 시연해 보인다',
      voiceRules: [
        '높임말 구어체로 말한다 — ~예요, ~죠, ~거든요. 딱딱한 ~습니다체는 쓰지 않는다',
        '문장을 짧게 끊는다. 한 문장에 하나만 말한다',
        '질문을 던지고 바로 답한다 — 궁금증을 오래 끌지 않는다',
        '밝게 전하되 감탄사로 띄우지 않는다. 놀라움은 화자가 아니라 사실이 만든다',
        '숫자와 근거를 앞세운다',
        '어려운 말은 듣는 사람 어휘로 바꾼다. 바꿀 수 없으면 지운다',
        '문장 끝에 마침표를 찍지 않는다',
        '같은 어미를 세 번 연속 반복하지 않는다',
      ],
      forbidden: [
        '과장 단정 — 최고예요, 무조건, 강추, 놓치지 마세요',
        '안 써본 것을 써본 것처럼 말하기',
        '앱·코드 내부 용어를 그대로 쓰기 (MAX_REFERENCES, 립싱크, 컷 같은 것)',
        '반말',
        '번역투 — 소리 내 읽어서 걸리면 다시 쓴다',
        '다루는 브랜드를 깎아내리는 표현',
      ],
    },
  },
] as const;

export function findPersona(id: string | undefined | null): ModelPersona | null {
  if (!id) return null;
  return MODEL_PERSONAS.find((p) => p.id === id) ?? null;
}

/**
 * 캐릭터 시트의 공개 URL을 만든다.
 *
 * loadReferenceImages는 allowlist에 속한 호스트만 fetch하므로(SSRF 방어)
 * Supabase Storage URL이어야 서버가 받아올 수 있다. 환경변수가 없으면
 * null을 돌려주고, 호출부는 시트 없이 진행한다 — 인물이 안 고정될 뿐
 * 생성 자체가 실패하지는 않아야 한다.
 */
export function personaSheetUrl(
  persona: ModelPersona,
  opts?: { fullBody?: boolean; turnaround?: boolean },
): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  // 없는 시트를 요구하면 한 단계씩 물러난다 — 턴어라운드 → 합본 → 얼굴.
  // 체형이나 후면은 못 잡아도 인물은 고정되며, 시트가 없다고 생성이 실패해서는 안 된다.
  const objectPath =
    (opts?.turnaround && persona.turnaroundSheetPath) ||
    ((opts?.turnaround || opts?.fullBody) && persona.combinedSheetPath) ||
    persona.sheetPath;
  return `${base.replace(/\/$/, '')}${BUCKET_PUBLIC_PREFIX}${objectPath}`;
}

/**
 * 매 생성 요청에 반복해서 붙이는 인물 고정 지시.
 *
 * 시트를 참조로 넣는 것만으로는 부족하다. Gemini는 참조 이미지를 "분위기
 * 힌트"로 흘려버릴 수 있어, 그것이 캐스팅 사진이라는 것을 문장으로 못박아야
 * 한다. 영상(홍아린 AI, 2026-08-25)이 "이 두 줄이 핵심"이라고 지목한 부분이다.
 */
export const IDENTITY_LOCK_INSTRUCTION =
  'IDENTITY LOCK: The person in this scene MUST be the exact same individual shown in the attached ' +
  'character reference sheet — same face structure, same eyes, same nose, same lips, same jawline, ' +
  'same hairstyle, same hair length and color, same skin tone, same apparent age. Treat the reference ' +
  'sheet as a casting photo of the model being photographed here. Do not substitute a different person. ' +
  'Ignore the plain t-shirt and grey backdrop in the reference sheet — those are studio setup, not part ' +
  'of this scene.';

/**
 * 제품 고정 지시 — 인물 경로에서 제품이 AI 렌더가 될 때 로고를 지킨다.
 *
 * 🔴 이 상수는 PRODUCT_FIDELITY_INSTRUCTION(prompts.ts)을 상쇄하려고 존재한다.
 * 그쪽은 *"as an independent creative work — not a direct reproduction of the
 * original photograph"*라고 **원본과 다르게 그리라고** 지시하는데, 2026-06-06
 * 스펙이 저작권 회피를 근거로 넣은 문구다. 그 근거는 2026-07-06 합성 경로
 * 도입(원본 픽셀을 그대로 내보냄)으로 이미 무너졌으나 문구만 남아 있다.
 *
 * 🔵 2026-08-27 실측: 나이키 다저스 반팔티(로고 4종)로 착용컷을 생성한 결과
 * 이 지시를 붙이면 Dodgers 필기체 워드마크·가슴 스우시·™이 모두 재현됐다.
 * 다만 **하단 나이키·MLB 마크가 누락되는 경우가 있어 완전하지 않다** —
 * 브랜드 상품은 생성 후 로고를 확대해 검수해야 한다.
 *
 * 🔵 같은 날 확인한 태스크 구분: "이 사진을 보정하라"(변형)는 프린트를
 * 재배치해버리지만 "참조를 보고 새 씬을 그려라"(생성)는 참조를 지킨다.
 * 두 경로를 같은 위험으로 묶으면 안 된다.
 */
export const PRODUCT_LOCK_INSTRUCTION =
  'PRODUCT LOCK (this overrides any earlier instruction to render the product as an independent or ' +
  'non-reproduced creative work): The product MUST be the exact same item shown in the attached product ' +
  'reference photo(s). Reproduce every printed graphic exactly as in the references — the same wordmark ' +
  'with the same letterforms and script style, the same brand marks in the same positions and relative ' +
  'sizes, the same colors. Do NOT invent, restyle, re-letter, relocate, or omit any logo, lettering, or ' +
  'trademark symbol. Do NOT add any graphic that is absent from the references. The product may drape, ' +
  'fold, or catch light naturally, but the printed artwork itself must stay faithful to the references.';

/**
 * 캐릭터 말투 지시문 — 영상 자막·카피 생성에 붙인다.
 *
 * IDENTITY_LOCK_INSTRUCTION이 얼굴을 고정하듯 이 함수는 목소리를 고정한다.
 * 한국어 카피를 만드는 프롬프트에 들어가므로 지시문 자체도 한국어다.
 *
 * 규칙과 금지를 구획으로 나누는 이유: 한 덩어리로 주면 모델이 금지 표현을
 * 예시로 읽고 그대로 쓰는 경우가 있다.
 */
export function buildCharacterVoice(profile: CharacterProfile): string {
  const rules = profile.voiceRules.map((r) => `- ${r}`).join('\n');
  const bans = profile.forbidden.map((r) => `- ${r}`).join('\n');
  return [
    `화자는 ${profile.name}이며 ${profile.title}이다. ${profile.ageBand}이고, ${profile.setting}.`,
    '',
    '지켜야 할 말투:',
    rules,
    '',
    '아래 표현은 쓰지 않는다:',
    bans,
  ].join('\n');
}

/**
 * 페르소나 id로 말투 지시문을 만든다 — 프롬프트에 그대로 이어 붙이는 용도.
 *
 * buildCharacterVoice는 프로필을 요구하지만 호출부는 id만 갖고 있고, 프로필이
 * 없는 페르소나(3명)와 지정 안 함(null)도 정상 경로다. 그 셋을 호출부마다
 * 분기하면 같은 코드가 라우트 수만큼 늘어나므로 여기서 흡수한다.
 *
 * 화자가 없으면 빈 문자열을 돌려준다 — 프롬프트에 붙여도 아무 일이 없어야 한다.
 */
export function personaVoiceBlock(personaId: string | undefined | null): string {
  const profile = findPersona(personaId)?.character;
  if (!profile) return '';
  return `\n\n${buildCharacterVoice(profile)}`;
}
/**
 * 로컬 원본 시트 경로 — 스크립트 전용이다(서버는 Storage URL을 쓴다).
 *
 * 🔴 폴더명이 페르소나 id와 다르다. 캐릭터가 정해진 셋은 캐릭터명(`굴다`·`이루`·`무진`)이고
 * 나머지는 대문자 id다. **코드가 참조하는 것은 id이므로 매핑은 여기 한 곳에만 둔다** —
 * 스크립트마다 경로를 문자열로 박으면 폴더명을 바꿀 때 전부 깨진다(2026-09-06 실제로 겪었다).
 */
export const PERSONA_ROOT = '/Volumes/Mac_SSD/모델 페르소나';

const CHARACTER_FOLDER: Record<string, string> = {
  model_f_c: '굴다',
  model_f_d: '유하',
  model_m_b: '이루',
  // 무진은 의류 모델이라 CharacterProfile(말투·직함)이 없다 — 이름은 폴더를 찾기
  // 위한 것이고, 화자로 쓸 일이 생기면 그때 character를 채운다.
  model_m_a: '무진',
};

export function personaLocalDir(personaId: string): string {
  const folder =
    CHARACTER_FOLDER[personaId] ??
    personaId.replace(/_([a-z])_([a-z])$/, (_, a: string, b: string) => `_${a.toUpperCase()}_${b.toUpperCase()}`);
  return `${PERSONA_ROOT}/${folder}`;
}

/** kind: face=얼굴 3뷰 · body=전신 · combined=합본 */
export function personaLocalSheet(
  personaId: string,
  kind: 'face' | 'body' | 'combined' | 'turnaround' = 'face',
): string {
  const name =
    kind === 'face' ? '캐릭터시트.jpg'
    : kind === 'body' ? '전신시트.png'
    : kind === 'combined' ? '캐릭터시트_합본.jpg'
    : '전신턴어라운드.jpg';
  return `${personaLocalDir(personaId)}/${name}`;
}
