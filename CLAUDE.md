@AGENTS.md

## gstack

Web browsing은 항상 `/browse` 스킬을 사용한다. `mcp__claude-in-chrome__*` 도구는 절대 사용하지 않는다.

사용 가능한 스킬:
/office-hours, /plan-ceo-review, /plan-eng-review, /plan-design-review, /design-consultation, /design-shotgun, /design-html, /review, /ship, /land-and-deploy, /canary, /benchmark, /browse, /connect-chrome, /qa, /qa-only, /design-review, /setup-browser-cookies, /setup-deploy, /retro, /investigate, /document-release, /codex, /cso, /autoplan, /plan-devex-review, /devex-review, /careful, /freeze, /guard, /unfreeze, /gstack-upgrade, /learn

## 에이전트 라우팅

다음 키워드가 포함된 요청은 해당 에이전트를 사용한다:

- "쿠팡 보고서", "광고 보고서", "성과 보고서", "광고 분석", "성과 분석" → `coupang-report` 에이전트
