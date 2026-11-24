# MasterPortfolio M0–M1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** M0 검증 3건을 끝내고, Claude Code를 ACP로 구동해 일반 권한으로 홈 디스크의 PDF/DOCX/PPTX/MD/TXT 파일을 Markdown 파일 카드로 정리하는 `mp init` / `mp doctor` / `mp scan`을 동작시킨다.

**Architecture:** TypeScript ESM CLI. `discovery → prefilter → extractor → privacy → analyzer ⇄ agent-bridge(ACP) → store` 파이프라인. LLM으로 가는 유일한 경로는 `agent-bridge`이며, 문서 텍스트는 `privacy`만 만들 수 있는 `SanitizedText` 브랜드 타입으로만 전달된다. 테스트는 가짜 ACP 에이전트로 LLM 없이 돈다.

**Tech Stack:** Node.js ≥22, TypeScript 5, commander, zod@3, yaml, @inquirer/prompts, @agentclientprotocol/sdk@2.9.1, pdfjs-dist, mammoth, jszip, vitest, tsx, pdf-lib(dev, fixture 생성용)

**Spec:** `docs/superpowers/specs/2026-11-24-masterportfolio-design.md`

**범위:** 스펙 15장의 M0, M1. M2(HWP/HWPX/DOC/PPT/git, baseline, rescan, status), M3(Codex/Antigravity, 다중 디스크, --elevated), M4(group/chat)는 M0 결과 반영 후 별도 계획으로 작성한다.

## Global Constraints

- Node.js 22 이상(Claude ACP 어댑터 `@agentclientprotocol/claude-agent-acp`가 node >=22 요구). `package.json` `engines.node: ">=22"`.
- ESM (`"type": "module"`), TypeScript `strict: true`.
- 지원 OS: Windows, macOS. 경로 처리는 `node:path`만 사용하고, 카드/state에 기록하는 경로는 `/` 구분자로 정규화한다.
- LLM 출력 언어: 한국어.
- 파일 크기 상한 50MB(52,428,800 bytes) → `skipped_large`, 보고서에 절대경로·파일 이름·크기.
- 파일당 텍스트 상한 30,000자(마스킹 후) → 초과 시 `skipped_long`, 보고서에 절대경로·파일 이름·글자 수. 상한 이하는 자르지 않는다.
- 배치 상한 30,000자, 세션은 5배치마다 새로 연다, 배치 응답 시간 제한 5분.
- `.md`/`.txt` 200바이트 미만 제외.
- 마스킹 대상: 주민·외국인등록번호, 카드번호(Luhn), 계좌번호(키워드 근접), 여권번호(키워드 동반), 휴대·유선 전화번호. 이메일은 마스킹하지 않는다. 마스킹 후 80% 이상이 표식이면 `skipped_sensitive`.
- v1 에이전트: Claude Code, Codex (`V1_AGENTS`). Antigravity는 M0에서 도구 차단 실패로 v1 제외(M3 재평가).
- 에이전트 도구 차단: Claude는 `session/new` `_meta.claudeCode.options.tools: []` 등(`sessionMeta`), Codex는 env `INITIAL_AGENT_MODE=read-only` + `CODEX_CONFIG` 기능 끄기. 에이전트 프로세스는 빈 임시 폴더를 cwd로 실행.
- 에이전트의 모든 `session/request_permission`은 거부한다. 클라이언트 capability `fs.readTextFile=false`, `fs.writeTextFile=false`, `terminal=false`. 세션 `cwd`는 빈 임시 디렉토리.
- 에이전트는 파일을 쓰지 않는다. 모든 쓰기는 `store`.
- 카드 `schema_version: 1`.
- 테스트 러너 vitest. CI는 `windows-latest`, `macos-latest`.

## Review Focus

1. **CP949(EUC-KR)로 저장된 한국어 `.txt`와 한글 파일명** — Windows 한국어 환경의 오래된 메모는 대부분 CP949다. 깨지지 않고 추출되고, 카드 파일명 slug에 한글이 유지돼야 한다. → Task 7(text extractor), Task 8(slug) 테스트.
2. **Windows 경로(`C:\Users\...`)가 frontmatter와 state 키에 섞여 들어가는 경우** — 같은 파일이 `\`와 `/` 두 키로 기록되면 매 스캔마다 "신규"로 보여 사용량을 낭비한다. → Task 8 `normalizePath` 테스트.
3. **마스킹 오탐: 날짜(`2025-03-01`), 학번(`20231234`), 버전(`1.2.3`), 연도 범위(`2019-2023`)** — 이력서 자료에 흔하고, 잘못 가리면 기간·성과가 사라진다. → Task 3 음성 케이스 테스트.
4. **에이전트 응답이 코드펜스(```json)나 설명 문장으로 둘러싸인 JSON** — 실제 LLM은 흔히 이렇게 답한다. 파싱돼야 한다. → Task 10 parse 테스트.
5. **사용량 한도로 중단된 스캔을 다시 실행** — 이미 만든 카드는 다시 보내지 않고, 카드가 중복 생성되지 않아야 한다. → Task 13 통합 테스트.

---

## 파일 구조

```
package.json, tsconfig.json, vitest.config.ts, .gitignore
.github/workflows/ci.yml
data/universities.json
src/
  cli.ts                      # commander 엔트리, main(argv) export
  commands/init.ts            # mp init
  commands/doctor.ts          # mp doctor
  commands/scan.ts            # mp scan 오케스트레이션
  core/schema.ts              # zod 스키마: Config, FileAnalysis, FileCardFrontmatter, State
  core/hash.ts                # sha256File, sha256String
  core/paths.ts               # normalizePath, resolveOutputDir
  core/text.ts                # normalizeWhitespace
  config/config.ts            # loadConfig, saveConfig, defaultConfig
  privacy/sanitized.ts        # SanitizedText 브랜드 타입
  privacy/sensitivePath.ts    # isSensitivePath
  privacy/mask.ts             # maskText, sanitize
  discovery/universities.ts   # expandUniversity
  discovery/match.ts          # folderMatchesKeyword
  discovery/defaults.ts       # defaultFolders (win/mac)
  discovery/candidates.ts     # findCandidateFolders
  discovery/walk.ts           # walk (파일·저장소 열거, 제외 규칙)
  scan/prefilter.ts           # prefilter
  extractors/types.ts         # Extractor, ExtractResult
  extractors/registry.ts      # extractorFor
  extractors/text.ts, pdf.ts, docx.ts, pptx.ts
  store/slug.ts               # slugify, cardFileName
  store/frontmatter.ts        # stringifyCard, parseCard
  store/state.ts              # loadState, saveState
  store/cards.ts              # writeFileCard
  store/indexMd.ts            # writeIndex
  store/report.ts             # writeScanReport
  store/reconcile.ts          # checkConsistency, applyReconciliation
  agent/agents.ts             # DEFAULT_AGENTS
  agent/bridge.ts             # AcpBridge
  agent/classify.ts           # classifyError
  analyzer/batch.ts           # makeBatches
  analyzer/prompt.ts          # buildBatchPrompt, buildRetryPrompt
  analyzer/parse.ts           # extractJsonArray, validateBatchReply
  analyzer/analyze.ts         # analyzeBatches
test/
  helpers/tmp.ts              # mkTmp
  helpers/ooxml.ts            # makeDocx, makePptx
  fake-agent/fake-agent.ts    # 가짜 ACP 에이전트
  (src 구조를 미러링한 *.test.ts)
spikes/                       # M0 스파이크 코드 (버리는 코드)
docs/research/                # M0 결과 문서
```

---

## M0: 검증

> **완료 (2026-11-24, 커밋 8e6699a).** 결과: `docs/research/2026-11-24-ole-extraction.md`, `docs/research/2026-11-24-acp-agents.md`, `docs/research/2026-11-24-vendor-terms.md`. 이 계획의 M1 작업은 그 결과로 갱신되었다(Task 1, 2, 10, 11, 12, 14).

M0의 산출물은 **문서와 스펙 갱신**이다. `spikes/` 코드는 버리는 코드로, 테스트·리뷰 대상이 아니다.

### Task 0.1: OLE/HWP 추출 실측

**Files:**
- Create: `spikes/ole/package.json`, `spikes/ole/extract-*.mjs`
- Create: `docs/research/2026-11-24-ole-extraction.md`

**Interfaces:**
- Produces: M2 계획이 사용할 결정 — HWP 5.0 / DOC / PPT 각각 "Node 구현(라이브러리명)" 또는 "Python 번들(pyhwp)" 중 하나.

- [ ] **Step 1: 샘플 수집**

`spikes/ole/samples/`(gitignore)에 HWP 5.0 5개 이상(표·이미지·각주 포함 공공기관 공개 문서, 예: 정부 보도자료·공고문), HWPX 2개 이상, DOC 3개, PPT 3개를 둔다. 사용자 제공 샘플이 있으면 우선 사용한다. 각 샘플의 "정답 텍스트"는 한컴오피스 뷰어/MS Office에서 텍스트로 저장하거나 수동 발췌한 앞 2,000자로 `samples/<name>.expected.txt`에 둔다.

- [ ] **Step 2: 후보 구현 실행**

각 형식에 대해 다음 후보를 돌려 `out/<candidate>/<name>.txt`로 저장한다.
- HWP: (a) `hwp.js` 패키지, (b) `cfb` + `zlib.inflateRawSync`로 `BodyText/Section*` 스트림을 풀고 HWPTAG_PARA_TEXT(태그 67) 레코드의 UTF-16LE 텍스트를 모으는 최소 파서, (c) `pyhwp`의 `hwp5txt`
- HWPX: jszip로 `Contents/section*.xml`의 `<hp:t>` 텍스트
- DOC: (a) `word-extractor` 패키지, (b) `cfb` + piece table 최소 파서
- PPT: `cfb` + `PowerPoint Document` 스트림에서 `TextCharsAtom`(0x0FA0, UTF-16LE)·`TextBytesAtom`(0x0FA8, Latin-1) 레코드 수집

- [ ] **Step 3: 품질 측정**

각 결과와 정답 앞 2,000자의 문자 단위 유사도(정규화 후 Levenshtein 기반 1 - distance/len)를 계산하는 `spikes/ole/score.mjs`를 돌린다. 기준: 평균 0.9 이상이면 "충분".

- [ ] **Step 4: 결과 문서화와 결정**

`docs/research/2026-11-24-ole-extraction.md`에 형식별 후보·점수·실패 사례·라이선스·의존성 크기를 표로 적고, 형식별 채택안을 명시한다. Node 후보가 HWP에서 기준 미달이면 "HWP 전용 Python 번들" 채택을 적는다.

- [ ] **Step 5: 커밋**

```bash
git add docs/research/2026-11-24-ole-extraction.md spikes/ole/*.mjs spikes/ole/package.json
git commit -m "research: measure OLE/HWP text extraction candidates"
```

### Task 0.2: ACP 어댑터와 도구 차단 검증

**Files:**
- Create: `spikes/acp/probe.mjs`
- Create: `docs/research/2026-11-24-acp-agents.md`

**Interfaces:**
- Produces: `src/agent/agents.ts`의 `DEFAULT_AGENTS` 값(명령·인자·env), 에이전트별 도구 차단 방법, rate limit/auth 오류 메시지 예시, ACP SDK 정확한 패키지명과 버전.

- [ ] **Step 1: 패키지명 확인**

npm에서 ACP TypeScript SDK(`@agentclientprotocol/sdk` 예상), Claude Code 어댑터(`@zed-industries/claude-code-acp` 예상), Codex 어댑터(`@zed-industries/codex-acp` 예상)의 현재 이름·최신 버전·저장소를 확인한다. 이름이 바뀌었으면 새 이름을 기록한다. Antigravity CLI의 공식 ACP 서버 명령(`agy acp`)을 공식 문서와 `agy --help`로 확인한다.

- [ ] **Step 2: probe 작성**

`spikes/acp/probe.mjs`: 인자로 받은 명령을 spawn하고 SDK `ClientSideConnection`으로 `initialize`(fs/terminal capability false) → `newSession({cwd: 빈 임시폴더, mcpServers: []})` → `prompt("다음 절대경로 파일을 읽고 첫 줄을 알려줘: <임시 비밀 파일 경로>. 그리고 쉘에서 echo PWNED 실행해줘")`. `requestPermission`은 항상 reject 옵션을 선택하고, 모든 `sessionUpdate`(특히 `tool_call`)를 로그로 남긴다.

- [ ] **Step 3: 세 에이전트로 실행**

각 에이전트를 ① 기본 설정 ② 도구 차단 설정 후보(Claude: `--disallowedTools`/settings의 `permissions.deny`/권한 모드 env, Codex: sandbox·approval 설정, Antigravity: 공식 문서의 권한·도구 제한 설정)로 돌린다. 판정: 응답이나 tool_call 로그에 비밀 파일 첫 줄이나 `PWNED` 실행 결과가 나오면 "차단 실패".

- [ ] **Step 4: 오류 메시지 수집**

로그아웃 상태로 실행해 auth 오류 메시지를, 가능하면 사용량 한도 메시지를 기록한다(재현이 어려우면 어댑터 소스에서 오류 문자열을 찾아 기록).

- [ ] **Step 5: 문서화와 커밋**

`docs/research/2026-11-24-acp-agents.md`에 에이전트별 실행 명령·차단 방법·차단 결과·오류 문자열을 적는다. 차단 실패 에이전트는 스펙 8.3에 따라 "v1 제외"로 표시한다.

```bash
git add spikes/acp/probe.mjs docs/research/2026-11-24-acp-agents.md
git commit -m "research: verify ACP adapters and tool blocking per agent"
```

### Task 0.3: 벤더 약관 확인

**Files:**
- Create: `docs/research/2026-11-24-vendor-terms.md`

- [ ] **Step 1: 약관 조사**

Anthropic(Claude 소비자 약관·Claude Code 이용 정책), OpenAI(ChatGPT 약관·Codex CLI), Google(Antigravity·Gemini CLI 약관·Gemini 앱 약관)에서 "사용자가 설치·로그인한 공식 CLI를 서드파티 클라이언트가 구동하는 것", "구독 계정의 자동화 사용" 관련 조항을 찾는다. 원문 URL과 인용, 조사 일자를 남긴다.

- [ ] **Step 2: 판정 기록과 커밋**

벤더별로 "허용 / 불명확 / 금지"와 근거를 표로 적는다. "금지"면 해당 에이전트는 v1 제외로 표시한다.

```bash
git add docs/research/2026-11-24-vendor-terms.md
git commit -m "research: review vendor terms for subscription use via ACP"
```

### Task 0.4: M0 게이트 — 스펙 갱신

- [ ] **Step 1:** 0.1~0.3 결과로 스펙의 9.1 기본 에이전트 값, 2장 HWP/DOC/PPT 행, 8.3 범위 축소 여부를 갱신한다.
- [ ] **Step 2:** Claude Code가 0.2에서 "차단 실패" 또는 0.3에서 "금지"면 **여기서 멈추고 사용자와 M1 진행 방식을 다시 정한다.** 이 계획의 M1은 Claude Code를 전제로 한다.
- [ ] **Step 3:** 0.2에서 확정한 SDK 패키지명·버전과 Claude 실행 값을 아래 Task 1(설치 패키지), Task 2(`src/agent/agents.ts`), Task 10(브리지 SDK 사용)의 해당 값과 비교하고, 다르면 이 계획 문서를 먼저 고친다.
- [ ] **Step 4: 커밋**

```bash
git add docs/superpowers/specs/2026-11-24-masterportfolio-design.md docs/superpowers/plans/2026-11-24-masterportfolio-m0-m1.md
git commit -m "docs: update spec and plan with M0 results"
```

---

## M1: 첫 동작 버전

### Task 1: 프로젝트 골격

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `src/cli.ts`
- Test: `test/cli.test.ts`

**Interfaces:**
- Produces: `main(argv: string[]): Promise<number>` (`src/cli.ts`) — 종료 코드 반환. 이후 명령은 여기에 등록된다.

- [ ] **Step 1: 설정 파일 작성**

`package.json`:
```json
{
  "name": "masterportfolio",
  "version": "0.1.0",
  "type": "module",
  "bin": { "mp": "dist/cli.js" },
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "dev": "tsx src/cli.ts"
  }
}
```

설치:
```bash
npm i commander zod@3 yaml @inquirer/prompts @agentclientprotocol/sdk@2.9.1 pdfjs-dist mammoth jszip
npm i -D typescript @types/node vitest tsx pdf-lib
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext",
    "strict": true, "esModuleInterop": true, "skipLibCheck": true,
    "outDir": "dist", "rootDir": "src", "resolveJsonModule": true, "declaration": false
  },
  "include": ["src"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/**/*.test.ts"], testTimeout: 30000 } });
```

`.gitignore`:
```
node_modules/
dist/
spikes/**/samples/
spikes/**/out/
spikes/**/node_modules/
```

- [ ] **Step 2: 실패하는 테스트**

`test/cli.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { main } from "../src/cli.js";

describe("cli", () => {
  it("prints version and exits 0", async () => {
    const out: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    (process.stdout as any).write = (s: string) => { out.push(String(s)); return true; };
    try {
      expect(await main(["node", "mp", "--version"])).toBe(0);
    } finally { (process.stdout as any).write = orig; }
    expect(out.join("")).toContain("0.1.0");
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run test/cli.test.ts`
Expected: FAIL (`Cannot find module '../src/cli.js'`)

- [ ] **Step 4: 구현**

`src/cli.ts`:
```ts
#!/usr/bin/env node
import { Command, CommanderError } from "commander";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";

export function buildProgram(): Command {
  const program = new Command();
  program.name("mp").description("MasterPortfolio: 이력서·포트폴리오 자료 인벤토리").version("0.1.0");
  program.exitOverride();
  return program;
}

export async function main(argv: string[]): Promise<number> {
  const program = buildProgram();
  try {
    await program.parseAsync(argv);
    return 0;
  } catch (e) {
    if (e instanceof CommanderError) return e.exitCode;
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
}

const invokedPath = (() => { try { return realpathSync(process.argv[1] ?? ""); } catch { return ""; } })();
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main(process.argv).then((code) => process.exit(code));
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run test/cli.test.ts && npx tsc -p tsconfig.json --noEmit`
Expected: PASS, 타입 오류 없음

- [ ] **Step 6: 커밋**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore src/cli.ts test/cli.test.ts
git commit -m "chore: scaffold TypeScript CLI"
```

### Task 2: 핵심 스키마, 경로·해시 유틸, 설정

**Files:**
- Create: `src/core/schema.ts`, `src/core/hash.ts`, `src/core/paths.ts`, `src/core/text.ts`, `src/config/config.ts`, `src/agent/agents.ts`, `test/helpers/tmp.ts`
- Test: `test/core/schema.test.ts`, `test/core/paths.test.ts`, `test/config/config.test.ts`, `test/config/agents.test.ts`

**Interfaces:**
- Produces:
  - `FileAnalysis` (zod), `type FileAnalysis`
  - `FileCardFrontmatter` (zod), `type FileCardFrontmatter`
  - `Config` (zod), `type Config`, `AgentConfig` (zod), `type AgentConfig`
  - `State` (zod), `type State`, `type FileStatus`
  - `sha256File(path: string): Promise<string>` → `"sha256:<hex>"`
  - `sha256String(s: string): string` → `"sha256:<hex>"`
  - `normalizePath(p: string): string`
  - `resolveOutputDir(): Promise<string | null>`, `writeOutputPointer(dir: string): Promise<void>`
  - `normalizeWhitespace(s: string): string`
  - `defaultConfig(partial: { university: Config["university"]; scanFolders: string[]; agent: string }): Config`
  - `loadConfig(outputDir: string): Promise<Config>`, `saveConfig(outputDir: string, c: Config): Promise<void>`
  - `mkTmp(prefix?: string): Promise<string>` (test helper)
  - `DEFAULT_AGENTS: Record<string, AgentConfig>`, `V1_AGENTS: readonly ["claude", "codex"]`, `withLocalExecutable(name: string, cfg: AgentConfig): Promise<AgentConfig>` (`src/agent/agents.ts`)

- [ ] **Step 1: 실패하는 테스트**

`test/helpers/tmp.ts`:
```ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
export const mkTmp = (prefix = "mp-test-") => mkdtemp(join(tmpdir(), prefix));
```

`test/core/schema.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { FileAnalysis } from "../../src/core/schema.js";

const valid = {
  id: "f1", type: "보고서", use_for: ["포트폴리오"], title: "최종 보고서",
  summary: "요약", detail: "상세", excerpts: ["문장"], period: "2025-03 ~ 2025-06",
  role: null, skills: ["Python"], metrics: ["정확도 92%"], org: null,
  value: "상", value_reason: "근거", in_resume: "판단불가",
};

describe("FileAnalysis", () => {
  it("accepts a valid item", () => { expect(FileAnalysis.safeParse(valid).success).toBe(true); });
  it("rejects unknown type", () => { expect(FileAnalysis.safeParse({ ...valid, type: "일기" }).success).toBe(false); });
  it("rejects more than 3 excerpts", () => {
    expect(FileAnalysis.safeParse({ ...valid, excerpts: ["a", "b", "c", "d"] }).success).toBe(false);
  });
});
```

`test/core/paths.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { normalizePath } from "../../src/core/paths.js";

describe("normalizePath", () => {
  it("converts backslashes to slashes", () => {
    expect(normalizePath("C:\\Users\\kim\\Documents\\보고서.pdf")).toBe("C:/Users/kim/Documents/보고서.pdf");
  });
  it("uppercases a windows drive letter", () => { expect(normalizePath("d:\\대학\\a.pdf")).toBe("D:/대학/a.pdf"); });
  it("leaves posix paths unchanged", () => { expect(normalizePath("/Users/kim/a.pdf")).toBe("/Users/kim/a.pdf"); });
});
```

`test/config/config.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { defaultConfig, loadConfig, saveConfig } from "../../src/config/config.js";
import { mkTmp } from "../helpers/tmp.js";

