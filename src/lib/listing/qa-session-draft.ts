// src/lib/listing/qa-session-draft.ts
import type { QuestionAnswer } from '@/lib/conversational-detail/types';

const TTL_MS = 24 * 60 * 60 * 1000;

interface QASessionRecord {
  answers: QuestionAnswer[];
  savedAt: number;
}

function makeKey(productName: string): string {
  return `qa_session_${productName.slice(0, 30).replace(/\s+/g, '_')}`;
}

export function saveQASession(productName: string, answers: QuestionAnswer[]): void {
  if (typeof localStorage === 'undefined') return;
  const record: QASessionRecord = { answers, savedAt: Date.now() };
  try {
    localStorage.setItem(makeKey(productName), JSON.stringify(record));
  } catch {
    // localStorage 용량 초과 등 무시
  }
}

export function loadQASession(productName: string): QuestionAnswer[] | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(makeKey(productName));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.savedAt !== 'number' ||
      !Array.isArray(parsed.answers)
    ) {
      localStorage.removeItem(makeKey(productName));
      return null;
    }
    const record = parsed as QASessionRecord;
    if (Date.now() - record.savedAt > TTL_MS) {
      localStorage.removeItem(makeKey(productName));
      return null;
    }
    return record.answers;
  } catch {
    return null;
  }
}

export function clearQASession(productName: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(makeKey(productName));
  } catch {
    // 무시
  }
}
