# M4.1 실사용 보강 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 실제 질의응답에서 드러난 차이 다섯 가지를 고친다. 바꾸는 것은 수행 방식(contribution) 필드, 기본 질문, 결정을 먼저 받는 review 흐름, 이력서 분류 master.md, 답을 필드에 넣는 가짜 에이전트다.

**Architecture:** 스키마 필드 두 개(`contribution`, `category`)를 추가한다. 기본 질문은 로컬에서 덧붙이며 `src/review/baseQuestions.ts`가 맡는다. 묶기·반영 프롬프트와 응답 스키마를 확장한다. review 세션은 두 단계(결정 → 질문)로 바꾸고, `renderMaster`는 category로 묶는다.

**Tech Stack:** TypeScript, Node ≥22, zod, vitest, @inquirer/prompts (checkbox 추가 사용)

**Spec:** `docs/superpowers/specs/2026-11-24-masterportfolio-design.md` 11.4 (+10.3, 11.1–11.3)

## Global Constraints

- 실제 CLI를 실제 폴더나 에이전트에 대고 테스트하지 않는다. 테스트는 `test/fake-agent/fake-agent.ts`와 임시 폴더만 쓴다.
- LLM에 보내는 모든 텍스트는 `sanitize()`를 거친다. 답변은 저장 전에 마스킹한다(기존 `recordAnswer` 규칙).
- 기존 경험 카드(필드 없음)는 그대로 읽혀야 한다. 새 필드는 `.nullable().default(null)`로 두고 `schema_version`은 1을 유지한다.
- 카드 파일을 쓸 때마다 state.json을 함께 저장한다(`saveExperience`, `createExperience` 사용).
- 편집된 카드(`edited`)는 건드리지 않는다.
- 사용자에게 보이는 문구는 한국어다.
- 커밋 트레일러:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01V4yeGmzxT1ga3dyye63Gua`
- 전체 테스트: `npm test`, 타입 검사: `npx tsc --noEmit`, 빌드: `npm run build`.

## Review Focus

1. 새 필드가 없는 옛 경험 카드: 읽기·저장·master 생성이 모두 동작해야 한다.
2. 기본 질문을 두 번 실행해도 중복으로 덧붙지 않아야 한다(idempotent).
3. 결정 단계에서 Ctrl+C를 누르면 아무 카드도 바뀌지 않아야 한다.
4. review.md 2단계 파일에 결정 절만 있거나 질문 절만 있어도 `--apply`가 동작해야 한다.
5. 반영 응답의 contribution·category 값이 enum 밖이면, 그 필드만 버리고 나머지는 반영해야 한다.

---

### Task 1: 스키마 필드와 기본 질문 모듈

**Files:**
- Modify: `src/core/schema.ts`
- Create: `src/review/baseQuestions.ts`
- Test: `test/review/baseQuestions.test.ts`, `test/store/experiences.test.ts`(옛 카드 읽기 1건 추가)

**Interfaces (Produces):**
- `schema.ts`:
  - `export const CONTRIBUTIONS = ["직접 수행", "학습 후 재수행", "AI 보조", "AI 주도", "개념 해석"] as const;`
  - `export const CATEGORIES = ["프로젝트", "연구", "대회·CTF", "교육·수업", "동아리·스터디", "기타"] as const;`
  - `QUESTION_FIELDS`에 `"contribution"` 추가(`"other"` 앞).
  - `ExperienceFrontmatter`에 `contribution: z.enum(CONTRIBUTIONS).nullable().default(null)`, `category: z.enum(CATEGORIES).nullable().default(null)` 추가(`team_size` 다음).
- `baseQuestions.ts`:
  - `export const CONTRIBUTION_Q = "이 작업에서 본인이 직접 한 부분과 강의·팀원·AI의 도움을 받은 부분은 각각 무엇인가요? 지금 혼자 다시 할 수 있나요?";`
  - `export function evidenceModified(state: State, evidence: string[]): string[]`: evidence의 각 rel에 대해 `state.files` 항목 중 `card === rel`인 것의 `card_snapshot.modified`(문자열)를 앞 7자(YYYY-MM)로 잘라 정렬·중복 제거해 반환한다. 없으면 건너뛴다.
  - `export function ensureBaseQuestions(fm: ExperienceFrontmatter, mods: string[]): ExperienceFrontmatter`: 아래 규칙으로 질문을 덧붙인다. 덧붙일 것이 없으면 **같은 객체**(`fm`)를 반환한다. 새 질문 id는 `q${기존 질문 수 + 1}`부터 차례로 매긴다.
    1. `fm.contribution === null`이고 `field === "contribution"`인 질문이 없으면 `{ field: "contribution", q: CONTRIBUTION_Q, a: null }`를 덧붙인다.
    2. `a === null`인 period 질문이 없을 때 기간 질문을 덧붙인다. `range`는 `mods`가 있으면 `${mods[0]} ~ ${mods.at(-1)}`이고, 둘이 같으면 하나만 쓴다.
       - `fm.period === null`이면: `실제로 진행한 시기(시작~종료 연월)는 언제인가요?`에 range가 있으면 ` (근거 파일 수정일: ${range}, 복사·재저장 날짜일 수 있음)`을 붙인다.
       - `fm.period`가 있고 mods가 있으며, period에서 뽑은 4자리 연도 집합과 mods 연도 집합이 겹치지 않으면: `카드 기간은 ${period}, 근거 파일 수정일은 ${range}입니다. 실제 진행 시기를 알려 주세요(맞으면 "맞음").` period에서 연도를 못 뽑으면 덧붙이지 않는다.
    - 이미 답이 있는 period 질문(`a !== null`)이 있으면 2번은 건너뛴다(답한 기간을 다시 묻지 않음).

- [ ] **Step 1: 실패하는 테스트 작성** (`test/review/baseQuestions.test.ts`)
  - contribution null, 질문 없음 → contribution 질문 1개가 덧붙는다(id q1).
  - 두 번 적용해도 질문 수가 같다. 두 번째 호출은 같은 객체를 반환한다(`toBe`).
  - contribution이 이미 `"AI 주도"`이면 contribution 질문을 덧붙이지 않는다.
  - period null, mods `["2026-10","2026-11"]` → 질문 문구에 `근거 파일 수정일: 2026-10 ~ 2026-11`이 들어간다. mods가 `[]`이면 괄호가 없다.
  - period `"2021-06 ~ 2021-08"`, mods `["2026-10"]` → 확인 질문(`카드 기간은 2021-06 ~ 2021-08, 근거 파일 수정일은 2026-10입니다`). mods `["2021-07"]`이면 덧붙이지 않는다.
  - 답이 있는 period 질문이 있으면 기간 질문을 덧붙이지 않는다. `a: null`인 period 질문이 있어도 덧붙이지 않는다.
  - 기존 질문 2개 → 새 id는 q3, q4.
  - `evidenceModified`: state.files 두 항목(`modified` `"2026-11-03"`, `"2026-10-27"`), 같은 달 중복 하나, 없는 rel 하나 → `["2026-10","2026-11"]`.
  - `experiences.test.ts`: contribution·category 키가 없는 옛 카드 파일을 `listExperiences`가 읽으면 두 값이 null이다.
- [ ] **Step 2:** `npx vitest run test/review/baseQuestions.test.ts test/store/experiences.test.ts`. 실패를 확인한다.
- [ ] **Step 3:** 구현한다.
  - `schema.ts`에서 `ExperienceQuestion.field`는 `QUESTION_FIELDS`를 쓰므로 자동으로 확장된다.
  - `test/store/masterMd.test.ts`처럼 `ExperienceFrontmatter` 리터럴을 만드는 테스트와 헬퍼, 그리고 `src/commands/group.ts`의 경험 생성 객체에 `contribution: null, category: null`을 추가해 tsc를 통과시킨다.
- [ ] **Step 4:** `npm test && npx tsc --noEmit`. 모두 통과해야 한다.
- [ ] **Step 5:** 커밋 `feat(schema): contribution/category on experience cards; local base questions (11.4)`

### Task 2: 묶기 단계: category 출력, 기본 질문 적용

**Files:**
- Modify: `src/analyzer/group.ts`, `src/commands/group.ts`, `test/fake-agent/fake-agent.ts`(묶기 응답에 category 추가)
- Test: `test/analyzer/group.test.ts`, `test/commands/group.test.ts`

**Interfaces:**
- Consumes: Task 1의 `CATEGORIES`, `ensureBaseQuestions`, `evidenceModified`.
- Produces: `NewExp`에 `category: Category | null`이 추가된다(`z.enum(CATEGORIES).nullish().catch(null).transform(v => v ?? null)`).

변경 사항:
1. `buildGroupPrompt` 출력 형식 예시에 `"category":"프로젝트|연구|대회·CTF|교육·수업|동아리·스터디|기타"`를 추가한다(type 다음).
2. 규칙 두 줄을 추가한다.
   - `- category는 이력서 분류입니다(문서 형식인 type과 다름). 수업 과제는 교육·수업, CTF·워게임·대회는 대회·CTF, 연구실 활동은 연구입니다.`
   - `- 본인 기여도·AI 활용 정도와 기간은 묻지 마세요(따로 묻습니다).`
3. 질문 검증 단계(`Questions` 변환)에서 `field === "period"`인 LLM 질문을 버린다. 새 경험과 attach 둘 다 해당한다. 버린 뒤 3개까지 자른다.
4. `src/commands/group.ts`:
   - 새 경험: fm을 만든 뒤 `ensureBaseQuestions(fm, evidenceModified(state, fm.evidence))`를 적용하고 `createExperience`에 넘긴다. `category`는 `exp.category`, `contribution`은 null이다.
   - attach: `next`를 만든 뒤 같은 방식으로 `ensureBaseQuestions`를 적용한다.
   - 병합 경로(여러 배치의 경험을 합칠 때)에서 category는 첫 경험의 값을 쓴다.
5. fake-agent의 `[묶기 단계]` 응답에서 각 경험에 `category: "프로젝트"`를 넣는다. 질문 목록에 `{field:"period", q:"언제였나요?"}`를 하나 섞어 버려지는지 검증할 수 있게 한다. 기존 시나리오가 기대하는 질문 수가 바뀌면 테스트 기대값을 함께 고친다.

- [ ] **Step 1: 실패하는 테스트**
  - `group.test.ts`(analyzer): period 질문은 버려지고, 잘못된 category(`"아무거나"`)는 null이 된다. 프롬프트에 `category`와 `본인 기여도·AI 활용 정도와 기간은 묻지 마세요`가 들어간다.
  - `group.test.ts`(command): seedCards에 `modified: "2026-11-03"`, `period: null`을 넣고 runGroup을 실행한다. 생성된 경험에서 다음을 확인한다.
    - `category === "프로젝트"`
    - questions에 contribution 질문 1개
    - `근거 파일 수정일: 2026-11`이 든 period 질문 1개
    - LLM이 낸 `"언제였나요?"`는 없음
- [ ] **Step 2:** 실패 확인.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** `npm test && npx tsc --noEmit`.
- [ ] **Step 5:** 커밋 `feat(group): category output; drop LLM period questions; append local base questions (11.4)`

### Task 3: 반영 단계: 필드 표시 Q, contribution·category, 답을 필드에 넣는 가짜 에이전트

**Files:**
- Modify: `src/analyzer/reviewApply.ts`, `test/fake-agent/fake-agent.ts`
- Test: `test/analyzer/reviewApply.test.ts`, `test/commands/review.test.ts`

변경 사항:
1. `buildApplyPrompt`:
   - Q 줄을 `Q[${q.field}]: …`로 쓴다.
   - 카드 JSON에 `contribution`, `category`를 포함한다.
   - 출력 예시에 `"contribution":"AI 주도","category":"대회·CTF"`를 추가한다.
   - 규칙 세 줄을 추가한다.
     - `- contribution(수행 방식)은 답변에 근거해 다음 중 하나로 분류하세요: 직접 수행(처음부터 직접) / 학습 후 재수행(강의·가이드로 배운 뒤 혼자 다시) / AI 보조(본인 주도, AI는 보조) / AI 주도(AI 에이전트가 대부분 수행, 본인은 방향·검증) / 개념 해석(본인은 개념·설계 해석, 구현은 AI·타인). 근거가 없으면 생략.`
     - `- role과 star의 a(Action)는 본인이 직접 한 일과 도움받은 부분(강의·팀원·AI)을 구분해 쓰세요.`
     - `- metrics는 결과·성과입니다. 문서 통계(슬라이드 장수, 파일·페이지·참고자료 개수)는 쓰지 마세요.`
2. `ApplyResult`에 `contribution: z.enum(CONTRIBUTIONS).nullish().catch(undefined).transform(v => v ?? undefined)`와 `category`(같은 방식, CATEGORIES)를 추가한다. enum 밖 값은 그 필드만 버린다.
3. `mergeApply`가 반영하는 키 목록에 `contribution`, `category`를 추가한다.
4. fake-agent `[반영 단계]`는 블록마다 `Q[field]: …` / `A: …` 쌍을 파싱한다. 답이 비었거나 `모름`이면 넣지 않는다. 나머지는 다음 규칙으로 필드에 넣는다.

   | 필드 | 넣는 방식 |
   |---|---|
   | period, org, role | 답 문자열 그대로 |
   | team_size | 답에서 첫 정수, 없으면 넣지 않음 |
   | metrics | `[답]` |
   | skills | 답을 `,`로 나눔 |
   | contribution | 답에 `AI`와 `대부분`이 있으면 `"AI 주도"`. `강의`가 있으면 `"학습 후 재수행"`. `개념`이 있으면 `"개념 해석"`. `AI`만 있으면 `"AI 보조"`. 그 밖은 `"직접 수행"` |
   | other | 무시 |

   star는 `{s:"상황",t:"과제",a:"행동",r:"결과"}`로 둔다. `role`이 없으면 넣지 않는다(기존 고정값 `"팀장(답변 반영)"` 제거). `apply-rate-limit` 시나리오는 그대로 둔다.
5. 기존 `review.test.ts`의 `expect(e.fm.role).toBe("팀장(답변 반영)")` 같은 기대값을 답 기반 값으로 고친다.

- [ ] **Step 1: 실패하는 테스트**
  - `reviewApply.test.ts`:
    - 프롬프트에 `Q[role]:`이 있고 contribution 규칙 문구가 들어간다.
    - `ApplyResult.parse({id:"x1", contribution:"엉터리", category:"연구", star:{…}})` → contribution undefined, category "연구".
    - `mergeApply`가 contribution을 반영한다.
  - `review.test.ts`(command): group 후 질문 답 `role`=`"팀장"`, contribution 질문 답 `"AI가 대부분 하고 검증만"`, `metrics` 답 `"모름"`으로 review를 돌린다. 반영 뒤 다음을 확인한다.
    - `role === "팀장"`
    - `contribution === "AI 주도"`
    - metrics는 seed 값 그대로
- [ ] **Step 2:** 실패 확인.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** `npm test && npx tsc --noEmit`.
- [ ] **Step 5:** 커밋 `feat(review-apply): field-tagged Q/A, contribution/category; fake agent maps answers to fields (11.4)`

### Task 4: 결정 먼저: 터미널 체크박스, 2단계 review.md, 기본 질문 마이그레이션

**Files:**
- Modify: `src/review/session.ts`, `src/review/reviewFile.ts`, `src/commands/review.ts`
- Test: `test/commands/review.test.ts`, `test/commands/reviewTerminal.test.ts`, `test/commands/cliReview.test.ts`, `test/review/*`(있으면)

**Interfaces:**
- `ReviewIO`에서 `decide`를 없애고 다음을 추가한다.
  ```ts
  /** null = 그만두기(아무것도 바꾸지 않음). 반환 rel 집합. 고르지 않은 나머지는 보류 */
  decideMany(items: { rel: string; label: string }[]): Promise<{ adopted: Set<string>; excluded: Set<string> } | null>;
  ```
- `session.ts`:
  - `export function decisionTargets(exps, all)`: `!edited`이고 review가 pending·held이며 (`all` 또는 value !== "하")인 것.
  - `export function questionTargets(exps)`: `!edited`이고 review === "adopted"이며 `a === null` 질문이 있는 것.
  - `reviewTargets`는 제거한다(사용처 교체).
  - `runReviewSession(out, state, exps, all, io)`:
    1. 결정 대상이 있으면 `decideMany`를 부른다. label은 ``${i+1}. ${title} — ${period ?? "기간 미상"} · 근거 ${evidence.length}개 · 가치 ${value ?? "미판정"}``다. null이면 `{quit:true}`로 즉시 반환한다(저장 없음). 아니면 adopted/excluded/나머지 held로 `decideReview` 저장하고 decided를 센다.
    2. 다음으로 `questionTargets`의 각 경험에 대해 요약을 show하고 `a:null` 질문을 하나씩 묻는다(기존 answer 흐름). 경험별 decide는 없다.
- `terminalIO.decideMany`는 `@inquirer/prompts`의 `checkbox`를 두 번 쓴다.
  - 1차: `채택할 경험을 고르세요 (스페이스로 선택, Enter로 확정)`
  - 2차: 남은 항목만 보여 주며 `제외할 경험을 고르세요 (나머지는 보류)`
  - 남은 항목이 없으면 2차는 생략한다. `pageSize: 20`. ExitPromptError는 null로 바꾼다(`quitOnExit`).
- `reviewFile.ts`:
  - `writeReviewFile(out, decisions, questions)`:
    - 머리말 뒤에 `# 1. 결정`(decisions가 있을 때만)을 쓴다. 각 항목은 `## ${rel}`, `제목: …`, `기간: … / 근거 ${n}개 / 가치 …`, 빈 줄, `결정:`, 빈 줄이다.
    - 이어서 `# 2. 질문`(questions가 있을 때만)을 쓴다. 각 항목은 `## ${rel}`, 제목·기간·역할 줄, `### qN (field) q`, `A:`이며 **결정 줄은 없다**.
    - 머리말 안내문은 `결정 절의 \`결정:\` 뒤에 채택·보류·제외 중 하나를 쓰세요. 질문 절의 \`A:\` 뒤에 답을 쓰세요(여러 줄 가능). 다 쓴 뒤 \`mp review --apply\`.`로 바꾼다.
  - `parseReviewFile`은 `# ` 제목 줄을 무시한다. 같은 rel이 두 절에 나오면 결정과 답을 합친다(`## experiences/` 섹션 파싱은 그대로).
