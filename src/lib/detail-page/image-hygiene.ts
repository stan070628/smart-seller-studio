/**
 * 이미지-카피 정합성 점검. 조립 시점(클라이언트)에서 쓴다.
 *
 * 생성 단계의 layout-validator는 imageSlots의 imageRef만 볼 수 있어서 여기서 다루는
 * 두 문제를 잡지 못한다. imageRef가 같아도 flux_lifestyle·detail_closeup 슬롯은 서로
 * 다른 AI 씬으로 채워지므로 "같은 ref = 재탕"이 아니고, 씬 생성 실패 시 원본으로
 * 대체되는 것도 런타임에만 알 수 있다. 최종 URL이 정해진 뒤라야 판정이 성립한다.
 */

// ── 0. 섹션 수 상한 (예방) ────────────────────────────────────────────────

/**
 * 사진 수에 맞춘 섹션 수 상한.
 *
 * 아래 findReusedImages가 재탕을 사후에 알린다면, 이건 애초에 재탕이 생기지 않게
 * 막는 쪽이다. 사진 N장이면 AI 연출 씬을 더해도 서로 다른 컷은 대략 N+2장이 한계인데,
 * 그보다 섹션이 많으면 남는 섹션이 앞에서 쓴 사진을 다시 크게 쓰게 된다(사진 3장으로
 * 9섹션을 만든 실제 사례에서 세 장이 각각 3회씩 반복됐다).
 *
 * 하한 6은 서사 아크가 성립하는 최소치다 — hook·compare·assure가 필수라 그 아래로
 * 내리면 필수 비트끼리 한 섹션을 다투게 된다.
 */
export function sectionCap(imageCount: number): number {
  return Math.min(10, Math.max(6, imageCount * 2));
}

// ── 1. 접사 주장 ──────────────────────────────────────────────────────────

/**
 * "이 사진은 접사다"라고 주장하는 표현. detail_closeup 슬롯이 생성 실패로 원본
 * 전체컷으로 대체되면 이 문장들이 거짓이 된다(실제로 "같은 조명에서 촬영한
 * 접사입니다" 밑에 전체컷이 붙은 사례가 있었다).
 *
 * 좁게 잡는다. "자세히", "꼼꼼히" 같은 일반어까지 넣으면 멀쩡한 카피를 지운다.
 */
const CLOSEUP_MARKERS = /접사|클로즈업|확대컷|확대해서|확대하면|가까이서|가까이 보면|가까이 보시면/;

export function hasCloseupClaim(text: string): boolean {
  return typeof text === 'string' && CLOSEUP_MARKERS.test(text);
}

/**
 * "이 사진에 사람이 있다"고 주장하는 표현. model_wearing 슬롯이 생성 실패로 원본
 * 제품컷으로 대체되면 이 문장들이 거짓이 된다(접사 주장과 같은 문제, 같은 메커니즘).
 *
 * 좁게 잡는다. "착용"만으로 잡으면 "착용 후 세탁하세요" 같은 멀쩡한 안내를 지운다 —
 * 사진에 인물이 있다는 주장으로 읽히는 형태만 대상이다.
 */
const WEARING_MARKERS = /모델이|착용한 모습|착용컷|입은 모습|입고 있는|들고 있는|사용하는 모습/;

export function hasWearingClaim(text: string): boolean {
  return typeof text === 'string' && WEARING_MARKERS.test(text);
}

/** 마침표 기준으로 자른 뒤, isClaim이 참인 문장만 뺀다. 나머지 문장은 보존한다. */
function dropClaimSentences(text: string, isClaim: (t: string) => boolean): string {
  const parts = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim() !== '');
  const kept = parts.filter((s) => !isClaim(s));
  return kept.join(' ').trim();
}

export interface CloseupStripResult {
  blocks: unknown[];
  /** 제거한 문장·항목 수 */
  removed: number;
  /** heading에 남은 접사 주장. 헤드라인은 자동으로 지우지 않는다 — 섹션이 무너진다. */
  headingClaims: string[];
}

export interface StripOpts {
  /** model_wearing 슬롯이 있던 섹션이면 true — 착용 주장도 함께 제거한다 */
  wearing?: boolean;
}

/**
 * 블록 트리에서 접사 주장을 제거한다. subtext는 해당 문장만, bullet_list는 해당
 * 항목만 뺀다. heading은 건드리지 않고 headingClaims로 보고한다 — 헤드라인을
 * 지우면 섹션에 제목이 없어지므로 셀러가 직접 고치는 편이 낫다.
 *
 * opts.wearing이 true면 착용 주장(hasWearingClaim)도 같은 방식으로 제거한다 —
 * model_wearing 슬롯이 생성 실패로 원본 제품컷으로 대체된 섹션에서 쓴다.
 * 옵션 없이 호출하면(하위 호환) 접사 주장만 대상이다.
 */
