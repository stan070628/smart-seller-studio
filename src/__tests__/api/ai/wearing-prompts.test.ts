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
  it('MODEL_KO는 성별 두 키를 갖는다', () => {
    expect(Object.keys(MODEL_KO).sort()).toEqual(['female', 'male']);
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
    // route.ts:512-514 — wearing은 compositeProductPng가 없어 claudePrompt를 쓰고,
    // SCENE_PROMPT_SYSTEM(58행)이 그 프롬프트를 이 지시로 끝내라고 요구한다.
    // 여기서 또 붙이면 같은 문단이 두 번 들어간다.
    const out = buildWearingInstruction({ faceVisible: true, gender: 'male' });
    expect(out).not.toContain(PRODUCT_FIDELITY_INSTRUCTION);
  });
});