- `commands/review.ts`:
  - `acceptEdits`를 제외한 모든 모드에서 시작할 때 **마이그레이션**을 한다. review !== "excluded"이고 `!edited`인 경험마다 `ensureBaseQuestions(fm, evidenceModified(state, fm.evidence))`를 적용하고, 결과가 다른 객체일 때만 `saveExperience`한다.
  - `--file`은 `decisionTargets`와 `questionTargets`로 파일을 쓴다. 둘 다 비면 `질문할 경험이 없습니다…`를 출력한다.
  - `--apply`는 반영한 뒤, 이번 파일에서 결정이 adopted로 바뀌었고 `a:null` 질문이 남은 경험 수 N이 0보다 크면 `새로 채택한 경험 ${N}개에 질문이 있습니다. \`mp review --file\`을 다시 실행하세요.`를 출력한다.
  - 터미널 모드는 `runReviewSession(out, state, exps, !!opts.all, io)`이다.
  - 값 '하' 건너뜀 안내는 유지한다.

- [ ] **Step 1: 실패하는 테스트** (`scripted` IO를 `decideMany` 기반으로 바꾼다)
  - 결정 먼저: 경험 3개 중 하나를 adopted, 하나를 excluded로 고르면 나머지는 held다. 질문은 adopted 경험의 것만 answer로 불린다(answer 호출 횟수 확인).
  - decideMany가 null이면 모든 카드가 그대로다(review pending, 파일 해시 불변).
  - held 경험은 다음 실행에서 다시 결정 대상이 된다.
  - 마이그레이션: contribution 질문이 없는 옛 카드(group 후 직접 질문 목록에서 contribution을 지운 카드)에 review를 돌리면 contribution 질문이 생긴다. 두 번 돌려도 하나뿐이다.
  - `--file`: 결정 절에 질문(`### q`)이 없고, 질문 절에 결정 줄이 없다. `--apply`로 결정만 채우면 새로 채택 안내 문구가 나온다. 이어서 `--file`을 하면 질문 절에 그 경험이 나온다.
  - 결정 절만, 혹은 질문 절만 있는 파일도 파싱된다.
  - `reviewTerminal.test.ts`: `terminalIO.decideMany`가 ExitPromptError에서 null을 반환한다(기존 decide 테스트 교체).
