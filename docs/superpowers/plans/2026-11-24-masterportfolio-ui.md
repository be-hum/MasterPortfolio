# mp ui (로컬 웹 UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 브라우저에서 결과 보기, 결정, 답변, 수정, 반영 실행을 하게 한다. 경험·성과 키워드로 카드를 한눈에 보이게 하고, 목차로 이동하게 한다.

**Architecture:**
- 경험 카드에 `keywords`, `outcome_keywords` 필드를 추가한다. 키워드 단계(`mp keywords`)를 새로 만든다.
- `mp review --apply-only` 모드를 추가한다.
- Node `http` 서버(`src/ui/server.ts`)가 JSON API를 제공하고, CLI 작업은 자식 프로세스로 실행한다.
- 단일 HTML 앱(`src/ui/app.ts`)은 live 모드(서버)와 static 모드(`master.html`)를 함께 지원한다.

**Tech Stack:** TypeScript, Node ≥22 (`node:http`, `node:child_process`), zod, vitest. 새 런타임 의존성은 없다.

**Spec:** `docs/superpowers/specs/2026-11-24-masterportfolio-design.md` §11.5 (+ §10.3, §11.1–11.4, §9.7–9.8)

## Global Constraints

- 실제 CLI를 실제 폴더나 에이전트에 대고 테스트하지 않는다. 테스트는 임시 폴더와 `test/fake-agent/fake-agent.ts`만 쓴다.
- LLM에 보내는 텍스트는 모두 `sanitize()`를 거친다. 답변 저장은 `recordAnswer`(마스킹)를 쓴다.
- 경험 카드 쓰기는 모두 `saveExperience`, `createExperience`, `acceptExperienceEdit`를 거친다(state.json 동시 저장). 편집된 카드에는 쓰지 않는다.
- 옛 카드(새 키 없음)도 읽혀야 한다. 새 배열 필드는 `.default([])`로 두고 `schema_version`은 1을 유지한다.
- 서버는 `127.0.0.1`에만 바인딩한다. 토큰과 Host를 검사하고 CORS 헤더는 내보내지 않는다. 경로 탈출을 거부한다.
- 사용자에게 보이는 문구는 한국어다. 외부 리소스(CDN·폰트)를 쓰지 않는다.
- 커밋 트레일러:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01V4yeGmzxT1ga3dyye63Gua`
- 검증: `npm test`, `npx tsc --noEmit`, `npm run build`.

## Review Focus

1. 다른 로컬 웹페이지가 API를 호출하는 경우(토큰 없음, Host 위조, DNS rebinding)는 모두 거부해야 한다.
2. `/files/` 경로 탈출(`../`, 인코딩된 `%2e%2e`, 절대경로)은 거부하고, .md가 아니거나 허용 폴더 밖이면 404를 반환해야 한다.
3. 작업 실행 중에 또 실행하면 409다. 자식 프로세스가 비정상 종료하면 code를 기록하고 running을 false로 바꿔야 한다.
4. 바깥에서 편집된 카드에 API로 쓰면 409이고 파일이 그대로여야 한다.
5. 키워드 단계 응답이 형식에 안 맞으면(배열 아님, 너무 긴 문자열, 모르는 id) 해당 항목만 버리거나 잘라야 한다.

---

### Task 1: 키워드 필드·키워드 단계·`mp keywords`·`review --apply-only`

**Files:**
- Modify: `src/core/schema.ts`, `src/analyzer/group.ts`, `src/analyzer/reviewApply.ts`, `src/agent/agents.ts`, `src/agent/runner.ts`(stats에 keywords), `src/commands/review.ts`, `src/cli.ts`, `test/fake-agent/fake-agent.ts`
- Create: `src/analyzer/keywords.ts`, `src/commands/keywords.ts`
- Test: `test/analyzer/keywords.test.ts`, `test/commands/keywords.test.ts`, 기존 group·reviewApply·review 테스트 보강

**Interfaces (Produces):**
- schema `ExperienceFrontmatter`에 다음을 추가한다(`category` 다음).
  - `keywords: z.array(z.string()).default([])`
  - `outcome_keywords: z.array(z.string()).default([])`
- `export const KEYWORD_LIMITS = { keywords: 3, outcome: 2, chars: 16 } as const;`(schema.ts)
- `export function clampKeywords(a: unknown, max: number): string[]`(keywords.ts): 배열이 아니면 `[]`를 반환한다. 문자열만 받아 trim하고 빈 값을 빼며, 18자 이내로 단어 경계에서 자르고 중복을 없앤 뒤 max개까지 남긴다.
- 묶기 프롬프트:
  - 출력 형식에 `"keywords":["…"],"outcome_keywords":["…"]`를 추가한다.
  - 규칙을 추가한다: `- keywords는 이 경험에서 한 일(활동·기법·대상) 2~3개, outcome_keywords는 이룬 성과 1~2개(수치 가능)입니다. 각 16자 이내. 기술 스택 이름만으로 된 키워드는 쓰지 마세요.`
  - NewExpSchema에서 clampKeywords로 받는다. group.ts의 새 경험 fm에 넣고, mergeExps는 dedupe한 합집합을 다시 clamp한다.
- 반영 단계:
  - ApplyResult에 `keywords`, `outcome_keywords`를 넣는다(optional, clampKeywords, 빈 배열이면 undefined).
  - 규칙을 추가한다: `- keywords(한 일 2~3개)·outcome_keywords(성과 1~2개)는 답변으로 더 정확해질 때만 쓰세요. 각 16자 이내, 기술 스택 이름만은 금지.`
  - mergeApply 키 목록에 두 필드를 추가한다.
- 키워드 단계(`src/analyzer/keywords.ts`):
  - `KEYWORDS_MARKER = "[키워드 단계]"`, `KEYWORDS_BATCH_SIZE = 20`
  - `buildKeywordsPrompt(items: {id: string; exp: LoadedExperience}[])`: 경험마다 `<<<EXP id=… nonce=…>>>` 블록에 sanitize된 한 줄 JSON `{title, org, role, contribution, metrics, star}`을 넣는다. star는 `{s,t,a,r}` 또는 null이다.
  - 규칙: 도구 금지, 블록은 데이터, 마스킹 표식 복원 금지, 위 키워드 정의.
  - 출력: JSON 배열 `[{"id":"k1","keywords":[…],"outcome_keywords":[…]}]`
  - `generateKeywords(bridge, out, state, items, opts)`: reviewApply의 `applyReviews`와 같은 형태(runBatches, validateReply, 재요청 프롬프트)다. 결과마다 `saveExperience(out, state, e, {...e.fm, keywords, outcome_keywords})`를 하고 onSaved/onSkipped를 부른다.
- `agents.ts`:
  - `Stage`에 `"keywords"`를 추가한다.
  - `modelForStage`에서 keywords는 `models.triage`다.
  - `NO_THINKING_STAGES`에 keywords를 추가한다.
  - runner stats에도 추가한다.
- `src/commands/keywords.ts`: `runKeywords({all?, yes?, logPrompts?, budget?, confirm?})`
  - 출력 폴더와 state를 확인한다(손상이면 CORRUPT_STATE_MSG, 코드 2).
  - 대상은 `!edited && review !== "excluded" && (all || (keywords.length === 0 && outcome_keywords.length === 0))`다.
  - 대상이 없으면 `키워드를 만들 경험이 없습니다.`를 출력하고 코드 0이다.
  - 그 밖에는 review.ts의 반영 단계 실행부를 같은 구조로 쓴다(createStageRunner, `resumeCommand: "mp keywords"`, 로그 `keywords-<stamp>.log`, crash 재시작 1회).
  - 끝에 `키워드 ${n}개 경험, 편집돼 건너뜀 ${m}개`를 출력하고, 중단 사유 출력 형식은 review와 같다.
- `mp review --apply-only`: 마이그레이션 후 세션·파일 처리를 건너뛰고 바로 반영 단계로 간다. CLI 옵션 설명은 `질의응답 없이 반영 대기 경험만 반영`이다.
- `cli.ts`:
  - `program.command("keywords").description("경험·성과 키워드 만들기(빠른 모델)")`
  - 옵션 `--all`(이미 있는 것도 다시), `--yes`, `--log-prompts`, `--budget <share>`
- fake-agent:
  - `[키워드 단계]`: 각 id에 `{keywords:["경험 키워드"], outcome_keywords:["성과 키워드"]}`를 반환한다.
  - 시나리오 `keywords-garbage`: 첫 응답 `"모르겠습니다"`.
  - 묶기·반영 응답에도 keywords를 넣는다(`group-one`: `["역분석","입력 복원"]`, `["키 복원"]`).

- [ ] **Step 1: 실패하는 테스트**
  - clampKeywords: 비배열은 `[]`이고, 17자 문자열은 16자로 잘리며, 중복과 빈 값은 빠지고, max를 넘으면 잘린다.
  - 프롬프트에 마스킹이 적용된다(카드 role에 `010-1234-5678` → 프롬프트에 없음).
  - `runKeywords`(seedCards → runGroup → 키워드 비우기 → runKeywords): 두 필드가 채워지고 로그 프롬프트에 `[키워드 단계]`와 model이 triage 모델로 기록된다(가짜 에이전트 로그의 model 필드). `--all` 없이 두 번째 실행하면 대상이 0이다.
  - `keywords-garbage`: 재요청 뒤 성공한다.
  - group 결과 카드에 keywords와 outcome_keywords가 있다. 반영 결과에 keywords가 반영된다.
  - `runReview({applyOnly:true, yes:true})`: 질문 IO 없이 pending_apply 카드만 반영한다(io를 넘기지 않아도 멈추지 않는다).
  - 옛 카드(키 없음)를 읽으면 두 필드가 `[]`다.
- [ ] **Step 2:** red를 확인한다. **Step 3:** 구현한다. **Step 4:** `npm test && npx tsc --noEmit`.
- [ ] **Step 5:** 커밋 `feat(keywords): experience/outcome keywords, keywords stage (mp keywords), review --apply-only (11.5)`

### Task 2: UI 서버와 `mp ui`

**Files:**
- Create: `src/ui/model.ts`, `src/ui/server.ts`, `src/ui/open.ts`, `src/commands/ui.ts`
- Modify: `src/store/masterMd.ts`(`toItem`을 export하거나 공용 함수 분리), `src/cli.ts`
- Test: `test/ui/server.test.ts`, `test/ui/model.test.ts`

**Interfaces (Produces):**
- `src/ui/model.ts`:
  - `export type UiExperience = MasterItem & { review: ReviewState; value: string | null; questions: {id; field; q; a}[]; pending_apply: boolean; edited: boolean; keywords: string[]; outcome_keywords: string[] }`
  - `export function buildUiState(exps: LoadedExperience[], fileTitles: Map<string,string|null>): UiExperience[]`: 모든 review 상태를 포함한다. category는 inferCategory를 쓰고, 표시 보정은 masterMd와 같은 규칙이다(같은 함수 재사용).
  - `export async function loadFileTitles(out: string, exps: LoadedExperience[]): Promise<Map<string,string|null>>`: master.ts의 로직을 옮기고 master.ts도 이것을 쓴다.
- `src/ui/server.ts`:
  - `export async function startUiServer(o: { out: string; port?: number; token: string; cliPath: string; html: (token: string) => string }): Promise<{ url: string; port: number; close(): Promise<void> }>`
  - 요청 검사 순서:
    1. Host가 `127.0.0.1:${port}` 또는 `localhost:${port}`가 아니면 403이다.
    2. `/`와 `/index.html`은 쿼리 `t`가 토큰과 같을 때만 `html(token)`을 반환하고, 아니면 401이다. `Cache-Control: no-store`를 붙인다.
    3. `/api/*`는 `x-mp-token` 헤더가 토큰과 같아야 하며 아니면 401이다(`crypto.timingSafeEqual`).
    4. POST 본문은 1MB를 넘으면 413, JSON이 아니면 400이다.
  - 응답은 `{ok:true,...}` 또는 `{error:"…"}`(한국어 메시지)다.
  - 라우트는 §11.5 그대로다. 각 쓰기 요청은 state와 경험 목록을 새로 읽는다(`loadState` → `listExperiences`). state가 손상이면 500과 CORRUPT_STATE_MSG다.
    - decide: 모든 rels가 존재해야 하고 편집된 것이 있으면 그것만 409 목록으로 돌려준다(나머지는 저장). `decideReview` 후 saveExperience.
    - answer: 질문 id가 없으면 404다. `recordAnswer`를 쓴다.
    - edit: zod `UiEdit = z.object({ title: z.string().min(1).max(120), period: z.string().nullable(), org: …, role: …, team_size: z.number().int().positive().nullable(), contribution: z.enum(CONTRIBUTIONS).nullable(), category: z.enum(CATEGORIES).nullable(), keywords: z.array(z.string()), outcome_keywords: z.array(z.string()), skills: z.array(z.string()), metrics: z.array(z.string()) }).partial().strict()`. keywords는 clampKeywords를 거친다.
    - job: `spawn(process.execPath, [cliPath, ...args], { cwd: process.cwd(), env: { ...process.env, MP_OUTPUT_DIR: out } })`. stdout과 stderr를 줄 단위로 모아 마지막 200줄만 유지한다. exit 시 `{running:false, code}`다. 실행 중이면 409다.
    - `/files/<rel>`: `decodeURIComponent` 후 `path.resolve(out, rel)`이 `out/files/` 또는 `out/experiences/` 아래이고 `.md`로 끝나며 존재해야 한다. 아니면 404다. `text/plain; charset=utf-8`이다.
- `src/ui/open.ts`: `export function openBrowser(url: string): boolean`(spawn detached, 실패 시 false). WSL 판정은 `/proc/version`에 `microsoft`가 있는지(대소문자 무시)로 한다.
- `src/commands/ui.ts`: `runUi({port?, open?})`
  - 출력 폴더를 확인한다.
  - 토큰은 `randomBytes(32).toString("hex")`다.
  - cliPath는 `process.argv[1]`이다(테스트에서는 주입).
  - html은 Task 3의 `renderApp({mode:"live", token})`인데, Task 3 전에는 임시로 `"<!doctype html><title>Master Record</title>"`를 쓴다.
  - 출력: `MasterPortfolio UI: ${url}` 그리고 `종료하려면 Ctrl+C`.
  - SIGINT에서 close한다.
- `cli.ts`: `program.command("ui").description("브라우저에서 결과 보기·결정·답변·반영").option("--port <n>").option("--no-open", "브라우저를 열지 않음")`

- [ ] **Step 1: 실패하는 테스트** (`test/ui/server.test.ts`, 실제 HTTP, port 0, seedCards + runGroup으로 준비)
  - 토큰 없는 `/api/state`는 401, 잘못된 Host(`evil.com`)는 403, 올바르면 200이고 experiences 길이와 필드가 맞다.
  - `/?t=bad`는 401, `/?t=TOKEN`은 200 HTML이다.
  - decide → 카드 review가 바뀐다. answer(전화번호 포함)는 저장 값이 마스킹되고 pending_apply가 true다. 잘못된 qid는 404다. edit(contribution "AI 주도", keywords 17자 포함)는 저장되고 잘린다. 허용 밖 필드(`review`)는 400이다.
  - 바깥 편집 후 쓰기는 409이고 파일이 그대로다. accept-edit 후 쓰기는 성공한다.
  - `/files/../.mp/config.json`, `/files/%2e%2e/x.md`, `/files/files/none.md`는 404다. 존재하는 파일 카드는 200이다.
  - job master를 실행하면 완료될 때까지 폴링하고, code 0이며 `master.html`이 생긴다. 실행 중 두 번째 POST는 409다(가짜 cliPath로 `setTimeout` 스크립트를 실행해 재현해도 된다).
  - 1MB를 넘는 본문은 413이다.
  - model.test: 제외·보류도 포함되고, category 추정과 metrics 문서 통계 제외가 적용된다.
- [ ] **Step 2:** red. **Step 3:** 구현. **Step 4:** `npm test && npx tsc --noEmit`.
- [ ] **Step 5:** 커밋 `feat(ui): local API server and mp ui command (11.5)`

### Task 3: 화면(단일 HTML 앱)과 master.html 정적 모드

**Files:**
- Create: `src/ui/app.ts`
- Modify: `src/commands/ui.ts`(renderApp 연결), `src/commands/master.ts`, `src/store/masterHtml.ts`(renderApp static으로 대체하거나 삭제하고 사용처 교체)
- Test: `test/ui/app.test.ts`, 기존 `test/store/masterHtml.test.ts` 교체

**Interfaces:**
- `export function renderApp(o: { mode: "live"; token: string } | { mode: "static"; data: UiExperience[]; generatedAt: string }): string`: 단일 HTML이다(인라인 CSS·JS).
  - static 모드는 `<script type="application/json" id="data">`에 JSON을 넣는다. 이때 `<`는 `<`, U+2028과 U+2029는 이스케이프한다. 채택만 포함하고 쓰기·작업 UI는 없다.
  - live 모드는 토큰을 JS 상수로 넣고(JSON.stringify) `/api/state`를 fetch한다.
  - DOM은 모두 `textContent`와 `createElement`로 만든다(innerHTML에 데이터 금지).
- 화면 요구사항은 §11.5 "화면"과 아래 디자인 지침을 따른다.
  - 레이아웃: 왼쪽 사이드바 240px 고정, 가운데 목록, 오른쪽 상세 패널(440px, 슬라이드 인)이다. 820px 이하에서는 사이드바가 상단 접이식이고 패널은 전체 화면이다.
  - 목록 한 줄(높이 약 56px):
    - 1행은 제목(굵게, 말줄임)과 오른쪽 기간이다.
    - 2행은 수행 방식 배지, 경험 키워드 칩(중립색), 성과 키워드 칩(강조색, ▲ 또는 ✓ 접두)이다.
    - 왼쪽 끝 상태 점은 채택 초록, 보류 노랑, 제외 회색, 대기 파랑이다.
    - 키워드가 없으면 성과 첫 항목 24자를 흐린 성과 칩으로 보여 준다.
  - 사이드바:
    - 할 일 카드(결정 대기·답변 대기·반영 대기 개수 버튼)
    - 분류 목차(앵커 이동, 현재 위치 강조. IntersectionObserver)
    - 보기(분류별 / 연도별)
    - 상태 필터(기본: 결정 대기 + 채택. static은 채택만)
    - 수행 방식 필터
  - 상세 패널:
    - 상단은 제목, 상태, 결정 버튼 3개다(live).
    - "질문 n개" 섹션은 질문마다 textarea와 저장·모름·건너뛰기 버튼이다(live).
    - 성과·STAR·기술·근거(링크 `/files/<rel>` live, 상대경로 static), 복사 두 개, "편집" 토글이 이어진다(필드 폼, 키워드는 쉼표 구분 입력).
  - 하단 작업 바(live): 반영 대기 n → [반영 실행], [키워드 만들기], [master 다시 만들기]. 실행 중에는 로그 패널(최근 줄)과 1초 폴링이다. 완료되면 토스트를 띄우고 다시 불러온다.
  - 결정 대기 필터일 때 목록에 체크박스와 일괄 버튼이 나온다.
  - 단축키: `/` 검색, `j`/`k` 이동, `Enter` 열기, `Esc` 닫기.
  - 색 토큰을 `:root`에 두고 다크(`prefers-color-scheme`)를 재정의한다. 대비는 AA다. 기본 글꼴 스택은 기존과 같다.
  - 인쇄(static과 live 둘 다): 사이드바·패널·작업 바를 숨기고, 채택 경험을 문서형으로 펼친다(제목, 기간·소속·역할, 수행 방식, 키워드, 성과, STAR).
- `master.ts`는 `renderApp({mode:"static", data: buildUiState(...).filter(adopted), generatedAt})`로 master.html을 쓴다.
- 앱 JS의 순수 로직(필터, 정렬, 카운트, 연도 그룹)은 `src/ui/appLogic.ts`로 분리해 TS로 테스트한다. 같은 함수를 `.toString()`으로 인라인하지 말고, 앱 스크립트 안에 같은 로직을 작성한 뒤 테스트는 TS 버전으로 하라. 대신 앱 스크립트를 `new Function`으로 문법 검사한다. **Ruling 허용:** 구현자가 더 나은 방법(예: appLogic.ts를 esbuild 없이 문자열로 인라인할 수 있는 순수 함수로 작성)을 택하면 보고에 적는다.

- [ ] **Step 1: 테스트**
  - renderApp static: `</script>`가 든 제목 데이터가 문자열을 깨지 않는다. 외부 리소스가 없다. 채택만 포함한다. 데이터 JSON이 파싱된다. 스크립트는 `new Function` 문법이 통과한다. live: 토큰이 들어가고 `/api/state` fetch 코드가 있다.
  - appLogic: 필터(상태·분류·수행 방식·검색), 연도 그룹(기간 없음은 마지막), 할 일 카운트.
  - flow.test: master.html에 데이터 JSON과 경험 제목이 있다.
- [ ] **Step 2–4:** red → 구현 → `npm test && npx tsc --noEmit && npm run build`.
- [ ] **Step 5:** 커밋 `feat(ui): single-page app (sidebar TOC, keyword rows, detail panel, jobs) + static master.html (11.5)`
