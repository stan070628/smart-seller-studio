---
name: 상세페이지에 가격 정보 금지
description: AI 상품 상세페이지 생성/수정 시 가격 정보를 절대 포함하지 않는다
type: feedback
---

상세페이지 HTML 생성 및 수정 시 가격 정보(판매가, 정상가, 할인가, 할인율 등)를 절대 포함하지 않는다.

**Why:** 가격은 쿠팡/네이버 각 마켓 등록 폼에서 별도로 입력하는 항목이다. 상세페이지에 가격이 들어가면 마켓별로 다른 판매가를 운영할 때 정보가 불일치하고, 가격 변경 시마다 상세페이지를 다시 만들어야 하는 문제가 생긴다.

**How to apply:** `generate-detail-html`, `edit-detail-html` API의 system prompt와 user prompt에서 가격 관련 내용 제거. `buildDetailPageUserPrompt`에 price 파라미터 전달 금지. 앞으로 상세페이지 관련 프롬프트를 수정할 때 가격 항목이 들어가지 않도록 주의.
