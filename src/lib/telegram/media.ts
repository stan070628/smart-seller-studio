/**
 * 텔레그램으로 들어온 미디어를 Supabase Storage에 보관한다.
 *
 * 이 봇은 원래 소싱 키워드 파이프라인 전용이라 텍스트가 아닌 메시지를 전부 버렸다.
 * 참고용 영상을 던져 두고 나중에 열어보려는 용도가 생겨 미디어 분기를 얹었다.
 */
import { downloadTelegramFile, getTelegramFilePath, sendTelegramMessage } from './client';
import { uploadToStorage } from '@/lib/supabase/server';

/** Bot API 다운로드 상한 (20MB). 초과하면 getFile이 거부한다. */
export const TELEGRAM_DOWNLOAD_LIMIT = 20 * 1024 * 1024;

export type TelegramMediaKind = 'video' | 'animation' | 'video_note' | 'document' | 'photo';

export interface TelegramMedia {
  kind: TelegramMediaKind;
  fileId: string;
  fileUniqueId: string;
  mimeType: string;
  fileSize: number | null;
  fileName: string | null;
}

type Dict = Record<string, unknown>;

function asDict(v: unknown): Dict | null {
  return v && typeof v === 'object' ? (v as Dict) : null;
}

function str(d: Dict, k: string): string | null {
  const v = d[k];
  return typeof v === 'string' ? v : null;
}

function num(d: Dict, k: string): number | null {
  const v = d[k];
  return typeof v === 'number' ? v : null;
}

/** kind별 기본 MIME — 텔레그램이 mime_type을 생략하는 경우가 있다. */
const DEFAULT_MIME: Record<TelegramMediaKind, string> = {
  video: 'video/mp4',
  animation: 'video/mp4',
  video_note: 'video/mp4',
  document: 'application/octet-stream',
  photo: 'image/jpeg',
};

/**
 * 메시지에서 저장할 미디어 하나를 고른다. 없으면 null.
 *
 * 우선순위는 video → animation → video_note → document → photo다.
 * photo는 PhotoSize 배열이라 가장 큰 것을 고른다.
 */
export function extractMedia(message: unknown): TelegramMedia | null {
  const msg = asDict(message);
  if (!msg) return null;

  for (const kind of ['video', 'animation', 'video_note', 'document'] as const) {
    const m = asDict(msg[kind]);
    if (!m) continue;
    const fileId = str(m, 'file_id');
    const fileUniqueId = str(m, 'file_unique_id');
    if (!fileId || !fileUniqueId) continue;
    return {
      kind,
      fileId,
      fileUniqueId,
      mimeType: str(m, 'mime_type') ?? DEFAULT_MIME[kind],
      fileSize: num(m, 'file_size'),
      fileName: str(m, 'file_name'),
    };
  }

  const photos = Array.isArray(msg.photo) ? msg.photo : null;
  if (photos && photos.length > 0) {
    // PhotoSize 배열은 작은 것부터 오지만 순서를 신뢰하지 않고 넓이로 고른다.
    let best: Dict | null = null;
    let bestArea = -1;
    for (const p of photos) {
      const d = asDict(p);
      if (!d) continue;
      const area = (num(d, 'width') ?? 0) * (num(d, 'height') ?? 0);
      if (area > bestArea) {
        best = d;
        bestArea = area;
      }
    }
    const fileId = best ? str(best, 'file_id') : null;
    const fileUniqueId = best ? str(best, 'file_unique_id') : null;
    if (best && fileId && fileUniqueId) {
      return {
        kind: 'photo',
        fileId,
        fileUniqueId,
        mimeType: DEFAULT_MIME.photo,
        fileSize: num(best, 'file_size'),
        fileName: null,
      };
    }
  }

  return null;
}

const MIME_EXT: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** 확장자는 MIME을 먼저 믿고, 없으면 파일명에서 가져온다. */
export function resolveExtension(media: TelegramMedia): string {
  const byMime = MIME_EXT[media.mimeType.toLowerCase()];
  if (byMime) return byMime;
  const name = media.fileName ?? '';
  const dot = name.lastIndexOf('.');
  if (dot > 0 && dot < name.length - 1) {
    const ext = name.slice(dot + 1).toLowerCase();
    if (/^[a-z0-9]{1,5}$/.test(ext)) return ext;
  }
  return media.kind === 'photo' ? 'jpg' : 'bin';
}

/**
 * 저장 경로. 날짜로 나누고 file_unique_id를 붙여 같은 파일의 중복 저장을 막는다.
 * uploadToStorage는 upsert: false라 같은 파일을 두 번 보내면 업로드가 거부되는데,
 * 그것이 의도한 동작이다 — 같은 영상은 한 번만 남는다.
 */
export function buildStoragePath(media: TelegramMedia, now: Date): string {
  const day = now.toISOString().slice(0, 10);
  return `telegram/${day}/${media.fileUniqueId}.${resolveExtension(media)}`;
}

function humanSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/**
 * 미디어를 내려받아 Storage에 넣고 결과를 채팅으로 알린다.
 * 실패해도 예외를 밖으로 던지지 않는다 — 웹훅은 이미 200을 반환한 뒤다.
 */
export async function saveTelegramMedia(media: TelegramMedia, chatId: string, now = new Date()): Promise<void> {
  if (media.fileSize !== null && media.fileSize > TELEGRAM_DOWNLOAD_LIMIT) {
    await sendTelegramMessage(
      chatId,
      `파일이 ${humanSize(media.fileSize)}라 봇으로는 받을 수 없습니다. ` +
        `텔레그램 봇 API의 다운로드 상한이 20MB입니다. 잘라서 보내거나 링크로 주세요.`,
    );
    return;
  }

  try {
    const filePath = await getTelegramFilePath(media.fileId);
    const buffer = await downloadTelegramFile(filePath);
    const storagePath = buildStoragePath(media, now);
    const result = await uploadToStorage(storagePath, buffer, media.mimeType, buffer.byteLength);
    await sendTelegramMessage(
      chatId,
      `${media.kind} 저장 완료 (${humanSize(buffer.byteLength)})\n${result.url}`,
    );
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error(`[telegram] 미디어 저장 실패: ${reason}`);
    await sendTelegramMessage(chatId, `저장 실패: ${reason}`);
  }
}
