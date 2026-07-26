import { describe, it, expect } from 'vitest';
import {
  MODEL_KO,
  MODEL_CONTEXT,
  FACE_VISIBLE,
  FACE_CROPPED,
  COLOR_ACCURACY,
  POSE_STATIC,
  PRODUCT_FIDELITY_INSTRUCTION,
  buildWearingInstruction,
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

  it('FACE_VISIBLE과 FACE_CROPPED는 서로 배타적인 지시다', () => {
    expect(FACE_VISIBLE).toContain('PORTRAIT');
    expect(FACE_CROPPED).toContain('COMPLETELY OUTSIDE the frame');
  });
});

describe('buildWearingInstruction', () => {
  it('얼굴 보이는 컷에 FACE_VISIBLE이 들어간다', () => {
    const out = buildWearingInstruction({ faceVisible: true, gender: 'male' });
    expect(out).toContain(FACE_VISIBLE);
    expect(out).not.toContain(FACE_CROPPED);
  });

  it('크롭 컷에 FACE_CROPPED가 들어간다', () => {
    const out = buildWearingInstruction({ faceVisible: false, gender: 'male' });
    expect(out).toContain(FACE_CROPPED);
    expect(out).not.toContain(FACE_VISIBLE);
  });

  it('성별에 맞는 모델 서술만 들어간다', () => {
    const m = buildWearingInstruction({ faceVisible: true, gender: 'male' });
    const f = buildWearingInstruction({ faceVisible: true, gender: 'female' });
    expect(m).toContain(MODEL_KO.male);
    expect(m).not.toContain(MODEL_KO.female);
    expect(f).toContain(MODEL_KO.female);
    expect(f).not.toContain(MODEL_KO.male);
  });

  it('색 보존·포즈 제약·모델 맥락은 항상 포함된다', () => {
    for (const faceVisible of [true, false]) {
      for (const gender of ['male', 'female'] as const) {
        const out = buildWearingInstruction({ faceVisible, gender });
        expect(out).toContain(COLOR_ACCURACY);
        expect(out).toContain(POSE_STATIC);
        expect(out).toContain(MODEL_CONTEXT);
      }
    }
  });

  it('성별이 없으면 male을 기본으로 쓴다', () => {
    expect(buildWearingInstruction({ faceVisible: true })).toContain(MODEL_KO.male);
  });

  it('PRODUCT_FIDELITY_INSTRUCTION을 포함하지 않는다', () => {
    // wearing은 COMPOSITE_SECTIONS에 없어 compositeProductPng가 null이 되고,
    // route.ts의 `compositeProductPng ? bgPrompt : claudePrompt` 분기에서 claudePrompt를 쓴다.
    // SCENE_PROMPT_SYSTEM의 `MUST end with this exact instruction` 규칙이
    // 그 프롬프트를 이 지시로 끝내게 만들므로, 여기서 또 붙이면 같은 문단이 두 번 들어간다.
    const out = buildWearingInstruction({ faceVisible: true, gender: 'male' });
    expect(out).not.toContain(PRODUCT_FIDELITY_INSTRUCTION);
  });

  it('조립 결과가 프롬프트 원문과 일치한다 (문구 변경 시 스냅샷을 갱신하며 실물 재검증)', () => {
    expect(buildWearingInstruction({ faceVisible: true, gender: 'female' })).toMatchInlineSnapshot(`"The person is a Korean woman in her late twenties with long straight black hair, natural dewy Korean makeup, fair even skin tone, slim build. Styled like a Korean lifestyle magazine editorial shot in Seoul, not a Western or Chinese catalog. A candid lifestyle PORTRAIT — this is a photo OF THE PERSON, not a product shot. The head and face occupy the upper third of the frame, eyes meeting the camera, an easy natural smile. Waist-up composition. POSE CONSTRAINTS: both arms stay BELOW shoulder height — never raised, never overhead. Hands hang naturally relaxed with open fingers or rest in pockets — never clenched into fists. The person stands, leans or walks slowly — NO running, NO jumping, NO mid-action motion. COLOR ACCURACY IS CRITICAL: neutral daylight with accurate white balance. The garment's color must match the reference image exactly — a white garment renders as pure white. NOT golden hour, NOT sunset, NOT warm color cast."`);
    expect(buildWearingInstruction({ faceVisible: false, gender: 'male' })).toMatchInlineSnapshot(`"The person is a Korean man in his late twenties with a clean modern Korean haircut — softly layered, natural black hair, fair even skin tone, slim build. Styled like a Korean lifestyle magazine editorial shot in Seoul, not a Western or Chinese catalog. FRAMING IS CRITICAL: the frame starts at the collarbone and ends at the hips — the head and face are COMPLETELY OUTSIDE the frame, not visible at all. POSE CONSTRAINTS: both arms stay BELOW shoulder height — never raised, never overhead. Hands hang naturally relaxed with open fingers or rest in pockets — never clenched into fists. The person stands, leans or walks slowly — NO running, NO jumping, NO mid-action motion. COLOR ACCURACY IS CRITICAL: neutral daylight with accurate white balance. The garment's color must match the reference image exactly — a white garment renders as pure white. NOT golden hour, NOT sunset, NOT warm color cast."`);
  });

  it('조각이 앞 조각 끝에 공백 하나로 이어진다', () => {
    // 범용 구두점 정규식(/[.,][^\s]/, /[a-z][A-Z]/)은 "e.g.,"·"1,000" 같은
    // 이 파일의 기존 문체(buildNoProductSuffix, SECTION_BG_HINTS.lifestyle)에서
    // 오탐한다. 모든 조각이 '.'로 끝나므로 각 조각 시작 직전 두 글자가 정확히
    // '. '인지만 확인하면 조각 내용과 무관하게 붙음·중복 공백을 잡을 수 있다.
    for (const faceVisible of [true, false]) {
      for (const gender of ['male', 'female'] as const) {
        const out = buildWearingInstruction({ faceVisible, gender });
        for (const frag of [MODEL_CONTEXT, faceVisible ? FACE_VISIBLE : FACE_CROPPED, POSE_STATIC, COLOR_ACCURACY]) {
          const i = out.indexOf(frag);
          expect(i).toBeGreaterThan(0); // 조각이 온전히 들어있다
          expect(out.slice(i - 2, i)).toBe('. '); // 마침표 + 공백 하나(이중 공백·붙음 모두 배제)
        }
      }
    }
  });
});