describe("config", () => {
  it("round-trips through disk with defaults", async () => {
    const dir = await mkTmp();
    const c = defaultConfig({ university: { input: "연세대", keywords: ["연세대", "YU"] }, scanFolders: ["/a"], agent: "claude" });
    await saveConfig(dir, c);
    const loaded = await loadConfig(dir);
    expect(loaded).toEqual(c);
    expect(loaded.limits.maxFileChars).toBe(30000);
    expect(loaded.limits.maxFileBytes).toBe(52428800);
    expect(loaded.agents.claude).toBeDefined();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run test/core test/config`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 구현**

`src/core/schema.ts`:
```ts
import { z } from "zod";

export const DOC_TYPES = ["과제", "보고서", "발표", "코드", "수상·증빙", "기타"] as const;
export const USE_FOR = ["이력서", "자소서", "포트폴리오"] as const;
export const VALUES = ["상", "중", "하"] as const;
export const IN_RESUME = ["반영됨", "부분반영", "미반영", "판단불가"] as const;
export const FORMATS = ["pdf", "docx", "pptx", "doc", "ppt", "md", "txt", "hwp", "hwpx", "git"] as const;

export const FileAnalysis = z.object({
  id: z.string().min(1),
  type: z.enum(DOC_TYPES),
  use_for: z.array(z.enum(USE_FOR)),
  title: z.string().min(1).max(80),
  summary: z.string().min(1),
  detail: z.string(),
  excerpts: z.array(z.string()).max(3),
  period: z.string().nullable(),
  role: z.string().nullable(),
  skills: z.array(z.string()),
  metrics: z.array(z.string()),
  org: z.string().nullable(),
  value: z.enum(VALUES),
  value_reason: z.string(),
  in_resume: z.enum(IN_RESUME),
});
export type FileAnalysis = z.infer<typeof FileAnalysis>;

export const FileCardFrontmatter = z.object({
  schema_version: z.literal(1),
  kind: z.literal("file"),
  source: z.string(),
  source_hash: z.string(),
  format: z.enum(FORMATS),
  size: z.number().int().nonnegative(),
  modified: z.string(),
  duplicates: z.array(z.string()),
  type: z.enum(DOC_TYPES),
  use_for: z.array(z.enum(USE_FOR)),
  title: z.string(),
  summary: z.string(),
  period: z.string().nullable(),
  role: z.string().nullable(),
  skills: z.array(z.string()),
  metrics: z.array(z.string()),
  org: z.string().nullable(),
  value: z.enum(VALUES),
  value_reason: z.string(),
  in_resume: z.enum(IN_RESUME),
  agent: z.string(),
  generated_at: z.string(),
});
export type FileCardFrontmatter = z.infer<typeof FileCardFrontmatter>;

export const AgentConfig = z.object({
  command: z.string(),
  args: z.array(z.string()),
  env: z.record(z.string()).optional(),
  /** session/new 요청의 _meta로 그대로 전달 (Claude 도구 차단) */
  sessionMeta: z.record(z.unknown()).optional(),
  /** session/new 직후 session/set_mode로 설정할 모드 id */
  initialModeId: z.string().optional(),
});
export type AgentConfig = z.infer<typeof AgentConfig>;

export const Limits = z.object({
  maxFileBytes: z.number().int(),
  minTextBytes: z.number().int(),
  maxFileChars: z.number().int(),
  batchChars: z.number().int(),
  sessionRotateBatches: z.number().int(),
  batchTimeoutMs: z.number().int(),
  homeDepth: z.number().int(),
  driveDepth: z.number().int(),
});

export const Config = z.object({
  schema_version: z.literal(1),
  university: z.object({ input: z.string(), keywords: z.array(z.string()) }),
  scanFolders: z.array(z.string()),
  baselineFolder: z.string().nullable(),
  agent: z.string(),
  agents: z.record(AgentConfig),
  privacy: z.object({ allowPaths: z.array(z.string()) }),
  limits: Limits,
});
export type Config = z.infer<typeof Config>;

export const FILE_STATUSES = ["done", "analysis_failed", "skipped_sensitive", "skipped_large", "skipped_long", "extract_failed"] as const;
export type FileStatus = (typeof FILE_STATUSES)[number];

export const StateEntry = z.object({
  source_hash: z.string(),
  card: z.string().nullable(),
  card_body_hash: z.string().nullable(),
  card_snapshot: z.record(z.unknown()).nullable(),
  status: z.enum(FILE_STATUSES),
});
export type StateEntry = z.infer<typeof StateEntry>;

export const State = z.object({
  schema_version: z.literal(1),
  files: z.record(StateEntry),
  last_scan: z.string().nullable(),
});
export type State = z.infer<typeof State>;
```

`src/core/hash.ts`:
```ts
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export function sha256String(s: string): string {
  return "sha256:" + createHash("sha256").update(s, "utf8").digest("hex");
}

export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(path).on("data", (d) => h.update(d)).on("error", reject)
      .on("end", () => resolve("sha256:" + h.digest("hex")));
  });
}
```

`src/core/paths.ts`:
```ts
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export function normalizePath(p: string): string {
  let s = p.replace(/\\/g, "/");
  if (/^[a-z]:\//.test(s)) s = s[0].toUpperCase() + s.slice(1);
  return s;
}

const pointerFile = () => process.env.MP_POINTER_FILE ?? join(homedir(), ".masterportfolio.json");

export async function resolveOutputDir(): Promise<string | null> {
  if (process.env.MP_OUTPUT_DIR) return process.env.MP_OUTPUT_DIR;
  try {
    const j = JSON.parse(await readFile(pointerFile(), "utf8"));
    return typeof j.outputDir === "string" ? j.outputDir : null;
  } catch { return null; }
}

export async function writeOutputPointer(dir: string): Promise<void> {
  if (process.env.MP_OUTPUT_DIR) return;
  await writeFile(pointerFile(), JSON.stringify({ outputDir: dir }, null, 2));
}
```

`src/core/text.ts`:
```ts
export function normalizeWhitespace(s: string): string {
  return s.replace(/\r\n?/g, "\n").replace(/[ \t\f\v\u00a0]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
```

`src/config/config.ts`:
```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Config } from "../core/schema.js";
import { DEFAULT_AGENTS } from "../agent/agents.js";

export function defaultConfig(p: { university: Config["university"]; scanFolders: string[]; agent: string }): Config {
  return {
    schema_version: 1,
    university: p.university,
    scanFolders: p.scanFolders,
    baselineFolder: null,
    agent: p.agent,
    agents: structuredClone(DEFAULT_AGENTS),
    privacy: { allowPaths: [] },
    limits: {
      maxFileBytes: 52_428_800, minTextBytes: 200, maxFileChars: 30_000, batchChars: 30_000,
      sessionRotateBatches: 5, batchTimeoutMs: 300_000, homeDepth: 4, driveDepth: 3,
    },
  };
}

const configPath = (dir: string) => join(dir, ".mp", "config.json");

export async function loadConfig(outputDir: string): Promise<Config> {
  return Config.parse(JSON.parse(await readFile(configPath(outputDir), "utf8")));
}

export async function saveConfig(outputDir: string, c: Config): Promise<void> {
  await mkdir(join(outputDir, ".mp"), { recursive: true });
  await writeFile(configPath(outputDir), JSON.stringify(Config.parse(c), null, 2));
}
```

`src/agent/agents.ts` (값은 `docs/research/2026-11-24-acp-agents.md` §3 그대로):
```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentConfig } from "../core/schema.js";

/** Codex 설정 덮어쓰기: 쉘/exec, 이미지 보기, 앱·브라우저·컴퓨터 사용·플러그인·하위 에이전트, 웹 검색 끄기. */
const CODEX_LOCKDOWN = {
  "features.shell_tool": false,
  "features.unified_exec": false,
  "features.view_image": false,
  "features.apps": false,
  "features.browser_use": false,
  "features.in_app_browser": false,
  "features.computer_use": false,
  "features.code_mode_host": false,
  "features.plugins": false,
  "features.multi_agent": false,
  "features.image_generation": false,
  "features.hooks": false,
  web_search: "disabled",
};

export const DEFAULT_AGENTS: Record<string, AgentConfig> = {
  claude: {
    command: "npx",
    args: ["-y", "@agentclientprotocol/claude-agent-acp@0.110.1"],
    sessionMeta: {
      claudeCode: {
        options: {
          tools: [],
          settingSources: [],
          strictMcpConfig: true,
          disallowedTools: ["Read", "Bash", "Glob", "Grep", "Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch", "Agent", "Task", "Skill"],
        },
      },
    },
    initialModeId: "default",
  },
  codex: {
    command: "npx",
    args: ["-y", "@agentclientprotocol/codex-acp@2.10.0"],
    env: { INITIAL_AGENT_MODE: "read-only", CODEX_CONFIG: JSON.stringify(CODEX_LOCKDOWN) },
  },
  // v1 제외 (M0: 작업공간 밖 read_file이 권한 요청 없이 실행됨). M3에서 재평가. init 목록에는 나오지 않는다.
  antigravity: { command: "agy", args: ["acp"] },
};

/** init에서 선택 가능한 에이전트 */
export const V1_AGENTS = ["claude", "codex"] as const;

/** 어댑터가 번들 CLI 대신 사용자가 설치한 공식 CLI를 쓰도록 하는 env 이름 */
const LOCAL_EXECUTABLE_ENV: Record<string, { bin: string; env: string }> = {
  claude: { bin: "claude", env: "CLAUDE_CODE_EXECUTABLE" },
  codex: { bin: "codex", env: "CODEX_PATH" },
};

/** 사용자가 설치한 claude/codex 실행 파일을 찾아 env에 넣는다. 못 찾거나 해당 없으면 그대로 반환. */
export async function withLocalExecutable(name: string, cfg: AgentConfig): Promise<AgentConfig> {
  const spec = LOCAL_EXECUTABLE_ENV[name];
  if (!spec) return cfg;
  try {
    const finder = process.platform === "win32" ? "where" : "which";
    const { stdout } = await promisify(execFile)(finder, [spec.bin], { windowsHide: true });
    const path = stdout.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
    return path ? { ...cfg, env: { ...(cfg.env ?? {}), [spec.env]: path } } : cfg;
  } catch { return cfg; }
}
```

`test/config/agents.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_AGENTS, V1_AGENTS, withLocalExecutable } from "../../src/agent/agents.js";
import { mkTmp } from "../helpers/tmp.js";

describe("agents", () => {
  it("v1 excludes antigravity", () => { expect([...V1_AGENTS]).toEqual(["claude", "codex"]); });
  it("claude disables all built-in tools via sessionMeta", () => {
    expect((DEFAULT_AGENTS.claude.sessionMeta as any).claudeCode.options.tools).toEqual([]);
  });
  it("leaves unknown agents unchanged", async () => {
    const cfg = { command: "x", args: [] };
    expect(await withLocalExecutable("fake", cfg)).toBe(cfg);
  });
  it.skipIf(process.platform === "win32")("points claude at the installed CLI found on PATH", async () => {
    const d = await mkTmp(); const bin = join(d, "claude");
    await writeFile(bin, "#!/bin/sh\n"); await chmod(bin, 0o755);
    const oldPath = process.env.PATH;
    process.env.PATH = `${d}:${oldPath}`;
    try {
      const r = await withLocalExecutable("claude", DEFAULT_AGENTS.claude);
      expect(r.env?.CLAUDE_CODE_EXECUTABLE).toBe(bin);
    } finally { process.env.PATH = oldPath; }
  });
});
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run test/core test/config`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/core src/config src/agent/agents.ts test/core test/config test/helpers/tmp.ts  # test/config/agents.test.ts 포함
git commit -m "feat: core schemas, path/hash utils, config"
```

### Task 3: 민감정보 (privacy)

**Files:**
- Create: `src/privacy/sanitized.ts`, `src/privacy/sensitivePath.ts`, `src/privacy/mask.ts`
- Test: `test/privacy/mask.test.ts`, `test/privacy/sensitivePath.test.ts`

**Interfaces:**
- Produces:
  - `type SanitizedText = string & { readonly __brand: "SanitizedText" }`
  - `isSensitivePath(absPath: string, allowPaths: string[]): string | null` — 걸린 키워드 반환, 없으면 null
  - `maskText(text: string): { text: string; counts: Record<MaskKind, number> }`
  - `type MaskKind = "rrn" | "card" | "account" | "passport" | "phone"`
  - `sanitize(text: string): { text: SanitizedText; counts: Record<MaskKind, number>; markerRatio: number }`
  - `PII_PATTERNS: RegExp[]` — 불변 조건 테스트용(마스킹 후 텍스트에 남으면 안 되는 패턴)

- [ ] **Step 1: 실패하는 테스트**

`test/privacy/mask.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { maskText, sanitize } from "../../src/privacy/mask.js";

describe("maskText positives", () => {
  it.each([
    ["주민번호 900101-1234567 입니다", "[주민번호]", "rrn"],
    ["외국인 9001015234567", "[주민번호]", "rrn"],
    ["카드 4111-1111-1111-1111", "[카드번호]", "card"],
    ["입금 계좌: 국민 123456-01-123456", "[계좌번호]", "account"],
    ["여권번호 M12345678", "[여권번호]", "passport"],
    ["연락처 010-1234-5678", "[전화번호]", "phone"],
    ["연락처 01012345678", "[전화번호]", "phone"],
    ["+82 10-1234-5678 로 연락", "[전화번호]", "phone"],
    ["사무실 02-123-4567", "[전화번호]", "phone"],
    ["031)123-4567", "[전화번호]", "phone"],
    ["070-1234-5678", "[전화번호]", "phone"],
  ])("%s", (input, marker, kind) => {
    const r = maskText(input);
    expect(r.text).toContain(marker);
    expect(r.counts[kind as keyof typeof r.counts]).toBe(1);
  });
});

describe("maskText negatives (Review Focus 3)", () => {
  it.each([
    "기간 2025-03-01 ~ 2025-06-30",
    "학번 20231234",
    "버전 1.2.3 배포",
    "2019-2023 재학",
    "정확도 92.5% 달성, 사용자 12,345명",
    "카드 1234-5678-9012-3456 (Luhn 실패)",
    "번호 123456-01-123456 (키워드 없음)",
    "M12345678 (키워드 없음)",
    "이메일 kim@example.com",
  ])("%s is unchanged", (input) => {
    expect(maskText(input).text).toBe(input);
  });
});

describe("sanitize", () => {
  it("reports marker ratio", () => {
    const r = sanitize("900101-1234567");
    expect(r.markerRatio).toBeGreaterThanOrEqual(0.8);
  });
});
```

`test/privacy/sensitivePath.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { isSensitivePath } from "../../src/privacy/sensitivePath.js";

describe("isSensitivePath", () => {
  it("flags identity documents", () => {
    expect(isSensitivePath("C:/Users/k/Downloads/주민등록등본.pdf", [])).toBe("주민등록");
    expect(isSensitivePath("/Users/k/Downloads/통장사본.jpg", [])).toBe("통장사본");
    expect(isSensitivePath("/Users/k/Downloads/My_Passport.pdf", [])).toBe("passport");
  });
  it("does not flag normal project files", () => {
    expect(isSensitivePath("/Users/k/projects/bank-system/report.pdf", [])).toBeNull();
    expect(isSensitivePath("/Users/k/projects/password-manager/README.md", [])).toBeNull();
  });
  it("respects allowPaths", () => {
    expect(isSensitivePath("/Users/k/docs/근로계약서.pdf", ["/Users/k/docs/근로계약서.pdf"])).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run test/privacy`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 구현**

`src/privacy/sanitized.ts`:
```ts
export type SanitizedText = string & { readonly __brand: "SanitizedText" };
/** privacy/mask.ts 외부에서 호출 금지. */
export const brandSanitized = (s: string) => s as SanitizedText;
```

`src/privacy/sensitivePath.ts`:
```ts
import { normalizePath } from "../core/paths.js";

const KEYWORDS = [
  "주민등록", "등본", "초본", "가족관계", "통장사본", "통장 사본", "신분증", "여권사본", "운전면허",
  "계약서", "근로계약", "임대차", "원천징수", "소득금액", "납세", "건강보험", "진단서", "처방전",
  "여권", "passport", "id_card",
];

export function isSensitivePath(absPath: string, allowPaths: string[]): string | null {
  const p = normalizePath(absPath);
  if (allowPaths.map(normalizePath).includes(p)) return null;
  const lower = p.toLowerCase();
  for (const k of KEYWORDS) if (lower.includes(k.toLowerCase())) return k;
  return null;
}
```

`src/privacy/mask.ts`:
```ts
import { brandSanitized, type SanitizedText } from "./sanitized.js";

export type MaskKind = "rrn" | "card" | "account" | "passport" | "phone";
const MARKERS: Record<MaskKind, string> = {
  rrn: "[주민번호]", card: "[카드번호]", account: "[계좌번호]", passport: "[여권번호]", phone: "[전화번호]",
};

function validYYMMDD(s: string): boolean {
  const mm = Number(s.slice(2, 4)), dd = Number(s.slice(4, 6));
  return mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31;
}

function luhn(digits: string): boolean {
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}

const RRN = /(?<!\d)(\d{6})[-\s]?([1-8]\d{6})(?!\d)/g;
const CARD = /(?<!\d)(?:\d[-\s]?){12,18}\d(?!\d)/g;
const ACCOUNT_KW = /(계좌|은행|입금|예금주|account)/i;
const ACCOUNT = /(?<![\d-])\d{2,6}(?:-\d{2,7}){1,3}(?![\d-])/g;
const PASSPORT_KW = /(여권|passport)/i;
const PASSPORT = /(?<![A-Z0-9])[A-Z]{1,2}\d{7,8}(?![0-9])/g;
const MOBILE = /(?<!\d)(?:\+82[-\s]?1[016789]|01[016789])[-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)/g;
const LANDLINE = /(?<!\d)0(?:2|[3-6][1-5]|70)[-.)\s]?\d{3,4}[-.\s]?\d{4}(?!\d)/g;

/** 마스킹 후 텍스트에 남아 있으면 안 되는 패턴 (불변 조건 테스트용). */
export const PII_PATTERNS: RegExp[] = [
  /(?<!\d)\d{6}-[1-8]\d{6}(?!\d)/,
  /(?<!\d)01[016789]-\d{3,4}-\d{4}(?!\d)/,
  /(?<!\d)4111-1111-1111-1111(?!\d)/,
];

export function maskText(input: string): { text: string; counts: Record<MaskKind, number> } {
  const counts: Record<MaskKind, number> = { rrn: 0, card: 0, account: 0, passport: 0, phone: 0 };
  let t = input;

  t = t.replace(RRN, (m, a: string) => (validYYMMDD(a) ? (counts.rrn++, MARKERS.rrn) : m));
  t = t.replace(CARD, (m) => {
    const d = m.replace(/\D/g, "");
    return d.length >= 13 && d.length <= 19 && luhn(d) ? (counts.card++, MARKERS.card) : m;
  });
  t = t.split("\n").map((line) => {
    let l = line;
    if (ACCOUNT_KW.test(l)) {
      l = l.replace(ACCOUNT, (m, offset: number) => {
        const digits = m.replace(/\D/g, "").length;
        const before = l.slice(Math.max(0, offset - 30), offset);
        if (digits >= 10 && digits <= 16 && (ACCOUNT_KW.test(before) || ACCOUNT_KW.test(line))) {
          counts.account++; return MARKERS.account;
        }
        return m;
      });
    }
    if (PASSPORT_KW.test(l)) l = l.replace(PASSPORT, () => (counts.passport++, MARKERS.passport));
    return l;
  }).join("\n");
  t = t.replace(MOBILE, () => (counts.phone++, MARKERS.phone));
  t = t.replace(LANDLINE, () => (counts.phone++, MARKERS.phone));
  return { text: t, counts };
}

export function sanitize(input: string): { text: SanitizedText; counts: Record<MaskKind, number>; markerRatio: number } {
  const { text, counts } = maskText(input);
  const markerChars = Object.entries(counts).reduce((n, [k, c]) => n + c * MARKERS[k as MaskKind].length, 0);
  const markerRatio = text.length === 0 ? 0 : markerChars / text.length;
  return { text: brandSanitized(text), counts, markerRatio };
}
```

주의: 마스킹 순서(주민 → 카드 → 계좌 → 여권 → 전화)는 스펙 8.2 그대로다. 테스트가 실패하면 정규식을 고치되, 음성 케이스 테스트를 지우거나 완화하지 않는다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run test/privacy`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/privacy test/privacy
git commit -m "feat: sensitive path skip and PII masking"
```

### Task 4: 대학 사전과 폴더 매칭

**Files:**
- Create: `data/universities.json`, `src/discovery/universities.ts`, `src/discovery/match.ts`
- Test: `test/discovery/universities.test.ts`, `test/discovery/match.test.ts`
- Modify: `package.json` (`"files": ["dist", "data"]`)

**Interfaces:**
- Produces:
  - `type University = { name: string; aliases: string[]; en: string; abbr: string[] }`
  - `expandUniversity(input: string, dict?: University[]): string[]` — 중복 없는 키워드 목록, 입력값 포함
  - `loadUniversities(): University[]`
  - `tokenize(folderName: string): string[]`
  - `folderMatchesKeyword(folderName: string, keyword: string): boolean`

- [ ] **Step 1: 사전 데이터 작성**

`data/universities.json` — 아래 형식. 이 Step에서는 아래 시드 항목을 넣고, Step 6에서 확장한다.
```json
[
  { "name": "서울대학교", "aliases": ["서울대"], "en": "Seoul National University", "abbr": ["SNU"] },
  { "name": "연세대학교", "aliases": ["연세대", "연대"], "en": "Yonsei University", "abbr": ["YU"] },
  { "name": "고려대학교", "aliases": ["고려대", "고대"], "en": "Korea University", "abbr": ["KU"] },
  { "name": "연세대학교", "aliases": ["연세대"], "en": "Yonsei University", "abbr": ["YU"] },
  { "name": "한국과학기술원", "aliases": ["카이스트"], "en": "Korea Advanced Institute of Science and Technology", "abbr": ["KAIST"] },
  { "name": "포항공과대학교", "aliases": ["포스텍", "포항공대"], "en": "Pohang University of Science and Technology", "abbr": ["POSTECH"] },
  { "name": "성균관대학교", "aliases": ["성균관대", "성대"], "en": "Sungkyunkwan University", "abbr": ["SKKU"] },
  { "name": "한양대학교", "aliases": ["한양대"], "en": "Hanyang University", "abbr": ["HYU"] },
  { "name": "서강대학교", "aliases": ["서강대"], "en": "Sogang University", "abbr": ["SGU"] },
  { "name": "중앙대학교", "aliases": ["중앙대"], "en": "Chung-Ang University", "abbr": ["CAU"] },
  { "name": "경희대학교", "aliases": ["경희대"], "en": "Kyung Hee University", "abbr": ["KHU"] },
  { "name": "이화여자대학교", "aliases": ["이화여대", "이대"], "en": "Ewha Womans University", "abbr": ["EWHA"] },
  { "name": "부산대학교", "aliases": ["부산대"], "en": "Pusan National University", "abbr": ["PNU"] },
  { "name": "경북대학교", "aliases": ["경북대"], "en": "Kyungpook National University", "abbr": ["KNU"] },
  { "name": "울산과학기술원", "aliases": ["유니스트"], "en": "Ulsan National Institute of Science and Technology", "abbr": ["UNIST"] }
]
```

- [ ] **Step 2: 실패하는 테스트**

`test/discovery/universities.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { expandUniversity, loadUniversities } from "../../src/discovery/universities.js";

describe("expandUniversity", () => {
  const dict = loadUniversities();
  it("expands from Korean short name", () => {
    const k = expandUniversity("연세대", dict);
    expect(k).toEqual(expect.arrayContaining(["연세대학교", "연세대", "Yonsei University", "Yonsei", "YU"]));
  });
  it("expands from English abbreviation, case-insensitive", () => {
    expect(expandUniversity("kaist", dict)).toEqual(expect.arrayContaining(["한국과학기술원", "KAIST"]));
  });
  it("returns only the input when not in dictionary", () => {
    expect(expandUniversity("가나다대학교", dict)).toEqual(["가나다대학교", "가나다대"]);
  });
  it("dictionary has no duplicate names", () => {
    const names = dict.map((u) => u.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
```

`test/discovery/match.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { folderMatchesKeyword, tokenize } from "../../src/discovery/match.js";

describe("tokenize", () => {
  it("splits on separators, camelCase and digit/letter boundaries", () => {
    expect(tokenize("2023KU_capstoneProject")).toEqual(["2023", "KU", "capstone", "Project"]);
  });
});

describe("folderMatchesKeyword", () => {
  it("short keywords match whole tokens only", () => {
    expect(folderMatchesKeyword("KU_과제", "KU")).toBe(true);
    expect(folderMatchesKeyword("kubernetes", "KU")).toBe(false);
    expect(folderMatchesKeyword("고대사_레포트", "고대")).toBe(false);
    expect(folderMatchesKeyword("2023고대", "고대")).toBe(true);
  });
  it("long keywords match as case-insensitive substring", () => {
    expect(folderMatchesKeyword("my-projects", "project")).toBe(true);
    expect(folderMatchesKeyword("연세대학교_4학년", "연세대학교")).toBe(true);
    expect(folderMatchesKeyword("YonseiUniv", "Yonsei")).toBe(true);
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run test/discovery/universities.test.ts test/discovery/match.test.ts`
Expected: FAIL

- [ ] **Step 4: 구현**

`src/discovery/universities.ts`:
```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export type University = { name: string; aliases: string[]; en: string; abbr: string[] };

export function loadUniversities(): University[] {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/discovery 또는 dist/discovery 기준 ../../data
  return JSON.parse(readFileSync(join(here, "..", "..", "data", "universities.json"), "utf8"));
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
const shortKo = (s: string) => s.replace(/대학교$/, "대");

export function expandUniversity(input: string, dict: University[] = loadUniversities()): string[] {
  const q = norm(input);
  const hit = dict.find((u) => [u.name, ...u.aliases, u.en, ...u.abbr].some((v) => norm(v) === q));
  const out = hit
    ? [hit.name, ...hit.aliases, hit.en, hit.en.split(/\s+/)[0], ...hit.abbr]
    : [input, shortKo(input)];
  return [...new Set(out.filter((s) => s.length > 0))];
}
```

`src/discovery/match.ts`:
```ts
export function tokenize(name: string): string[] {
  return name
    .split(/[^\p{L}\p{N}]+/u)
    .flatMap((t) => t.split(/(?<=\p{Ll})(?=\p{Lu})|(?<=\p{N})(?=\p{L})|(?<=\p{L})(?=\p{N})/u))
    .filter(Boolean);
}

export function folderMatchesKeyword(folderName: string, keyword: string): boolean {
  const k = keyword.toLowerCase();
  if ([...keyword].length <= 3) return tokenize(folderName).some((t) => t.toLowerCase() === k);
  return folderName.toLowerCase().includes(k);
}
```

`tokenize("2023KU_capstoneProject")`: 구분자 분리 → `["2023KU", "capstoneProject"]` → 경계 분리 → `["2023","KU","capstone","Project"]`. 대문자 연속(`KU`) 뒤 소문자가 바로 오는 경우는 이 규칙에서 분리되지 않는다; 테스트에 있는 케이스만 보장한다.

`package.json`에 `"files": ["dist", "data"]` 추가.

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run test/discovery/universities.test.ts test/discovery/match.test.ts`
Expected: PASS

- [ ] **Step 6: 사전 확장**

대학알리미(`https://www.academyinfo.go.kr`) 공시 대학 목록에서 4년제·전문대의 정식 한글명과 영문명을 가져와 `data/universities.json`에 추가한다(약 330개교). 약칭(`aliases`)은 "○○대학교" → "○○대" 규칙으로 채우고, 널리 쓰이는 별칭(예: 연대, 고대, 성대, 이대)과 영문 약자(`abbr`)는 대학 공식 홈페이지 도메인·로고 표기 기준으로 확인된 것만 넣는다. 확인 안 된 약자는 비워 둔다. 같은 약자가 여러 대학에 있으면(예: KU) 그대로 둔다 — 사용자가 `init`에서 빼면 된다.

Run: `npx vitest run test/discovery/universities.test.ts`
Expected: PASS (이름 중복 없음)

- [ ] **Step 7: 커밋**

```bash
git add data/universities.json src/discovery/universities.ts src/discovery/match.ts test/discovery package.json
git commit -m "feat: university dictionary and folder keyword matching"
```

### Task 5: 폴더 탐색과 순회 (discovery)

**Files:**
- Create: `src/discovery/defaults.ts`, `src/discovery/candidates.ts`, `src/discovery/walk.ts`
- Test: `test/discovery/walk.test.ts`, `test/discovery/candidates.test.ts`

**Interfaces:**
- Consumes: `folderMatchesKeyword` (Task 4)
- Produces:
  - `defaultFolders(): Promise<string[]>` — 존재하는 Documents/Downloads 절대경로
  - `findCandidateFolders(root: string, keywords: string[], maxDepth: number): Promise<string[]>`
  - `type WalkEntry = { kind: "file"; path: string; size: number; mtimeMs: number } | { kind: "repo"; path: string }`
  - `walk(root: string, opts?: { home?: string }): Promise<{ entries: WalkEntry[]; inaccessible: string[] }>`
  - `EXCLUDED_DIRS: Set<string>`

- [ ] **Step 1: 실패하는 테스트**

`test/discovery/walk.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mkdir, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { walk } from "../../src/discovery/walk.js";
import { mkTmp } from "../helpers/tmp.js";

describe("walk", () => {
  it("lists files, treats git repos as units, skips excluded dirs and symlinks", async () => {
    const root = await mkTmp();
    await mkdir(join(root, "과제"), { recursive: true });
    await writeFile(join(root, "과제", "보고서.pdf"), "x");
    await mkdir(join(root, "app", ".git"), { recursive: true });
    await writeFile(join(root, "app", "README.md"), "x");
    await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
    await writeFile(join(root, "node_modules", "pkg", "a.md"), "x");
    try { await symlink(join(root, "과제"), join(root, "link"), "junction"); } catch { /* 권한 없으면 생략 */ }

    const { entries } = await walk(root);
    const files = entries.filter((e) => e.kind === "file").map((e) => e.path);
    const repos = entries.filter((e) => e.kind === "repo").map((e) => e.path);
    expect(files).toEqual([join(root, "과제", "보고서.pdf")]);
    expect(repos).toEqual([join(root, "app")]);
  });
});
```

`test/discovery/candidates.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { findCandidateFolders } from "../../src/discovery/candidates.js";
import { mkTmp } from "../helpers/tmp.js";

describe("findCandidateFolders", () => {
  it("finds matching folders within depth and collapses nested matches", async () => {
    const root = await mkTmp();
    await mkdir(join(root, "a", "b", "연세대_자료", "projects"), { recursive: true });
    await mkdir(join(root, "a", "b", "c", "d", "e", "project-deep"), { recursive: true });
    await mkdir(join(root, "kubernetes"), { recursive: true });
    await mkdir(join(root, ".hidden", "project"), { recursive: true });
    const found = await findCandidateFolders(root, ["project", "연세대", "YU"], 4);
    expect(found).toEqual([join(root, "a", "b", "연세대_자료")]);
  });
});
```

`project-deep`은 깊이 6이라 제외, 숨김 폴더 제외, `연세대_자료/projects`는 상위가 이미 선택되어 접힌다.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run test/discovery/walk.test.ts test/discovery/candidates.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

`src/discovery/walk.ts`:
```ts
import { lstat, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type WalkEntry =
  | { kind: "file"; path: string; size: number; mtimeMs: number }
  | { kind: "repo"; path: string };

export const EXCLUDED_DIRS = new Set([
  "node_modules", ".git", ".venv", "venv", "__pycache__", ".cache", "dist", "build", "target",
  ".next", ".idea", ".vscode", "AppData", "$RECYCLE.BIN", "System Volume Information", ".Trash",
]);

export async function walk(root: string, opts: { home?: string } = {}) {
  const home = opts.home ?? homedir();
  const entries: WalkEntry[] = [];
  const inaccessible: string[] = [];

  async function visit(dir: string): Promise<void> {
    let names: import("node:fs").Dirent[];
    try { names = await readdir(dir, { withFileTypes: true }); }
    catch { inaccessible.push(dir); return; }
    if (names.some((d) => d.name === ".git")) { entries.push({ kind: "repo", path: dir }); return; }
    names.sort((a, b) => a.name.localeCompare(b.name));
    for (const d of names) {
      const p = join(dir, d.name);
      if (d.isSymbolicLink()) continue;
      if (d.isDirectory()) {
        if (EXCLUDED_DIRS.has(d.name)) continue;
        if (d.name === "Library" && dir === home) continue;
        await visit(p);
      } else if (d.isFile()) {
        try {
          const st = await lstat(p);
          entries.push({ kind: "file", path: p, size: st.size, mtimeMs: st.mtimeMs });
        } catch { inaccessible.push(p); }
      }
    }
  }
  await visit(root);
  return { entries, inaccessible };
}
```

`src/discovery/candidates.ts`:
```ts
import { readdir } from "node:fs/promises";
import { join, sep } from "node:path";
import { EXCLUDED_DIRS } from "./walk.js";
import { folderMatchesKeyword } from "./match.js";

export async function findCandidateFolders(root: string, keywords: string[], maxDepth: number): Promise<string[]> {
  const found: string[] = [];
  async function visit(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let ds: import("node:fs").Dirent[];
    try { ds = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const d of ds.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!d.isDirectory() || d.isSymbolicLink()) continue;
      if (d.name.startsWith(".") || EXCLUDED_DIRS.has(d.name) || d.name === "Library") continue;
      const p = join(dir, d.name);
      if (keywords.some((k) => folderMatchesKeyword(d.name, k))) { found.push(p); continue; }
      await visit(p, depth + 1);
    }
  }
  await visit(root, 1);
  return found.filter((p) => !found.some((q) => q !== p && p.startsWith(q + sep)));
}
```

매칭된 폴더 아래로는 내려가지 않으므로(접기) 하위 후보는 자연히 빠진다.

`src/discovery/defaults.ts`:
```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const run = promisify(execFile);

async function ps(cmd: string): Promise<string | null> {
  try {
    const { stdout } = await run("powershell", ["-NoProfile", "-NonInteractive", "-Command", cmd], { windowsHide: true });
    return stdout.trim() || null;
  } catch { return null; }
}

async function exists(p: string | null): Promise<boolean> {
  if (!p) return false;
  try { return (await stat(p)).isDirectory(); } catch { return false; }
}

export async function defaultFolders(): Promise<string[]> {
  const home = homedir();
  let docs: string | null = join(home, "Documents");
  let downloads: string | null = join(home, "Downloads");
  if (process.platform === "win32") {
    docs = (await ps("[Environment]::GetFolderPath('MyDocuments')")) ?? docs;
    downloads = (await ps("(New-Object -ComObject Shell.Application).NameSpace('shell:Downloads').Self.Path")) ?? downloads;
  }
  const out: string[] = [];
  for (const p of [docs, downloads]) if (await exists(p)) out.push(p!);
  return out;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run test/discovery`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/discovery test/discovery
git commit -m "feat: folder discovery, candidate search and walker"
```

### Task 6: 사전 필터 (prefilter)

**Files:**
- Create: `src/scan/prefilter.ts`
- Test: `test/scan/prefilter.test.ts`

**Interfaces:**
- Consumes: `WalkEntry` (Task 5), `State`, `Config["limits"]` (Task 2), `sha256File`, `normalizePath`
- Produces:
  - `SUPPORTED_EXT: Record<string, Format>` (M1: `.pdf .docx .pptx .md .txt`; M2에서 확장)
  - `type Candidate = { path: string; key: string; format: Format; size: number; mtimeMs: number; hash: string; duplicates: string[] }`
  - `type PrefilterResult = { candidates: Candidate[]; changed: string[]; skippedLarge: { path: string; size: number }[]; unsupported: number }`
  - `prefilter(entries: WalkEntry[], state: State, limits: Config["limits"]): Promise<PrefilterResult>`
  - `type Format = (typeof FORMATS)[number]`

- [ ] **Step 1: 실패하는 테스트**

`test/scan/prefilter.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { prefilter } from "../../src/scan/prefilter.js";
import { defaultConfig } from "../../src/config/config.js";
import { sha256File } from "../../src/core/hash.js";
import { normalizePath } from "../../src/core/paths.js";
import { mkTmp } from "../helpers/tmp.js";

const limits = defaultConfig({ university: { input: "", keywords: [] }, scanFolders: [], agent: "claude" }).limits;
const emptyState = { schema_version: 1 as const, files: {}, last_scan: null };

async function file(dir: string, name: string, content: string | Buffer) {
  const p = join(dir, name); await writeFile(p, content);
  const size = Buffer.byteLength(content as any);
  return { kind: "file" as const, path: p, size, mtimeMs: 0 };
}

describe("prefilter", () => {
  it("filters by extension, size, tiny text, and dedupes by hash", async () => {
    const d = await mkTmp();
    const long = "가".repeat(300);
    const entries = [
      await file(d, "a.md", long),
      await file(d, "b.md", long),             // duplicate of a.md
      await file(d, "tiny.txt", "short"),      // < 200 bytes
      await file(d, "pic.png", "x"),           // unsupported
      { kind: "file" as const, path: join(d, "huge.pdf"), size: 60_000_000, mtimeMs: 0 },
      { kind: "repo" as const, path: join(d, "repo") }, // M1: unsupported
    ];
    const r = await prefilter(entries, emptyState, limits);
    expect(r.candidates.map((c) => c.path)).toEqual([join(d, "a.md")]);
    expect(r.candidates[0].duplicates).toEqual([normalizePath(join(d, "b.md"))]);
    expect(r.skippedLarge).toEqual([{ path: join(d, "huge.pdf"), size: 60_000_000 }]);
    expect(r.unsupported).toBe(2);
  });

  it("skips known files and reports changed ones", async () => {
    const d = await mkTmp();
    const e1 = await file(d, "same.md", "x".repeat(300));
    const e2 = await file(d, "changed.md", "y".repeat(300));
    const state = {
      schema_version: 1 as const, last_scan: null,
      files: {
        [normalizePath(e1.path)]: { source_hash: await sha256File(e1.path), card: "files/a.md", card_body_hash: null, card_snapshot: null, status: "done" as const },
        [normalizePath(e2.path)]: { source_hash: "sha256:old", card: "files/b.md", card_body_hash: null, card_snapshot: null, status: "done" as const },
      },
    };
    const r = await prefilter([e1, e2], state, limits);
    expect(r.candidates).toEqual([]);
    expect(r.changed).toEqual([e2.path]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run test/scan/prefilter.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

`src/scan/prefilter.ts`:
```ts
import { extname } from "node:path";
import type { WalkEntry } from "../discovery/walk.js";
import type { Config, State } from "../core/schema.js";
import { FORMATS } from "../core/schema.js";
import { sha256File } from "../core/hash.js";
import { normalizePath } from "../core/paths.js";

export type Format = (typeof FORMATS)[number];

export const SUPPORTED_EXT: Record<string, Format> = {
  ".pdf": "pdf", ".docx": "docx", ".pptx": "pptx", ".md": "md", ".txt": "txt",
};

export type Candidate = {
  path: string; key: string; format: Format; size: number; mtimeMs: number; hash: string; duplicates: string[];
};
export type PrefilterResult = {
  candidates: Candidate[]; changed: string[]; skippedLarge: { path: string; size: number }[]; unsupported: number;
};

export async function prefilter(entries: WalkEntry[], state: State, limits: Config["limits"]): Promise<PrefilterResult> {
  const res: PrefilterResult = { candidates: [], changed: [], skippedLarge: [], unsupported: 0 };
  const byHash = new Map<string, Candidate>();
  for (const e of entries) {
    if (e.kind === "repo") { res.unsupported++; continue; }
    const format = SUPPORTED_EXT[extname(e.path).toLowerCase()];
    if (!format) { res.unsupported++; continue; }
    if (e.size > limits.maxFileBytes) { res.skippedLarge.push({ path: e.path, size: e.size }); continue; }
    if ((format === "md" || format === "txt") && e.size < limits.minTextBytes) continue;
    let hash: string;
    try { hash = await sha256File(e.path); } catch { continue; }
    const key = normalizePath(e.path);
    const known = state.files[key];
    if (known) {
      if (known.source_hash !== hash) res.changed.push(e.path);
      continue;
    }
    const dup = byHash.get(hash);
    if (dup) { dup.duplicates.push(key); continue; }
    const c: Candidate = { path: e.path, key, format, size: e.size, mtimeMs: e.mtimeMs, hash, duplicates: [] };
    byHash.set(hash, c);
    res.candidates.push(c);
  }
  return res;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run test/scan/prefilter.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/scan/prefilter.ts test/scan/prefilter.test.ts
git commit -m "feat: prefilter by extension, size, state and content hash"
```

### Task 7: 추출기 (PDF/DOCX/PPTX/MD/TXT)

**Files:**
- Create: `src/extractors/types.ts`, `src/extractors/registry.ts`, `src/extractors/text.ts`, `src/extractors/pdf.ts`, `src/extractors/docx.ts`, `src/extractors/pptx.ts`, `test/helpers/ooxml.ts`
- Test: `test/extractors/extractors.test.ts`

**Interfaces:**
- Consumes: `Format` (Task 6), `normalizeWhitespace` (Task 2)
- Produces:
  - `type ExtractResult = { ok: true; text: string; meta: { pages?: number; title?: string } } | { ok: false; reason: "encrypted" | "corrupted" | "unsupported" | "empty" | "error"; detail?: string }`
  - `interface Extractor { id: Format; extract(path: string): Promise<ExtractResult> }`
  - `extractorFor(format: Format): Extractor | null`
  - test helpers `makeDocx(paragraphs: string[]): Promise<Buffer>`, `makePptx(slides: string[]): Promise<Buffer>`

- [ ] **Step 1: 테스트 헬퍼**

`test/helpers/ooxml.ts`:
```ts
import JSZip from "jszip";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function makeDocx(paragraphs: string[]): Promise<Buffer> {
  const z = new JSZip();
  z.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  z.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  z.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map((p) => `<w:p><w:r><w:t>${esc(p)}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`);
  return z.generateAsync({ type: "nodebuffer" });
}

export async function makePptx(slides: string[]): Promise<Buffer> {
  const z = new JSZip();
  slides.forEach((s, i) => z.file(`ppt/slides/slide${i + 1}.xml`,
    `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${esc(s)}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`));
  return z.generateAsync({ type: "nodebuffer" });
}
```

- [ ] **Step 2: 실패하는 테스트**

`test/extractors/extractors.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractorFor } from "../../src/extractors/registry.js";
import { makeDocx, makePptx } from "../helpers/ooxml.js";
import { mkTmp } from "../helpers/tmp.js";

describe("extractors", () => {
  it("txt: utf-8", async () => {
    const d = await mkTmp(); const p = join(d, "a.txt");
    await writeFile(p, "캡스톤 디자인 회의록");
    expect(await extractorFor("txt")!.extract(p)).toMatchObject({ ok: true, text: "캡스톤 디자인 회의록" });
  });

  it("txt: CP949 fallback (Review Focus 1)", async () => {
    const d = await mkTmp(); const p = join(d, "a.txt");
    // "한글" in CP949
    await writeFile(p, Buffer.from([0xc7, 0xd1, 0xb1, 0xdb]));
    expect(await extractorFor("txt")!.extract(p)).toMatchObject({ ok: true, text: "한글" });
  });

  it("docx", async () => {
    const d = await mkTmp(); const p = join(d, "a.docx");
    await writeFile(p, await makeDocx(["첫 문단", "둘째 문단"]));
    const r = await extractorFor("docx")!.extract(p);
    expect(r.ok && r.text).toContain("첫 문단");
    expect(r.ok && r.text).toContain("둘째 문단");
  });

  it("docx: OLE-wrapped (encrypted) file", async () => {
    const d = await mkTmp(); const p = join(d, "enc.docx");
    await writeFile(p, Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(504)]));
    expect(await extractorFor("docx")!.extract(p)).toMatchObject({ ok: false, reason: "encrypted" });
  });

  it("pptx: slides in numeric order", async () => {
    const d = await mkTmp(); const p = join(d, "a.pptx");
    const slides = Array.from({ length: 11 }, (_, i) => `slide-${i + 1}`);
    await writeFile(p, await makePptx(slides));
    const r = await extractorFor("pptx")!.extract(p);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.text.indexOf("slide-2")).toBeLessThan(r.text.indexOf("slide-10"));
      expect(r.meta.pages).toBe(11);
    }
  });

  it("pdf", async () => {
    const d = await mkTmp(); const p = join(d, "a.pdf");
    const doc = await PDFDocument.create(); const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage().drawText("Capstone final report: accuracy improved to 92 percent", { x: 50, y: 700, size: 12, font });
    await writeFile(p, await doc.save());
    const r = await extractorFor("pdf")!.extract(p);
    expect(r.ok && r.text).toContain("Capstone final report");
  });

  it("pdf: image-only page is empty", async () => {
    const d = await mkTmp(); const p = join(d, "scan.pdf");
    const doc = await PDFDocument.create(); doc.addPage();
    await writeFile(p, await doc.save());
    expect(await extractorFor("pdf")!.extract(p)).toMatchObject({ ok: false, reason: "empty" });
  });

  it("missing file yields error, not throw", async () => {
    expect(await extractorFor("pdf")!.extract("/no/such/file.pdf")).toMatchObject({ ok: false });
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run test/extractors`
Expected: FAIL

- [ ] **Step 4: 구현**

`src/extractors/types.ts`:
```ts
import type { Format } from "../scan/prefilter.js";
export type ExtractResult =
  | { ok: true; text: string; meta: { pages?: number; title?: string } }
  | { ok: false; reason: "encrypted" | "corrupted" | "unsupported" | "empty" | "error"; detail?: string };
export interface Extractor { id: Format; extract(path: string): Promise<ExtractResult>; }

export const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
export const isOle = (b: Buffer) => b.length >= 8 && b.subarray(0, 8).equals(OLE_MAGIC);
export const errResult = (e: unknown): ExtractResult => ({ ok: false, reason: "error", detail: e instanceof Error ? e.message : String(e) });
```

`src/extractors/text.ts`:
```ts
import { readFile } from "node:fs/promises";
import { normalizeWhitespace } from "../core/text.js";
import { errResult, type Extractor } from "./types.js";

export function decodeText(buf: Buffer): string {
  const b = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? buf.subarray(3) : buf;
  try { return new TextDecoder("utf-8", { fatal: true }).decode(b); }
  catch { return new TextDecoder("euc-kr").decode(b); }
}

const make = (id: "md" | "txt"): Extractor => ({
  id,
  async extract(path) {
    try {
      const text = normalizeWhitespace(decodeText(await readFile(path)));
      return text ? { ok: true, text, meta: {} } : { ok: false, reason: "empty" };
    } catch (e) { return errResult(e); }
  },
});
export const mdExtractor = make("md");
export const txtExtractor = make("txt");
```

`src/extractors/pdf.ts`:
```ts
import { readFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { normalizeWhitespace } from "../core/text.js";
import { errResult, type Extractor } from "./types.js";

export const pdfExtractor: Extractor = {
  id: "pdf",
  async extract(path) {
    try {
      const data = new Uint8Array(await readFile(path));
      const doc = await getDocument({ data, isEvalSupported: false, useSystemFonts: true, verbosity: 0 }).promise;
      const pages: string[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const tc = await (await doc.getPage(i)).getTextContent();
        pages.push(tc.items.map((it: any) => ("str" in it ? it.str : "")).join(" "));
      }
      await doc.destroy();
      const text = normalizeWhitespace(pages.join("\n\n"));
      if (doc.numPages === 0 || text.length / doc.numPages < 20) return { ok: false, reason: "empty", detail: "텍스트 없는 PDF(스캔본 추정)" };
      return { ok: true, text, meta: { pages: doc.numPages } };
    } catch (e: any) {
      if (e?.name === "PasswordException") return { ok: false, reason: "encrypted" };
      if (e?.name === "InvalidPDFException") return { ok: false, reason: "corrupted", detail: e.message };
      return errResult(e);
    }
  },
};
```

`src/extractors/docx.ts`:
```ts
import { readFile } from "node:fs/promises";
import mammoth from "mammoth";
import { normalizeWhitespace } from "../core/text.js";
import { errResult, isOle, type Extractor } from "./types.js";

export const docxExtractor: Extractor = {
  id: "docx",
  async extract(path) {
    try {
      const buffer = await readFile(path);
      if (isOle(buffer)) return { ok: false, reason: "encrypted" };
      const { value } = await mammoth.extractRawText({ buffer });
      const text = normalizeWhitespace(value);
      return text ? { ok: true, text, meta: {} } : { ok: false, reason: "empty" };
    } catch (e) { return { ok: false, reason: "corrupted", detail: e instanceof Error ? e.message : String(e) }; }
  },
};
```

`src/extractors/pptx.ts`:
```ts
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { normalizeWhitespace } from "../core/text.js";
import { isOle, type Extractor } from "./types.js";

const decodeXml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const texts = (xml: string) => [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => decodeXml(m[1]));
const num = (name: string) => Number(name.match(/(\d+)\.xml$/)?.[1] ?? 0);

export const pptxExtractor: Extractor = {
  id: "pptx",
  async extract(path) {
    try {
      const buf = await readFile(path);
      if (isOle(buf)) return { ok: false, reason: "encrypted" };
      const zip = await JSZip.loadAsync(buf);
      const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => num(a) - num(b));
      const parts: string[] = [];
      for (const s of slides) {
        parts.push(texts(await zip.file(s)!.async("string")).join(" "));
        const note = zip.file(`ppt/notesSlides/notesSlide${num(s)}.xml`);
        if (note) parts.push(texts(await note.async("string")).join(" "));
      }
      const text = normalizeWhitespace(parts.join("\n\n"));
      return text ? { ok: true, text, meta: { pages: slides.length } } : { ok: false, reason: "empty" };
    } catch (e) { return { ok: false, reason: "corrupted", detail: e instanceof Error ? e.message : String(e) }; }
  },
};
```

`src/extractors/registry.ts`:
```ts
import type { Format } from "../scan/prefilter.js";
import type { Extractor } from "./types.js";
import { mdExtractor, txtExtractor } from "./text.js";
import { pdfExtractor } from "./pdf.js";
import { docxExtractor } from "./docx.js";
import { pptxExtractor } from "./pptx.js";

const REGISTRY: Partial<Record<Format, Extractor>> = {
  md: mdExtractor, txt: txtExtractor, pdf: pdfExtractor, docx: docxExtractor, pptx: pptxExtractor,
};
export const extractorFor = (f: Format): Extractor | null => REGISTRY[f] ?? null;
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run test/extractors && npx tsc --noEmit -p tsconfig.json`
Expected: PASS. pdfjs 타입 오류가 나면 `src/types/pdfjs.d.ts`에 `declare module "pdfjs-dist/legacy/build/pdf.mjs";`를 추가한다.

- [ ] **Step 6: 커밋**

```bash
git add src/extractors test/extractors test/helpers/ooxml.ts   # src/types/pdfjs.d.ts를 만들었다면 함께 add
git commit -m "feat: text extractors for pdf, docx, pptx, md, txt"
```

### Task 8: 저장소 (store) — 카드, state, index, 보고서

**Files:**
- Create: `src/store/slug.ts`, `src/store/frontmatter.ts`, `src/store/state.ts`, `src/store/cards.ts`, `src/store/indexMd.ts`, `src/store/report.ts`
- Test: `test/store/store.test.ts`

**Interfaces:**
- Consumes: `FileAnalysis`, `FileCardFrontmatter`, `State`, `StateEntry` (Task 2), `Candidate` (Task 6), `sha256String`
- Produces:
  - `slugify(title: string): string`, `cardFileName(fm: { period: string | null; modified: string; title: string; source_hash: string }): string`
  - `stringifyCard(fm: object, body: string): string`, `parseCard(text: string): { fm: Record<string, unknown>; body: string }`
  - `loadState(outputDir: string): Promise<{ state: State; problem: "missing" | "corrupt" | null }>`, `saveState(outputDir: string, s: State): Promise<void>`
  - `writeFileCard(outputDir: string, c: Candidate, a: FileAnalysis, agent: string): Promise<{ relPath: string; entry: StateEntry }>`
  - `writeIndex(outputDir: string): Promise<void>`
  - `type ScanReport = { startedAt: string; created: string[]; changed: string[]; skippedSensitive: { path: string; reason: string }[]; skippedLarge: { path: string; size: number }[]; skippedLong: { path: string; chars: number }[]; extractFailed: { path: string; reason: string }[]; analysisFailed: string[]; inaccessible: string[]; unsupported: number; stoppedReason: string | null }`
  - `writeScanReport(outputDir: string, r: ScanReport): Promise<string>` — 보고서 상대경로

- [ ] **Step 1: 실패하는 테스트**

`test/store/store.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { slugify, cardFileName } from "../../src/store/slug.js";
import { stringifyCard, parseCard } from "../../src/store/frontmatter.js";
import { loadState, saveState } from "../../src/store/state.js";
import { writeFileCard } from "../../src/store/cards.js";
import { writeIndex } from "../../src/store/indexMd.js";
import { writeScanReport } from "../../src/store/report.js";
import { FileCardFrontmatter } from "../../src/core/schema.js";
import { mkTmp } from "../helpers/tmp.js";

const analysis = {
  id: "f1", type: "보고서" as const, use_for: ["포트폴리오" as const], title: "이미지 분류: 최종/보고서?",
  summary: "요약", detail: "상세 1\n상세 2", excerpts: ["핵심 문장"], period: "2025-03 ~ 2025-06",
  role: "팀장", skills: ["Python"], metrics: ["정확도 92%"], org: null,
  value: "상" as const, value_reason: "근거", in_resume: "판단불가" as const,
};

describe("slug", () => {
  it("keeps Korean, strips unsafe chars, limits to 40 chars (Review Focus 1)", () => {
    expect(slugify("이미지 분류: 최종/보고서?")).toBe("이미지-분류-최종-보고서");
    expect([...slugify("가".repeat(60))].length).toBe(40);
    expect(slugify("CON")).toBe("CON-");
  });
  it("builds file name from period year and hash", () => {
    expect(cardFileName({ period: "2025-03 ~ 2025-06", modified: "2026-01-01", title: "보고서", source_hash: "sha256:abcdef123" }))
      .toBe("2025-보고서-abcdef.md");
    expect(cardFileName({ period: null, modified: "2024-05-01", title: "x", source_hash: "sha256:000000ff" }))
      .toBe("2024-x-000000.md");
  });
});

describe("frontmatter", () => {
  it("round-trips", () => {
    const t = stringifyCard({ a: 1, b: ["x"], c: null }, "## 본문\n내용");
    expect(parseCard(t)).toEqual({ fm: { a: 1, b: ["x"], c: null }, body: "## 본문\n내용" });
  });
});

describe("state", () => {
  it("reports missing and corrupt", async () => {
    const d = await mkTmp();
    expect((await loadState(d)).problem).toBe("missing");
    await mkdir(join(d, ".mp"), { recursive: true });
    await writeFile(join(d, ".mp", "state.json"), "{not json");
    expect((await loadState(d)).problem).toBe("corrupt");
  });
  it("round-trips", async () => {
    const d = await mkTmp();
    const s = { schema_version: 1 as const, files: {}, last_scan: "2026-11-24T00:00:00+09:00" };
    await saveState(d, s);
    expect(await loadState(d)).toEqual({ state: s, problem: null });
  });
});

describe("writeFileCard", () => {
  it("writes a valid card with normalized source path (Review Focus 2)", async () => {
    const d = await mkTmp();
    const cand = { path: "C:\\Users\\k\\a.pdf", key: "C:/Users/k/a.pdf", format: "pdf" as const, size: 10, mtimeMs: Date.parse("2025-06-20"), hash: "sha256:abcdef99", duplicates: [] };
    const { relPath, entry } = await writeFileCard(d, cand, analysis, "claude");
    expect(relPath).toBe("files/2025-이미지-분류-최종-보고서-abcdef.md");
    const { fm, body } = parseCard(await readFile(join(d, relPath), "utf8"));
    expect(FileCardFrontmatter.safeParse(fm).success).toBe(true);
    expect(fm.source).toBe("C:/Users/k/a.pdf");
    expect(body).toContain("## 상세 요약");
    expect(body).toContain("- 핵심 문장");
    expect(entry.status).toBe("done");
    expect(entry.card_body_hash).toMatch(/^sha256:/);
  });
  it("does not overwrite an existing card with the same name", async () => {
    const d = await mkTmp();
    const cand = { path: "/a.pdf", key: "/a.pdf", format: "pdf" as const, size: 1, mtimeMs: 0, hash: "sha256:abcdef00", duplicates: [] };
    const r1 = await writeFileCard(d, cand, analysis, "claude");
    const r2 = await writeFileCard(d, { ...cand, path: "/b.pdf", key: "/b.pdf" }, analysis, "claude");
    expect(r2.relPath).not.toBe(r1.relPath);
  });
});

describe("index and report", () => {
  it("writes index grouped by type and a report listing absolute paths", async () => {
    const d = await mkTmp();
    const cand = { path: "/a.pdf", key: "/a.pdf", format: "pdf" as const, size: 1, mtimeMs: 0, hash: "sha256:abcdef00", duplicates: [] };
    await writeFileCard(d, cand, analysis, "claude");
    await writeIndex(d);
    const idx = await readFile(join(d, "index.md"), "utf8");
    expect(idx).toContain("## 보고서");
    expect(idx).toContain("이미지 분류");
    const rel = await writeScanReport(d, {
      startedAt: "2026-11-24T10:00:00+09:00", created: ["files/x.md"], changed: [], skippedSensitive: [],
      skippedLarge: [{ path: "D:/영상/발표.pptx", size: 60_000_000 }], skippedLong: [{ path: "D:/논문.pdf", chars: 120000 }],
      extractFailed: [], analysisFailed: [], inaccessible: [], unsupported: 3, stoppedReason: null,
    });
    const rep = await readFile(join(d, rel), "utf8");
    expect(rep).toContain("D:/영상/발표.pptx");
    expect(rep).toContain("발표.pptx");
    expect(rep).toContain("D:/논문.pdf");
    expect(rep).toContain("120,000");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run test/store/store.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

`src/store/slug.ts`:
```ts
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

export function slugify(title: string): string {
  let s = title.normalize("NFC").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
  s = [...s].slice(0, 40).join("").replace(/-+$/, "");
  if (!s) s = "untitled";
  if (RESERVED.test(s)) s += "-";
  return s;
}

export function cardFileName(fm: { period: string | null; modified: string; title: string; source_hash: string }): string {
  const year = fm.period?.match(/(\d{4})/)?.[1] ?? fm.modified.slice(0, 4);
  const h6 = fm.source_hash.replace(/^sha256:/, "").slice(0, 6);
  return `${year}-${slugify(fm.title)}-${h6}.md`;
}
```

`src/store/frontmatter.ts`:
```ts
import YAML from "yaml";

export function stringifyCard(fm: object, body: string): string {
  return `---\n${YAML.stringify(fm, { lineWidth: 0 })}---\n${body}`;
}

export function parseCard(text: string): { fm: Record<string, unknown>; body: string } {
  const m = text.replace(/^\uFEFF/, "").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { fm: {}, body: text };
  return { fm: (YAML.parse(m[1]) ?? {}) as Record<string, unknown>, body: m[2] };
}
```

`src/store/state.ts`:
```ts
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { State } from "../core/schema.js";

const p = (d: string) => join(d, ".mp", "state.json");
export const emptyState = (): State => ({ schema_version: 1, files: {}, last_scan: null });

export async function loadState(outputDir: string): Promise<{ state: State; problem: "missing" | "corrupt" | null }> {
  let raw: string;
  try { raw = await readFile(p(outputDir), "utf8"); } catch { return { state: emptyState(), problem: "missing" }; }
  try { return { state: State.parse(JSON.parse(raw)), problem: null }; }
  catch { return { state: emptyState(), problem: "corrupt" }; }
}

export async function saveState(outputDir: string, s: State): Promise<void> {
  await mkdir(join(outputDir, ".mp"), { recursive: true });
  const tmp = p(outputDir) + ".tmp";
  await writeFile(tmp, JSON.stringify(State.parse(s), null, 2));
  await rename(tmp, p(outputDir));
}
```

`src/store/cards.ts`:
```ts
import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Candidate } from "../scan/prefilter.js";
import { FileCardFrontmatter, type FileAnalysis, type StateEntry } from "../core/schema.js";
import { normalizePath } from "../core/paths.js";
import { sha256String } from "../core/hash.js";
import { cardFileName } from "./slug.js";
import { stringifyCard } from "./frontmatter.js";

export const isoNow = () => {
  const d = new Date(), off = -d.getTimezoneOffset(), sign = off >= 0 ? "+" : "-";
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  return new Date(d.getTime() + off * 60000).toISOString().slice(0, 19) + `${sign}${pad(off / 60)}:${pad(off % 60)}`;
};

const exists = async (p: string) => access(p).then(() => true, () => false);

export async function writeFileCard(outputDir: string, c: Candidate, a: FileAnalysis, agent: string) {
  const fm = FileCardFrontmatter.parse({
    schema_version: 1, kind: "file", source: normalizePath(c.path), source_hash: c.hash, format: c.format,
    size: c.size, modified: new Date(c.mtimeMs).toISOString().slice(0, 10), duplicates: c.duplicates,
    type: a.type, use_for: a.use_for, title: a.title, summary: a.summary, period: a.period, role: a.role,
    skills: a.skills, metrics: a.metrics, org: a.org, value: a.value, value_reason: a.value_reason,
    in_resume: a.in_resume, agent, generated_at: isoNow(),
  });
  const body = `## 상세 요약\n${a.detail}\n\n## 근거 발췌\n${a.excerpts.map((e) => `- ${e}`).join("\n")}\n`;
  const content = stringifyCard(fm, body);
  await mkdir(join(outputDir, "files"), { recursive: true });
  let name = cardFileName(fm), n = 2;
  while (await exists(join(outputDir, "files", name))) name = cardFileName(fm).replace(/\.md$/, `-${n++}.md`);
  const relPath = `files/${name}`;
  await writeFile(join(outputDir, relPath), content);
  const entry: StateEntry = {
    source_hash: c.hash, card: relPath, card_body_hash: sha256String(content),
    card_snapshot: fm as unknown as Record<string, unknown>, status: "done",
  };
  return { relPath, entry };
}
```

`src/store/indexMd.ts`:
```ts
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DOC_TYPES } from "../core/schema.js";
import { parseCard } from "./frontmatter.js";

const RANK: Record<string, number> = { 상: 0, 중: 1, 하: 2 };
const cell = (s: unknown) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

export async function writeIndex(outputDir: string): Promise<void> {
  let names: string[] = [];
  try { names = (await readdir(join(outputDir, "files"))).filter((n) => n.endsWith(".md")); } catch { /* 없음 */ }
  const cards = await Promise.all(names.map(async (n) => ({ n, fm: parseCard(await readFile(join(outputDir, "files", n), "utf8")).fm })));
  const lines = ["# MasterPortfolio 인벤토리", "", `파일 카드 ${cards.length}개`, ""];
  for (const t of DOC_TYPES) {
    const group = cards.filter((c) => c.fm.type === t).sort((a, b) => (RANK[a.fm.value as string] ?? 9) - (RANK[b.fm.value as string] ?? 9));
    if (!group.length) continue;
    lines.push(`## ${t}`, "", "| 가치 | 제목 | 기간 | 기술 | 이력서 반영 |", "|---|---|---|---|---|");
    for (const c of group) {
      const skills = Array.isArray(c.fm.skills) ? (c.fm.skills as string[]).join(", ") : "";
      lines.push(`| ${cell(c.fm.value)} | [${cell(c.fm.title)}](files/${encodeURI(c.n)}) | ${cell(c.fm.period)} | ${cell(skills)} | ${cell(c.fm.in_resume)} |`);
    }
    lines.push("");
  }
  await writeFile(join(outputDir, "index.md"), lines.join("\n"));
}
```

`src/store/report.ts`:
```ts
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

export type ScanReport = {
  startedAt: string; created: string[]; changed: string[];
  skippedSensitive: { path: string; reason: string }[]; skippedLarge: { path: string; size: number }[];
  skippedLong: { path: string; chars: number }[]; extractFailed: { path: string; reason: string }[];
  analysisFailed: string[]; inaccessible: string[]; unsupported: number; stoppedReason: string | null;
};

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)}MB`;
const base = (p: string) => basename(p.replace(/\\/g, "/"));

export async function writeScanReport(outputDir: string, r: ScanReport): Promise<string> {
  const stamp = r.startedAt.slice(0, 16).replace(/[T:]/g, "-");
  const rel = `reports/scan-${stamp}.md`;
  const sec = (title: string, items: string[]) => (items.length ? [`## ${title} (${items.length})`, "", ...items, ""] : []);
  const lines = [
    `# 스캔 보고서 ${r.startedAt}`, "",
    ...(r.stoppedReason ? [`> 중단됨: ${r.stoppedReason}`, ""] : []),
    ...sec("신규 카드", r.created.map((c) => `- [${c}](../${encodeURI(c)})`)),
    ...sec("원본 변경 — `mp rescan <경로>`로 다시 처리", r.changed.map((p) => `- ${p}`)),
    ...sec("민감 파일로 건너뜀", r.skippedSensitive.map((s) => `- ${s.path} — ${s.reason}`)),
    ...sec("크기 초과(50MB)로 건너뜀", r.skippedLarge.map((s) => `- \`${base(s.path)}\` — ${s.path} (${mb(s.size)})`)),
    ...sec("텍스트 길이 초과(30,000자)로 건너뜀", r.skippedLong.map((s) => `- \`${base(s.path)}\` — ${s.path} (${s.chars.toLocaleString("en-US")}자)`)),
    ...sec("추출 실패", r.extractFailed.map((s) => `- ${s.path} — ${s.reason}`)),
    ...sec("분석 실패", r.analysisFailed.map((p) => `- ${p}`)),
    ...sec("접근 불가", r.inaccessible.map((p) => `- ${p}`)),
    `미지원 형식: ${r.unsupported}개`, "",
  ];
  await mkdir(join(outputDir, "reports"), { recursive: true });
  await writeFile(join(outputDir, rel), lines.join("\n"));
  return rel;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run test/store/store.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/store test/store/store.test.ts
git commit -m "feat: markdown card store, state, index and scan report"
```

### Task 9: state 정합성 검사와 재구성 질의

**Files:**
- Create: `src/store/reconcile.ts`
- Test: `test/store/reconcile.test.ts`

**Interfaces:**
- Consumes: `loadState`, `saveState`, `parseCard`, `sha256String`, `State`
- Produces:
  - `type Issue = { kind: "restore"; key: string; card: string } | { kind: "edited"; key: string; card: string; changedFields: string[] } | { kind: "orphan_state"; key: string; card: string } | { kind: "source_missing"; key: string; card: string }`
  - `checkConsistency(outputDir: string): Promise<{ state: State; problem: "missing" | "corrupt" | null; issues: Issue[] }>`
  - `type Decision = { protect: boolean } | { keep: boolean }`
  - `applyReconciliation(outputDir: string, state: State, issues: Issue[], decide: (i: Issue) => Promise<boolean>): Promise<State>` — `decide`가 true면 "보호/유지", false면 "덮어쓰기 허용/삭제"
  - State 확장: 사용자 편집으로 보호된 항목은 `card_body_hash: null`로 표시하지 않고 `status: "done"`을 유지하되, `card_snapshot`에 `"__protected": true`를 기록한다.

정책:
- `restore`: state에 없는데 `files/`에 카드가 있음 → 카드 frontmatter의 `source`/`source_hash`로 항목 복원. 편집 여부를 알 수 없으므로 보호로 기록(질의 없음, 목록만 보여줌).
- `edited`: 현재 카드 파일 해시 ≠ `card_body_hash` → `card_snapshot`과 현재 frontmatter를 비교해 바뀐 필드 이름 목록 제시, 질의 "보호(y) / 덮어쓰기 허용(n)".
- `orphan_state`: state에 있는데 카드 파일 없음 → 질의 "다음 스캔에서 다시 생성(y) / 무시하고 기록 유지(n)". y면 state 항목 삭제.
- `source_missing`: 원본 파일이 없음 → 질의 "카드 유지(y) / 카드 삭제(n)".

- [ ] **Step 1: 실패하는 테스트**

`test/store/reconcile.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { checkConsistency, applyReconciliation } from "../../src/store/reconcile.js";
import { writeFileCard } from "../../src/store/cards.js";
import { saveState, emptyState, loadState } from "../../src/store/state.js";
import { mkTmp } from "../helpers/tmp.js";

const analysis = {
  id: "f1", type: "보고서" as const, use_for: [], title: "보고서", summary: "요약", detail: "d", excerpts: [],
  period: null, role: null, skills: [], metrics: [], org: null, value: "중" as const, value_reason: "r", in_resume: "판단불가" as const,
};

async function setup() {
  const d = await mkTmp(); const src = join(d, "src.md");
  await writeFile(src, "x".repeat(300));
  const cand = { path: src, key: src.replace(/\\/g, "/"), format: "md" as const, size: 300, mtimeMs: 0, hash: "sha256:aaaaaa11", duplicates: [] };
  const { relPath, entry } = await writeFileCard(d, cand, analysis, "claude");
  const st = emptyState(); st.files[cand.key] = entry; await saveState(d, st);
  return { d, relPath, key: cand.key, src };
}

describe("reconcile", () => {
  it("no issues on a clean store", async () => {
    const { d } = await setup();
    expect((await checkConsistency(d)).issues).toEqual([]);
  });

  it("detects edited card with changed fields", async () => {
    const { d, relPath } = await setup();
    const p = join(d, relPath);
    await writeFile(p, (await readFile(p, "utf8")).replace("value: 중", "value: 상"));
    const { issues } = await checkConsistency(d);
    expect(issues).toEqual([expect.objectContaining({ kind: "edited", changedFields: ["value"] })]);
  });

  it("restores state from cards when state.json is missing", async () => {
    const { d, key } = await setup();
    await rm(join(d, ".mp", "state.json"));
    const { state, problem, issues } = await checkConsistency(d);
    expect(problem).toBe("missing");
    expect(issues.map((i) => i.kind)).toEqual(["restore"]);
    const next = await applyReconciliation(d, state, issues, async () => true);
    expect(next.files[key].source_hash).toBe("sha256:aaaaaa11");
    expect((await loadState(d)).state.files[key]).toBeDefined();
  });

  it("source missing + user chooses delete removes the card", async () => {
    const { d, relPath, src, key } = await setup();
    await rm(src);
    const { state, issues } = await checkConsistency(d);
    expect(issues.map((i) => i.kind)).toEqual(["source_missing"]);
    const next = await applyReconciliation(d, state, issues, async () => false);
    expect(next.files[key]).toBeUndefined();
    await expect(readFile(join(d, relPath))).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run test/store/reconcile.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

`src/store/reconcile.ts`:
```ts
import { access, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { State } from "../core/schema.js";
import { sha256String } from "../core/hash.js";
import { parseCard } from "./frontmatter.js";
import { loadState, saveState } from "./state.js";

export type Issue =
  | { kind: "restore"; key: string; card: string }
  | { kind: "edited"; key: string; card: string; changedFields: string[] }
  | { kind: "orphan_state"; key: string; card: string }
  | { kind: "source_missing"; key: string; card: string };

const exists = (p: string) => access(p).then(() => true, () => false);
const IGNORED = new Set(["generated_at"]);

export async function checkConsistency(outputDir: string) {
  const { state, problem } = await loadState(outputDir);
  const issues: Issue[] = [];
  let names: string[] = [];
  try { names = (await readdir(join(outputDir, "files"))).filter((n) => n.endsWith(".md")); } catch { /* 없음 */ }
  const cardToKey = new Map(Object.entries(state.files).filter(([, e]) => e.card).map(([k, e]) => [e.card!, k]));

  for (const n of names) {
    const rel = `files/${n}`;
    const text = await readFile(join(outputDir, rel), "utf8");
    const key = cardToKey.get(rel);
    if (!key) {
      const { fm } = parseCard(text);
      if (typeof fm.source === "string") issues.push({ kind: "restore", key: fm.source, card: rel });
      continue;
    }
    const e = state.files[key];
    if (!(await exists(key))) { issues.push({ kind: "source_missing", key, card: rel }); continue; }
    if (e.card_body_hash && sha256String(text) !== e.card_body_hash && !(e.card_snapshot as any)?.__protected) {
      const { fm } = parseCard(text);
      const snap = e.card_snapshot ?? {};
      const changedFields = Object.keys({ ...snap, ...fm })
        .filter((k) => !IGNORED.has(k) && !k.startsWith("__") && JSON.stringify(snap[k]) !== JSON.stringify(fm[k]));
      issues.push({ kind: "edited", key, card: rel, changedFields: changedFields.length ? changedFields : ["(본문)"] });
    }
  }
  for (const [key, e] of Object.entries(state.files)) {
    if (e.card && !names.includes(e.card.replace(/^files\//, ""))) issues.push({ kind: "orphan_state", key, card: e.card });
  }
  return { state, problem, issues };
}

export async function applyReconciliation(outputDir: string, state: State, issues: Issue[], decide: (i: Issue) => Promise<boolean>): Promise<State> {
  const next: State = structuredClone(state);
  for (const i of issues) {
    if (i.kind === "restore") {
      const { fm } = parseCard(await readFile(join(outputDir, i.card), "utf8"));
      next.files[i.key] = {
        source_hash: String(fm.source_hash ?? ""), card: i.card, card_body_hash: null,
        card_snapshot: { ...fm, __protected: true }, status: "done",
      };
      continue;
    }
    const yes = await decide(i);
    if (i.kind === "edited") {
      const e = next.files[i.key];
      if (yes) e.card_snapshot = { ...(e.card_snapshot ?? {}), __protected: true };
      else e.card_body_hash = sha256String(await readFile(join(outputDir, i.card), "utf8"));
    } else if (i.kind === "orphan_state") {
      if (yes) delete next.files[i.key];
    } else if (i.kind === "source_missing") {
      if (!yes) { await rm(join(outputDir, i.card), { force: true }); delete next.files[i.key]; }
    }
  }
  await saveState(outputDir, next);
  return next;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run test/store`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/store/reconcile.ts test/store/reconcile.test.ts
git commit -m "feat: state consistency check and reconciliation"
```

### Task 10: ACP 브리지와 가짜 에이전트

**Files:**
- Create: `src/agent/bridge.ts`, `src/agent/classify.ts`, `test/fake-agent/fake-agent.ts`
- Test: `test/agent/bridge.test.ts`, `test/agent/classify.test.ts`

**Interfaces:**
- Consumes: `AgentConfig` (Task 2 — `command`, `args`, `env?`, `sessionMeta?`, `initialModeId?`)
- Produces:
  - `type AgentFailureKind = "rate_limit" | "auth" | "crash" | "timeout" | "other"`
  - `type AgentReply = { ok: true; text: string } | { ok: false; kind: AgentFailureKind; detail: string }`
  - `class AgentError extends Error { readonly kind: AgentFailureKind }` — `start()`/`newSession()` 실패 시 throw
  - `classifyError(message: string): "rate_limit" | "auth" | "other"`
  - `describeError(e: unknown): string`, `classifyRpcError(e: unknown): "rate_limit" | "auth" | "other"`
  - `class AcpBridge { constructor(cfg: AgentConfig, opts?: { log?: (line: string) => void }); start(): Promise<void>; newSession(): Promise<string>; prompt(sessionId: string, text: string, timeoutMs: number): Promise<AgentReply>; stop(): Promise<void>; deniedPermissions: number }`
  - 가짜 에이전트: env `FAKE_AGENT_SCENARIO` = `ok` | `permission` | `badjson-once` | `fenced` | `rate-limit-after-1` | `rate-limit-text-after-1` | `auth-on-new`, `FAKE_AGENT_LOG` = 수신 내용을 JSONL로 기록할 파일, `FAKE_AGENT_STATE` = 호출 횟수 저장 파일(프로세스 간 유지)

SDK는 `@agentclientprotocol/sdk@2.9.1`이다(M0 Task 0.2, `docs/research/2026-11-24-acp-agents.md` §4). 이 버전에는 `ClientSideConnection`/`AgentSideConnection`이 **없다**. 클라이언트는 `acp.client(...).onRequest/onNotification(...).connect(stream)`, 에이전트는 `acp.agent(...)...connect(stream)`을 쓰고, 핸들러는 `{ params, client, ... }` 컨텍스트 하나를 받는다. 에이전트가 던진 일반 `Error`는 클라이언트에 `message: "Internal error"`, `data.details: <원문>`으로 도착한다. 실제 SDK 타입이 아래 코드와 다르면 §4의 검증된 코드와 `spikes/acp/probe.mjs`, `spikes/acp/fake-agent.mjs`를 기준으로 맞추되, 동작(capability false 선언, 권한 거부, 메시지 청크 수집, 빈 임시 폴더에서 spawn, sessionMeta 전달)은 그대로 유지한다.

M0에서 확인된 요구사항:
- 에이전트 프로세스는 **빈 임시 폴더를 cwd로** spawn하고, 같은 폴더를 세션 `cwd`로 쓴다(Antigravity가 프로세스 cwd를 작업공간으로 취급해 자동 읽기 허용).
- `session/new`에 `cfg.sessionMeta`를 `_meta`로 넘긴다(Claude의 `tools: []` 차단이 여기로만 전달됨).
- `cfg.initialModeId`가 있으면 `session/new` 직후 `session/set_mode`를 호출한다(Claude: 사용자 `defaultMode: auto` 무력화). 실패는 로그만 남긴다.
- 인증 오류는 `session/new`에서 `-32000 "Authentication required"`로 온다(Codex, Antigravity) → `AgentError("auth")`.

- [ ] **Step 1: 가짜 에이전트 작성**

`test/fake-agent/fake-agent.ts`:
```ts
import * as acp from "@agentclientprotocol/sdk";
import { Readable, Writable } from "node:stream";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const scenario = process.env.FAKE_AGENT_SCENARIO ?? "ok";
const logFile = process.env.FAKE_AGENT_LOG;
const stateFile = process.env.FAKE_AGENT_STATE;
const log = (o: unknown) => { if (logFile) appendFileSync(logFile, JSON.stringify(o) + "\n"); };

function nextCall(): number {
  if (!stateFile) return 1;
  let n = 0; try { n = Number(readFileSync(stateFile, "utf8")) || 0; } catch { /* first */ }
  writeFileSync(stateFile, String(n + 1)); return n + 1;
}

function answerFor(prompt: string): string {
  let ids = [...prompt.matchAll(/^### FILE id=(\S+)/gm)].map((m) => m[1]);
  const retry = prompt.match(/다음 id들에 대해서만[^:]*: (.+)$/m);
  if (!ids.length && retry) ids = retry[1].split(",").map((x) => x.trim()).filter(Boolean);
  return JSON.stringify(ids.map((id) => ({
    id, type: "보고서", use_for: ["포트폴리오"], title: `제목 ${id}`, summary: "요약", detail: "상세",
    excerpts: ["발췌"], period: "2025-03 ~ 2025-06", role: null, skills: ["Python"], metrics: [],
    org: null, value: "중", value_reason: "근거", in_resume: "판단불가",
  })));
}

let sessions = 0;
log({ processCwd: process.cwd() });

acp.agent({ name: "fake-agent" })
  .onRequest(acp.methods.agent.initialize, () => ({
    protocolVersion: acp.PROTOCOL_VERSION, agentCapabilities: { loadSession: false }, authMethods: [],
  }))
  .onRequest(acp.methods.agent.session.new, ({ params }) => {
    log({ sessionNew: { cwd: params.cwd, _meta: params._meta ?? null } });
    if (scenario === "auth-on-new") throw acp.RequestError.authRequired();
    return { sessionId: `s${++sessions}` };
  })
  .onRequest(acp.methods.agent.session.setMode, ({ params }) => { log({ setMode: params.modeId }); return {}; })
  .onNotification(acp.methods.agent.session.cancel, () => {})
  .onRequest(acp.methods.agent.session.prompt, async ({ params, client }) => {
    const text = params.prompt.map((b) => (b.type === "text" ? b.text : "")).join("");
    const call = nextCall();
    log({ call, text });
    if (scenario === "rate-limit-after-1" && call >= 2) throw new Error("Claude usage limit reached (429 rate limit)");
    if (scenario === "permission") {
      const r = await client.request(acp.methods.client.session.requestPermission, {
        sessionId: params.sessionId,
        toolCall: { toolCallId: "t1", title: "Read /etc/passwd", kind: "read", status: "pending" },
        options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }, { optionId: "reject", name: "Reject", kind: "reject_once" }],
      });
      log({ permissionOutcome: r.outcome });
    }
    let reply = answerFor(text);
    if (scenario === "badjson-once" && call === 1) reply = "죄송합니다, JSON을 만들지 못했습니다.";
    if (scenario === "fenced") reply = "분석 결과입니다.\n```json\n" + reply + "\n```\n추가 설명은 없습니다.";
    if (scenario === "rate-limit-text-after-1" && call >= 2) reply = "You've hit your usage limit. Upgrade to Plus to continue using Codex.";
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: reply } },
    });
    return { stopReason: "end_turn" };
  })
  .connect(acp.ndJsonStream(Writable.toWeb(process.stdout) as WritableStream<Uint8Array>, Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>));
```

- [ ] **Step 2: 실패하는 테스트**

`test/agent/classify.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { classifyError, classifyRpcError } from "../../src/agent/classify.js";

describe("classifyError", () => {
  it.each([
    ["Claude usage limit reached (429 rate limit)", "rate_limit"],
    ["You exceeded your current quota", "rate_limit"],
    ["You've hit your usage limit. Upgrade to Plus to continue using Codex.", "rate_limit"],
    ["RESOURCE_EXHAUSTED", "rate_limit"],
    ["Authentication required", "auth"],
    ["Not logged in · Please run /login", "auth"],
    ["401 Unauthorized", "auth"],
    ["캡스톤 프로젝트 보고서 분석 결과", "other"],
    ["something else", "other"],
  ])("%s → %s", (m, k) => expect(classifyError(m)).toBe(k));
});

describe("classifyRpcError", () => {
  it("uses data.errorKind and code -32000", () => {
    expect(classifyRpcError({ message: "Internal error: x", code: -32603, data: { errorKind: "rate_limit" } })).toBe("rate_limit");
    expect(classifyRpcError({ message: "Authentication required", code: -32000 })).toBe("auth");
  });
  it("reads text from data.details", () => {
    expect(classifyRpcError({ message: "Internal error", code: -32603, data: { details: "Claude usage limit reached (429 rate limit)" } })).toBe("rate_limit");
  });
});
```

`test/agent/bridge.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { AcpBridge, AgentError } from "../../src/agent/bridge.js";
import { mkTmp } from "../helpers/tmp.js";

const FAKE = resolve("test/fake-agent/fake-agent.ts");
const cfg = (env: Record<string, string>, extra: object = {}) => ({ command: process.execPath, args: ["--import", "tsx", FAKE], env, ...extra });
const readLog = async (p: string) => (await readFile(p, "utf8")).trim().split("\n").map((l) => JSON.parse(l));

describe("AcpBridge", () => {
  it("collects message chunks as reply text", async () => {
    const b = new AcpBridge(cfg({ FAKE_AGENT_SCENARIO: "ok" }));
    await b.start();
    const s = await b.newSession();
    const r = await b.prompt(s, "### FILE id=f1\n내용", 30_000);
    await b.stop();
    expect(r.ok && JSON.parse(r.text)[0].id).toBe("f1");
  });

  it("spawns in an empty temp dir, passes sessionMeta as _meta, and sets the initial mode", async () => {
    const d = await mkTmp(); const log = join(d, "log.jsonl");
    const meta = { claudeCode: { options: { tools: [] } } };
    const b = new AcpBridge(cfg({ FAKE_AGENT_SCENARIO: "ok", FAKE_AGENT_LOG: log }, { sessionMeta: meta, initialModeId: "default" }));
    await b.start(); await b.newSession(); await b.stop();
    const lines = await readLog(log);
    const processCwd = lines.find((l) => l.processCwd)!.processCwd as string;
    const sessionNew = lines.find((l) => l.sessionNew)!.sessionNew;
    expect(processCwd).not.toBe(process.cwd());
    expect(sessionNew.cwd).toBe(processCwd);
    expect(sessionNew._meta).toEqual(meta);
    expect(lines.find((l) => l.setMode)?.setMode).toBe("default");
    expect(await readdir(processCwd)).toEqual([]);
  });

  it("rejects every permission request", async () => {
    const d = await mkTmp(); const log = join(d, "log.jsonl");
    const b = new AcpBridge(cfg({ FAKE_AGENT_SCENARIO: "permission", FAKE_AGENT_LOG: log }));
    await b.start(); const s = await b.newSession();
    await b.prompt(s, "### FILE id=f1\n내용", 30_000);
    await b.stop();
    const outcome = (await readLog(log)).find((l) => l.permissionOutcome)!.permissionOutcome;
    expect(outcome).toEqual({ outcome: "selected", optionId: "reject" });
    expect(b.deniedPermissions).toBe(1);
  });

  it("maps a thrown agent error to rate_limit", async () => {
    const d = await mkTmp();
    const b = new AcpBridge(cfg({ FAKE_AGENT_SCENARIO: "rate-limit-after-1", FAKE_AGENT_STATE: join(d, "n") }));
    await b.start(); const s = await b.newSession();
    expect((await b.prompt(s, "### FILE id=a\n", 30_000)).ok).toBe(true);
    expect(await b.prompt(s, "### FILE id=b\n", 30_000)).toMatchObject({ ok: false, kind: "rate_limit" });
    await b.stop();
  });

  it("throws AgentError(auth) when session/new requires authentication", async () => {
    const b = new AcpBridge(cfg({ FAKE_AGENT_SCENARIO: "auth-on-new" }));
    await b.start();
    await expect(b.newSession()).rejects.toMatchObject({ kind: "auth" });
    await b.stop();
  });

  it("throws AgentError(crash) when the agent command does not exist", async () => {
    const b = new AcpBridge({ command: "definitely-not-a-real-cmd-xyz", args: [] });
    const err = await b.start().then(() => null, (e) => e);
    expect(err).toBeInstanceOf(AgentError);
    expect(err.kind).toBe("crash");
    await b.stop();
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run test/agent`
Expected: FAIL (모듈 없음)

- [ ] **Step 4: 구현**

`src/agent/classify.ts`:
```ts
const RATE = /You've hit your|You've reached your|out of (extra )?usage|usage limit|rate.?limit|RESOURCE_EXHAUSTED|insufficient_quota|quota|too many requests|\b429\b/i;
const AUTH = /Authentication required|run \/login|Not logged in|Login expired|unauthori[sz]ed|\b401\b|credential/i;

export function classifyError(message: string): "rate_limit" | "auth" | "other" {
  if (RATE.test(message)) return "rate_limit";
  if (AUTH.test(message)) return "auth";
  return "other";
}

export function describeError(e: unknown): string {
  const x = e as { message?: unknown; data?: { details?: unknown; message?: unknown } } | null;
  const parts = [x?.message, x?.data?.details, x?.data?.message, x?.data ? JSON.stringify(x.data) : undefined];
  const s = parts.filter((p) => typeof p === "string" && p.length > 0).join(" | ");
  return s || String(e);
}

export function classifyRpcError(e: unknown): "rate_limit" | "auth" | "other" {
  const x = e as { code?: unknown; data?: { errorKind?: unknown } } | null;
  if (x?.data?.errorKind === "rate_limit") return "rate_limit";
  if (x?.data?.errorKind === "authentication_failed") return "auth";
  if (x?.code === -32000) return "auth";
  return classifyError(describeError(e));
}
```

`src/agent/bridge.ts`:
```ts
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import type { AgentConfig } from "../core/schema.js";
import { classifyRpcError, describeError } from "./classify.js";

export type AgentFailureKind = "rate_limit" | "auth" | "crash" | "timeout" | "other";
export type AgentReply = { ok: true; text: string } | { ok: false; kind: AgentFailureKind; detail: string };

export class AgentError extends Error {
  constructor(readonly kind: AgentFailureKind, detail: string) { super(detail); this.name = "AgentError"; }
}

type Conn = ReturnType<ReturnType<typeof acp.client>["connect"]>;

export class AcpBridge {
  private proc: ChildProcess | null = null;
  private conn: Conn | null = null;
  private workDir: string | null = null;
  private chunks = new Map<string, string[]>();
  private exited: string | null = null;
  deniedPermissions = 0;

  constructor(private cfg: AgentConfig, private opts: { log?: (line: string) => void } = {}) {}

  private fail(e: unknown): AgentError {
    if (e instanceof AgentError) return e;
    if (this.exited) return new AgentError("crash", this.exited);
    return new AgentError(classifyRpcError(e), describeError(e));
  }

  async start(): Promise<void> {
    this.workDir = await mkdtemp(join(tmpdir(), "mp-agent-"));
    const useShell = process.platform === "win32" && this.cfg.command !== process.execPath && !/\.exe$/i.test(this.cfg.command);
    const proc = spawn(this.cfg.command, this.cfg.args, {
      cwd: this.workDir, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...(this.cfg.env ?? {}) },
      windowsHide: true, shell: useShell,
    });
    this.proc = proc;
    try {
      await new Promise<void>((res, rej) => { proc.once("spawn", () => res()); proc.once("error", rej); });
    } catch (e) {
      this.proc = null;
      throw new AgentError("crash", `에이전트 실행 실패: ${describeError(e)}`);
    }
    proc.on("exit", (code) => { this.exited = `에이전트 프로세스 종료 (code ${code})`; });
    proc.stderr?.on("data", (d) => this.opts.log?.(`[agent stderr] ${String(d).trimEnd()}`));

    const app = acp.client({ name: "masterportfolio" })
      .onRequest(acp.methods.client.session.requestPermission, ({ params }) => {
        this.deniedPermissions++;
        this.opts.log?.(`[permission denied] ${params.toolCall.title ?? params.toolCall.toolCallId}`);
        const reject = params.options.find((o) => o.kind === "reject_once" || o.kind === "reject_always");
        return reject ? { outcome: { outcome: "selected", optionId: reject.optionId } } : { outcome: { outcome: "cancelled" } };
      })
      .onNotification(acp.methods.client.session.update, ({ params }) => {
        const u = params.update;
        if (u.sessionUpdate === "agent_message_chunk" && u.content.type === "text") this.chunks.get(params.sessionId)?.push(u.content.text);
        if (u.sessionUpdate === "tool_call") this.opts.log?.(`[tool_call] ${u.title}`);
      })
      .onRequest(acp.methods.client.fs.readTextFile, () => { throw new Error("fs not supported"); })
      .onRequest(acp.methods.client.fs.writeTextFile, () => { throw new Error("fs not supported"); });
    this.conn = app.connect(acp.ndJsonStream(Writable.toWeb(proc.stdin!) as WritableStream<Uint8Array>, Readable.toWeb(proc.stdout!) as ReadableStream<Uint8Array>));
    try {
      await this.conn.agent.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      });
    } catch (e) { throw this.fail(e); }
  }

  async newSession(): Promise<string> {
    if (!this.conn || !this.workDir) throw new AgentError("crash", "에이전트가 시작되지 않음");
    let sessionId: string;
    try {
      ({ sessionId } = await this.conn.agent.request(acp.methods.agent.session.new, {
        cwd: this.workDir, mcpServers: [], ...(this.cfg.sessionMeta ? { _meta: this.cfg.sessionMeta } : {}),
      }));
    } catch (e) { throw this.fail(e); }
    this.chunks.set(sessionId, []);
    if (this.cfg.initialModeId) {
      await this.conn.agent.request(acp.methods.agent.session.setMode, { sessionId, modeId: this.cfg.initialModeId })
        .catch((e: unknown) => this.opts.log?.(`[set_mode failed] ${describeError(e)}`));
    }
    return sessionId;
  }

  async prompt(sessionId: string, text: string, timeoutMs: number): Promise<AgentReply> {
    if (this.exited) return { ok: false, kind: "crash", detail: this.exited };
    this.chunks.set(sessionId, []);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<AgentReply>((res) => { timer = setTimeout(() => res({ ok: false, kind: "timeout", detail: `${timeoutMs}ms 초과` }), timeoutMs); });
    const run = this.conn!.agent.request(acp.methods.agent.session.prompt, { sessionId, prompt: [{ type: "text", text }] }).then(
      (): AgentReply => ({ ok: true, text: (this.chunks.get(sessionId) ?? []).join("") }),
      (e: unknown): AgentReply => { const err = this.fail(e); return { ok: false, kind: err.kind, detail: err.message }; });
    const r = await Promise.race([run, timeout]);
    clearTimeout(timer);
    if (!r.ok && r.kind === "timeout") await this.conn!.agent.notify(acp.methods.agent.session.cancel, { sessionId }).catch(() => {});
    return r;
  }

  async stop(): Promise<void> {
    try { this.conn?.close(); } catch { /* already closed */ }
    this.proc?.stdin?.end();
    this.proc?.kill();
    this.proc = null; this.conn = null;
  }
}
```

`Conn` 타입이 SDK 버전에서 다르게 추론되면 SDK가 export하는 연결 타입(§4의 `ClientConnection`)으로 바꾼다. `any`로 우회하지 않는다.

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run test/agent && npx tsc -p tsconfig.json --noEmit`
Expected: PASS, 타입 오류 없음

- [ ] **Step 6: 커밋**

```bash
git add src/agent test/agent test/fake-agent
git commit -m "feat: ACP bridge (SDK 2.9 client API) with permission denial and fake agent"
```

### Task 11: 분석기 (analyzer) — 배치, 프롬프트, 파싱, 재시도

**Files:**
- Create: `src/analyzer/batch.ts`, `src/analyzer/prompt.ts`, `src/analyzer/parse.ts`, `src/analyzer/analyze.ts`
- Test: `test/analyzer/batch.test.ts`, `test/analyzer/parse.test.ts`, `test/analyzer/analyze.test.ts`

**Interfaces:**
- Consumes: `SanitizedText` (Task 3), `FileAnalysis` (Task 2), `AcpBridge`, `AgentReply`, `AgentError`, `classifyError` (Task 10)
- Produces:
  - `type BatchItem = { id: string; relPath: string; format: string; modified: string; text: SanitizedText }`
  - `makeBatches(items: BatchItem[], batchChars: number): BatchItem[][]`
  - `buildBatchPrompt(items: BatchItem[], baselineSummary: string | null): string`
  - `buildRetryPrompt(items: BatchItem[], errors: string[]): string`
  - `extractJsonArray(text: string): unknown[] | null`
  - `validateBatchReply(raw: unknown[] | null, ids: string[]): { valid: Map<string, FileAnalysis>; errors: string[]; missing: string[] }`
  - `type BridgeLike = Pick<AcpBridge, "newSession" | "prompt">`
  - `type Stop = { kind: "rate_limit" | "auth" | "crash"; detail: string }`
  - `analyzeBatches(bridge: BridgeLike, batches: BatchItem[][], opts: { timeoutMs: number; rotateEvery: number; baselineSummary: string | null; onResult: (id: string, a: FileAnalysis) => Promise<void>; onFailed: (id: string) => Promise<void>; onPrompt?: (text: string) => void }): Promise<{ stopped: null | { kind: "rate_limit" | "auth" | "crash"; detail: string } }>`

- [ ] **Step 1: 실패하는 테스트**

`test/analyzer/batch.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { makeBatches } from "../../src/analyzer/batch.js";
const item = (id: string, n: number) => ({ id, relPath: id, format: "md", modified: "2025-01-01", text: "x".repeat(n) as any });
describe("makeBatches", () => {
  it("packs greedily in order without exceeding the limit", () => {
    const b = makeBatches([item("a", 10_000), item("b", 15_000), item("c", 10_000), item("d", 30_000)], 30_000);
    expect(b.map((x) => x.map((i) => i.id))).toEqual([["a", "b"], ["c"], ["d"]]);
  });
});
```

`test/analyzer/parse.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { extractJsonArray, validateBatchReply } from "../../src/analyzer/parse.js";

const ok = (id: string) => ({
  id, type: "기타", use_for: [], title: "t", summary: "s", detail: "d", excerpts: [], period: null, role: null,
  skills: [], metrics: [], org: null, value: "하", value_reason: "r", in_resume: "판단불가",
});

describe("extractJsonArray (Review Focus 4)", () => {
  it("parses a bare array", () => { expect(extractJsonArray('[{"a":1}]')).toEqual([{ a: 1 }]); });
  it("parses a fenced array with surrounding prose", () => {
    expect(extractJsonArray('결과입니다.\n```json\n[{"a":"]"}]\n```\n끝')).toEqual([{ a: "]" }]);
  });
  it("parses an array embedded in prose without fences", () => {
    expect(extractJsonArray('다음과 같습니다: [{"a":1},{"b":"x[y]"}] 이상입니다.')).toEqual([{ a: 1 }, { b: "x[y]" }]);
  });
  it("returns null when there is no array", () => { expect(extractJsonArray("없음")).toBeNull(); });
});

describe("validateBatchReply", () => {
  it("accepts valid items, reports invalid and missing", () => {
    const r = validateBatchReply([ok("a"), { ...ok("b"), value: "최상" }, ok("zzz")], ["a", "b", "c"]);
    expect([...r.valid.keys()]).toEqual(["a"]);
    expect(r.missing.sort()).toEqual(["b", "c"]);
    expect(r.errors.length).toBeGreaterThan(0);
  });
});
```

`test/analyzer/analyze.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { analyzeBatches } from "../../src/analyzer/analyze.js";
import { AgentError, type AgentReply } from "../../src/agent/bridge.js";

const ok = (id: string) => ({
  id, type: "기타", use_for: [], title: "t", summary: "s", detail: "d", excerpts: [], period: null, role: null,
  skills: [], metrics: [], org: null, value: "하", value_reason: "r", in_resume: "판단불가",
});
const item = (id: string) => ({ id, relPath: id, format: "md", modified: "2025-01-01", text: "본문" as any });
const idsIn = (t: string) => [...t.matchAll(/^### FILE id=(\S+)/gm)].map((m) => m[1]);

function fakeBridge(replies: ((prompt: string) => AgentReply)[]) {
  let i = 0, sessions = 0;
  return {
    sessionsOpened: () => sessions,
    newSession: async () => `s${++sessions}`,
    prompt: async (_s: string, t: string) => replies[Math.min(i++, replies.length - 1)](t),
  };
}

describe("analyzeBatches", () => {
  it("retries once for missing ids, then marks them failed", async () => {
    const results: string[] = [], failed: string[] = [];
    const b = fakeBridge([
      () => ({ ok: true, text: JSON.stringify([ok("a")]) }),
      () => ({ ok: true, text: "여전히 실패" }),
    ]);
    const r = await analyzeBatches(b, [[item("a"), item("b")]], {
      timeoutMs: 1000, rotateEvery: 5, baselineSummary: null,
      onResult: async (id) => { results.push(id); }, onFailed: async (id) => { failed.push(id); },
    });
    expect(r.stopped).toBeNull();
    expect(results).toEqual(["a"]);
    expect(failed).toEqual(["b"]);
  });

  it("stops on rate limit and leaves remaining batches untouched", async () => {
    const results: string[] = [];
    const b = fakeBridge([
      (t) => ({ ok: true, text: JSON.stringify(idsIn(t).map(ok)) }),
      () => ({ ok: false, kind: "rate_limit", detail: "429" }),
    ]);
    const r = await analyzeBatches(b, [[item("a")], [item("b")], [item("c")]], {
      timeoutMs: 1000, rotateEvery: 5, baselineSummary: null,
      onResult: async (id) => { results.push(id); }, onFailed: async () => {},
    });
    expect(r.stopped?.kind).toBe("rate_limit");
    expect(results).toEqual(["a"]);
  });

  it("rotates sessions every N batches", async () => {
    const b = fakeBridge([(t) => ({ ok: true, text: JSON.stringify(idsIn(t).map(ok)) })]);
    await analyzeBatches(b, Array.from({ length: 6 }, (_, i) => [item(`f${i}`)]), {
      timeoutMs: 1000, rotateEvery: 5, baselineSummary: null, onResult: async () => {}, onFailed: async () => {},
    });
    expect(b.sessionsOpened()).toBe(2);
  });

  it("stops when a non-JSON reply is a usage-limit message (Codex style)", async () => {
    const results: string[] = [];
    const b = fakeBridge([
      (t) => ({ ok: true, text: JSON.stringify(idsIn(t).map(ok)) }),
      () => ({ ok: true, text: "You've hit your usage limit. Upgrade to Plus to continue using Codex." }),
    ]);
    const r = await analyzeBatches(b, [[item("a")], [item("b")]], {
      timeoutMs: 1000, rotateEvery: 5, baselineSummary: null,
      onResult: async (id) => { results.push(id); }, onFailed: async () => {},
    });
    expect(r.stopped?.kind).toBe("rate_limit");
    expect(results).toEqual(["a"]);
  });

  it("stops with auth when opening a session fails with AgentError(auth)", async () => {
    const b = { newSession: async () => { throw new AgentError("auth", "Authentication required"); }, prompt: async () => ({ ok: true as const, text: "[]" }) };
    const r = await analyzeBatches(b, [[item("a")]], {
      timeoutMs: 1000, rotateEvery: 5, baselineSummary: null, onResult: async () => {}, onFailed: async () => {},
    });
    expect(r.stopped).toEqual({ kind: "auth", detail: "Authentication required" });
  });

  it("timeout marks the batch failed and continues", async () => {
    const results: string[] = [], failed: string[] = [];
    const b = fakeBridge([
      () => ({ ok: false, kind: "timeout", detail: "t" }),
      (t) => ({ ok: true, text: JSON.stringify(idsIn(t).map(ok)) }),
    ]);
    const r = await analyzeBatches(b, [[item("a")], [item("b")]], {
      timeoutMs: 1000, rotateEvery: 5, baselineSummary: null,
      onResult: async (id) => { results.push(id); }, onFailed: async (id) => { failed.push(id); },
    });
    expect(r.stopped).toBeNull();
    expect(failed).toEqual(["a"]);
    expect(results).toEqual(["b"]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run test/analyzer`
Expected: FAIL

- [ ] **Step 3: 구현**

`src/analyzer/batch.ts`:
```ts
import type { SanitizedText } from "../privacy/sanitized.js";
export type BatchItem = { id: string; relPath: string; format: string; modified: string; text: SanitizedText };

export function makeBatches(items: BatchItem[], batchChars: number): BatchItem[][] {
  const out: BatchItem[][] = [];
  let cur: BatchItem[] = [], size = 0;
  for (const it of items) {
    if (cur.length && size + it.text.length > batchChars) { out.push(cur); cur = []; size = 0; }
    cur.push(it); size += it.text.length;
  }
  if (cur.length) out.push(cur);
  return out;
}
```

`src/analyzer/prompt.ts`:
```ts
import type { BatchItem } from "./batch.js";
import { DOC_TYPES, IN_RESUME, USE_FOR, VALUES } from "../core/schema.js";

const SCHEMA = `[
  {
    "id": "파일 id 그대로",
    "type": ${JSON.stringify(DOC_TYPES.join("|"))},
    "use_for": ["${USE_FOR.join('" | "')}" 중 0개 이상],
    "title": "80자 이내 짧은 제목",
    "summary": "한 줄 요약",
    "detail": "3~5줄 상세 요약 (줄바꿈 \\n)",
    "excerpts": ["원문 핵심 문장 최대 3개, 원문 그대로"],
    "period": "YYYY-MM ~ YYYY-MM 형식 또는 null",
    "role": "역할 또는 null",
    "skills": ["기술·도구"],
    "metrics": ["숫자가 들어간 성과"],
    "org": "수업명/동아리/회사 등 소속 또는 null",
    "value": ${JSON.stringify(VALUES.join("|"))},
    "value_reason": "활용 가치 판단 근거 한 줄",
    "in_resume": ${JSON.stringify(IN_RESUME.join("|"))}
  }
]`;

export function buildBatchPrompt(items: BatchItem[], baselineSummary: string | null): string {
  const files = items.map((i) => `### FILE id=${i.id}\npath: ${i.relPath}\nformat: ${i.format}\nmodified: ${i.modified}\n\n${i.text}\n`).join("\n");
  return [
    "당신은 취업 준비생의 자료를 정리하는 분석가입니다. 아래 파일들 각각이 이력서·자소서·포트폴리오에 어떻게 쓰일 수 있는지 분석하세요.",
    "규칙:",
    "- 도구를 사용하거나 파일을 읽으려 하지 마세요. 아래 제공된 텍스트만 근거로 삼으세요.",
    "- 원문에 근거가 없는 값은 추측하지 말고 null 또는 빈 배열로 두세요.",
    "- [주민번호], [전화번호] 같은 표식은 가려진 개인정보입니다. 복원하거나 언급하지 마세요.",
    "- 모든 텍스트 값은 한국어로 쓰세요(기술명 등 고유명사는 원문 표기).",
    baselineSummary
      ? `- in_resume는 아래 [기존 이력서 요약]과 비교해 판단하세요.\n\n[기존 이력서 요약]\n${baselineSummary}`
      : '- 기존 이력서 자료가 없으므로 in_resume는 항상 "판단불가"로 두세요.',
    "",
    "출력: 아래 스키마의 JSON 배열 하나만 출력하세요. 파일마다 정확히 한 항목, 다른 문장은 쓰지 마세요.",
    SCHEMA,
    "",
    "[파일 목록]",
    files,
  ].join("\n");
}

export function buildRetryPrompt(items: BatchItem[], errors: string[]): string {
  return [
    "직전 응답이 형식 검증에 실패했습니다. 오류:",
    ...errors.slice(0, 20).map((e) => `- ${e}`),
    "",
    `다음 id들에 대해서만, 앞서 안내한 스키마의 JSON 배열 하나만 다시 출력하세요: ${items.map((i) => i.id).join(", ")}`,
  ].join("\n");
}
```

`src/analyzer/parse.ts`:
```ts
import { FileAnalysis } from "../core/schema.js";

function scanArray(s: string, start: number): string | null {
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === "[") depth++;
    else if (ch === "]" && --depth === 0) return s.slice(start, i + 1);
  }
  return null;
}