export function stripCloseupClaims(blocks: unknown, opts?: StripOpts): CloseupStripResult {
  let removed = 0;
  const headingClaims: string[] = [];
  const isClaim = (t: string) =>
    hasCloseupClaim(t) || (opts?.wearing === true && hasWearingClaim(t));

  const walk = (list: unknown): unknown[] => {
    if (!Array.isArray(list)) return [];
    const out: unknown[] = [];
    for (const b of list) {
      if (!b || typeof b !== 'object') { out.push(b); continue; }
      const block = { ...(b as Record<string, unknown>) };

      if (block.type === 'heading' && typeof block.text === 'string' && isClaim(block.text)) {
        headingClaims.push(block.text);
      }

      if (block.type === 'subtext' && typeof block.text === 'string' && isClaim(block.text)) {
        const next = dropClaimSentences(block.text, isClaim);
        removed++;
        // 문장이 하나뿐이라 통째로 비면 블록 자체를 뺀다(빈 subtext는 여백만 남긴다).
        if (next === '') continue;
        block.text = next;
      }

      if (block.type === 'bullet_list' && Array.isArray(block.items)) {
        const items = (block.items as unknown[]).filter(
          (it) => !(typeof it === 'string' && isClaim(it)),
        );
        removed += (block.items as unknown[]).length - items.length;
        if (items.length === 0) continue;
        block.items = items;
      }

      if (Array.isArray(block.cols)) {
        block.cols = (block.cols as unknown[]).map(walk);
      }

      out.push(block);
    }
    return out;
  };

  return { blocks: walk(blocks), removed, headingClaims };
}

// ── 2. 대형 이미지 재탕 ────────────────────────────────────────────────────

export interface SectionImages {
  title: string;
  /** 이 섹션에 최종 배치된 이미지 URL들 */
  urls: string[];
}

export interface ReusedImage {
  url: string;
  /** 이 이미지를 쓴 섹션 제목들 (등장 순서) */
  sections: string[];
}

/**
 * 대형 슬롯에서 같은 사진이 2회 이상 쓰인 경우를 찾는다.
 *
 * 이미지가 정확히 1장인 섹션만 센다. 색상·구성 옵션 카드처럼 여러 장을 쓰는 섹션은
 * 카드 썸네일이라 같은 사진이 다른 섹션과 겹쳐도 눈에 거슬리지 않고, 애초에 옵션마다
 * 다른 사진을 쓰는 게 정상이라 여기서 셀 대상이 아니다. 대형 1장짜리 섹션에서만
 * "아까 본 사진이 또 나온다"가 문제가 된다.
 */
export function findReusedImages(sections: SectionImages[]): ReusedImage[] {
  const byUrl = new Map<string, string[]>();
  for (const sec of sections) {
    if (!Array.isArray(sec.urls) || sec.urls.length !== 1) continue;
    const url = sec.urls[0];
    if (!url) continue;
    const list = byUrl.get(url) ?? [];
    list.push(sec.title);
    byUrl.set(url, list);
  }
  const out: ReusedImage[] = [];
  for (const [url, titles] of byUrl) {
    if (titles.length >= 2) out.push({ url, sections: titles });
  }
  return out;
}

// ── 3. 셀러용 문구 ─────────────────────────────────────────────────────────

export function imageHygieneWarnings(opts: {
  reused: ReusedImage[];
  /** 씬 생성에 실패해 원본 사진으로 대체된 섹션 수 */
  fallbackSections: number;
  /** 접사 주장 제거 수 */
  strippedClaims: number;
  /** 자동으로 지우지 못한 heading 접사 주장 */
  headingClaims: string[];
}): string[] {
  const out: string[] = [];

  if (opts.reused.length > 0) {
    const detail = opts.reused
      .map((r) => `"${r.sections.join('", "')}"`)
      .join(' / ');
    out.push(
      `같은 사진이 여러 섹션에 크게 반복됩니다: ${detail}. ` +
      `사진을 추가하면 섹션마다 다른 컷이 들어갑니다.`,
    );
  }

  if (opts.fallbackSections > 0) {
    const tail = opts.strippedClaims > 0
      ? ` 사진과 맞지 않는 '접사' 표현 ${opts.strippedClaims}곳은 자동으로 제거했습니다.`
      : '';
    out.push(
      `연출 컷 생성에 실패해 ${opts.fallbackSections}개 섹션이 원본 사진으로 대체됐습니다.${tail}`,
    );
  }

  if (opts.headingClaims.length > 0) {
    out.push(
      `제목에 남은 접사 표현은 자동으로 고치지 않았습니다: ${opts.headingClaims.map((h) => `"${h}"`).join(', ')}. ` +
      `사진과 맞지 않으면 에디터에서 직접 수정해주세요.`,
    );
  }

  return out;
}
