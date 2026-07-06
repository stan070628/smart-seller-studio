# 썸네일 참조 이미지: 워터마크 제거 + 쿠팡 변환 다운로드

## 배경

썸네일 탭의 참조 이미지 영역(`DetailMakerThumbnailPanel`)에는 현재 "한자" 버튼(중국어 제거)만 있다.
상세페이지 탭은 "한자" + "WM" 두 버튼을 모두 제공하는 것과 달리 썸네일 탭은 WM이 빠져 있다.
또한 1688 등 사입 참조 이미지를 쿠팡 썸네일 규격(1200×1200, 흰 배경, 92% fill)으로 즉시 변환·다운로드하는
기능이 없어, 셀러가 포토샵 등 별도 도구를 써야 하는 불편이 있다.

## 목표

1. 썸네일 참조 이미지에 워터마크 제거("WM") 버튼 추가
2. 썸네일 참조 이미지에 쿠팡 규격 변환 + 미리보기 + 다운로드 기능 추가

## 범위 외

- AI 썸네일 생성 플로우 변경 없음
- 상세페이지 탭 변경 없음
- 일괄 다운로드(ZIP) 없음 (이번 스코프 아님)

---

## 설계

### 1. 공유 유틸 추출

**`src/lib/image/coupang-policy.ts`** (신규)

`edit-thumbnail/route.ts`의 `enforceCoupangPolicy(buffer: Buffer): Promise<Buffer>` 함수를
이 파일로 이동한다. `edit-thumbnail/route.ts`는 여기서 re-import.

스펙:
- 입력: Sharp 가 처리 가능한 이미지 Buffer
- 출력: 1200×1200, 흰 배경, 상품 92% fill, JPEG q92 Buffer
- 내부: trim(threshold 12) → 긴 변 기준 스케일 → 흰 캔버스 중앙 합성

### 2. 신규 API 라우트

**`src/app/api/image/coupang-convert/route.ts`**

```
POST /api/image/coupang-convert
Body: { imageUrl: string }
Response: 
  200 - Content-Type: image/jpeg, binary body (다운로드용)
  400 - { error: string }
  500 - { error: string }
```

구현:
1. `imageUrl` 유효성 검사
2. fetch로 이미지 다운로드 (타임아웃 10s)
3. `enforceCoupangPolicy(buffer)` 실행
4. `new Response(jpegBuffer, { headers: { 'Content-Type': 'image/jpeg' } })` 반환

Supabase Storage에 저장하지 않음 — 순수 변환 후 binary 반환으로 빠름.

### 3. UI 변경 (`DetailMakerThumbnailPanel.tsx`)

#### 새 state

```typescript
const [watermarkExtraIdx, setWatermarkExtraIdx] = useState<number | null>(null); // WM 모달
const [coupangConvertIdx, setCoupangConvertIdx] = useState<number | null>(null);  // 변환 중 인덱스
const [coupangPreview, setCoupangPreview] = useState<{ idx: number; blobUrl: string } | null>(null); // 미리보기
```

#### 이미지 카드당 버튼 3개

| 버튼 | 현재 | 변경 후 |
|------|------|---------|
| 삭제 | ✅ | ✅ |
| 한자 | ✅ | ✅ |
| WM   | ❌ | ✅ 추가 |
| 쿠팡 | ❌ | ✅ 추가 |

버튼 배치: 카드 하단에 2행 구성
- 1행: "한자" | "WM"
- 2행: "쿠팡 변환" (full width or center)

#### WM 버튼 동작

```tsx
<button onClick={() => setWatermarkExtraIdx(idx)}>WM</button>
{watermarkExtraIdx === idx && (
  <ImageCleanupModal
    imageUrl={url}
    mode="watermark"
    onReplace={newUrl => { onReplaceExtraRef?.(idx, newUrl); setWatermarkExtraIdx(null); }}
    onAdd={newUrl => { onAddExtraRef?.(newUrl); setWatermarkExtraIdx(null); }}
    onClose={() => setWatermarkExtraIdx(null)}
    canAdd={true}
  />
)}
```

#### 쿠팡 변환 버튼 동작

1. 클릭 → `setCoupangConvertIdx(idx)` (로딩 표시)
2. `POST /api/image/coupang-convert` 호출
3. 응답 blob → `URL.createObjectURL(blob)` → `setCoupangPreview({ idx, blobUrl })`
4. 미리보기 모달 표시

#### 미리보기 모달 (인라인)

```tsx
{coupangPreview && (
  <div style={overlayStyle}>
    <div style={modalStyle}>
      <h3>쿠팡 썸네일 변환 결과</h3>
      <p style={{ fontSize: 11, color: '#6b7280' }}>1200 × 1200px · 흰 배경 · 상품 92% fill</p>
      <img src={coupangPreview.blobUrl} style={{ width: 240, height: 240, objectFit: 'contain' }} />
      <div style={{ display: 'flex', gap: 8 }}>
        <a href={coupangPreview.blobUrl} download="thumbnail-coupang.jpg">
          <button>다운로드</button>
        </a>
        <button onClick={() => {
          URL.revokeObjectURL(coupangPreview.blobUrl);
          setCoupangPreview(null);
        }}>닫기</button>
      </div>
    </div>
  </div>
)}
```

---

## 파일 변경 목록

| 파일 | 변경 유형 |
|------|----------|
| `src/lib/image/coupang-policy.ts` | 신규 생성 |
| `src/app/api/image/coupang-convert/route.ts` | 신규 생성 |
| `src/app/api/ai/edit-thumbnail/route.ts` | `enforceCoupangPolicy` → import로 교체 |
| `src/components/listing/detail-maker/DetailMakerThumbnailPanel.tsx` | WM 버튼 + 쿠팡 버튼 + 미리보기 추가 |

---

## 검증

1. 썸네일 참조 이미지 업로드 후 "WM" 버튼 클릭 → ImageCleanupModal 열림 확인
2. 워터마크가 있는 이미지에서 영역 드래그 → 제거 결과 확인
3. "쿠팡 변환" 버튼 클릭 → 로딩 표시 → 미리보기 모달 열림 확인
4. 미리보기 이미지가 1200×1200, 흰 배경인지 확인
5. 다운로드 버튼 클릭 → `thumbnail-coupang.jpg` 파일 저장 확인
6. `edit-thumbnail/route.ts` 기존 AI 썸네일 생성 흐름 회귀 없음 확인