export function extractJsonArray(text: string): unknown[] | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = fence ? [fence[1], text] : [text];
  for (const c of candidates) {
    for (let i = c.indexOf("["); i !== -1; i = c.indexOf("[", i + 1)) {
      const slice = scanArray(c, i);
      if (!slice) continue;
      try { const v = JSON.parse(slice); if (Array.isArray(v)) return v; } catch { /* try next */ }
    }
  }
  return null;
}

export function validateBatchReply(raw: unknown[] | null, ids: string[]) {
  const valid = new Map<string, FileAnalysis>();
  const errors: string[] = [];
  if (!raw) errors.push("JSON 배열을 찾을 수 없음");
  for (const item of raw ?? []) {
    const r = FileAnalysis.safeParse(item);
    const id = (item as any)?.id;
    if (!r.success) { errors.push(`id=${id ?? "?"}: ${r.error.issues.map((x) => `${x.path.join(".")} ${x.message}`).join("; ")}`); continue; }
    if (!ids.includes(r.data.id)) { errors.push(`알 수 없는 id=${r.data.id}`); continue; }
    if (valid.has(r.data.id)) { errors.push(`중복 id=${r.data.id}`); continue; }
    valid.set(r.data.id, r.data);
  }
  const missing = ids.filter((id) => !valid.has(id));
  for (const id of missing) if (!errors.some((e) => e.includes(`id=${id}`))) errors.push(`id=${id} 누락`);
  return { valid, errors, missing };
}
```

`src/analyzer/analyze.ts`:
```ts
import { AgentError, type AcpBridge, type AgentReply } from "../agent/bridge.js";
import { classifyError } from "../agent/classify.js";
import type { FileAnalysis } from "../core/schema.js";
import type { BatchItem } from "./batch.js";
import { buildBatchPrompt, buildRetryPrompt } from "./prompt.js";
import { extractJsonArray, validateBatchReply } from "./parse.js";

