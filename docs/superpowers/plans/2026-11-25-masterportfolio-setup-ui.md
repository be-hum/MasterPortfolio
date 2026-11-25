# 화면 안의 처음 설정·설정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 처음 설정과 이후 설정 변경을 터미널 없이 브라우저 화면에서 하게 한다. 운영체제 폴더 선택 창을 쓰고, 바탕 화면·클라우드·드라이브를 기본 폴더 제안에 추가한다.

**Architecture:**
- 핵심 로직: 폴더 제안, 설정 생성, 구조화된 환경 점검, 폴더 선택 창. 이 로직은 `src/setup/`에 두고 CLI와 서버가 함께 쓴다.
- 서버: `out`이 null이면 설정 모드로 뜨고, 설정 API로 설정을 저장한 뒤 같은 서버가 일반 모드로 바뀐다.
- 화면: 기존 단일 HTML 앱에 마법사 화면과 설정 화면을 더한다.

**Tech Stack:** TypeScript, Node ≥22, zod, vitest. 새 의존성은 없다.

**Spec:** `docs/superpowers/specs/2026-11-24-masterportfolio-design.md` §11.6 (+ §11.5, §5.5, §9.8)

## Global Constraints

- 실제 CLI를 실제 결과 폴더나 실제 에이전트에 대고 테스트하지 않는다. 테스트는 임시 폴더와 `test/fake-agent/fake-agent.ts`만 쓴다. 폴더 선택 창은 실행 함수를 주입해 테스트한다(실제 대화상자를 띄우지 않는다).
- 서버 규칙은 그대로 둔다. 127.0.0.1 바인딩, 토큰(`X-MP-Token`), Host 검사, 본문 1MB, CORS 없음, 작업 실행 중 쓰기는 409다.
- 경로 입력은 `normalizeFolderInput`으로 정규화한 뒤 존재 여부와 폴더인지를 확인한다. 사용자 입력을 셸 문자열에 넣지 않는다. 폴더 선택 창의 초기 경로는 환경변수로 넘긴다.
- 설정 저장은 `saveConfig` + `writeOutputPointer`를 쓴다. 기존 설정 파일 형식(schema_version 1)을 유지한다.
- 사용자에게 보이는 문구는 한국어다. 외부 리소스는 쓰지 않는다. 화면 DOM은 createElement와 textContent로만 만든다.
- 커밋 트레일러:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01V4yeGmzxT1ga3dyye63Gua`
- 검증: `npm test`, `npx tsc --noEmit`, `npm run build`.

## Review Focus

1. 설정 모드 서버에서 일반 API(`/api/state` 데이터, `/api/job` 등)가 결과 폴더 없이 호출되면 크래시하지 말고 "설정이 필요합니다"(409)를 반환해야 한다.
2. 설정 저장 경로 검증: 존재하지 않는 폴더, 파일 경로, 빈 값, 결과 폴더와 같은 스캔 폴더는 거부하거나 경고해야 한다. 결과 폴더는 없으면 만든다.
3. 폴더 선택 창이 열려 있는 동안 두 번째 요청은 409다. 취소는 null이다. 명령 실행 실패는 "폴더 선택 창을 열 수 없습니다. 경로를 직접 입력하세요"로 안내해야 한다.
4. 설정 화면의 범위 판단 초기화는 그 경로와 하위 판단만 지워야 한다(다른 판단은 그대로).
5. 일반 모드에서 다시 `/api/setup`을 호출하면 409다. 기존 설정을 덮어쓰지 않는다.

---

### Task 1: 핵심 로직 — 폴더 제안, 설정 생성, 구조화된 환경 점검, 폴더 선택 창, 문구 수정

**Files:**
- Create: `src/setup/folders.ts`, `src/setup/config.ts`, `src/setup/check.ts`, `src/setup/pickFolder.ts`
- Modify: `src/discovery/defaults.ts`, `src/commands/init.ts`, `src/commands/doctor.ts`, `src/ui/app.ts`(버튼 설명 문구 한 줄), `src/commands/scan.ts`(`scanSummary` 문구), `README.md`
- Test: `test/setup/*.test.ts`, 기존 doctor·init 테스트

**Interfaces (Produces):**
- `src/setup/folders.ts`
  - `export type FolderSuggestion = { path: string; label: string; kind: "documents"|"downloads"|"desktop"|"cloud"|"drive"|"keyword"; checked: boolean }`
  - `export async function suggestFolders(keywords: string[], deps?: { home?: string; platform?: NodeJS.Platform; exists?: (p: string) => boolean; listDir?: (p: string) => string[]; winFolder?: (name: "MyDocuments"|"Desktop"|"Downloads") => Promise<string | null>; systemDrive?: string; candidates?: (root: string, keywords: string[]) => Promise<string[]> }): Promise<FolderSuggestion[]>`
    - 문서·다운로드·바탕 화면: `checked: true`. Windows는 `[Environment]::GetFolderPath(...)`(다운로드는 기존 `shell:Downloads` 방식)를 쓰고, 그 밖은 `~/Documents`, `~/Downloads`, `~/Desktop`이다. 존재하는 것만 넣는다.
    - cloud(`checked: false`): 홈 바로 아래에서 이름이 `OneDrive`로 시작하는 폴더, 그리고 macOS `~/Library/CloudStorage/*`. 이미 문서 등 위 제안의 상위 폴더면 넣지 않는다.
    - drive(`checked: false`): Windows는 `C`~`Z` 중 `systemDrive`(기본 `process.env.SystemDrive ?? "C:"`)를 뺀, 존재하는 `X:\\`. macOS는 `/Volumes/*` 중 `/`를 가리키는 심볼릭 링크를 뺀 것. Linux는 넣지 않는다.
    - keyword(`checked: false`): 기존 `findCandidateFolders(home, ["project","projects","프로젝트", ...keywords], 4)` 결과 중 위 제안 아래에 있지 않은 것.
    - 같은 경로는 한 번만 넣는다(pathKey 비교). 순서: documents, downloads, desktop, cloud, drive, keyword.
    - label은 한국어다: "문서", "다운로드", "바탕 화면", "클라우드: OneDrive - X", "드라이브 D:", 폴더 이름.
  - `export async function defaultOutputDir(deps?): Promise<string>`: 문서 폴더(위와 같은 방법)/MasterPortfolio. 문서 폴더가 없으면 `~/MasterPortfolio`.
- `src/setup/config.ts`
  - `export type SetupInput = { university: string; keywords: string[]; folders: string[]; planScale: number; output: string; agent?: string }`
  - `export async function validateSetup(i: SetupInput): Promise<{ ok: true; folders: string[]; output: string } | { ok: false; errors: string[] }>`
    - folders: normalizeFolderInput, 중복 제거, 각각 존재하고 폴더인지 확인한다(아니면 `"폴더를 찾을 수 없습니다: <경로>"`). 하나도 없으면 `"스캔할 폴더를 하나 이상 고르세요"`.
    - output: 정규화해서 빈 값이면 오류다. 이미 있고 폴더가 아니면 오류다. 스캔 폴더와 같으면 `"결과 폴더는 스캔 폴더와 달라야 합니다"`.
    - planScale ∈ {1,5,20}.
  - `export async function createSetupConfig(i: SetupInput): Promise<{ output: string; config: Config }>`: 검증 → `mkdir(output, {recursive})` → `defaultConfig(...)` → `budget.planScale` → `withLocalExecutable` → `saveConfig` → `writeOutputPointer`. 검증 실패는 `SetupError(errors)`를 throw한다.
  - `src/commands/init.ts`의 대화형·비대화형 경로가 둘 다 이것을 쓰게 바꾼다(동작과 출력 문구는 유지). 대화형은 폴더 체크 목록에 `suggestFolders`를 쓰고, 결과 폴더 기본값은 `defaultOutputDir()`이다.
- `src/setup/check.ts`
  - `export type CheckItem = { ok: boolean; label: string; fix?: string; warn?: boolean }`
  - `export async function checkEnvironment(out: string | null, opts: { skipAgent?: boolean }): Promise<CheckItem[]>`: 기존 `runDoctor`의 모든 점검(Node, git(warn), 결과 폴더 쓰기, 다른 환경 설정 안내(warn), 스캔 폴더 읽기, 에이전트 연결)을 같은 문구로 돌려준다.
  - `runDoctor`는 이것을 불러 `✔`/`✘`/`!`/`ℹ`로 출력한다(기존 출력·종료 코드 유지).
- `src/setup/pickFolder.ts`
  - `export type Runner = (file: string, args: string[], env: NodeJS.ProcessEnv) => Promise<{ code: number; stdout: string }>`
  - `export async function pickFolder(opts: { initial?: string; title?: string; platform?: NodeJS.Platform; isWsl?: boolean; run?: Runner }): Promise<string | null>`
    - Windows와 WSL: `powershell.exe -NoProfile -STA -Command <고정 스크립트>`. 스크립트는 `$env:MP_PICK_INITIAL`, `$env:MP_PICK_TITLE`을 읽는다. TopMost Form을 owner로 FolderBrowserDialog를 ShowDialog하고, 선택하면 경로를 UTF-8로 출력하며 취소하면 아무것도 출력하지 않는다. 출력 인코딩은 `[Console]::OutputEncoding=[Text.Encoding]::UTF8`이다. WSL이면 결과를 `wslpath -u`로 변환한다.
    - macOS: `osascript -e 'POSIX path of (choose folder with prompt (system attribute "MP_PICK_TITLE"))'`. 취소(코드 1)는 null이다. 앞으로 오게 `tell application "System Events" to activate`를 넣는다(실패해도 무시).
    - Linux: `zenity --file-selection --directory --title=...`(title은 env로 넘길 수 없으므로 고정 문구)이다. 명령이 없으면 `PickUnavailable`을 throw한다.
    - 실행 실패나 0·1이 아닌 코드는 `PickUnavailable("폴더 선택 창을 열 수 없습니다. 경로를 직접 입력하세요")`다.
- 문구 수정:
  - README "명령줄"의 scan 줄과 "자료 찾기" 설명에 "새 파일을 분석한다. 원본이 바뀐 파일은 알려 주기만 한다(다시 분석은 다음 버전)"를 반영한다.
  - 작업 바 [새 자료 스캔] title은 `"설정한 폴더에서 새로 생긴 자료를 찾아 카드로 만들기(바뀐 파일은 알려 주기만 함, 에이전트 사용)"`이다.
  - `scanSummary`의 "원본이 바뀐 파일 n개"를 `"원본이 바뀐 파일 n개(아직 다시 분석하지 않음)"`로 바꾼다.

- [ ] **Step 1: 실패하는 테스트**
  - suggestFolders: 주입한 deps로 win32 시나리오를 만든다. 문서·다운로드·바탕 화면은 checked, `OneDrive - Univ`는 cloud, `D:\\`와 `E:\\`는 drive(시스템 C는 제외), 키워드 후보 하나, 중복 제거, 순서를 확인한다. darwin 시나리오에서는 `/Volumes/Data`(링크 아님)는 drive, `/Volumes/Macintosh HD`(→ `/` 링크)는 제외되고 CloudStorage는 cloud인지 확인한다.
  - validateSetup: 없는 폴더, 파일 경로, 빈 목록, output == folder, 잘못된 planScale에 대해 각 오류 문구를 확인한다. 정상이면 정규화된 값을 돌려준다.
  - createSetupConfig: 임시 폴더에서 config·pointer가 생기고(MP_POINTER_FILE 주입), planScale과 keywords가 반영되고, output 폴더가 생성되는지 확인한다.
  - checkEnvironment: 설정이 없을 때 `{ok:false,label:"설정 없음"}`, 결과 폴더와 스캔 폴더가 정상일 때 ok 항목(skipAgent)을 확인한다. runDoctor의 기존 출력 테스트는 그대로 통과해야 한다.
  - pickFolder: 주입한 run으로 확인한다.
    - win32 stdout `"C:\\x\\y\r\n"` → `"C:\\x\\y"`. 빈 stdout은 null. env에 MP_PICK_INITIAL이 전달되고 args에 사용자 문자열이 없다.
    - WSL은 wslpath 호출 결과로 변환된다.
    - darwin 코드 1은 null이다.
    - linux에서 run이 ENOENT를 throw하면 PickUnavailable이다.
  - scanSummary 문구 테스트를 갱신한다.
- [ ] **Step 2:** red를 확인한다. **Step 3:** 구현한다. **Step 4:** `npm test && npx tsc --noEmit`.
- [ ] **Step 5:** 커밋 `feat(setup): folder suggestions (desktop/cloud/drives), shared setup config, structured env check, OS folder picker; fix scan wording (11.6)`

### Task 2: 서버 — 설정 모드와 설정 API, `mp start` 연결

**Files:**
- Modify: `src/ui/server.ts`, `src/commands/ui.ts`, `src/commands/start.ts`, `src/cli.ts`(필요하면)
- Test: `test/ui/setupServer.test.ts`, `test/commands/start.test.ts`

**Interfaces:**
- `UiServerOptions.out: string | null`. 추가 옵션은 다음과 같다(테스트 주입용).
  - `setupDeps?: { suggest?: typeof suggestFolders; pick?: typeof pickFolder; check?: typeof checkEnvironment; create?: typeof createSetupConfig; defaultOutput?: () => Promise<string> }`
- 설정 모드(out null)에서의 라우트 동작:
  - `GET /api/state` → `{ ok: true, setup: true }`
  - 다른 기존 쓰기와 작업 API → 409 `{ error: "처음 설정이 필요합니다." }`
- 라우트(모두 토큰 필요):
  - `GET /api/setup/suggest?university=<입력>` → `{ ok, keywords: expandUniversity(입력), folders: FolderSuggestion[], defaultOutput }`. 일반 모드에서도 쓸 수 있다(설정 화면의 폴더 추가 제안).
  - `POST /api/setup {university, keywords, folders, planScale, output}`: 설정 모드에서만 동작하고 일반 모드면 409다. `createSetupConfig`로 저장하고, 성공하면 서버 `out`을 그 경로로 바꾸고 `{ ok, output }`이다. 검증 실패는 400 `{ error, errors }`다.
  - `POST /api/pick-folder {initial?, title?}` → `{ ok, path: string|null }`. 동시 요청은 409, PickUnavailable은 400 `{error}`다. 고른 경로가 폴더인지 확인한다.
  - `POST /api/check {skipAgent?}` → `{ ok, items: CheckItem[] }`(설정 모드면 out null로 점검).
  - `GET /api/settings` → `{ ok, output, university, keywords, scanFolders, planScale, fiveHourShare, scope: [{path, decision, by, at}] }`(일반 모드만)
  - `POST /api/settings {scanFolders?, planScale?, fiveHourShare?, keywords?}`: 작업 중이면 409. scanFolders는 validateSetup의 폴더 규칙(존재·폴더·결과 폴더와 다름)을 따른다. fiveHourShare는 0.05~1, planScale ∈ {1,5,20}. `loadConfig` → 수정 → `saveConfig`다.
  - `POST /api/settings/scope-reset {path}` → `resetScopeDecisions(config.scope.decisions, normalize(path))`로 지운 키 수를 돌려준다. 작업 중이면 409다.
- `runUi({ setup?: boolean })`: 결과 폴더가 없을 때 setup이 true면 out null로 서버를 열고, 아니면 기존처럼 "먼저 `mp init`"(코드 2)이다.
- `runStart`: 결과 폴더가 없으면 `runUi({ setup: true })`이다(터미널 init 호출 제거, 안내 문구 `"처음 설정 화면을 브라우저에서 엽니다."`). deps 주입은 유지한다.

- [ ] **Step 1: 실패하는 테스트** (실제 HTTP, 주입 deps)
  - 설정 모드: `/api/state` → setup:true. `/api/job`·`/api/decide` → 409. `/api/settings` → 409.
  - suggest: 주입 suggest·defaultOutput 결과와 keywords 확장(예: "연세대" → 연세대학교 포함)을 확인한다.
  - setup 성공 → 이후 `/api/state`가 일반 응답(experiences 배열)이고, config·pointer가 생긴다(임시 MP_POINTER_FILE). 두 번째 `/api/setup` → 409. 검증 실패 → 400과 errors.
  - pick-folder: 주입 pick이 지연 중일 때 두 번째 요청 → 409. PickUnavailable → 400. 고른 경로가 파일이면 400.
  - check: 주입 check 결과를 그대로 돌려준다.
  - settings: GET 값을 확인한다. POST로 planScale 5와 폴더 추가를 저장하면 config에 반영된다. 없는 폴더 → 400. 작업 중 → 409. scope-reset은 하위만 지운다.
  - runStart: 결과 폴더가 없으면 ui가 `{setup:true}`로 불린다.
- [ ] **Step 2–4:** red → 구현 → `npm test && npx tsc --noEmit`.
- [ ] **Step 5:** 커밋 `feat(ui): setup mode and settings API; mp start opens the browser setup (11.6)`

### Task 3: 화면 — 처음 설정 마법사와 설정 화면

**Files:**
- Modify: `src/ui/app.ts`, `src/ui/appLogic*`(필요하면)
- Test: `test/ui/app.test.ts`(문법·렌더 문자열), appLogic 단위 테스트(마법사 상태 검증 함수가 있으면)

**요구사항:**
- `/api/state`가 `setup:true`면 메인 대신 **마법사**를 렌더한다(사이드바와 작업 바는 숨긴다). 4단계 진행 표시(1 대학 · 2 폴더 · 3 요금제·결과 폴더 · 4 점검)와 이전·다음 버튼이 있다.
  1. 대학명 입력 → [이름 찾기]가 `/api/setup/suggest?university=` → keywords 체크 목록이다(추가 입력 가능). [건너뛰기]도 있다.
  2. 폴더: suggest 결과를 종류별 묶음(기본·클라우드·드라이브·이름이 맞는 폴더)의 체크 목록으로 보여 준다. [폴더 선택](pick-folder, 진행 중에는 버튼 비활성과 "폴더 선택 창을 확인하세요" 안내), 경로 입력과 [추가]가 있다. 추가한 폴더는 목록 맨 위에 체크된 상태로 들어간다.
  3. 요금제 라디오(Pro / Max 5x / Max 20x, 설명: "사용량 예산을 Pro 기준으로 환산"), 결과 폴더 입력(기본 defaultOutput)과 [폴더 선택]이 있다.
  4. [설정 저장] → `/api/setup`. 오류는 항목별로 표시한다. 성공하면 `/api/check`(에이전트 포함, "Claude 연결 확인 중… 최대 1분")로 항목을 ✔/✘/!로 보여 주고, 실패 항목에는 fix를 표시하며 [다시 점검]이 있다. [시작하기]를 누르면 메인으로 간다(load).
- **설정 화면**: 사이드바 하단의 [⚙ 설정]을 누르면 오른쪽 패널(기존 상세 패널 자리)이나 전체 화면 오버레이로 연다.
  - 스캔 폴더 목록에는 [제거]가 있고, [폴더 선택]과 경로 입력으로 추가한다. [제안 보기]는 suggest의 아직 없는 제안을 보여 준다.
  - 요금제 라디오, 예산 비율 슬라이더 또는 숫자(5~100%, "Pro 기준")가 있다.
  - 대학 검색 이름은 쉼표 구분 입력이다.
  - [저장]은 `/api/settings`다. 409(작업 중)와 400 오류를 표시한다.
  - 폴더 범위 판단 표(경로·포함/제외·LLM/사용자·날짜)는 검색 필터가 있고, 행마다 [초기화]는 scope-reset이다(확인 문구는 페이지 안에서 띄우고 `confirm()`은 쓰지 않는다).
  - 결과 폴더(표시), [환경 점검](check 결과 목록)이 있다.
- 키보드 접근성(Tab 순서, Enter로 다음), 다크 모드, 좁은 화면을 지원한다. 기존 스타일 토큰을 재사용한다.
- Windows Chrome 헤드리스로 설정 모드와 설정 화면을 스크린샷으로 확인한다(임시 폴더와 주입 deps를 쓰는 서버, 실제 결과 폴더 금지).

- [ ] **Step 1–4:** 테스트(스크립트 문법, 마법사·설정 DOM에 데이터 innerHTML 없음, appLogic 단위) → 구현 → `npm test && npx tsc --noEmit && npm run build` → 스크린샷 확인.
- [ ] **Step 5:** 커밋 `feat(ui): browser setup wizard and settings screen (11.6)`
