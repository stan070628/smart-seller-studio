---
name: 상세페이지 이미지 잘림 금지
description: 상품 상세페이지 첫 이미지(히어로)를 포함한 모든 이미지는 잘림 없이 전체를 표시해야 한다
type: feedback
---

상세페이지의 모든 상품 이미지는 `width:100%; height:auto; display:block`으로 표시한다. `object-fit:cover`나 고정 높이(min-height, height)로 이미지를 강제 크롭하지 않는다.

**Why:** 히어로 섹션에서 `position:absolute; object-fit:cover`를 썼더니 상품 이미지 상하가 잘리는 현상이 발생했다. 상품 상세페이지는 이미지 전체가 보여야 구매 결정에 도움이 된다.

**How to apply:** `html-builder.ts`의 `buildHeroSection` 및 `buildGallerySection` 등 이미지를 렌더링하는 모든 섹션에서 이미지 크롭 스타일 사용 금지. 헤드라인/서브헤드라인 텍스트는 이미지 위에 오버레이하지 않고 이미지 아래 별도 영역에 배치한다.