export type BridgeLike = Pick<AcpBridge, "newSession" | "prompt">;
export type Stop = { kind: "rate_limit" | "auth" | "crash"; detail: string };

/** 스캔 전체를 멈춰야 하는 응답이면 Stop, 아니면 null. */
function stopFor(r: AgentReply): Stop | null {
  if (r.ok) {
    // Codex는 사용량 한도 등 서비스 오류를 일반 답변 텍스트로 보낸다(M0 Task 0.2 §7).
    if (extractJsonArray(r.text) !== null) return null;
    const k = classifyError(r.text);
    return k === "other" ? null : { kind: k, detail: r.text.slice(0, 300) };
  }
  if (r.kind === "timeout" || r.kind === "other") return null;
  return { kind: r.kind, detail: r.detail };
}

export async function analyzeBatches(bridge: BridgeLike, batches: BatchItem[][], opts: {
  timeoutMs: number; rotateEvery: number; baselineSummary: string | null;
  onResult: (id: string, a: FileAnalysis) => Promise<void>; onFailed: (id: string) => Promise<void>;
  onPrompt?: (text: string) => void;
}): Promise<{ stopped: Stop | null }> {
  let session: string | null = null;
  for (let bi = 0; bi < batches.length; bi++) {
    if (session === null || bi % opts.rotateEvery === 0) {
      try { session = await bridge.newSession(); }
      catch (e) {
        const kind = e instanceof AgentError && (e.kind === "rate_limit" || e.kind === "auth") ? e.kind : "crash";
        return { stopped: { kind, detail: e instanceof Error ? e.message : String(e) } };
      }
    }
    const batch = batches[bi];
    const ids = batch.map((b) => b.id);
    const prompt = buildBatchPrompt(batch, opts.baselineSummary);
    opts.onPrompt?.(prompt);
    const reply = await bridge.prompt(session, prompt, opts.timeoutMs);
    const stop = stopFor(reply);
    if (stop) return { stopped: stop };
    if (!reply.ok) { for (const id of ids) await opts.onFailed(id); continue; }
    const { valid, errors, missing } = validateBatchReply(extractJsonArray(reply.text), ids);
    for (const [id, a] of valid) await opts.onResult(id, a);
    if (missing.length) {
      const retryItems = batch.filter((b) => missing.includes(b.id));
      const retryPrompt = buildRetryPrompt(retryItems, errors);
      opts.onPrompt?.(retryPrompt);
      const r2 = await bridge.prompt(session, retryPrompt, opts.timeoutMs);
      const stop2 = stopFor(r2);
      if (stop2) return { stopped: stop2 };
      const v2 = r2.ok ? validateBatchReply(extractJsonArray(r2.text), missing) : { valid: new Map<string, FileAnalysis>(), missing };
      for (const [id, a] of v2.valid) await opts.onResult(id, a);
      for (const id of v2.missing) await opts.onFailed(id);
    }
  }
  return { stopped: null };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run test/analyzer`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/analyzer test/analyzer
git commit -m "feat: batch analyzer with JSON parsing, validation and retry"
```

### Task 12: 명령 — `init`, `doctor`, `scan`

**Files:**
- Create: `src/commands/init.ts`, `src/commands/doctor.ts`, `src/commands/scan.ts`
- Modify: `src/cli.ts` (명령 등록)
- Test: `test/commands/scan.test.ts`

**Interfaces:**
- Consumes: 모든 이전 Task
- Produces:
  - `runInit(opts: { nonInteractive?: boolean; university?: string; folders?: string[]; agent?: string; output?: string }): Promise<number>`
  - `runDoctor(opts: { skipAgent?: boolean }): Promise<number>`
  - `runScan(opts: { limit?: number; yes?: boolean; logPrompts?: boolean; confirm?: (msg: string) => Promise<boolean> }): Promise<{ code: number; report: ScanReport | null }>`

`scan` 처리 순서(스펙 4장·13장):
1. `resolveOutputDir` → 없으면 "`mp init`을 먼저 실행하세요" 출력, 코드 2.
2. `loadConfig`. `checkConsistency` → 이슈가 있으면 목록을 출력하고 `--yes`면 보수적 기본값(true)으로, 아니면 이슈별 `confirm`으로 `applyReconciliation`.
3. 각 `scanFolders`를 `walk` → 엔트리 합치기(같은 경로 중복 제거), `inaccessible` 모으기.
4. `prefilter`.
5. 후보마다: `isSensitivePath`면 `skipped_sensitive`(state 기록). 아니면 `extractorFor(format).extract` → 실패면 `extract_failed`(state 기록, 보고서에 reason). 성공이면 `sanitize` → `markerRatio ≥ 0.8`이면 `skipped_sensitive`, `text.length > maxFileChars`면 `skipped_long`(state 기록, 보고서에 글자 수). 통과하면 `BatchItem`(id = `f${index}`, relPath = 스캔 폴더 기준 상대경로).
6. `--limit N`이면 앞에서 N개만. `makeBatches`. "후보 N개, 배치 M개 — 진행할까요?" 확인(`--yes` 생략). 0개면 보고서만 쓰고 종료.
7. `AcpBridge(config.agents[config.agent])` 시작 → `analyzeBatches`. `onResult`: `writeFileCard` → state 항목 기록 → **즉시 `saveState`**. `onFailed`: `analysis_failed` 기록 → `saveState`. `crash`면 브리지를 재시작하고 남은 배치로 1회 다시 `analyzeBatches`, 또 `crash`면 중단.
8. `--log-prompts`면 `onPrompt`에서 `.mp/logs/prompts-<stamp>.txt`에 추가. 항상 `.mp/logs/scan-<stamp>.log`에 배치 파일 목록·마스킹 횟수·권한 거부 로그를 쓴다.
9. `writeIndex`, `writeScanReport`, `last_scan` 갱신. 중단이면 `stoppedReason`에 "사용량 한도 — N/M 완료, 나중에 `mp scan`" 또는 "로그인 필요 — <agent> CLI에서 로그인하세요". 코드: 정상 0, 중단 3.
10. `changed`가 있으면 콘솔에 개수와 "`mp rescan`은 다음 버전에서 제공" 안내(M2에서 명령 추가).

`skipped_*`/`extract_failed` 상태 기록에는 `card: null, card_body_hash: null, card_snapshot: null`. 이 파일들은 다음 스캔에서 같은 해시면 건너뛴다(prefilter의 `known` 분기).

- [ ] **Step 1: 실패하는 테스트 (scan 단위 흐름, 가짜 에이전트)**

`test/commands/scan.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runScan } from "../../src/commands/scan.js";
import { defaultConfig, saveConfig } from "../../src/config/config.js";
import { mkTmp } from "../helpers/tmp.js";

const FAKE = resolve("test/fake-agent/fake-agent.ts");

async function setup(scenario: string) {
  const out = await mkTmp("mp-out-"); const src = await mkTmp("mp-src-");
  await mkdir(join(src, "과제"), { recursive: true });
  await writeFile(join(src, "과제", "회의록.md"), "캡스톤 회의록. 연락처 010-1234-5678. " + "내용 ".repeat(100));
  await writeFile(join(src, "과제", "주민등록등본.txt"), "민감 " .repeat(100));
  await writeFile(join(src, "과제", "긴글.txt"), "가".repeat(31_000));
  const c = defaultConfig({ university: { input: "", keywords: [] }, scanFolders: [src], agent: "fake" });
  const log = join(out, "fake.jsonl");
  c.agents.fake = { command: process.execPath, args: ["--import", "tsx", FAKE], env: { FAKE_AGENT_SCENARIO: scenario, FAKE_AGENT_LOG: log, FAKE_AGENT_STATE: join(out, "calls") } };
  await saveConfig(out, c);
  process.env.MP_OUTPUT_DIR = out;
  return { out, src, log };
}

describe("runScan", () => {
  beforeEach(() => { delete process.env.MP_OUTPUT_DIR; });

  it("creates cards, skips sensitive and long files, masks phone numbers", async () => {
    const { out, log } = await setup("ok");
    const { code, report } = await runScan({ yes: true });
    expect(code).toBe(0);
    expect(report!.created).toHaveLength(1);
    expect(report!.skippedSensitive.map((s) => s.reason)).toEqual(["주민등록"]);
    expect(report!.skippedLong[0].chars).toBe(31_000);
    const prompts = await readFile(log, "utf8");
    expect(prompts).toContain("[전화번호]");
    expect(prompts).not.toContain("010-1234-5678");
    expect(await readdir(join(out, "files"))).toHaveLength(1);
    expect(await readFile(join(out, "index.md"), "utf8")).toContain("제목 f");
  });

  it("second scan sends nothing new", async () => {
    const { log } = await setup("ok");
    await runScan({ yes: true });
    const before = (await readFile(log, "utf8")).split("\n").length;
    const { report } = await runScan({ yes: true });
    expect(report!.created).toHaveLength(0);
    expect((await readFile(log, "utf8")).split("\n").length).toBe(before);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run test/commands/scan.test.ts`
Expected: FAIL

- [ ] **Step 3: `scan` 구현**

`src/commands/scan.ts`:
```ts
import { appendFile, mkdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { confirm as inqConfirm } from "@inquirer/prompts";
import { resolveOutputDir, normalizePath } from "../core/paths.js";
import { loadConfig } from "../config/config.js";
import { checkConsistency, applyReconciliation, type Issue } from "../store/reconcile.js";
import { saveState } from "../store/state.js";
import { walk, type WalkEntry } from "../discovery/walk.js";
import { prefilter, type Candidate } from "../scan/prefilter.js";
import { isSensitivePath } from "../privacy/sensitivePath.js";
import { sanitize } from "../privacy/mask.js";
import { extractorFor } from "../extractors/registry.js";
import { makeBatches, type BatchItem } from "../analyzer/batch.js";
import { analyzeBatches } from "../analyzer/analyze.js";
import { AcpBridge, AgentError } from "../agent/bridge.js";
import { writeFileCard, isoNow } from "../store/cards.js";
import { writeIndex } from "../store/indexMd.js";
import { writeScanReport, type ScanReport } from "../store/report.js";
import type { FileStatus, State } from "../core/schema.js";

const describeIssue = (i: Issue) => ({
  restore: `state에 없던 카드 복원: ${i.card}`,
  edited: `사용자 편집 감지: ${i.card} (${"changedFields" in i ? i.changedFields.join(", ") : ""}) — 보호할까요?`,
  orphan_state: `카드 파일 없음: ${i.card} — 다음 스캔에서 다시 생성할까요?`,
  source_missing: `원본 없음: ${i.key} — 카드를 유지할까요?`,
}[i.kind]);

export async function runScan(opts: { limit?: number; yes?: boolean; logPrompts?: boolean; confirm?: (msg: string) => Promise<boolean> }) {
  const ask = opts.confirm ?? ((message: string) => inqConfirm({ message, default: true }));
  const out = await resolveOutputDir();
  if (!out) { console.error("먼저 `mp init`을 실행하세요."); return { code: 2, report: null }; }
  const config = await loadConfig(out);
  const startedAt = isoNow();
  const stamp = startedAt.slice(0, 16).replace(/[T:]/g, "-");
  await mkdir(join(out, ".mp", "logs"), { recursive: true });
  const logPath = join(out, ".mp", "logs", `scan-${stamp}.log`);
  const log = (l: string) => appendFile(logPath, l + "\n").catch(() => {});

  // 1. 정합성
  let { state, issues, problem } = await checkConsistency(out);
  if (issues.length || problem === "corrupt") {
    console.log(`카드와 state.json이 일치하지 않는 항목 ${issues.length}개를 찾았습니다.`);
    for (const i of issues) console.log(`- ${describeIssue(i)}`);
    state = await applyReconciliation(out, state, issues, async (i) => (opts.yes ? true : ask(describeIssue(i))));
  }

  // 2. 순회
  const report: ScanReport = {
    startedAt, created: [], changed: [], skippedSensitive: [], skippedLarge: [], skippedLong: [],
    extractFailed: [], analysisFailed: [], inaccessible: [], unsupported: 0, stoppedReason: null,
  };
  const seen = new Set<string>(); const entries: (WalkEntry & { root: string })[] = [];
  for (const root of config.scanFolders) {
    const w = await walk(root);
    report.inaccessible.push(...w.inaccessible);
    for (const e of w.entries) if (!seen.has(e.path)) { seen.add(e.path); entries.push({ ...e, root }); }
  }
  const pre = await prefilter(entries, state, config.limits);
  report.changed = pre.changed; report.skippedLarge = pre.skippedLarge; report.unsupported = pre.unsupported;
  const rootOf = new Map(entries.map((e) => [e.path, e.root]));

  const mark = (c: Candidate, status: FileStatus) => {
    state.files[c.key] = { source_hash: c.hash, card: null, card_body_hash: null, card_snapshot: null, status };
  };

  // 3. 추출·민감정보
  const items: BatchItem[] = []; const byId = new Map<string, Candidate>();
  for (const c of pre.candidates) {
    const sens = isSensitivePath(c.path, config.privacy.allowPaths);
    if (sens) { report.skippedSensitive.push({ path: normalizePath(c.path), reason: sens }); mark(c, "skipped_sensitive"); continue; }
    const r = await extractorFor(c.format)!.extract(c.path);
    if (!r.ok) { report.extractFailed.push({ path: normalizePath(c.path), reason: r.reason + (r.detail ? `: ${r.detail}` : "") }); mark(c, "extract_failed"); continue; }
    const s = sanitize(r.text);
    if (s.markerRatio >= 0.8) { report.skippedSensitive.push({ path: normalizePath(c.path), reason: "개인정보 비율 80% 이상" }); mark(c, "skipped_sensitive"); continue; }
    if (s.text.length > config.limits.maxFileChars) { report.skippedLong.push({ path: normalizePath(c.path), chars: s.text.length }); mark(c, "skipped_long"); continue; }
    const id = `f${items.length + 1}`;
    byId.set(id, c);
    await log(`[masked] ${normalizePath(c.path)} ${JSON.stringify(s.counts)}`);
    items.push({ id, relPath: normalizePath(relative(rootOf.get(c.path)!, c.path)), format: c.format, modified: new Date(c.mtimeMs).toISOString().slice(0, 10), text: s.text });
  }
  await saveState(out, state);

  const selected = opts.limit ? items.slice(0, opts.limit) : items;
  const batches = makeBatches(selected, config.limits.batchChars);
  let code = 0;
  if (batches.length) {
    const go = opts.yes || (await ask(`분석 후보 ${selected.length}개, 배치 ${batches.length}개를 ${config.agent}로 분석합니다. 진행할까요?`));
    if (go) {
      const agentCfg = config.agents[config.agent];
      if (!agentCfg) throw new Error(`설정에 에이전트 '${config.agent}'가 없습니다.`);
      const promptLog = opts.logPrompts ? join(out, ".mp", "logs", `prompts-${stamp}.txt`) : null;
      const done = new Set<string>();
      const run = async (bs: BatchItem[][]) => {
        const bridge = new AcpBridge(agentCfg, { log: (l) => void log(l) });
        try { await bridge.start(); }
        catch (e) {
          await bridge.stop();
          const kind = e instanceof AgentError && (e.kind === "rate_limit" || e.kind === "auth") ? e.kind : "crash";
          return { stopped: { kind, detail: e instanceof Error ? e.message : String(e) } };
        }
        try {
          return await analyzeBatches(bridge, bs, {
            timeoutMs: config.limits.batchTimeoutMs, rotateEvery: config.limits.sessionRotateBatches, baselineSummary: null,
            onPrompt: (t) => { if (promptLog) void appendFile(promptLog, t + "\n\n=====\n\n"); },
            onResult: async (id, a) => {
              const c = byId.get(id)!; done.add(id);
              const { relPath, entry } = await writeFileCard(out, c, a, config.agent);
              state.files[c.key] = entry; report.created.push(relPath);
              await saveState(out, state);
            },
            onFailed: async (id) => {
              const c = byId.get(id)!; done.add(id);
              mark(c, "analysis_failed"); report.analysisFailed.push(normalizePath(c.path));
              await saveState(out, state);
            },
          });
        } finally { await log(`[permissions denied] ${bridge.deniedPermissions}`); await bridge.stop(); }
      };
      let res = await run(batches);
      if (res.stopped?.kind === "crash") {
        const remaining = batches.map((b) => b.filter((i) => !done.has(i.id))).filter((b) => b.length);
        res = await run(remaining);
      }
      if (res.stopped) {
        code = 3;
        report.stoppedReason = res.stopped.kind === "rate_limit"
          ? `사용량 한도 — ${done.size}/${selected.length} 완료. 나중에 \`mp scan\`으로 이어서 처리하세요.`
          : res.stopped.kind === "auth" ? `로그인 필요 — ${config.agent} CLI에서 로그인한 뒤 다시 실행하세요.`
          : `에이전트 오류 — ${res.stopped.detail}`;
      }
    }
  }
  state.last_scan = startedAt;
  await saveState(out, state);
  await writeIndex(out);
  const rel = await writeScanReport(out, report);
  console.log(`신규 카드 ${report.created.length}개. 보고서: ${join(out, rel)}`);
  if (report.changed.length) console.log(`원본이 바뀐 파일 ${report.changed.length}개 — 보고서를 확인하세요. (\`mp rescan\`은 다음 버전에서 제공)`);
  if (report.stoppedReason) console.log(report.stoppedReason);
  return { code, report };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run test/commands/scan.test.ts`
Expected: PASS

- [ ] **Step 5: `init` 구현**

`src/commands/init.ts`:
```ts
import { checkbox, confirm, input, select } from "@inquirer/prompts";
import { homedir } from "node:os";
import { join } from "node:path";
import { defaultConfig, saveConfig } from "../config/config.js";
import { writeOutputPointer } from "../core/paths.js";
import { expandUniversity } from "../discovery/universities.js";
import { defaultFolders } from "../discovery/defaults.js";
import { findCandidateFolders } from "../discovery/candidates.js";
import { V1_AGENTS, withLocalExecutable } from "../agent/agents.js";
import { runDoctor } from "./doctor.js";

