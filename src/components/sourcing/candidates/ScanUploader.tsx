'use client';

import { useCallback, useEffect, useState } from 'react';
import { prepareCaptures } from '@/lib/sourcing-candidates/prepare-capture';

interface Props {
  label: string;
  hint: string;
  /** 준비된 JPEG 조각을 받아 업로드·판독까지 한다. 반환 문장은 완료 메시지 */
  onFiles: (files: File[]) => Promise<string>;
  /** 페이지 전체 붙여넣기를 받을지 (한 화면에 업로더가 여럿이면 하나만 true) */
  listenPaste?: boolean;
}

/**
 * 캡처 입력. 전체 페이지 캡처는 prepareCaptures가 빈칸을 잘라 조각낸다.
 * 여러 장을 한 번에 올리면 올린 순서가 순위 순서다.
 */
export default function ScanUploader({ label, hint, onFiles, listenPaste = false }: Props) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const handle = useCallback(async (input: File[]) => {
    const images = input.filter((f) => f.type.startsWith('image/'));
    if (images.length === 0 || busy) return;
    setBusy(true);
    setMsg({ ok: true, text: '캡처 준비 중…' });
    try {
      const prepared = await prepareCaptures(images);
      if (prepared.overBudget) throw new Error('용량이 커서 한 번에 못 보냅니다. 나눠서 올려 주세요.');
      setMsg({ ok: true, text: `조각 ${prepared.files.length}개 판독 중… (1~2분 걸릴 수 있습니다)` });
      setMsg({ ok: true, text: await onFiles(prepared.files) });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : '실패' });
    } finally {
      setBusy(false);
    }
  }, [busy, onFiles]);

  useEffect(() => {
    if (!listenPaste) return;
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length) { e.preventDefault(); void handle(files); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [handle, listenPaste]);

  return (
    <label
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); void handle(Array.from(e.dataTransfer.files)); }}
      className={`block cursor-pointer rounded-lg border-2 border-dashed p-4 text-sm ${busy ? 'border-blue-300 bg-blue-50' : 'border-gray-300 hover:border-gray-400'}`}
    >
      <input type="file" accept="image/*" multiple className="hidden" disabled={busy}
        onChange={(e) => { void handle(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
      <div className="font-medium">{label}</div>
      <div className="text-gray-500">{hint}</div>
      {msg && <div className={`mt-2 ${msg.ok ? 'text-gray-700' : 'text-red-600'}`}>{msg.text}</div>}
    </label>
  );
}
