'use client';

import React, { useSyncExternalStore } from 'react';

interface ConfirmOptions { message: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean; }
interface PendingConfirm extends ConfirmOptions { id: number; resolve: (v: boolean) => void; }

let pending: PendingConfirm | null = null;
let nextId = 1;
const listeners = new Set<() => void>();

function emit() { for (const l of listeners) l(); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
function getSnapshot() { return pending; }

export function confirmDialog(opts: string | ConfirmOptions): Promise<boolean> {
  const options: ConfirmOptions = typeof opts === 'string' ? { message: opts } : opts;
  return new Promise<boolean>((resolve) => {
    pending = { id: nextId++, ...options, resolve };
    emit();
  });
}

function close(result: boolean) {
  const p = pending;
  pending = null;
  emit();
  p?.resolve(result);
}

export function ConfirmHost() {
  const p = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (!p) return null;
  return (
    <div
      onClick={() => close(false)}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: '20px 24px', maxWidth: 360, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
        <div style={{ fontSize: 14, color: '#18181b', whiteSpace: 'pre-line', marginBottom: 16 }}>{p.message}</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={() => close(false)} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #e4e4e7', background: '#fff', fontSize: 13, cursor: 'pointer', color: '#3f3f46' }}>{p.cancelLabel ?? '취소'}</button>
          <button onClick={() => close(true)} style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: p.danger ? '#dc2626' : '#2563eb', color: '#fff', fontSize: 13, cursor: 'pointer' }}>{p.confirmLabel ?? '확인'}</button>
        </div>
      </div>
    </div>
  );
}