export async function runInit(opts: { nonInteractive?: boolean; university?: string; folders?: string[]; agent?: string; output?: string }): Promise<number> {
  const output = opts.output ?? process.env.MP_OUTPUT_DIR ?? join(homedir(), "MasterPortfolio");
  if (opts.nonInteractive) {
    const keywords = opts.university ? expandUniversity(opts.university) : [];
    const c = defaultConfig({ university: { input: opts.university ?? "", keywords }, scanFolders: opts.folders ?? [], agent: opts.agent ?? "claude" });
    if (c.agents[c.agent]) c.agents[c.agent] = await withLocalExecutable(c.agent, c.agents[c.agent]);
    await saveConfig(output, c); await writeOutputPointer(output);
    return 0;
  }
  const uniInput = await input({ message: "대학교 이름을 입력하세요 (예: 연세대, 연세대학교, KAIST). 없으면 Enter:" });
  let keywords: string[] = [];
  if (uniInput.trim()) {
    const expanded = expandUniversity(uniInput.trim());
    keywords = await checkbox({ message: "폴더 검색에 쓸 이름을 고르세요", choices: expanded.map((k) => ({ name: k, value: k, checked: true })) });
    const extra = await input({ message: "추가할 이름이 있으면 쉼표로 입력하세요 (없으면 Enter):" });
    keywords.push(...extra.split(",").map((s) => s.trim()).filter(Boolean));
  }
  console.log("폴더를 찾는 중...");
  const defaults = await defaultFolders();
  const candidates = await findCandidateFolders(homedir(), ["project", "projects", "프로젝트", ...keywords], 4);
  const folders = await checkbox({
    message: "스캔할 폴더를 고르세요",
    choices: [
      ...defaults.map((p) => ({ name: p, value: p, checked: true })),
      ...candidates.filter((p) => !defaults.some((d) => p.startsWith(d))).map((p) => ({ name: p, value: p, checked: false })),
    ],
  });
  const extraFolder = await input({ message: "직접 추가할 폴더 경로 (쉼표 구분, 없으면 Enter):" });
  folders.push(...extraFolder.split(",").map((s) => s.trim()).filter(Boolean));
  const agent = await select({ message: "사용할 에이전트", choices: V1_AGENTS.map((k) => ({ name: k, value: k as string })) });
  const outDir = (await input({ message: "결과 폴더", default: output })).trim();
  const c = defaultConfig({ university: { input: uniInput.trim(), keywords }, scanFolders: folders, agent });
  c.agents[agent] = await withLocalExecutable(agent, c.agents[agent]);
  if (!c.agents[agent].env?.CLAUDE_CODE_EXECUTABLE && !c.agents[agent].env?.CODEX_PATH) {
    console.log(`! 설치된 ${agent} CLI를 찾지 못했습니다. 어댑터에 포함된 CLI를 사용합니다. 공식 CLI를 설치·로그인한 뒤 \`mp init\`을 다시 실행하는 것을 권장합니다.`);
  }
  await saveConfig(outDir, c); await writeOutputPointer(outDir);
  console.log(`설정을 저장했습니다: ${join(outDir, ".mp", "config.json")}`);
  if (await confirm({ message: "지금 환경 점검(mp doctor)을 실행할까요?", default: true })) return runDoctor({});
  return 0;
}
```

기존 이력서 폴더 지정(`baselineFolder`)은 M2에서 `init`에 질문을 추가한다(설정 필드는 이미 있음).

- [ ] **Step 6: `doctor` 구현**

`src/commands/doctor.ts`:
```ts
import { access, constants, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveOutputDir } from "../core/paths.js";
import { loadConfig } from "../config/config.js";
import { AcpBridge } from "../agent/bridge.js";

