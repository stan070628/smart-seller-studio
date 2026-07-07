'use client';

import React, { useSyncExternalStore } from 'react';

type ToastKind = 'success' | 'error';
interface ToastItem { id: number; kind: ToastKind; message: string; }

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() { for (const l of listeners) l(); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
function getSnapshot() { return items; }

function push(kind: ToastKind, message: string) {
  const id = nextId++;
  items = [...items, { id, kind, message }];
  emit();
  setTimeout(() => { items = items.filter((t) => t.id !== id); emit(); }, 3500);
}

export const toast = {
  success: (message: string) => push('success', message),
  error: (message: string) => push('error', message),
};

export function Toaster() {
  const list = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return (
    <div style={{ position: 'fixed', bottom: 24, left: 24, zIndex: 10000, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {list.map((t) => (
        <div
          key={t.id}
          onClick={() => { items = items.filter((x) => x.id !== t.id); emit(); }}
          style={{
            background: t.kind === 'success' ? '#16a34a' : '#dc2626',
            color: '#fff', padding: '10px 16px', borderRadius: 10, fontSize: 13,
            boxShadow: '0 4px 16px rgba(0,0,0,0.2)', cursor: 'pointer',
            maxWidth: 360, whiteSpace: 'pre-line',
          }}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
