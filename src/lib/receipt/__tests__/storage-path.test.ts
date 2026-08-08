import { describe, it, expect } from 'vitest';
import { receiptImagePath } from '@/lib/receipt/storage-path';

describe('receiptImagePath', () => {
  const uid = '11111111-2222-3333-4444-555555555555';
  const did = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

  it('user·draft uuid와 순번으로 경로를 만든다', () => {
    expect(receiptImagePath(uid, did, 0, 'image/jpeg')).toBe(
      `receipts/${uid}/${did}/0.jpg`,
    );
  });

  it('png는 확장자가 png다', () => {
    expect(receiptImagePath(uid, did, 1, 'image/png')).toBe(
      `receipts/${uid}/${did}/1.png`,
    );
  });

  it('webp는 확장자가 webp다', () => {
    expect(receiptImagePath(uid, did, 2, 'image/webp')).toBe(
      `receipts/${uid}/${did}/2.webp`,
    );
  });

  it('draft uuid가 경로에 들어간다 — 추측 불가능성의 근거', () => {
    const path = receiptImagePath(uid, did, 0, 'image/jpeg');
    expect(path).toContain(did);
  });

  it('순번이 음수면 예외를 던진다', () => {
    expect(() => receiptImagePath(uid, did, -1, 'image/jpeg')).toThrow('index');
  });
});