- [ ] **Step 2:** 실패 확인.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** `npm test && npx tsc --noEmit`.
- [ ] **Step 5:** 커밋 `feat(review): decide-first flow (bulk checkbox, two-part review.md); migrate base questions (11.4)`

### Task 5: master.md: 이력서 분류, 표시 보정, 수행 방식

**Files:**
- Modify: `src/store/masterMd.ts`
- Test: `test/store/masterMd.test.ts`

**Interfaces:**
- `export function inferCategory(fm: ExperienceFrontmatter): Category`: `fm.category`가 있으면 그 값을 쓴다. 없으면 `${title} ${org ?? ""}`에 아래 정규식을 순서대로 적용해 첫 일치를 고른다.
  1. `/CTF|워게임|wargame|dreamhack|pwnable|대회|예선|본선|해커톤|공모전/i` → 대회·CTF
  2. `/동아리|스터디|학회/` → 동아리·스터디
  3. `/\bLab\b|연구실|연구/i` → 연구
  4. `/수업|과제|강의|교육과정|학기/`에 맞거나 `type === "과제"` → 교육·수업
  5. 그 밖 → 프로젝트
- `renderMaster`:
  - `## ${category}`로 묶는다. 순서는 `CATEGORIES` 순서이고, 안에서는 기존 최신순 정렬을 유지한다.
  - 표시 보정:
    - 기간 `/^(\d{4}-\d{2}) ~ \1$/`은 `$1`로 줄인다.
    - team_size 1은 역할 뒤에 ` (개인)`을 붙인다. 역할에 `/개인|단독|혼자/`가 있으면 생략한다. 역할이 없으면 `- 팀 규모: 개인`이다. 2 이상은 기존 `(팀 N명)` / `- 팀 규모: N명`이다.
    - contribution이 있으면 역할 줄 다음에 `- 수행 방식: ${contribution}`을 쓴다.
    - 성과에서 `DOC_STAT = /^(슬라이드|페이지|장|쪽|파일|header file|source file|참고 ?자료)\s*[\d,]+|[\d,]+\s*(장|쪽|페이지)$|(header|source) file\s*\d+/i`에 맞는 항목은 뺀다(trim 후 검사). 남은 게 없으면 성과 줄을 생략한다.

