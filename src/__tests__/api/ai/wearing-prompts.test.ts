import { describe, it, expect } from 'vitest';
import {
  MODEL_KO,
  MODEL_CONTEXT,
  COLOR_ACCURACY,
  POSE_STATIC,
  PERSON_QUALITY,
  PRODUCT_FIDELITY_INSTRUCTION,
} from '@/app/api/ai/generate-scene-image/prompts';

describe('인물 프롬프트 상수', () => {
  it('MODEL_KO의 두 성별 서술 모두 피부톤과 체형을 명시한다', () => {
    // 타입 시스템이 이미 강제하는 "키가 male/female 두 개"보다,
    // 35장 생성 과정에서 필요하다고 확인된 속성(피부톤·체형 명시)을 검사한다 —
    // 이 속성은 타입으로 표현되지 않아 런타임 검사가 아니면 회귀를 못 잡는다.
    for (const desc of Object.values(MODEL_KO)) {
      expect(desc).toContain('skin tone');
      expect(desc).toContain('build');
    }
  });

  it('MODEL_CONTEXT에 중국·서양 카탈로그 배제 문구가 있다', () => {
    // "Korean"만으로는 범아시아 평균으로 수렴한다 — 이 부정문이 핵심
    expect(MODEL_CONTEXT).toContain('not a Western or Chinese catalog');
  });

  it('COLOR_ACCURACY에 골든아워 금지가 있다', () => {
    // 골든아워가 화이트 민소매를 살구색으로 만든 것을 막는다
    expect(COLOR_ACCURACY).toContain('NOT golden hour');
  });

  it('POSE_STATIC에 동적 포즈 금지가 있다', () => {
    // 달리기·점프에서 손이 뭉개진다
    expect(POSE_STATIC).toContain('NO running');
  });
});

describe('PERSON_QUALITY (조건절)', () => {
  it('"If a person appears"로 시작해 인물 등장을 강제하지 않는다', () => {
    expect(PERSON_QUALITY.startsWith('If a person appears')).toBe(true);
  });

  it('성별을 뒤에서 덮어쓰지 않고 male/female 서술을 나란히 제시한다', () => {
    // 실물 검증에서 뒤쪽 덮어쓰기(예: "The person is a Korean man...")가
    // 앞서 쓴 성별 묘사를 이기지 못했다 — 그래서 Claude가 씬에 맞게 고르도록
    // 두 서술을 함께 준다.
    expect(PERSON_QUALITY).toContain(MODEL_KO.male);
    expect(PERSON_QUALITY).toContain(MODEL_KO.female);
  });

  it('MODEL_CONTEXT·POSE_STATIC·COLOR_ACCURACY를 모두 포함한다', () => {
    expect(PERSON_QUALITY).toContain(MODEL_CONTEXT);
    expect(PERSON_QUALITY).toContain(POSE_STATIC);
    expect(PERSON_QUALITY).toContain(COLOR_ACCURACY);
  });
});

describe('PRODUCT_FIDELITY_INSTRUCTION', () => {
  it('PERSON_QUALITY를 포함한다 — Claude 프롬프트 끝에 반드시 붙으므로, 인물 조건절이 ' +
    '이 상수 하나에 있으면 storyboard 직결 경로(Claude 우회)에서도 Gemini에 도달한다', () => {
    expect(PRODUCT_FIDELITY_INSTRUCTION).toContain(PERSON_QUALITY);
  });

  it('제품 개수·단일 프레임·스파클 금지 등 기존 지시를 그대로 유지한다', () => {
    expect(PRODUCT_FIDELITY_INSTRUCTION).toContain('EXACTLY the same quantity');
    expect(PRODUCT_FIDELITY_INSTRUCTION).toContain('SINGLE FRAME ONLY');
    expect(PRODUCT_FIDELITY_INSTRUCTION).toContain('NO SPARKLE MARKS');
  });

  it('조립 결과가 프롬프트 원문과 일치한다 (문구 변경 시 스냅샷을 갱신하며 실물 재검증)', () => {
    expect(PRODUCT_FIDELITY_INSTRUCTION).toMatchInlineSnapshot(`"Using the attached product image(s) as a visual reference, study the product's overall shape, proportions, color palette, material texture, and key design details, then render it as a new photorealistic image naturally integrated in the scene. The product rendition should faithfully capture the reference's essential visual characteristics (form, color scheme, distinctive features) as an independent creative work — not a direct reproduction of the original photograph. IMPORTANT: Use EXACTLY the same quantity of items as shown in the reference image — do not add more items, do not duplicate products. SINGLE FRAME ONLY: Generate exactly one single continuous photograph — no split panels, diptychs, multi-view layouts, before/after comparisons, or composite image compositions. NO SPARKLE MARKS: Do NOT render any four-pointed star, sparkle, glitter, or diamond glyph anywhere in the image — not on the garment, product surface, or background. If such a mark appears in the reference image, treat it as an artifact and omit it. POSITIVE SUBJECT: If a person appears, they must look confident, comfortable, and at ease — relaxed or lightly positive expression, upright active posture. No grimacing, exhaustion, hunching over, hands on knees, slumping, distress, or discomfort. They must be Korean — either a Korean man in his late twenties with a clean modern Korean haircut — softly layered, natural black hair, fair even skin tone, slim build, or a Korean woman in her late twenties with long straight black hair, natural dewy Korean makeup, fair even skin tone, slim build — whichever matches the scene and the product's likely wearer. Styled like a Korean lifestyle magazine editorial shot in Seoul, not a Western or Chinese catalog. POSE CONSTRAINTS: both arms stay BELOW shoulder height — never raised, never overhead. Hands hang naturally relaxed with open fingers or rest in pockets — never clenched into fists. The person stands, leans or walks slowly — NO running, NO jumping, NO mid-action motion. COLOR ACCURACY IS CRITICAL: neutral daylight with accurate white balance. The product's color must match the reference image exactly — a white item renders as pure white. NOT golden hour, NOT sunset, NOT warm color cast."`);
  });
});
