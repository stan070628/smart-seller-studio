# 스펙: 썸네일/상세 만들기 탭 4가지 버그 수정

**날짜**: 2026-05-25  
**범위**: AssetsTab 워크플로우 전반  
**관련 이슈**: 이미지 미반영 / 소스 버튼 미표시(이미 수정) / 개별 저장 / NOTICE 가로 배치

---

## 배경

"썸네일/상세 만들기" 탭(AssetsTab)에서 4가지 UX 버그가 발견됐다.

1. 상세페이지용으로 업로드한 이미지가 DetailPageEditor 섹션에 연결되지 않아, 생성 후 편집기에서 이미지가 보이지 않는다.
2. 섹션 이미지 추가 시 "소스" 버튼이 표시되지 않아 로컬 폴더만 열렸다 — 이미 수정 완료(commit `6e0bfcf`).
3. 업로드 입력 슬롯의 개별 이미지에 다운로드 버튼이 없다.
4. 상세페이지 하단 NOTICE / RETURN / PRIVACY 3개 이미지가 세로로 쌓여 화면을 과도하게 점유한다.

---

## 이슈 1 — 상세페이지용 이미지가 섹션에 미연결

### 근본 원인

`AssetsTab.tsx`의 `handleGenerate()`는 `assetsDraft.detailFiles` URL 배열을
`/api/ai/generate-detail-html`로 전달해 HTML을 올바르게 생성한다.  
그러나 `contentToSections(detailContent)` 결과로 생성되는 모든 섹션은
`attachedImages: []`로 초기화된다.  
`detailPageSections.length > 0`이면 `AssetsResultPanel`은 iframe 대신
`DetailPageEditor`를 렌더링하는데, 섹션에 이미지가 없으므로 편집기에서 이미지가 보이지 않는다.

### 수정 방법

`AssetsTab.tsx` — `handleGenerate()`, 업로드 모드 분기(라인 102~135):

`contentToSections` 호출 후 `assetsDraft.detailFiles`(없으면 `thumbnailFiles` 폴백) URL들을
`AttachedImage[]`로 변환해 **첫 번째 섹션**의 `attachedImages`에 할당한다.

```typescript
// contentToSections 호출 직후
if (detailPageSections.length > 0) {
  const sourcesToAttach = detailSources; // detailFiles or thumbnailFiles
  detailPageSections = detailPageSections.map((s, idx) =>
    idx === 0
      ? {
          ...s,
          attachedImages: sourcesToAttach.map((url, order) => ({
            url,
            order,
            processingMode: 'original' as const,
          })),
        }
      : s,
  );
}
```

- 첫 번째 섹션(보통 hero)에 모든 업로드 이미지를 연결.
- 사용자는 이후 섹션별로 소스 픽커를 통해 이미지를 추가/교체 가능.
- 기존 URL 모드(`assetsDraft.mode === 'url'`)에도 동일한 패턴 적용(해당 분기 내).

**수정 파일**: `src/components/listing/assets/AssetsTab.tsx`

---

## 이슈 2 — 소스 버튼 미표시 (이미 수정 완료)

`SectionImageAttachment.tsx` 라인 79–84에서 `sourceImages` 빌드 시
`assetsDraft.thumbnailFiles`, `assetsDraft.detailFiles`, `assetsDraft.generatedThumbnails`
추가 완료. (commit `6e0bfcf`, 2026-05-25)

---

## 이슈 3 — 개별 이미지 저장 버튼 없음

### 현재 상태

- `AssetsResultPanel`: 생성된 썸네일마다 "다운로드" 버튼 존재 (라인 413-424).
  단, `position:absolute` 소형 버튼이라 사용자가 인지하기 어려움.
- `AssetsInputPanel`: 업로드 슬롯 이미지마다 ×(삭제), 🪄(AI편집), 🔗(URL복사)만 있고
  다운로드 버튼이 없음.

### 수정 방법

**`AssetsInputPanel.tsx` — `renderSlot` 이미지 카드**:

기존 `🔗` URL 복사 버튼 아래에 `↓` 다운로드 버튼을 추가한다.
버튼 위치: `bottom: 2, right: 22` (기존 🔗 버튼 왼쪽).

```typescript
// renderSlot 컴포넌트 내부에 handleDownload 헬퍼 추가
const handleDownloadSlotImage = async (url: string, index: number) => {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const ext = blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'jpg';
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = `image-${index + 1}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(objUrl);
  } catch {
    window.open(url, '_blank'); // CORS 실패 시 새 탭으로 fallback
  }
};
```

버튼은 기존 `🔗` 버튼 왼쪽(`right: 22`)에 동일한 스타일로 추가 (`↓` 텍스트).

> `AssetsResultPanel.handleDownloadOne`과 동일한 fetch→Blob→ObjectURL 패턴 사용.
> 함수는 `renderSlot` 바깥 컴포넌트 스코프에 선언해 재사용.

**수정 파일**: `src/components/listing/assets/AssetsInputPanel.tsx`

---

## 이슈 4 — NOTICE / RETURN / PRIVACY 가로 배치

### 현재 코드

`src/lib/detail-page-privacy.ts`:
```typescript
export const PRIVACY_FOOTER_HTML = FIXED_IMAGES.map(
  (src) =>
    `<div style="max-width:780px;margin:0 auto;line-height:0;">
       <img src="${src}" alt="" style="width:100%;display:block;" />
     </div>`,
).join('\n');
```
→ 3개 `<div>`가 블록 레벨로 세로 스택.

### 수정 후

```typescript
export const PRIVACY_FOOTER_HTML =
  `<div style="max-width:780px;margin:0 auto;display:flex;gap:0;line-height:0;">` +
  FIXED_IMAGES.map(
    (src) =>
      `<div style="flex:1;min-width:0;"><img src="${src}" alt="" style="width:100%;display:block;" /></div>`,
  ).join('') +
  `</div>`;
```

- 3개 이미지가 1:1:1 비율로 가로 배치.
- `max-width:780px` 컨테이너 유지.
- `gap:0`으로 이미지 사이 틈 없음.
- `line-height:0`으로 이미지 하단 여백 제거.

**수정 파일**: `src/lib/detail-page-privacy.ts`

---

## 검증 시나리오

1. **이슈 1**: "상세페이지용 이미지"에 2장 이상 업로드 → "자동 생성" → DetailPageEditor 첫 번째 섹션에 이미지 표시 확인
2. **이슈 2**: 위 시나리오 후 섹션 카드에서 "소스" 버튼 클릭 → 업로드 이미지 목록 표시 확인 (이미 수정)
3. **이슈 3**: 업로드 슬롯 이미지 hover → ↓ 버튼 표시 → 클릭 시 새 탭 오픈 또는 다운로드 확인
4. **이슈 4**: 자동 생성 결과 HTML 하단 → NOTICE/RETURN/PRIVACY 3장이 1줄 가로 배치 확인; ZIP 다운로드 후 HTML 파일 열어서도 확인
