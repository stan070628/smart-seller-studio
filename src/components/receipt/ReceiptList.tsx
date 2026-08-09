'use client';

/**
 * 영수증 초안 목록 + 촬영 업로드
 *
 * 판독 중인 초안이 하나라도 있으면 주기적으로 다시 조회한다.
 * cron이 10분 주기라 대기가 길 수 있으므로 상태를 계속 보여준다.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { Badge, Progress } from '@/lib/receipt/view';

export interface DraftCard {
  id: string;
  purchased_at: string | null;
  store_name: string | null;
  receipt_total: number | null;
  image_count: number;
  created_at: string;
  badge: Badge;
  progress: Progress;
}

/** cron이 10분 주기이므로 초 단위 폴링은 대부분 헛돈다 */
const POLL_MS = 20_000;

const TONE: Record<string, { bg: string; fg: string }> = {
  ok: { bg: '#e7f6ec', fg: '#1a7f37' },
  warn: { bg: '#fff4e5', fg: '#b45309' },
  danger: { bg: '#fdecec', fg: '#b91c1c' },
  neutral: { bg: '#eef0f2', fg: '#4b5563' },
};

function won(n: number | null) {
  return n == null ? '—' : `${n.toLocaleString('ko-KR')}원`;
}

export default function ReceiptList() {
  const router = useRouter();
  const [drafts, setDrafts] = useState<DraftCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/receipts?status=draft');
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? '조회 실패');
      setDrafts(json.data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '조회 실패');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // 판독 대기·판독 중이 있을 때만 폴링한다
  const busy = drafts.some((d) => d.badge.busy);
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => { void load(); }, POLL_MS);
    return () => clearInterval(t);
  }, [busy, load]);

  const upload = useCallback(async (files: FileList) => {
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append('files', f));
      const res = await fetch('/api/receipts', { method: 'POST', body: fd });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? '업로드 실패');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '업로드 실패');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }, [load]);

  return (
    <div style={{ padding: '16px' }}>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        aria-label="영수증 이미지"
        style={{ display: 'none' }}
        onChange={(e) => { if (e.target.files?.length) void upload(e.target.files); }}
      />

      <button
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        style={{
          width: '100%', height: '56px', borderRadius: '12px', border: 'none',
          backgroundColor: uploading ? '#9ca3af' : '#1a7f37', color: '#fff',
          fontSize: '16px', fontWeight: 700, marginBottom: '16px',
        }}
      >
        {uploading ? '업로드 중…' : '영수증 촬영'}
      </button>

      {error && (
        <div
          role="alert"
          style={{
            padding: '12px', borderRadius: '8px', backgroundColor: '#fdecec',
            color: '#b91c1c', fontSize: '13px', marginBottom: '12px',
          }}
        >{error}</div>
      )}

      {loading && <div style={{ color: '#374151', fontSize: '14px' }}>불러오는 중…</div>}

      {!loading && drafts.length === 0 && (
        <div style={{ textAlign: 'center', color: '#374151', fontSize: '14px', padding: '48px 0' }}>
          대기 중인 영수증이 없습니다.<br />장을 보고 오면 여기에 쌓입니다.
        </div>
      )}

      {drafts.map((d) => {
        const tone = TONE[d.badge.tone] ?? TONE.neutral;
        return (
          <div
            key={d.id}
            role="button"
            tabIndex={0}
            onClick={() => router.push(`/m/receipt/${d.id}`)}
            onKeyDown={(e) => { if (e.key === 'Enter') router.push(`/m/receipt/${d.id}`); }}
            style={{
              backgroundColor: '#fff', borderRadius: '12px', padding: '14px',
              marginBottom: '10px', border: '1px solid #e5e7eb', cursor: 'pointer',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '15px', fontWeight: 700, color: '#111827' }}>
                {d.purchased_at ? String(d.purchased_at).slice(0, 10) : '날짜 미확인'}
              </span>
              <span style={{
                fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '999px',
                backgroundColor: tone.bg, color: tone.fg,
              }}>{d.badge.label}</span>
            </div>

            <div style={{ marginTop: '6px', fontSize: '13px', color: '#374151' }}>
              {d.store_name ?? '매장 미확인'} · {won(d.receipt_total)} · 사진 {d.image_count}장
            </div>

            {d.progress.total > 0 && (
              <div style={{ marginTop: '8px', fontSize: '12px', color: '#374151' }}>
                품목 {d.progress.total} · 확정 {d.progress.confirmed}
                {d.progress.ready > 0 && (
                  <span style={{ color: '#1a7f37', fontWeight: 700 }}> · 확정 대기 {d.progress.ready}</span>
                )}
                {d.progress.undecided > 0 && (
                  <span style={{ color: '#b45309', fontWeight: 700 }}> · 미정 {d.progress.undecided}</span>
                )}
                {d.progress.blocked > 0 && (
                  <span style={{ color: '#b91c1c', fontWeight: 700 }}> · 상품 미지정 {d.progress.blocked}</span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