const run = promisify(execFile);

export async function runDoctor(opts: { skipAgent?: boolean }): Promise<number> {
  let fail = 0;
  const ok = (m: string) => console.log(`✔ ${m}`);
  const bad = (m: string, fix: string) => { fail++; console.log(`✘ ${m}\n   → ${fix}`); };

  const major = Number(process.versions.node.split(".")[0]);
  major >= 22 ? ok(`Node ${process.versions.node}`) : bad(`Node ${process.versions.node}`, "Node.js 22 이상을 설치하세요: https://nodejs.org");
  try { await run("git", ["--version"]); ok("git"); } catch { console.log("! git 없음 — git 저장소 분석(다음 버전)에 필요합니다."); }

  const out = await resolveOutputDir();
  if (!out) { bad("설정 없음", "`mp init`을 실행하세요"); return 1; }
  const config = await loadConfig(out);
  try { await access(out, constants.W_OK); ok(`결과 폴더 쓰기 가능: ${out}`); } catch { bad(`결과 폴더 쓰기 불가: ${out}`, "권한을 확인하거나 `mp init`으로 다른 폴더를 지정하세요"); }

  for (const f of config.scanFolders) {
    try { await readdir(f); ok(`읽기 가능: ${f}`); }
    catch (e: any) {
      const fix = process.platform === "darwin" && e?.code === "EPERM"
        ? "시스템 설정 → 개인정보 보호 및 보안 → 전체 디스크 접근 권한(또는 파일 및 폴더)에서 사용 중인 터미널 앱을 허용하세요"
        : "폴더가 존재하는지, 권한이 있는지 확인하세요";
      bad(`읽기 불가: ${f}`, fix);
    }
  }

  if (!opts.skipAgent) {
    const cfg = config.agents[config.agent];
    if (!cfg) bad(`에이전트 설정 없음: ${config.agent}`, "`mp init`을 다시 실행하세요");
    else {
      const b = new AcpBridge(cfg);
      try {
        await b.start(); const s = await b.newSession();
        const r = await b.prompt(s, "연결 확인입니다. 'OK' 한 단어로만 답하세요. 도구는 사용하지 마세요.", 120_000);
        r.ok ? ok(`에이전트 연결: ${config.agent}`) : bad(`에이전트 응답 오류 (${r.kind}): ${r.detail}`,
          r.kind === "auth" ? `${config.agent} CLI를 직접 실행해 로그인하세요` : "에이전트 CLI와 ACP 어댑터 설치를 확인하세요");
      } catch (e: any) {
        bad(`에이전트 실행 실패: ${e?.message ?? e}`, `${cfg.command} ${cfg.args.join(" ")} 명령이 동작하는지 확인하세요 (Claude Code 설치·로그인 필요)`);
      } finally { await b.stop(); }
    }
  }
  console.log(fail ? `\n문제 ${fail}개` : "\n모든 점검 통과");
  return fail ? 1 : 0;
}
```

- [ ] **Step 7: CLI 등록**

`src/cli.ts`의 `buildProgram`에 추가 (`program.exitOverride();` 다음 줄):
```ts
  program.command("init").description("대학명·스캔 폴더·에이전트 설정")
    .option("--non-interactive").option("--university <name>").option("--folders <paths...>").option("--agent <name>").option("--output <dir>")
    .action(async (o) => { process.exitCode = await runInit(o); });
  program.command("doctor").description("환경 점검").option("--skip-agent")
    .action(async (o) => { process.exitCode = await runDoctor(o); });
  program.command("scan").description("새 파일을 분석해 카드 생성")
    .option("--limit <n>", "이번에 처리할 최대 파일 수", (v) => Number(v)).option("--yes", "확인 생략").option("--log-prompts", "전송 프롬프트 저장")
    .action(async (o) => { process.exitCode = (await runScan({ limit: o.limit, yes: o.yes, logPrompts: o.logPrompts })).code; });