- [ ] **Step 1: 실패하는 테스트**
  - category 묶음 순서: 프로젝트 → 연구 → 대회·CTF. `category: null`인 `"워게임 리버싱"`은 대회·CTF로, `org: "보안 Lab"`은 연구로, `type: "과제"`는 교육·수업으로, `org: "학술 동아리"`는 동아리·스터디로 간다.
  - `"2024-01 ~ 2024-01"`은 `- 기간: 2024-01`로 나온다.
  - role `"개인 프로젝트 (단독 개발)"` + team 1은 `(개인)`도 `(팀 1명)`도 붙지 않는다. role `"분석"` + team 1은 `- 역할: 분석 (개인)`이다.
  - contribution `"AI 주도"`는 `- 수행 방식: AI 주도`로 나온다.
  - metrics `["슬라이드 17장","Header file 13개","정확도 92%","참고 자료 14건"]`은 `- 성과: 정확도 92%`만 남는다. 전부 문서 통계면 성과 줄이 없다.
  - 기존 테스트의 `## 보고서`/`## 발표` 기대값을 category 기준으로 고친다.
- [ ] **Step 2:** 실패 확인.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** `npm test && npx tsc --noEmit && npm run build`.
- [ ] **Step 5:** 커밋 `feat(master): group by resume category; collapse periods, solo team, contribution line, drop doc-stat metrics (11.4)`
