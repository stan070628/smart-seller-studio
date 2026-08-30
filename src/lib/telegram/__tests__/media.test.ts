// @vitest-environment node

import { describe, it, expect } from 'vitest';
import { extractMedia, resolveExtension, buildStoragePath } from '../media';

const VIDEO = {
  video: {
    file_id: 'AgADvideo',
    file_unique_id: 'uniq-video',
    width: 720,
    height: 1280,
    duration: 12,
    mime_type: 'video/mp4',
    file_size: 3_145_728,
  },
};

describe('extractMedia', () => {
  it('영상 메시지에서 file_id와 MIME을 뽑는다', () => {
    const m = extractMedia(VIDEO);
    expect(m).toMatchObject({ kind: 'video', fileId: 'AgADvideo', mimeType: 'video/mp4', fileSize: 3_145_728 });
  });

  it('텍스트만 있는 메시지는 null을 준다 — 기존 키워드 파이프라인을 건드리지 않기 위해서다', () => {
    expect(extractMedia({ text: '무선 선풍기', chat: { id: 1 } })).toBeNull();
  });

  it('mime_type이 없으면 종류별 기본값을 쓴다', () => {
    const m = extractMedia({ video: { file_id: 'a', file_unique_id: 'b' } });
    expect(m?.mimeType).toBe('video/mp4');
  });

  it('영상과 사진이 함께 오면 영상을 고른다', () => {
    const m = extractMedia({ ...VIDEO, photo: [{ file_id: 'p', file_unique_id: 'q', width: 90, height: 90 }] });
    expect(m?.kind).toBe('video');
  });

  it('사진은 배열에서 가장 큰 것을 고른다 — 순서를 신뢰하지 않는다', () => {
    const m = extractMedia({
      photo: [
        { file_id: 'big', file_unique_id: 'u-big', width: 1280, height: 1280 },
        { file_id: 'small', file_unique_id: 'u-small', width: 90, height: 90 },
      ],
    });
    expect(m?.fileId).toBe('big');
  });

  it('영상으로 보낸 document도 받는다', () => {
    const m = extractMedia({
      document: { file_id: 'd', file_unique_id: 'u', file_name: 'ref.mov', mime_type: 'video/quicktime' },
    });
    expect(m).toMatchObject({ kind: 'document', mimeType: 'video/quicktime' });
  });

  it('메시지가 아닌 값에도 터지지 않는다', () => {
    expect(extractMedia(null)).toBeNull();
    expect(extractMedia('문자열')).toBeNull();
    expect(extractMedia({ video: 'not-an-object' })).toBeNull();
  });
});

describe('resolveExtension', () => {
  const base = { kind: 'document' as const, fileId: 'a', fileUniqueId: 'b', fileSize: null, fileName: null };

  it('MIME을 먼저 믿는다', () => {
    expect(resolveExtension({ ...base, mimeType: 'video/quicktime' })).toBe('mov');
  });

  it('MIME을 모르면 파일명 확장자를 쓴다', () => {
    expect(resolveExtension({ ...base, mimeType: 'application/octet-stream', fileName: 'clip.webm' })).toBe('webm');
  });

  it('둘 다 없으면 bin으로 떨어진다', () => {
    expect(resolveExtension({ ...base, mimeType: 'application/octet-stream' })).toBe('bin');
  });
});

describe('buildStoragePath', () => {
  it('날짜 폴더와 file_unique_id로 경로를 만든다', () => {
    const media = extractMedia(VIDEO)!;
    expect(buildStoragePath(media, new Date('2026-08-30T12:00:00Z'))).toBe('telegram/2026-08-30/uniq-video.mp4');
  });

  it('같은 파일은 같은 경로가 나온다 — 중복 저장을 upsert:false가 막는다', () => {
    const media = extractMedia(VIDEO)!;
    const now = new Date('2026-08-30T12:00:00Z');
    expect(buildStoragePath(media, now)).toBe(buildStoragePath(media, now));
  });
});