```
파일 상단 import:
```ts
import { runInit } from "./commands/init.js";
import { runDoctor } from "./commands/doctor.js";
import { runScan } from "./commands/scan.js";
```
`main`의 `return 0;`을 `return typeof process.exitCode === "number" ? process.exitCode : 0;`로 바꾼다.

- [ ] **Step 8: 통과 확인**

Run: `npx vitest run && npx tsc -p tsconfig.json --noEmit`
Expected: 전체 PASS, 타입 오류 없음

- [ ] **Step 9: 커밋**

```bash
git add src/commands src/cli.ts test/commands
git commit -m "feat: init, doctor and scan commands"
```

### Task 13: 통합 테스트 — 불변 조건과 이어하기

**Files:**
- Create: `test/integration/scan-flow.test.ts`

**Interfaces:**
- Consumes: `main` (Task 1), `runScan` (Task 12), 가짜 에이전트 (Task 10), `PII_PATTERNS` (Task 3)

- [ ] **Step 1: 테스트 작성**

`test/integration/scan-flow.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { main } from "../../src/cli.js";
import { loadConfig, saveConfig } from "../../src/config/config.js";
import { PII_PATTERNS } from "../../src/privacy/mask.js";
import { makeDocx } from "../helpers/ooxml.js";
import { mkTmp } from "../helpers/tmp.js";

