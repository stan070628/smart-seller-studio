'use client';

import React, { useState, useEffect } from 'react';
import { Play, Square, Trash2 } from 'lucide-react';
import { useImportQueue } from '@/hooks/useImportQueue';
import { useListingStore } from '@/store/useListingStore';
import DomeggookPreparePanel from '@/components/listing/DomeggookPreparePanel';
import type { BulkImportItem, ImportItemStatus } from '@/types/bulkImport';

const C = {
  bg: '#f9f9f9',
  card: '#ffffff',
  border: '#eeeeee',
  text: '#1a1c1c',
  textSub: '#71717a',
  accent: '#be0014',
  green: '#16a34a',
  yellow: '#d97706',
  red: '#dc2626',
};

const STATUS_LABEL: Record<ImportItemStatus, string> = {
  pending: '대기',
  processing: '처리 중...',
  ready: '완료',
  failed: '실패',
};

const STATUS_COLOR: Record<ImportItemStatus, string> = {
  pending: C.textSub,
  processing: C.yellow,
  ready: C.green,
  failed: C.red,
};

export default function BulkImportPanel() {
  const [rawInput, setRawInput] = useState('');
  const [initialized, setInitialized] = useState(false);
  const [registerItemNo, setRegisterItemNo] = useState<number | null>(null);
  const {
    items,
    isRunning,
    initQueue,
    startProcessing,
    stopProcessing,
    getItemNoForRegister,
    clearFailed,
    readyCount,
    failedCount,
  } = useImportQueue();

  const { pendingBulkItems, clearPendingBulkItems } = useListingStore();

  useEffect(() => {
    if (pendingBulkItems.length > 0) {
      const count = initQueue(pendingBulkItems.join('\n'));
      clearPendingBulkItems();
      if (count > 0) setInitialized(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleInit() {
    const count = initQueue(rawInput);
    if (count > 0) setInitialized(true);
  }

  return (
    <div style={{ padding: '24px 0' }}>
      {/* DomeggookPreparePanel 모달 */}
      {registerItemNo !== null && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ width: '100%', maxWidth: 720, maxHeight: '90vh', overflowY: 'auto', borderRadius: 12 }}>
            <DomeggookPreparePanel
              onClose={() => setRegisterItemNo(null)}
              onContinueToRegister={() => setRegisterItemNo(null)}
              initialItemNo={String(registerItemNo)}
            />
          </div>
        </div>
      )}

      {/* 입력 영역 */}
      {!initialized && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, marginBottom: 20 }}>
          <p style={{ fontSize: 13, color: C.textSub, margin: '0 0 12px' }}>
            도매꾹 상품번호 또는 URL을 한 줄에 하나씩 입력하세요 (최대 80개 권장)
          </p>
          <textarea
            value={rawInput}
            onChange={(e) => setRawInput(e.target.value)}
            placeholder={`12345678\n87654321\nhttps://www.domeggook.com/...goods_no=99999999`}
            rows={10}
            style={{
              width: '100%',
              padding: '10px 12px',
              fontSize: 13,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              resize: 'vertical',
              fontFamily: 'monospace',
              boxSizing: 'border-box',
            }}
          />
          <button
            onClick={handleInit}
            disabled={!rawInput.trim()}
            style={{
              marginTop: 12,
              padding: '9px 20px',
              fontSize: 13,
              fontWeight: 700,
              background: C.accent,
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              cursor: rawInput.trim() ? 'pointer' : 'not-allowed',
              opacity: rawInput.trim() ? 1 : 0.5,
            }}
          >
            상품 목록 불러오기
          </button>
        </div>
      )}

      {/* 컨트롤 바 */}
      {initialized && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: C.textSub }}>
            총 {items.length}개 · 처리완료 {readyCount}개 · 실패 {failedCount}개
          </span>
          <div style={{ flex: 1 }} />
          {!isRunning ? (
            <button
              onClick={startProcessing}
              disabled={items.every((it) => it.status !== 'pending')}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 16px', fontSize: 13, fontWeight: 700,
                background: C.accent, color: '#fff',
                border: 'none', borderRadius: 8, cursor: 'pointer',
              }}
            >
              <Play size={14} /> AI 처리 시작
            </button>
          ) : (
            <button
              onClick={stopProcessing}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 16px', fontSize: 13, fontWeight: 700,
                background: '#6b7280', color: '#fff',
                border: 'none', borderRadius: 8, cursor: 'pointer',
              }}
            >
              <Square size={14} /> 중지
            </button>
          )}
          {failedCount > 0 && (
            <button
              onClick={clearFailed}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 14px', fontSize: 12,
                background: C.bg, color: C.textSub,
                border: `1px solid ${C.border}`, borderRadius: 8, cursor: 'pointer',
              }}
            >
              <Trash2 size={13} /> 실패 항목 제거
            </button>
          )}
          <button
            onClick={() => { setInitialized(false); setRawInput(''); }}
            style={{
              padding: '8px 14px', fontSize: 12,
              background: C.bg, color: C.textSub,
              border: `1px solid ${C.border}`, borderRadius: 8, cursor: 'pointer',
            }}
          >
            새로 입력
          </button>
        </div>
      )}

      {/* 결과 테이블 */}
      {items.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f3f3f3', borderBottom: `1px solid ${C.border}` }}>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: C.textSub, width: 80 }}>상품번호</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: C.textSub }}>상품명</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600, color: C.textSub, width: 110 }}>추천가(네이버)</th>
                <th style={{ padding: '10px 16px', textAlign: 'center', fontWeight: 600, color: C.textSub, width: 90 }}>상태</th>
                <th style={{ padding: '10px 16px', textAlign: 'center', fontWeight: 600, color: C.textSub, width: 80 }}>액션</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <BulkItemRow
                  key={item.id}
                  item={item}
                  isEven={idx % 2 === 0}
                  onRegister={() => {
                    const no = getItemNoForRegister(item.id);
                    if (no) setRegisterItemNo(no);
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BulkItemRow({
  item,
  isEven,
  onRegister,
}: {
  item: BulkImportItem;
  isEven: boolean;
  onRegister: () => void;
}) {
  return (
    <tr style={{ background: isEven ? '#fff' : C.bg, borderTop: `1px solid ${C.border}` }}>
      <td style={{ padding: '10px 16px', color: C.textSub, fontFamily: 'monospace' }}>
        {item.itemNo}
      </td>
      <td style={{ padding: '10px 16px', color: C.text }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {item.thumbnailUrl && (
            <img
              src={item.thumbnailUrl}
              alt=""
              style={{ width: 36, height: 36, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }}
            />
          )}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 320 }}>
            {item.title ?? (item.status === 'pending' ? '—' : '처리 중...')}
          </span>
        </div>
        {item.errorMessage && (
          <div style={{ fontSize: 11, color: '#dc2626', marginTop: 2 }}>{item.errorMessage}</div>
        )}
      </td>
      <td style={{ padding: '10px 16px', textAlign: 'right', color: C.text }}>
        {item.recommendedPriceNaver ? item.recommendedPriceNaver.toLocaleString('ko-KR') + '원' : '—'}
      </td>
      <td style={{ padding: '10px 16px', textAlign: 'center' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: STATUS_COLOR[item.status] }}>
          {STATUS_LABEL[item.status]}
        </span>
      </td>
      <td style={{ padding: '10px 16px', textAlign: 'center' }}>
        {item.status === 'ready' && (
          <button
            onClick={onRegister}
            style={{
              padding: '5px 12px', fontSize: 12, fontWeight: 700,
              background: C.accent, color: '#fff',
              border: 'none', borderRadius: 6, cursor: 'pointer',
            }}
          >
            등록
          </button>
        )}
      </td>
    </tr>
  );
}