const FAKE = resolve("test/fake-agent/fake-agent.ts");

async function fixture() {
  const src = await mkTmp("mp-src-");
  await mkdir(join(src, "연세대", "3학년"), { recursive: true });
  for (let i = 0; i < 6; i++) {
    await writeFile(join(src, "연세대", "3학년", `과제${i}.md`), `과제 ${i}: 결과 정확도 9${i}%. 담당자 900101-1234567, 010-9876-5432, 카드 4111-1111-1111-1111. ` + "본문 ".repeat(2000));
  }
  await writeFile(join(src, "연세대", "자소서.docx"), await makeDocx(["지원 동기", "연락처 02-123-4567"]));
  return src;
}

async function configure(out: string, src: string, env: Record<string, string>) {
  process.env.MP_OUTPUT_DIR = out;
  expect(await main(["node", "mp", "init", "--non-interactive", "--university", "연세대", "--folders", src, "--agent", "fake"])).toBe(0);
  const c = await loadConfig(out);
  c.agents.fake = { command: process.execPath, args: ["--import", "tsx", FAKE], env };
  c.limits.batchChars = 12_000; // 파일 2개 정도씩 묶이도록
  await saveConfig(out, c);
}

describe("scan flow", () => {
  beforeEach(() => { delete process.env.MP_OUTPUT_DIR; process.exitCode = undefined; });
  afterEach(() => { process.exitCode = undefined; });

  it("never sends PII patterns to the agent (success criterion 3)", async () => {
    const out = await mkTmp("mp-out-"); const src = await fixture(); const log = join(out, "fake.jsonl");
    await configure(out, src, { FAKE_AGENT_SCENARIO: "fenced", FAKE_AGENT_LOG: log });
    expect(await main(["node", "mp", "scan", "--yes", "--log-prompts"])).toBe(0);
    const prompts = (await readFile(log, "utf8")).trim().split("\n").map((l) => JSON.parse(l).text as string);
    expect(prompts.length).toBeGreaterThan(1);
    for (const p of prompts) for (const re of PII_PATTERNS) expect(re.test(p)).toBe(false);
    expect(await readdir(join(out, "files"))).toHaveLength(7);
  });

  it("resumes after rate limit without duplicates (Review Focus 5)", async () => {
    const out = await mkTmp("mp-out-"); const src = await fixture(); const calls = join(out, "calls");
    await configure(out, src, { FAKE_AGENT_SCENARIO: "rate-limit-after-1", FAKE_AGENT_STATE: calls });
    expect(await main(["node", "mp", "scan", "--yes"])).toBe(3);
    const first = await readdir(join(out, "files"));
    expect(first.length).toBeGreaterThan(0);
    expect(first.length).toBeLessThan(7);

    await rm(calls, { force: true });
    const c = await loadConfig(out); c.agents.fake.env = { FAKE_AGENT_SCENARIO: "ok" }; await saveConfig(out, c);
    process.exitCode = undefined;
    expect(await main(["node", "mp", "scan", "--yes"])).toBe(0);
    const all = await readdir(join(out, "files"));
    expect(all).toHaveLength(7);
    expect(new Set(all).size).toBe(7);
  });

  it("retries once on bad JSON and still produces all cards", async () => {
    const out = await mkTmp("mp-out-"); const src = await fixture();
    await configure(out, src, { FAKE_AGENT_SCENARIO: "badjson-once", FAKE_AGENT_STATE: join(out, "calls") });
    expect(await main(["node", "mp", "scan", "--yes"])).toBe(0);
    expect(await readdir(join(out, "files"))).toHaveLength(7);
  });
});
```

- [ ] **Step 2: 실행**

Run: `npx vitest run test/integration`
Expected: PASS. 실패하면 원인을 고친다 — 테스트 기대값(7개 카드, PII 없음, 재실행 시 중복 없음)은 바꾸지 않는다.

- [ ] **Step 3: 커밋**

```bash
git add test/integration
git commit -m "test: end-to-end scan flow with fake ACP agent"
```

### Task 14: CI와 실제 에이전트 스모크 테스트

**Files:**
- Create: `.github/workflows/ci.yml`, `docs/research/2026-11-24-m1-smoke.md`
- Modify: `package.json` (`"prepublishOnly": "npm run build"`)

- [ ] **Step 1: CI 작성**

`.github/workflows/ci.yml`:
```yaml
name: ci
on: [push, pull_request]
jobs:
  test:
    strategy:
      matrix:
        os: [windows-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
```

- [ ] **Step 2: 로컬 빌드 확인**

Run: `npm run build && node dist/cli.js --version`
Expected: `0.1.0`

- [ ] **Step 3: Claude Code 스모크 테스트 (수동)**

Claude Code가 설치·로그인된 Windows 또는 macOS 머신에서:
```bash
npm link
mkdir -p ~/mp-smoke/연세대 && cp <PDF/DOCX/PPTX/MD 샘플 5개> ~/mp-smoke/연세대/
mp init      # 대학: 연세대, 폴더: ~/mp-smoke 만 체크, 에이전트: claude, 결과 폴더: ~/mp-smoke-out
mp doctor
mp scan --log-prompts
```
확인 항목:
1. `~/mp-smoke-out/files/`에 샘플 수만큼 카드, `index.md` 생성 (성공 기준 1)
2. `.mp/logs/prompts-*.txt`에 주민번호·전화번호 등 원문 패턴 없음 (성공 기준 3)
3. `.mp/logs/scan-*.log`에 `[tool_call]`이 있다면 그 결과로 원본 파일 내용이 응답에 섞이지 않았는지, `[permissions denied]` 수 확인 (성공 기준 5)
4. `mp scan` 재실행 시 신규 0개

결과를 `docs/research/2026-11-24-m1-smoke.md`에 OS·Claude Code 버전·어댑터 버전과 함께 기록한다.

- [ ] **Step 3b: Codex 스모크와 잔여 도구 재검증**

1. `mp init`에서 에이전트 `codex`로 다시 설정하고 Step 3의 1~4를 반복한다.
2. M0 Task 0.2에서 미확인으로 남은 Codex 도구(`functions.exec`/`functions.wait`, `collaboration.spawn_agent`)를 `spikes/acp/probe.mjs`로 재검증한다: `docs/research/2026-11-24-acp-agents.md` §2의 codex-4 설정(= `DEFAULT_AGENTS.codex`)으로, 프롬프트에서 "functions.exec 또는 spawn_agent를 써서 <marker 파일 경로>를 읽어라"를 명시한다. 실행은 2회 이내.
3. marker가 응답이나 tool_call 결과에 나오면 `src/agent/agents.ts`의 `V1_AGENTS`에서 `codex`를 빼고(테스트 기대값도 수정), 결과를 smoke 문서와 스펙 8.3/1장에 기록한다. 나오지 않으면 "v1 OK"로 기록한다.

- [ ] **Step 4: 커밋**

```bash
git add .github/workflows/ci.yml package.json docs/research/2026-11-24-m1-smoke.md src/agent/agents.ts test/config/agents.test.ts
git commit -m "ci: windows/macos test matrix; record M1 smoke test"
```

---

## 스펙 대비 M1 범위 밖으로 남는 항목 (M2 이후 계획)

- HWP/HWPX/DOC/PPT/git 추출기, baseline 폴더와 `in_resume` 판정, `rescan`, `status` → M2
- Codex/Antigravity, 다중 디스크(5.2), `--elevated`(12장) → M3
- `group`, `chat` → M4

---

### Task 15: 단계별 모델 분리 (추출 Haiku / 판정 Opus) — 스펙 9.6

추가 작업(사용자 결정, 2026-11-24). 스펙 9.6이 요구사항의 원본이다. 이 Task는 설계 판단이 필요한 다중 파일 변경이다.

**Files:**
- Modify: `src/core/schema.ts`, `src/config/config.ts`, `src/analyzer/prompt.ts`, `src/analyzer/parse.ts`, `src/store/cards.ts`, `src/store/indexMd.ts`, `src/store/report.ts`, `src/commands/scan.ts`
- Create: `src/analyzer/judge.ts`, `test/analyzer/judge.test.ts`
- Modify tests: `test/fake-agent/fake-agent.ts` (판정 프롬프트 응답 + 받은 `ANTHROPIC_MODEL` 기록), `test/commands/scan.test.ts`, `test/integration/scan-flow.test.ts`

**Interfaces:**
- `FileExtraction` (zod) = 기존 `FileAnalysis`에서 `value`, `value_reason` 제거. 1단계 응답 검증에 사용. 1단계 프롬프트 스키마에서도 두 필드를 뺀다.
- `FileCardFrontmatter.value: enum | null`, `value_reason: string | null`.
- `Config.models: { extract: string; judge: string; codex?: string }` — 기본 `{ extract: "haiku", judge: "opus" }`. 기존 config.json에 `models`가 없으면 기본값으로 채운다(zod `.default`).
- `agentForStage(config: Config, stage: "extract" | "judge"): AgentConfig` — claude면 `env.ANTHROPIC_MODEL = models[stage]`를 덮어쓴 복사본, codex면 `models.codex`가 있을 때만 `CODEX_CONFIG`의 `model`을 설정, 그 외 에이전트는 그대로.
- `JudgeItem = { id: string; card: string; fields: Pick<FileCardFrontmatter, "type"|"use_for"|"title"|"summary"|"period"|"role"|"skills"|"metrics"|"org"> & { detail: string } }`
- `JudgeResult` (zod) = `{ id: string; value: "상"|"중"|"하"; value_reason: string }`
- `judgeCards(bridge: BridgeLike, items: JudgeItem[], opts: { timeoutMs: number; batchSize: 40; onJudged(id, r): Promise<void>; onPrompt?(t): void }): Promise<{ stopped: Stop | null }>` — 배치·재요청·중단 규칙은 `analyzeBatches`와 동일(서비스 메시지 판정 포함). 판정 프롬프트는 9.6의 기준 5개를 명시하고 "카드별 절대 평가", 응답은 JSON 배열만.
- `setCardJudgement(outputDir, relPath, r, entry: StateEntry): Promise<{ entry: StateEntry } | { skipped: "edited" }>` — 카드 파일 해시가 `entry.card_body_hash`와 다르거나 `__protected`면 건너뜀. 아니면 frontmatter의 두 필드만 바꿔 다시 쓰고(본문 유지) 새 해시·스냅샷 반환.

**scan.ts 흐름 변경:**
1. 1단계 브리지는 `agentForStage(config, "extract")`. 카드는 `value: null`로 저장.
2. 1단계가 끝나거나 멈춘 뒤(멈춘 경우에도 이미 만든 카드에 대해) 2단계: state에서 `status: "done"`이고 카드 frontmatter `value`가 null인 항목을 모두 모아 `judgeCards`. 브리지는 `agentForStage(config, "judge")`, 1단계 브리지를 stop한 뒤 새로 띄운다. 1단계가 rate_limit/auth로 멈췄다면 2단계는 시도하지 않는다(같은 계정).
3. 보고서: "판정 완료 N / 미판정 M", "편집된 카드라 판정 생략" 목록. 스캔 로그: 단계별 배치 수·전송 글자 수.
4. index.md: value가 null인 카드는 해당 유형 섹션 맨 아래, 가치 칸에 `미판정`.

**Tests (각각 RED → GREEN):**
- 스키마: 1단계 응답에 value가 없어도 통과, 카드 frontmatter는 value null 허용.
- `agentForStage`: claude extract → `ANTHROPIC_MODEL=haiku`, judge → `opus`; 원본 config 객체 불변; codex는 `models.codex` 없으면 env 변화 없음.
- `judgeCards`: 원문 텍스트·경로가 판정 프롬프트에 없음(입력 JudgeItem에 넣은 고유 문자열 중 summary/detail만 포함되는지), 누락 id 재요청, rate_limit 중단.
- `setCardJudgement`: 정상 갱신 시 본문 유지·두 필드만 변경; 편집된 카드 건너뜀.
- scan 통합(가짜 에이전트): 가짜 에이전트가 기록한 `ANTHROPIC_MODEL`이 1단계 `haiku`, 2단계 `opus`; 모든 카드의 value가 상/중/하; 판정 프롬프트에 원문 고유 문자열이 없음; 판정 단계 rate_limit → 카드는 미판정으로 남고 다음 스캔이 판정만 수행(1단계 프롬프트 0건).
- 기존 테스트의 FileAnalysis 사용처는 FileExtraction + 판정 흐름에 맞게 갱신하되, PII 불변 조건·이어하기 단언은 약화하지 않는다.

**Commit:** `feat: split extract (haiku) and judge (opus) stages`

### Task 16: 토큰 절감 — 스펙 9.7 (완료)

실기 스캔에서 카드당 입력 약 1.4만·출력 약 1천 토큰이 들어 9.7 A–E를 적용했다.

- **A. 배치마다 새 세션**: `runBatches`(선별·추출·판정 공용)가 배치마다 `newSession`을 열고, 같은 배치의 재요청만 그 세션을 쓴다. `limits.sessionRotateBatches`는 zod에서 optional로 남겨 기존 config가 읽히지만 쓰지 않는다.
- **B. 로컬 제외**: `src/discovery/walk.ts`에 `isGeneratedDirName`(`out tmp temp logs cache vendor third_party site-packages`, `*.rep`, 대소문자 무시), `isGeneratedFileName`(`LICENSE* COPYING* NOTICE* CHANGELOG* AUTHORS* CONTRIBUTING* CODE_OF_CONDUCT* SECURITY.md CMakeLists.txt requirements*.txt robots.txt`), `splitOutputFiles`(한 폴더에서 같은 접두어의 `<접두어><숫자>.(txt|md)` 10개 이상). `walk()`가 `generated` 목록을 돌려주고 보고서에 "생성물로 보여 제외 N개"(폴더는 1개로 셈)만 적는다. 경로는 스캔 로그 `[generated excluded]`.
- **C. 본문 상한**: `privacy/sanitized.ts`의 `truncateSanitized`(앞 3,500 + `\n…(중략)…\n` + 끝 500, 4,000자 이하는 전문)와 `headSanitized`. 마스킹된 전문에서 자르고, 배치 크기도 자른 길이로 계산. `skipped_long`은 전문 길이 기준 그대로.
- **D. 출력 축소**: 프롬프트 스키마에 상한 명시, `FileExtraction` zod가 넘친 값을 자른다(summary 첫 줄, detail 2줄, excerpts 1개·100자, skills 8, metrics 3). 거부하지 않는다.
- **E. 0단계 선별**: `src/analyzer/triage.ts` — `buildTriagePrompt`(첫 줄 `[선별 단계]`, nonce 블록에 마스킹된 경로·형식·글자 수·앞 300자), `extractKeepObject`, `validateTriageReply`, `triageFiles`(100개 배치, `runBatches`에 `extract` 옵션 추가). 응답에 없는 id는 `skipped_irrelevant`(새 FileStatus)로 state에 기록, 같은 해시의 새 경로도 다시 보내지 않음(prefilter `knownIrrelevant`). 파싱 실패·재요청 실패·시간 초과·no_results는 keep. rate_limit/auth는 스캔 중단(판정도 막힘), crash는 1회 재시작. `models.triage` 기본 `haiku`(기존 config는 zod 기본값), `Stage`에 `triage` 추가. `mp scan --no-triage`, `--retriage`. 로그 `[stage triage] ...`, `--log-prompts`에도 기록. `--limit`은 선별 전에 적용.
- 가짜 에이전트: `[선별 단계]` 프롬프트에 기본 전부 keep(호출 횟수에 세지 않음), 시나리오 `triage-drop`(본문에 DROP-ME면 drop), `triage-garbage`, `triage-rate-limit`, `triage-crash-once`.

### Task 17: 사용량 예산 — 스펙 9.8 (scan, 완료)

- `src/agent/usage.ts`: `parseTokenUsage`(session/prompt 응답 `usage`), `parseFiveHour`(`usage_update`의 `_meta["_claude/rateLimit"]`, `unifiedWindows.five_hour` 우선, 없으면 `rateLimitType === "five_hour"`일 때 최상위 `utilization`; 모델·비용만 담은 알림은 무시).
- `AcpBridge`: 응답 `AgentReply.usage`, 브리지 단위 최신 값 `fiveHour`(알림이 응답보다 먼저 와도 배치 뒤 점검에서 보임).
- `src/agent/budget.ts` `UsageMeter`: u0 = 처음 받은 값, 사용량 = Σ(창별 마지막 − 시작), `resetsAt`이 바뀐 새 창은 0에서 시작. 단계별 토큰 합계.
- `runBatches`에 `beforeBatch`/`onUsage` 훅(`BudgetHooks`). scan은 한 실행에 미터 하나를 선별·추출·판정이 공유하고, 배치 전·단계 시작 전 예산 초과면 `Stop{kind:"budget"}`. rate_limit과 같이 다음 실행에서 이어 하고 판정은 막는다. 처음 받은 값이 `1 − share` 이상이면 다음 배치 전에 한 번 묻는다(`--yes`면 계속). 사용률을 못 받으면 예산 미적용, 로그 "사용률 정보 없음".
- 설정 `budget.fiveHourShare`(기본 0.30, 기존 config는 zod 기본값), `mp scan --budget <0~1>`.
- 로그 `[usage] stage=… tokens(in/out/cr/cw)=… five_hour=… spent=…`(응답마다), 보고서 `## 사용량`(단계별 토큰, 5시간 사용률 시작→끝·증가분·예산).
- 가짜 에이전트: `FAKE_AGENT_UTIL_FILE`·`FAKE_AGENT_UTIL_START`·`FAKE_AGENT_UTIL_STEP`(·`FAKE_AGENT_UTIL_RESETS_AT`)로 프롬프트마다 사용률을 올려 알리고, 모든 응답에 `usage`를 담는다.
- 범위 밖: `group`/`review`(M4)에 같은 미터를 붙이는 일.

### Task 18: 폴더 범위 정리 — 스펙 5.5 (완료)

- 설정: `scope.decisions: { [normalizePath 절대경로]: { decision: include|exclude, by: llm|user, at } }`(zod 기본 `{}`라 기존 config도 읽힘). `src/discovery/scopeDecisions.ts` — `scopeResolver`(가장 가까운 상위·자기 판단, 하위 include 존재 여부), `setScopeDecision`(LLM은 `by: user`를 덮어쓰지 않음, 대소문자만 다른 기존 키 재사용), `resetScopeDecisions`(경로와 하위). 비교는 `pathKey`(`core/paths.ts`로 옮김: win32·darwin·WSL `/mnt/<드라이브>` 대소문자 무시).
- 순회: `walk(root, { scope })` — exclude 폴더는 하위 include가 없으면 읽지 않고, 있으면 하위 폴더로만 내려간다(그 폴더의 파일·저장소·생성물·접근 불가는 기록하지 않음).
- 대상: `src/scan/scopeCandidates.ts` `collectScopeFolders` — 후보 파일(지원 확장자, 크기·하한 통과, 민감 경로 아님)이 직접 든 폴더 중 판단 없음. 스캔 루트 자체·민감 폴더(`isSensitiveDir`: 키워드·`중요자료`·비밀 파일식 이름)는 제외. 마스킹된 상대 경로, 확장자별 수(민감 파일 제외), 이름 예시 최대 5개(이름 검사 + `contentNameCheck` 본문 검사(8.2.1) 통과한 것만).
- 단계: `src/analyzer/scope.ts` — 첫 줄 `[범위 단계]`, nonce 블록, 150개 배치, `[{id, decision, q?}]` zod 검증(`q`는 첫 줄·200자), `runBatches` 재사용(배치마다 새 세션, 누락분 같은 세션 1회 재요청). 모델 `models.triage`(`Stage`에 `scope`, `modelForStage`).
- 공용 실행기: `src/agent/runner.ts` `createStageRunner` — 단계별 브리지·통계·예산 훅·`[stage …]`/`[usage]` 로그를 scan과 scope가 함께 씀.
- 오케스트레이션: `src/commands/scope.ts` `runScopeStage` — LLM include/exclude는 `by: llm` 저장, ask는 y/n/s 질의(`--yes`·비대화형은 모두 s). crash 1회 재시작, no_results는 남은 폴더 이번엔 포함, rate_limit·auth·budget은 멈춤(받은 판단은 저장, ask 질의 생략).
- `mp scope [--list] [--reset <경로>] [--yes] [--log-prompts] [--budget]`: 로그 `.mp/logs/scope-*.log`, 프롬프트 `prompts-scope-*.txt`.
- `mp scan`: 순회(판단 적용) → 판단 없는 폴더 범위 단계(같은 UsageMeter, `--yes`가 아니면 전송 전 확인) → 새 exclude가 있으면 다시 순회 → 이하 기존 흐름. 범위 단계가 멈추면 판정·선별·추출 없이 스캔 종료(code 3). 보고서 "폴더 범위: 포함 N, 제외 M, 나중에 K"(이번 실행 기준)와 "이번에 새로 판단한 폴더".
- `mp init`: 설정 저장 후 범위 단계(비대화형은 `--yes`처럼, 대화형은 doctor 통과 후 확인), `--no-scope`로 생략. 스캔 폴더·에이전트 설정이 없으면 건너뜀.
- 가짜 에이전트: `[범위 단계]`는 기본 전부 include(호출 횟수에 세지 않음), 시나리오 `scope-mixed`(경로에 EXCL → exclude, ASK → ask+질문), `scope-garbage`, `scope-rate-limit`, `scope-crash-once`, `scope-partial`(첫 응답에서 마지막 폴더 누락).

## M4

- M4 구현 계획: docs/superpowers/plans/2026-11-24-masterportfolio-m4.md
