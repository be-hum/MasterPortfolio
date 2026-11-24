# MasterPortfolio 설계 스펙

- 작성일: 2026-11-24
- 상태: 사용자 리뷰 대기
- 관련 문서: `docs/proposals/2026-11-24-masterportfolio-proposal.md`

## 1. 목표와 합의된 이해

**목표**: 사용자가 구독 중인 LLM 에이전트(Claude Code / Codex CLI / Antigravity CLI)를 Agent Client Protocol(ACP)로 구동해, 로컬 디스크의 이력서·자소서·포트폴리오용 자료를 찾아 Markdown 카드로 정리하는 배포용 CLI `mp`를 만든다.

**합의 사항**

- 우리 프로그램은 **ACP 클라이언트**다. LLM 호출은 사용자의 에이전트가 사용자 구독으로 수행한다.
- 형태: 배포용 CLI 우선. 엔진과 인터페이스를 분리해 이후 로컬 웹 UI / 데스크톱 앱에서 재사용한다. 원격 호스팅 웹은 범위 밖.
- 지원 OS: Windows, macOS (Windows 테스트 우선). Linux는 공식 지원하지 않음.
- 지원 에이전트(v1): Claude Code, Codex CLI. Antigravity CLI(`agy acp`)는 M0에서 내장 도구를 끌 수 없음이 확인되어(8.3) v1에서 제외하고 M3에서 재평가한다. Google 쪽은 Gemini CLI의 실험 옵션 대신 Antigravity의 공식 ACP 서버(`agy acp`)를 쓴다. 커뮤니티 Antigravity ACP 어댑터나 OAuth 토큰 직접 사용은 금지(계정 정지 사례 다수).
- 결과물: v1은 **자료 인벤토리**. 채용 공고 맞춤 추천은 후속. 스키마는 이를 대비한다.
- 입력: PDF, DOCX, PPTX, DOC, PPT, MD, TXT, HWP, HWPX, 로컬 git 저장소. 기존 이력서·자소서는 지정 폴더 하나에서 기준자료로 수집. 이미지·스캔본은 후속.
- 원본 데이터는 Markdown 파일(YAML frontmatter)이다.

**성공 기준**

1. `mp init` → `mp scan` 만으로 지정 폴더의 지원 형식 파일이 파일 카드로 정리된다.
2. 파일 카드마다 기존 이력서 반영 여부가 표시된다.
3. LLM으로 전송된 텍스트에 주민등록번호·외국인등록번호·카드번호·계좌번호·여권번호·전화번호 패턴이 남지 않음을 로그로 확인할 수 있다.
4. v1 지원 에이전트(Claude Code, Codex) 중 어느 것을 사용해도 동일 스키마의 카드가 생성된다.
5. 에이전트가 원본 파일을 직접 읽거나 쉘을 실행하지 못한다.

## 2. 기술 스택

| 항목 | 선택 |
|---|---|
| 런타임 | Node.js 22 이상(Claude ACP 어댑터 요구사항), TypeScript |
| 배포 | npm 패키지 (`npm i -g` / `npx`) |
| ACP | `@agentclientprotocol/sdk@2.9.1` (client/agent 빌더 API) |
| CLI | commander |
| 스키마 검증 | zod |
| frontmatter | yaml (자체 frontmatter 분리) |
| PDF | pdfjs-dist |
| DOCX | mammoth |
| PPTX / HWPX | jszip + fast-xml-parser |
| HWP 5.0 | 자체 Node 파서: cfb + `zlib.inflateRawSync`, HWPTAG_PARA_TEXT(67), 배포용 문서는 ViewText AES-128-ECB 복호화 (M0 실측 평균 0.998, pyhwp 0.72 → Python 번들 불필요) |
| DOC | `word-extractor`(MIT, 0.992), 실패 시 자체 piece table 파서. Word 6/95 미지원 |
| PPT | 자체 Node 파서: cfb + persist directory 기반 활성 슬라이드 필터 (0.974) |
| HWPX | 자체 Node 파서: jszip + XML 순회 (0.999). 암호화된 배포용 HWPX는 미지원으로 보고 |
| git | 시스템 `git` CLI 호출 |
| 테스트 | vitest |

모든 추출기는 `Extractor` 인터페이스 뒤에 두어, 특정 형식만 외부 프로세스(예: Python)로 교체할 수 있게 한다.

## 3. 아키텍처

```
mp CLI ─┬─ init / doctor / scan / rescan / status / group / chat
        │
scan 파이프라인:
 discovery → prefilter → extractor → privacy → analyzer ⇄ agent-bridge(ACP) → store
```

| 모듈 | 책임 | 의존 |
|---|---|---|
| `discovery` | 기본 폴더·디스크 열거, 패턴 폴더 후보 탐색, 파일 순회 | OS 경로 규칙 |
| `prefilter` | 확장자·제외 경로·크기·중복(해시) 필터 | 없음 |
| `extractors/*` | `(path) → ExtractResult` | 형식별 라이브러리 |
| `privacy` | 민감 파일 스킵 판정, 패턴 마스킹 | 없음 |
| `agent-bridge` | 에이전트 프로세스 실행, ACP 세션, 프롬프트 송수신, 권한 요청 거부 | ACP SDK |
| `analyzer` | 배치 구성, 프롬프트 생성, 응답 zod 검증, 재시도 | `agent-bridge` |
| `store` | 카드 읽기·쓰기, `index.md`, 스캔 보고서, `state.json` | 파일시스템 |
| `grouping` | 경험 카드 생성(`group`)과 조정(`chat`) | `analyzer`, `store` |

**불변 조건**

- LLM으로 가는 유일한 경로는 `agent-bridge`이며, `agent-bridge`에 전달되는 문서 텍스트는 반드시 `privacy`를 거친 것이다. 이를 타입으로 강제한다 (`privacy`만 생성할 수 있는 `SanitizedText` 브랜드 타입).
- 에이전트는 파일을 쓰지 않는다. 모든 파일 쓰기는 `store`가 한다.

### 3.1 인터페이스

```ts
interface Extractor {
  id: string;                       // "pdf", "docx", "hwp", "git" ...
  canHandle(path: string, isDir: boolean): boolean;
  extract(path: string): Promise<ExtractResult>;
}

type ExtractResult =
  | { ok: true; text: string; meta: { pages?: number; title?: string; createdAt?: string } }
  | { ok: false; reason: "encrypted" | "corrupted" | "unsupported" | "empty" | "error"; detail?: string };

interface AgentBridge {
  start(agent: AgentConfig): Promise<void>;
  newSession(): Promise<SessionId>;
  prompt(session: SessionId, text: SanitizedText | string): Promise<AgentReply>; // string은 우리 프롬프트 템플릿용
  stop(): Promise<void>;
}

type AgentReply =
  | { ok: true; text: string }
  | { ok: false; kind: "rate_limit" | "auth" | "crash" | "timeout" | "other"; detail: string };
```

## 4. 명령

| 명령 | 동작 |
|---|---|
| `mp init` | 대학명 입력 → 내장 대학 사전으로 변형 자동 확장(5.3.1)하고 사용자 확인·추가 → 폴더 후보 탐색 → 체크리스트 확정 → 기존 이력서 폴더 지정(선택) → 에이전트 선택 → 출력 폴더 지정(기본 `~/MasterPortfolio`) → `config.json` 저장 → `doctor` 실행 |
| `mp doctor` | Node 버전, git 존재, 선택 에이전트 실행·ACP 초기화·로그인 상태, 출력 폴더 쓰기 권한, macOS TCC 접근 여부 점검. 실패 항목마다 해결 명령 안내 |
| `mp scan [--limit N] [--elevated] [--yes] [--log-prompts]` | 신규 파일만 처리. 원본 변경 파일은 보고서에 목록화. 시작 전 "후보 N개, 배치 M개" 확인(`--yes`로 생략) |
| `mp rescan <path...>` | 지정 원본 파일을 다시 처리해 카드를 덮어씀. 사용자 편집 카드면 확인 후 진행 |
| `mp status` | 카드 수(유형별·가치별), 미처리·변경·실패·스킵 수, 마지막 스캔 일시 |
| `mp scope [--list] [--reset <경로>]` | 폴더 범위 정리: LLM 판단 + 애매한 폴더 질의(5.5) |
| `mp group [--regroup]` | 판정 `상`/`중` 파일 카드를 경험 카드로 묶고 경험마다 보강 질문 생성(11장) |
| `mp review [--file] [--apply]` | 경험별 질의응답(터미널 또는 `review.md` 설문 파일) → 답변을 카드에 반영(11장) |
| `mp master` | 채택된 경험 카드로 `master.md` 생성(로컬, LLM 없음) |

## 5. 탐색 (discovery)

### 5.1 기본 폴더

- Windows: `[Environment]::GetFolderPath('MyDocuments')`(OneDrive 리디렉션 반영)와 Downloads(레지스트리 `User Shell Folders`의 `{374DE290-123F-4565-9164-39C4925E467B}`)를 PowerShell로 조회.
- macOS: `~/Documents`, `~/Downloads`.

### 5.2 디스크 열거

- Windows: `Get-CimInstance Win32_LogicalDisk` 중 `DriveType` 2(이동식), 3(고정). 네트워크 드라이브(4) 제외.
- macOS: `/Volumes/*` 중 `/`와 같은 장치인 항목(시스템 볼륨) 제외.

### 5.3 패턴 폴더 후보

- 키워드: `project`, `projects`, `프로젝트` + 대학명과 변형들(5.3.1). 대소문자 무시.
- 매칭: 4자 이상 키워드는 폴더명 부분 일치. 3자 이하 키워드(영문 약자 `KU`, `SNU`와 한글 약칭 `고대`, `연대` 모두)는 폴더명을 영숫자가 아닌 문자·대소문자 경계로 나눈 **토큰과 정확히 일치**할 때만 매칭한다(`kubernetes`가 `KU`로, `고대사`가 `고대`로 잡히는 오탐 방지).

#### 5.3.1 대학 사전

- 패키지에 국내 4년제·전문대 사전 `data/universities.json`을 포함한다. 항목: 정식 한글명, 통용 약칭(예: 연대, 고대), 영문명, 영문 약자(예: Yonsei / YU, Korea University / KU, SNU, KAIST, POSTECH).
- 사용자가 입력한 이름(정식명·약칭·영문 어느 것이든)으로 사전 항목을 찾아 모든 변형을 제시하고, 사용자가 빼거나 더할 수 있다. 사전에 없으면 입력값만 사용한다.
- 사전 원천: 공개된 대학 목록(교육부/대학알리미 공개 데이터)에서 정식명·영문명을 만들고, 약칭·약자는 수작업으로 보강한다. 사전 구축은 M1 작업에 포함한다.
- 탐색 깊이: 홈 디렉토리 기준 4단계, 그 외 디스크 루트 기준 3단계.
- 탐색 제외: 5.4 제외 경로, 그리고 OS 시스템 폴더(`C:\Windows`, `C:\Program Files*`, `C:\ProgramData`, 다른 사용자 프로필, macOS `/System`, `/Library`, `/Applications`).
- 결과: 기본 폴더 + 후보 폴더를 체크리스트로 제시. 기본 폴더는 체크된 상태, 후보 폴더는 체크 해제 상태로 시작. 상위 폴더가 선택되면 하위 후보는 목록에서 접는다.

### 5.4 순회 규칙

- 제외 디렉토리 이름: `node_modules`, `.git`(저장소 판정 후), `.venv`, `venv`, `__pycache__`, `.cache`, `dist`, `build`, `target`, `.next`, `.idea`, `.vscode`, `AppData`, `Library`(macOS 홈 하위), `$RECYCLE.BIN`, `System Volume Information`, `.Trash`.
- 심볼릭 링크·정션은 따라가지 않는다.
- 숨김 항목(이름이 `.`으로 시작하는 폴더·파일: `.agents`, `.claude`, `.github`, `.vscode`, `.env` 등)은 어느 깊이에서든 건너뛴다. 사용자가 스캔 폴더로 직접 지정한 숨김 폴더만 예외. 시스템 파일 `Thumbs.db`, `desktop.ini`, Office 잠금 파일 `~$*`도 건너뛴다.
- 결과 폴더(출력 폴더)는 스캔 폴더 안에 있어도 항상 제외한다.
- `.git`을 포함한 디렉토리는 **git 저장소 단위 1개**로 취급하고, 그 내부 파일은 문서로 순회하지 않는다.
- 접근 거부는 건너뛰고 `inaccessible` 목록에 기록.

### 5.5 폴더 범위 정리 (`mp scope`)

사용자 요청: "탐색 범위도 LLM 판단 + 질의로 정리". 파일 선별(9.7 E) 앞에서 폴더 단위로 크게 거른다.

- 실행 시점: `mp init` 끝에서 전체, `mp scope`로 수동 전체, `mp scan` 시작 시 판단 없는 새 폴더만.
- 대상: 5.4 순회 규칙·9.7 B 제외·민감 경로(8.1·8.2.1)를 거친 뒤 후보 파일(지원 확장자, 크기 조건 통과)이 하나라도 직접 들어 있는 폴더 중 `scope.decisions`에 판단이 없는 것. 상위 폴더가 exclude면 하위는 대상이 아니다.
- 입력(폴더당, 모델 `models.triage`): 임시 id, 마스킹된 상대 경로(스캔 루트 기준), 확장자별 파일 수, 파일 이름 예시 최대 5개(마스킹, 민감·비밀 이름·비밀값 본문 파일 제외). 예시는 결과물로 보이는 이름(write-up·report·submit·보고서·제출·최종·발표·풀이 등) → 문서 형식(pdf·docx·pptx·hwp) → 그 밖 순, 숫자 위주 이름은 뒤로(실기 스캔에서 이름순 예시 때문에 write-up이 든 work 폴더가 제외된 일 대응). 프롬프트에 "작업 폴더라도 그런 이름이 있으면 include"를 명시. 본문 없음. 150개 단위 배치, nonce 구분자. 프롬프트 첫 줄 고정 표식 `[범위 단계]`.
- 지시: 사용자 본인이 만든 과제·보고서·발표·프로젝트·대회·활동·이력 자료가 있을 폴더는 include, 강의자료·남의 자료·도구 산출물·로그·백업·설치 파일 폴더는 exclude, 판단이 어려우면 ask와 사용자에게 물을 한국어 질문 한 줄.
- 출력: `[{ id, decision: "include"|"exclude"|"ask", q?: string }]`, zod 검증, 누락분 1회 재요청. 끝까지 없는 폴더·파싱 실패는 판단 없음으로 두고(다음에 다시) 이번 스캔에서는 포함.
- 질의(터미널): ask 폴더마다 경로·파일 수·예시·질문을 보여 주고 `y`(포함) / `n`(제외) / `s`(나중에: 이번엔 포함, 판단 저장 안 함). `--yes`·비대화형은 모두 `s`로 처리.
- 저장: `config.json` `scope.decisions: { [절대경로(normalizePath)]: { decision: "include"|"exclude", by: "llm"|"user", at } }`. `by: user`는 LLM이 덮어쓰지 않는다. `mp scope --reset <경로>`는 그 경로와 하위 판단 삭제, `mp scope --list`는 목록 출력.
- 적용(순회): 가장 가까운 상위(자기 포함) 판단을 따른다. exclude면 그 폴더 아래로 내려가지 않되, 하위에 include 판단이 있으면 그 폴더까지만 내려간다.
- 오류·예산: 9.4, 9.8과 같다(같은 실행의 다른 단계와 예산 공유). 범위 단계가 rate_limit·auth·budget으로 멈추면 남은 폴더는 판단 없음으로 두고 스캔 전체를 멈춘다(같은 계정이므로 다음 단계도 실패). crash는 1회 재시작, no_results(회로 차단)는 남은 폴더를 이번엔 포함으로 두고 진행.
- 보고서: "폴더 범위: 포함 N, 제외 M, 나중에 K" 와 이번에 새로 판단한 폴더 목록.

## 6. 사전 필터 (prefilter)

- 지원 확장자: `.pdf .docx .pptx .doc .ppt .md .txt .hwp .hwpx` (대소문자 무시). 그 외 형식은 보고서에 "미지원 형식" 수로만 집계.
- 크기 상한: 50MB. 초과 파일은 읽지 않고 `skipped_large`로 기록한다. 스캔 보고서에 **절대경로, 파일 이름, 크기**를 나열해 "이런 파일이 있다"는 사실만 알리고 넘어간다.
- 하한: `.md .txt`는 200바이트 미만 제외.
- 중복: 내용 SHA-256이 같은 파일은 첫 번째만 처리하고 나머지 경로는 카드의 `duplicates` 필드에 기록.
- 이미 `state.json`에 같은 경로·같은 해시가 있으면 건너뜀. 같은 경로·다른 해시면 `changed` 목록에 기록하고 처리하지 않음.

## 7. 추출 (extractors)

| 형식 | 방법 |
|---|---|
| PDF | pdfjs-dist 페이지별 텍스트. 텍스트가 페이지당 평균 20자 미만이면 `empty`(스캔본, 후속 지원) |
| DOCX | mammoth raw text |
| PPTX | `ppt/slides/slide*.xml`의 `a:t` 노드 + 노트(`ppt/notesSlides`), 슬라이드 순서대로 |
| HWPX | `Contents/section*.xml`의 텍스트 노드, 섹션 순서대로 |
| HWP 5.0 | 2장 방식. 암호(비밀번호) 문서는 `encrypted`. 배포용(복사 제한) 문서 처리 여부는 M2 계획 전에 사용자 결정 |
| DOC (Word 97-2003) | OLE `WordDocument` + `0Table`/`1Table` 스트림의 piece table로 본문 텍스트 복원. 암호 문서는 `encrypted` |
| PPT (PowerPoint 97-2003) | OLE `PowerPoint Document` 스트림에서 `TextCharsAtom`/`TextBytesAtom` 레코드 텍스트 수집 |
| MD / TXT | UTF-8 시도 후 실패 시 CP949(EUC-KR) 디코딩 |
| git 저장소 | README(최상위, 최대 8,000자), 최상위 파일 목록, 확장자별 파일 수(언어 추정), 매니페스트(`package.json`, `pyproject.toml`, `requirements.txt`, `build.gradle`, `pom.xml`, `Cargo.toml`, `go.mod`)의 의존성 이름, `git log` 기반 전체 커밋 수·첫/마지막 커밋일·사용자 본인(`git config user.email`) 커밋 수, 원격 URL 호스트(예: github.com) |

추출 텍스트는 공백 정규화 후 전달한다.

## 8. 민감정보 (privacy)

### 8.1 파일 스킵

경로 또는 파일명에 다음 키워드가 포함되면 추출 전에 건너뛰고 `skipped_sensitive`에 사유와 함께 기록:

`주민등록, 등본, 초본, 가족관계, 통장사본, 통장 사본, 신분증, 여권사본, 운전면허, 계약서, 근로계약, 임대차, 원천징수, 소득금액, 납세, 건강보험, 진단서, 처방전, 여권, passport, id_card`

(`bank`, `password` 같은 영문 일반어는 "은행 시스템 프로젝트", "password-manager" 같은 정상 자료를 오탐하므로 넣지 않는다. 키워드는 git 저장소 경로에는 적용하지 않는다.)

사용자는 `config.json`의 `privacy.allowPaths`에 경로를 추가해 개별 예외를 둘 수 있다(예외 파일도 마스킹은 적용).

### 8.2 마스킹

추출 텍스트에 적용. 치환 후 표식:

| 대상 | 규칙 | 표식 |
|---|---|---|
| 주민·외국인등록번호 | `\d{6}[-\s]?[1-8]\d{6}` (앞 6자리가 유효한 YYMMDD) | `[주민번호]` |
| 카드번호 | 13~19자리(구분자 `-`/공백 허용) + Luhn 통과 | `[카드번호]` |
| 계좌번호 | 같은 줄 또는 앞 30자 이내에 `계좌|은행|입금|예금주|account`가 있고, 하이픈 포함 숫자열 총 10~16자리 | `[계좌번호]` |
| 여권번호 | 같은 줄에 `여권|passport`가 있고 `[A-Z]{1,2}\d{7,8}` | `[여권번호]` |
| 휴대전화 | `01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}`, `+82[-\s]?10…` 형태 포함 | `[전화번호]` |
| 유선전화 | `0(2|[3-6][1-5]|70)[-.)\s]?\d{3,4}[-.\s]?\d{4}` (지역번호·070) | `[전화번호]` |

- 구현 보강(M1 Task 3 리뷰 반영, 위 표보다 우선):
  - 마스킹 전 NFKC 정규화(전각 숫자 → 반각).
  - 주민번호 구분자: `-`, `–`, `—` 앞뒤 공백 허용, 줄바꿈은 불허. 일부 가림 형식 `YYMMDD-N******`도 `[주민번호]`.
  - 카드: 구분자는 `-`/공백만, 묶음 형식 4-4-4-4 / 4-4-4-1~7 / 4-6-4 / 4-6-5 또는 구분자 없는 15~16자리. 네 묶음이 모두 1900~2100 연도면 제외.
  - 계좌: 키워드가 같은 줄 또는 앞 30자(줄바꿈 포함) 안에 있으면 마스킹. 두 개의 YYYYMM/YYYYMMDD 날짜로 해석되는 값(예: `202203-202212`)은 제외.
  - 여권: 키워드 줄에서 대소문자 무시, 신형 `[A-Z]\d{3}[A-Z]\d{4}` 포함.
  - 전화: `(02) 123-4567`, `031) 123-4567`, `+82 (0)10-…`, `+82-2-…`(국제 유선) 포함.
  - 미지원(M2 재검토): 줄바꿈으로 끊긴 전화번호, 하이픈 없는 계좌번호.
- 이메일은 v1에서 마스킹하지 않는다.
- 마스킹 순서: 주민번호 → 카드 → 계좌 → 여권 → 전화번호 (긴 패턴 먼저 처리해 부분 치환 방지).
- 파일별 마스킹 횟수를 카드 생성 로그에 기록한다.
- 마스킹 후 텍스트의 80% 이상이 표식이면 해당 파일을 `skipped_sensitive`로 처리.

### 8.2.1 계정 비밀값 (2026-11-24 사고 대응)

실사용 점검에서 2단계 인증 복구 코드 파일(`*-recovery-codes.txt`, `*_backup_codes.txt` 형태)이 민감 파일로 걸리지 않아 선별 단계에서 앞부분이 에이전트로 전송될 수 있음이 드러났다(카드 생성은 안 됨). 대응: 해당 로그·대화 기록 삭제, 코드 재발급 권고, 아래 규칙 추가. 모두 **파일째 건너뛴다**(`skipped_sensitive`, 마스킹 아님). `privacy.allowPaths`는 두 검사 모두의 예외.

- 경로(파일 이름) 검사: backup/recovery code(s), 복구·백업 코드, 2fa/otp/mfa 토큰, `*-key.txt|md|json`·`api_key` 등, `.pem .key .p12 .pfx .kdbx`, `id_rsa` 류, `passwords.txt`·`비밀번호.txt`(접미어 한 단어까지), `credentials`·`secrets` 파일, 경로 조각 `중요자료`.
- 본문 검사(추출 직후, 마스킹 전): 개인 키 블록(`-----BEGIN … PRIVATE KEY-----`), 알려진 토큰 형식(GitHub `ghp_`·`github_pat_`, OpenAI/Anthropic `sk-`(URL·단어 안 제외, 숫자 섞인 32자 이상), AWS `AKIA`, Slack `xox?-`, Google `AIza`), 앞 3,000자 안의 "backup/recovery code"·"복구/백업 코드", 숫자가 든 4~5자 코드 쌍만 있는 줄 5줄 이상.

### 8.3 범위 축소 조건

M0 또는 실제 사용 테스트에서 다음 중 하나라도 확인되면 해당 범위를 축소한다:

- 에이전트의 내장 파일/쉘 도구를 끌 수 없음 → 그 에이전트를 v1 지원에서 제외.
- 샘플 코퍼스에서 마스킹 누락이 발견되고 규칙으로 해결되지 않음 → 패턴이 검출된 파일은 마스킹 대신 스킵(차단 방식)으로 전환.

## 9. 에이전트 연동 (agent-bridge)

### 9.1 실행

에이전트 실행 정보는 `config.json`의 `agents`에 둔다. 전체 기본값은 `docs/research/2026-11-24-acp-agents.md` §3. 요약:

| 에이전트 | 실행 | 도구 차단 (M0 실측 확인) |
|---|---|---|
| claude | `npx -y @agentclientprotocol/claude-agent-acp@0.110.1`, env `CLAUDE_CODE_EXECUTABLE`=사용자 설치 `claude` | `session/new` `_meta.claudeCode.options = { tools: [], settingSources: [], strictMcpConfig: true, disallowedTools: [...] }` + `session/set_mode default` |
| codex | `npx -y @agentclientprotocol/codex-acp@2.10.0`, env `CODEX_PATH`=사용자 설치 `codex` | env `INITIAL_AGENT_MODE=read-only`, `CODEX_CONFIG`로 shell/exec/apps/plugins/multi_agent 등 끄기. 잔여 도구(`functions.exec`, `spawn_agent`)는 M1 스모크에서 재검증, 새면 v1 제외 |
| antigravity | `agy acp` | 끌 방법 없음 → v1 제외 |

- `mp init`은 사용자가 설치한 `claude`/`codex`를 찾아 위 env로 지정한다(약관상 "사용자가 설치한 수정하지 않은 공식 CLI" 경로를 쓰기 위함, `docs/research/2026-11-24-vendor-terms.md`).
- 에이전트 프로세스는 빈 임시 디렉토리를 cwd로 실행한다.

- ACP `initialize`에서 클라이언트 capability `fs.readTextFile=false`, `fs.writeTextFile=false`, `terminal=false`를 선언한다.
- 모든 `session/request_permission`에 거부 옵션으로 응답하고 디버그 로그에 기록한다.
- 에이전트별 내장 도구 차단 설정을 위 표대로 적용한다. 권한 거부만으로는 부족하다(자동 승인 도구는 권한을 묻지 않음, M0 실측).
- 세션 작업 디렉토리(`cwd`)는 비어 있는 임시 디렉토리로 지정한다.

### 9.2 배치

- 한 배치: 파일 텍스트 합계 30,000자 이하.
- 파일당 상한 30,000자(마스킹 후 텍스트 기준). 상한 이하 파일은 자르지 않고 전문을 보낸다. 다른 파일과 합쳐 30,000자를 넘으면 다음 배치로 넘긴다(큰 파일은 배치를 혼자 사용).
- 30,000자 초과 파일은 LLM에 보내지 않고 `skipped_long`으로 기록한다. 스캔 보고서에 **절대경로, 파일 이름, 추출 글자 수**를 나열하고 넘어간다.
- 각 배치 프롬프트 구성: 시스템 지시(역할·출력 JSON 스키마·한국어 출력·추측 금지 규칙) + 기준자료 요약(최대 6,000자) + 파일 목록(`id`, 상대 경로, 형식, 수정일, 텍스트).
- 세션은 배치마다 새로 연다(9.7 A).
- 응답 시간 제한: 배치당 5분.

### 9.3 응답 검증

- 응답에서 첫 JSON 배열을 추출해 zod로 검증. 배치의 모든 `id`가 정확히 한 번씩 있어야 한다.
- 실패 시 같은 세션에 검증 오류를 담아 1회 재요청. 다시 실패한 `id`는 `analysis_failed`.

### 9.4 오류

| `AgentReply.kind` | 처리 |
|---|---|
| `rate_limit` | 즉시 중단. 완료된 카드는 저장됨. "N/M 완료, 나중에 `mp scan`" 안내 |
| `auth` | 중단. 해당 CLI 로그인 명령 안내 |
| `crash` | 에이전트 재시작 후 해당 배치 1회 재시도, 다시 실패하면 중단 |
| `timeout` | 해당 배치를 `analysis_failed`로 기록하고 계속 |

`rate_limit`/`auth` 판별은 에이전트별 오류 메시지 패턴으로 한다(M1에서 Claude, M3에서 나머지 수집).

### 9.5 로그

- `.mp/logs/scan-<timestamp>.log`: 배치별 파일 id·경로, 마스킹 횟수, 권한 요청 거부 내역, 오류.
- `--log-prompts` 사용 시 실제 전송 프롬프트 전문을 같은 폴더에 저장(성공 기준 3 검증용). 기본은 끔.

### 9.6 단계별 모델 분리 (추출: Haiku / 판정: Opus)

토큰 비용의 대부분은 문서 원문을 읽는 단계에서 나온다. 원문 읽기는 저렴한 모델로, 판단이 필요한 가치 평가는 원문 없이 상위 모델로 나눈다.

| 단계 | 모델 (기본값) | 입력 | 출력 |
|---|---|---|---|
| 1. 추출 | `haiku` | 마스킹된 원문 배치 (9.2) | 카드 필드 중 `value`, `value_reason`을 **제외**한 사실 정보 |
| 2. 판정 | `opus` | 1단계 결과 카드의 frontmatter 요약만 (원문 없음) | 카드별 `value`(상/중/하) + `value_reason` |

- 모델 지정: `config.json`의 `models: { extract: "haiku", judge: "opus" }`. Claude 에이전트는 어댑터 실행 env `ANTHROPIC_MODEL`로 전달한다(별칭을 써서 사용자 구독의 최신 모델을 따른다). 단계마다 별도 브리지(에이전트 프로세스)를 띄운다.
- Codex: 기본은 사용자 설정 모델을 그대로 쓴다(`models` 미적용). 사용자가 `models.codex`를 지정한 경우에만 `CODEX_CONFIG`의 `model`로 전달한다.
- 1단계 직후 카드는 `value: null`, `value_reason: null`(= 미판정)로 즉시 저장한다. 중단돼도 추출 결과는 남는다.
- 2단계는 스캔 마지막에 실행하며, 이번 스캔에서 만든 카드와 **이전 스캔에서 미판정으로 남은 카드**를 모두 대상으로 한다.
  - 판정 입력(카드당): id, type, use_for, title, summary, 상세 요약, period, role, skills, metrics, org. 원문·근거 발췌·경로는 보내지 않는다.
  - 배치: 카드 40개 단위. 응답은 `[{ id, value, value_reason }]`, zod 검증, 누락분 1회 재요청(9.3과 동일).
  - 판정 기준(프롬프트에 명시): 정량 성과의 구체성, 본인 역할의 명확성, 직무 관련 기술의 깊이, 결과물·증빙 존재, 최근성. 기준에 비춰 상대 비교가 아니라 카드별 절대 평가.
  - 판정 결과는 카드 frontmatter의 `value`, `value_reason`만 갱신한다. 사용자가 편집한 카드(10.5 기준)는 건드리지 않고 보고서에 "편집된 카드라 판정 생략"으로 남긴다. 갱신 후 state의 `card_body_hash`·`card_snapshot`도 새로 기록한다.
  - 2단계가 사용량 한도·인증 오류로 멈추면 카드는 미판정으로 남고, 다음 `mp scan`이 먼저 판정한다.
- `index.md`·보고서: 미판정 카드는 각 유형 섹션 맨 아래에 `미판정`으로 표시한다. 보고서에 "판정 완료 N / 미판정 M"을 적는다.
- 토큰 사용량 기록: 스캔 로그에 단계별 배치 수와 전송 글자 수를 남긴다(실제 토큰 집계는 에이전트 대화 기록 기준, 스모크 문서 참조).
- M4 `mp group`(경험 카드 묶기)도 판정 단계 모델(`opus`)을 사용한다.

### 9.7 토큰 절감 (실기 스모크 결과 반영, 2026-11-24)

실기 스캔 첫 98개 카드에서 카드당 입력 약 1.4만·출력 약 1천 토큰이 들었다. 원인은 (1) 한 세션에 5배치를 이어 보내 앞 배치가 매번 다시 입력됨(입력의 약 2/3), (2) 페이지 분할본·도구 산출물·남의 소스 등 무관한 파일이 대부분, (3) 파일마다 긴 상세 요약·근거 발췌 출력. 다음을 적용한다.

전체 흐름: **로컬 추출·마스킹 → 0단계 선별(triage) → 1단계 추출(카드 생성) → 2단계 판정** (이후 M4: 카드별 사용자 질의응답 → Master Record).

- **A. 배치마다 새 세션.** 추출·판정·선별 모두 배치 하나에 세션 하나. 같은 배치의 재요청(9.3)만 같은 세션을 쓴다. `sessionRotateBatches`는 더 쓰지 않는다(기존 config에 있어도 무시).
- **B. 로컬 제외(LLM에 보내지 않음, 보고서에 "생성물로 보여 제외 N개"만 집계).**
  - 디렉토리 이름(5.4에 추가): `out`, `tmp`, `temp`, `logs`, `cache`, `vendor`, `third_party`, `site-packages`, `.rep`로 끝나는 폴더(Ghidra 프로젝트).
  - 파일 이름: `LICENSE*`, `COPYING*`, `NOTICE*`, `CHANGELOG*`, `AUTHORS*`, `CONTRIBUTING*`, `CODE_OF_CONDUCT*`, `SECURITY.md`, `CMakeLists.txt`, `requirements*.txt`, `robots.txt` (대소문자 무시).
  - 강의자료(사용자 요청: "강의자료로 된 부분은 모두 제외, 유사한 단어도"): 폴더·파일 이름에 `강의자료 강의안 강의노트 강의록 강의슬라이드 강의교안 수업자료 강의녹취`(공백·`_`·`-` 무시)가 있거나, 앞이 한글이 아닌 `교안`·`교재`가 있으면 제외. 영어는 폴더 이름이 `lecture(s)`·`lecture notes`·`course/class materials`·`handouts`·`syllabus`·`녹취본`과 정확히 같을 때, 파일 이름은 `lecture<번호>`·`lecture notes`·`syllabus*`일 때만(사용자 프로젝트 `lecture-exam-analyzer` 보호).
  - 분할 산출물: 한 폴더에 `<접두어><숫자>.<txt|md>` 꼴 파일이 같은 접두어로, 접두어가 도구식(`page p pg chunk part slide seg segment split frame img image ocr out output tmp`)이면 10개 이상, 그 밖의 접두어면 50개 이상일 때 그 파일들(week1…week15 같은 과제 묶음 보호).
  - 메타 파일 이름은 이름 자체가 `LICENSE`·`CHANGELOG` 등이고 확장자만 붙은 경우(+ `LICENSE-*` 변형)만.
- **C. 본문 상한.** 마스킹 후 텍스트를 파일당 앞 3,500자 + `\n…(중략)…\n` + 끝 500자로 보낸다(4,000자 이하면 전문). 마스킹은 자르기 전에 전문에 대해 한다. `skipped_long`(30,000자 초과) 규칙은 그대로.
- **D. 출력 축소.** 추출 스키마: `summary` 한 줄, `detail` 최대 2줄, `excerpts` 최대 1개(100자 이내), `skills` 최대 8개, `metrics` 최대 3개. 카드 형식(10.2)은 그대로이고 내용만 짧아진다.
- **E. 0단계 선별(triage, 모델 `models.triage` 기본 `haiku`).**
  - 입력(파일당): id, 마스킹된 상대 경로, 형식, 추출 글자 수, 마스킹된 본문 앞 300자. 100개 단위 배치.
  - 기준(프롬프트): 사용자 본인이 작성했거나 참여한 과제·보고서·발표·프로젝트·대회·활동·이력 자료면 keep. 강의 자료 원본, 남의 문서·논문, 매뉴얼, 자동 생성 로그·리포트, 설정·빌드 파일, 데이터 덤프는 drop. **애매하면 keep.**
  - 출력: `{"keep":["f1",...]}` 형태 JSON 하나(drop 이유는 쓰지 않음). 응답에 없는 id는 drop, 파싱 실패·누락 시 그 배치 전체를 keep(안전 쪽).
  - drop된 파일은 state에 새 상태 `skipped_irrelevant`로 기록해 같은 해시면 다시 보내지 않는다. 보고서에 경로 목록을 남긴다. `mp scan --no-triage`는 선별을 건너뛰고, `--retriage`는 `skipped_irrelevant` 파일을 다시 후보로 넣는다.
  - 오류 처리는 9.4와 같다(rate_limit/auth 중단, crash 1회 재시작).
- **F. 확장 사고 끄기(실측 2026-11-24).** 범위·선별·추출 단계는 세션 `_meta.claudeCode.options.maxThinkingTokens = 0`. 같은 분류 응답의 출력이 약 750 → 286토큰. (`thinking: {type:"disabled"}`와 env `MAX_THINKING_TOKENS=0`은 어댑터 0.110.1에서 효과 없음.) 판정 단계는 사고를 유지한다.
- 로그: `[stage triage]`를 추가해 단계별 배치·글자 수를 남긴다.

### 9.8 사용량 예산 (5시간 창의 30%)

- 목표: LLM을 쓰는 명령(`scan`, `group`, `review`) 한 번 실행이 사용자 구독 5시간 사용량 창의 **30%p 이내**를 쓴다(Claude Pro 기준으로 설계, 비율이라 다른 요금제에도 같은 규칙).
- 측정(Claude, M1 실측 2026-11-24): 어댑터가 세션 첫 응답 무렵 `session/update` `usage_update`의 `_meta["_claude/rateLimit"].unifiedWindows.five_hour.{utilization, resetsAt}`(0~1)을 보낸다. 배치마다 새 세션(9.7 A)이므로 배치마다 값을 얻는다. `session/prompt` 응답의 `usage`(input/output/cachedRead/cachedWrite/total 토큰)도 함께 기록한다.
- 규칙: 명령 시작 후 처음 받은 utilization을 기준값 u0으로 둔다. 이후 `사용량 = Σ(창별 마지막 값 − 그 창의 시작값)`(창이 리셋되면 `resetsAt`가 바뀌므로 새 창 시작값은 0)이 `config.budget.fiveHourShare`(기본 0.30) 이상이면 다음 배치를 보내지 않고 멈춘다. 중단 종류 `budget`: 보고서에 "사용량 예산 도달 — 사용 N%p, 남은 파일 M개, 창 리셋 시각"을 적고 다음 실행에서 이어 한다(rate_limit과 같은 재개 경로). 판정 단계도 같은 예산을 공유한다.
- 같은 계정의 다른 사용(이 도구 밖 Claude 대화 등)도 창에 합산되므로 측정값은 보수적(실제보다 크게)이다.
- 시작 시 이미 utilization이 `1 − fiveHourShare` 이상이면 "창 리셋(시각) 후 실행 권장"을 묻는다(`--yes`면 그대로 진행하되 예산 규칙 적용).
- 사용률을 못 받으면(Codex 등) 예산을 적용하지 않고 로그에 "사용률 정보 없음"을 남긴다. 토큰 합계는 응답 `usage`가 있으면 기록한다.
- `--budget <0~1>`로 실행별 덮어쓰기, `--budget 1`은 사실상 무제한.
- 로그: 배치마다 `[usage] stage=… tokens(in/out/cr/cw)=… five_hour=0.xx spent=0.xx`. 보고서에 단계별 토큰 합계와 사용률 증가분.

## 10. 출력과 데이터 모델 (store)

- 요금제 환산(2026-11-24): `budget.fiveHourShare`는 **Pro 요금제 기준** 비율이다. `budget.planScale`(기본 1, Max 5x면 5, 20x면 20)은 내 요금제 5시간 창이 Pro 창의 몇 배인지다. 측정 사용률 기준 예산은 `fiveHourShare / planScale`이고(Max 5x에서 Pro 30% = 실측 6%p), 중단 안내·로그·보고서는 Pro 기준(실측 × planScale)을 함께 적는다.

### 10.1 폴더 구조

```
<출력 폴더>/
├─ index.md
├─ files/<연도>-<slug>-<hash6>.md
├─ experiences/<slug>.md
├─ baseline/<slug>-<hash6>.md
├─ reports/scan-<YYYY-MM-DD-HHmm>.md
└─ .mp/
    ├─ config.json
    ├─ state.json
    ├─ logs/
    └─ staging/          (--elevated 실행 중에만)
```

- `<연도>`: 카드 `period` 시작 연도, 없으면 원본 수정일 연도.
- `<slug>`: LLM이 제시한 짧은 제목을 파일명 안전 문자로 변환, 최대 40자.
- `<hash6>`: 원본 SHA-256 앞 6자리.

### 10.2 파일 카드

```yaml
---
schema_version: 1
kind: file
source: "D:/대학/캡스톤/최종보고서.hwp"
source_hash: "sha256:..."
format: hwp            # pdf|docx|pptx|md|txt|hwp|hwpx|git
size: 1048576
modified: 2025-06-20
duplicates: []
type: 보고서            # 과제|보고서|발표|코드|수상·증빙|기타
use_for: [포트폴리오, 자소서]   # 이력서|자소서|포트폴리오 중 0개 이상
title: "이미지 분류 서비스 최종 보고서"
summary: "한 줄 요약"
period: "2025-03 ~ 2025-06"    # 알 수 없으면 null
role: "팀장, 모델 학습"          # null 허용
skills: [Python, PyTorch]
metrics: ["정확도 92%"]
org: "OO대 컴퓨터공학과 캡스톤디자인"   # null 허용
value: 상              # 상|중|하, 미판정이면 null (9.6)
value_reason: "정량 성과와 팀 리딩 경험이 명확"   # 미판정이면 null
in_resume: 미반영       # 반영됨|부분반영|미반영|판단불가(기준자료 없음)
agent: claude
generated_at: 2026-11-24T10:00:00+09:00
---
## 상세 요약
최대 2줄 (9.7 D)

## 근거 발췌
- 원문 핵심 문장 최대 1개, 100자 이내 (마스킹된 텍스트 기준, 9.7 D)
```

- 추측 금지: 원문에 근거가 없는 필드는 `null` 또는 빈 배열.

### 10.3 경험 카드

`experiences/<slug>-<hash6>.md`:

```yaml
---
schema_version: 1
kind: experience
title: "캡스톤 디자인 – 이미지 분류 서비스"
type: 프로젝트            # 파일 카드 type 값 재사용
period: "2025-03 ~ 2025-06"
org: "연세대 소프트웨어학부"
role: "팀장, 모델 학습 담당"
team_size: 4             # null 허용
keywords: [VM 역공학, 입력 복원]      # 경험 키워드 2~3 (11.5)
outcome_keywords: [키 12벌 복원]     # 성과 키워드 1~2 (11.5)
contribution: 직접 수행     # null | 직접 수행 | 학습 후 재수행 | AI 보조 | AI 주도 | 개념 해석 (11.4)
category: 프로젝트         # null | 프로젝트 | 연구 | 대회·CTF | 교육·수업 | 동아리·스터디 | 기타 (11.4)
skills: [Python, PyTorch, FastAPI]
metrics: ["정확도 92%"]
value: 상                 # evidence 판정 최고값으로 시작, 반영 단계에서 갱신
value_reason: null
evidence: [files/2025-이미지분류-a1b2c3.md]
in_resume: 판단불가
review: pending          # pending | adopted | held | excluded
questions:
  - { id: q1, field: role, q: "본인 역할은?", a: null }      # a: null = 미응답, "모름" 허용
pending_apply: false
reviewed_at: null
agent: claude
generated_at: ...
---
## STAR 요약
- Situation / Task / Action / Result
## 질의응답
- Q/A 원문(마스킹된 답변)
```

- state.json에 `experiences` 맵(카드 경로 → `card_body_hash`, `card_snapshot`)을 둬 편집을 감지한다(10.5 규칙). 파일 카드 쪽에 역링크는 두지 않고 index/master 생성 때 계산한다.
- 파일 카드 state 상태에 `ungrouped`(11.1)를 추가한다(파일 카드 status와 별개 필드 `grouping: ungrouped`).

### 10.4 기준자료 카드 (baseline)

- 기존 이력서 폴더의 파일을 같은 추출·privacy 경로로 처리.
- LLM이 경험 목록(제목·기간·역할·키워드)을 추출해 `baseline/`에 저장.
- 분석 배치에 넣는 기준자료 요약은 모든 baseline 카드의 경험 목록을 합친 것(6,000자 초과 시 최근 수정 순으로 자름).
- 기준자료 폴더가 없으면 모든 파일 카드의 `in_resume`은 `판단불가`.

### 10.5 state.json

```json
{
  "schema_version": 1,
  "files": {
    "<원본 절대경로>": {
      "source_hash": "sha256:...",
      "card": "files/....md",
      "card_body_hash": "sha256:...",
      "card_snapshot": { "...": "마지막으로 기록한 frontmatter" },
      "status": "done | analysis_failed | skipped_sensitive | skipped_large | skipped_long | extract_failed | duplicate | skipped_irrelevant"
    }
  },
  "last_scan": "2026-11-24T10:00:00+09:00"
}
```

- `card_body_hash`: 카드를 쓸 때의 카드 파일 해시. 현재 해시와 다르면 사용자 편집으로 간주.
- 모든 명령 시작 시 정합성 검사: `state.json` 없음·파싱 실패·카드 목록 불일치(state에 있는데 카드 파일이 없음, 카드 파일이 있는데 state에 없음)·`card_body_hash` 불일치를 감지한다.
- 감지되면 해당 카드들을 읽어 재구성안을 만들고 사용자에게 질의한다:
  - 카드 frontmatter(`source`, `source_hash`)로 복원할 항목 목록
  - 내용이 바뀐 카드 목록과 바뀐 필드 요약(카드 frontmatter와 마지막 기록값 비교) → 항목별로 "사용자 편집으로 보호" 또는 "편집 아님, 덮어쓰기 허용"을 선택
  - 원본이 사라진 카드 → "유지" 또는 "삭제"
- 사용자가 확인한 뒤에만 `state.json`을 다시 쓴다. `--yes`이면 보수적 기본값(보호·유지)으로 적용한다.
- 이를 위해 state에 카드별 마지막 기록 frontmatter 스냅샷(`card_snapshot`)을 저장한다.

### 10.6 index.md / 스캔 보고서

- `index.md`: 유형별 섹션, 각 섹션은 `value` 내림차순 표(미판정은 맨 아래)(제목 링크, 기간, skills, in_resume).
- 스캔 보고서: 신규 카드, 원본 변경(`mp rescan` 안내), 민감 스킵, 대용량 스킵(절대경로·파일 이름·크기), 장문 스킵(절대경로·파일 이름·글자 수), 추출 실패, 분석 실패, 접근 불가, 미지원 형식 수.

## 11. 경험 카드·질의응답·Master Record (M4)

전체 흐름: `scan`(로컬 추출 → 선별 → 파일 카드 → 판정) → `group`(경험 묶기 + 보강 질문) → `review`(사용자 질의응답 → 반영) → `master`(master.md). 기존 `mp chat`은 범위에서 뺀다(`review`가 대체, 이후 재검토).

### 11.1 `mp group` (모델: `models.judge`)

- 대상: state `done`이고 판정 `상`/`중`이며 아직 어느 경험 카드 `evidence`에도 없고 `grouping: ungrouped`가 아닌 파일 카드. `--regroup`은 ungrouped도 포함.
- 입력(카드당 한 줄 JSON): 임시 id(`c1…`), type, title, summary, period, role, org, skills, metrics, value. 경로·원문·근거 발췌·해시는 보내지 않는다(임시 id ↔ 카드 경로는 로컬). 기존 경험 카드가 있으면 경험 목록(임시 id `e1…`, title·period·org 한 줄)을 함께 보낸다.
- 배치 30,000자(입력 카드 기준). 배치가 여러 개면 마지막에 새로 만든 경험 목록만 보내 합치기 1회.
- 출력: `{ experiences: [{ title, type, period, org, role, team_size, skills, metrics, evidence: [c…], questions: [{ field, q }] }], attach: [{ card: c…, experience: e… }], unassigned: [c…] }`. 질문은 경험당 최대 3개, 카드에서 이미 확인된 사실은 묻지 않는다.
- 검증(zod): evidence·attach의 id는 그 배치 id, 한 카드는 최대 한 곳. 응답에 없는 카드는 다음 group에서 다시 보낸다. `unassigned`는 state 해당 항목에 `grouping: ungrouped`로 기록.
- 새 경험 카드: `review: pending`, `value`는 evidence 판정 중 최고값. 같은 slug가 있으면 `-2` 접미사.
- `attach`: 기존 경험의 evidence에 추가하고 새 질문이 있으면 덧붙인다. 그 경험이 `adopted`여도 상태는 유지하고, 다음 `review`에서 새 질문(`a: null`)만 묻는다. 사용자가 편집한 경험 카드(10.5 규칙)는 건드리지 않고 보고서에 남긴다.
- 배치 단위 저장, 오류는 9.4·예산은 9.8.

### 11.2 `mp review`

- 대상: `review: pending`이거나 `a: null` 질문이 있는 경험 카드(`value` 하는 기본 제외, 목록만 표시). 시작 화면에 "답변은 마스킹 후 선택한 에이전트로 전송됨" 안내.
- 터미널(기본): 경험마다 요약(제목·기간·역할·근거 파일 제목)을 보여 주고 질문을 하나씩 묻는다. 답 / 건너뛰기(`a` 그대로 null) / `모름`. 마지막에 채택 / 보류 / 제외. 입력 즉시 카드에 저장(답은 `sanitize()` 후 저장), 중단 후 다시 실행하면 이어서.
- `--file`: 대상 경험의 질문을 `review.md`(결과 폴더)에 쓴다. 사용자가 답과 결정을 채운 뒤 `mp review --apply`가 파싱해 카드에 저장한다(형식 오류 줄은 건너뛰고 보고). 이후는 터미널 방식과 같다.
- 반영(모델: `models.judge`): 결정이 채택·보류이고 새 답이 있는 경험을 10개 단위 배치로 보낸다. 입력: 경험 카드 frontmatter + 마스킹된 Q/A. 출력: 경험별 갱신 필드(period, org, role, team_size, skills, metrics)와 STAR 요약. 답에 근거가 없는 필드는 바꾸지 않는다. 제외는 보내지 않고 로컬에서 상태만 바꾼다.
- `pending_apply: true`는 "아직 반영되지 않은 답이 있음"이다. 답을 저장할 때 켜고 반영 성공 시 끈다. 반영 대상은 `pending_apply`이고 결정이 채택·보류인 카드(이전 실행에서 중단·반영 실패로 남은 답 포함). 반영 직전 사용자가 카드를 편집했으면 덮어쓰지 않고 보고한다. Q/A 원문은 카드 본문 `## 질의응답`에 남긴다.
- 카드 파일을 쓸 때마다 state.json도 함께 저장한다(중단돼도 편집으로 오인되지 않음). 터미널 Ctrl+C는 그만두기와 같다.
- `--accept-edits`: 바깥에서 편집된 경험 카드(해시 불일치·기록 없음, 형식이 맞는 것만)를 목록으로 보여 주고 한 번 확인(`--yes`면 생략) 뒤 현재 내용을 다시 기록해 질의응답·반영 대상으로 되돌린다.
- state.json이 손상되면 `mp group`·`mp review`는 아무것도 저장하지 않고 "state.json 손상 — `mp scan`으로 먼저 정합성 검사 후 다시 실행"을 출력하고 코드 2로 끝난다.

### 11.3 `mp master` (LLM 없음)

- `review: adopted` 경험 카드를 이력서 분류(category, 11.4)별·최신순으로 모아 결과 폴더의 `master.md`를 만든다. 항목: 제목, 기간, 소속, 역할(팀 규모), 기술, 성과, STAR 요약, 근거 파일 카드 링크.
- 맨 위에 "자동 생성 — 수정은 experiences/의 경험 카드에서" 안내. 매번 전체를 다시 쓴다.
- 깨진 evidence 링크(파일 카드 삭제)는 항목 아래 표시.
- 같은 내용으로 `master.html`도 쓴다(외부 리소스 없는 단일 파일, 로컬 전용). 요약(경험 수·분류 수·수행 방식 분포), 검색, 분류·수행 방식 필터, 경험별 "한 줄 복사"(제목 (기간) — 역할 · 성과)·"STAR 복사", 모두 펼치기, 인쇄·PDF(펼친 상태로 인쇄), 다크 모드, 휴대폰 폭 대응. 카드 텍스트는 모두 HTML 이스케이프한다. master.md와 같은 표시 모델(`buildMasterView`)을 쓴다.

### 11.4 실사용 보강 (2026-11-24 실제 질의응답 피드백)

실제 사용에서 드러난 차이: (1) 사용자가 가장 중요하게 본 것은 "내가 직접 한 일인가"(AI·강의 도움 정도)인데 묻지 않았다. (2) 사용자는 질문보다 결정을 먼저, 비슷한 경험끼리 묶어서 내렸다(27개 중 10개 제외). (3) master.md가 파일 유형(과제·보고서·발표)으로 나뉘어 이력서 분류와 맞지 않았다. (4) 파일 수정일이 실제 진행 시기와 달랐다(2021 강의 → 2026 재분석 파일). (5) 가짜 에이전트가 답과 무관한 값을 돌려줘 "답이 맞는 필드에 들어갔는지"를 테스트하지 않았다.

- **수행 방식(contribution)**: 경험 카드 필드. 값과 뜻:
  - `직접 수행`: 본인이 처음부터 직접 수행.
  - `학습 후 재수행`: 강의·가이드로 배운 뒤 혼자 다시 수행.
  - `AI 보조`: 본인이 주도하고 AI는 보조 도구로 사용.
  - `AI 주도`: AI 에이전트가 대부분 수행하고 본인은 방향 설정·검증.
  - `개념 해석`: 본인은 개념·설계 해석을 맡고 구현은 AI·타인이 수행.
- **기본 질문(로컬, 토큰 없음)**: 경험을 만들 때와 `mp review` 시작 때, 제외되지 않고 편집되지 않은 경험에 다음 질문이 없으면 덧붙인다. LLM 질문 3개 한도와 별개다.
  - 수행 능력 점검(field `contribution`, contribution이 null일 때): "이 작업에서 본인이 직접 한 부분과 강의·팀원·AI의 도움을 받은 부분은 각각 무엇인가요? 지금 혼자 다시 할 수 있나요?"
  - 기간 확인(field `period`): period가 null이면 "실제로 진행한 시기(시작~종료 연월)는 언제인가요? (근거 파일 수정일: A ~ B, 복사·재저장 날짜일 수 있음)". period가 있는데 근거 파일 수정일 연도가 period의 연도와 하나도 겹치지 않으면 "카드 기간은 P, 근거 파일 수정일은 A ~ B입니다. 실제 진행 시기를 알려 주세요(맞으면 \"맞음\")." 수정일은 근거 파일 카드의 `modified`(YYYY-MM). 근거 수정일을 모르면 괄호 부분을 뺀다. 이미 `a: null`인 period 질문이 있으면 덧붙이지 않는다.
  - `mp group`은 LLM이 낸 period 질문을 버리고 위 규칙으로 대신한다. 묶기 프롬프트에 "본인 기여도·AI 활용 정도와 기간은 묻지 마세요(따로 묻습니다)"를 넣는다.
- **이력서 분류(category)**: 묶기 출력에 `category`를 추가하고 반영 단계도 바꿀 수 있다. null이면 master에서 로컬 규칙으로 추정: 제목·소속(대회·CTF만 근거 파일 카드 제목도)에 CTF·워게임·wargame·Dreamhack·pwnable·대회·예선·본선·해커톤·공모전·write-up → 대회·CTF, 동아리·스터디·학회 → 동아리·스터디, Lab·연구실·연구 → 연구, 수업·과제·강의·교육과정·학기 또는 type 과제 → 교육·수업, 그 밖 → 프로젝트(순서대로 첫 일치).
- **반영 단계**: Q 줄에 필드를 붙인다(`Q[period]: …`). 출력에 `contribution`, `category`를 추가한다. 규칙 추가: 수행 방식은 답변에 근거해 위 다섯 값 중 하나로 분류한다. role과 STAR의 Action은 본인이 직접 한 일과 도움받은 부분을 구분해 쓴다. metrics는 결과·성과이며 문서 통계(슬라이드 장수, 파일·페이지·참고자료 개수)는 쓰지 않는다.
- **결정 먼저(`mp review`)**: 1단계 결정, 2단계 질문.
  - 결정 대상은 `review`가 pending·held인 경험(value 하는 `--all` 없으면 제외).
  - 터미널: 목록(번호. 제목 — 기간 · 근거 n개 · 가치)을 보여 주고 체크박스 두 번으로 채택할 것 → 남은 것 중 제외할 것을 고른다. 나머지는 보류. 그만두기(Ctrl+C)는 아무것도 바꾸지 않는다.
  - 질문은 채택한 경험의 `a: null` 질문만 묻는다. 보류는 다음 실행의 결정 대상으로 다시 나온다.
  - `--file`: `# 1. 결정` 절(결정 대상마다 `## 경로`, 제목·기간·근거 수, `결정:`)과 `# 2. 질문` 절(채택 경험의 미응답 질문)을 쓴다. `--apply`가 결정과 답을 저장한 뒤, 새로 채택된 경험에 미응답 질문이 남아 있으면 "새로 채택한 경험 N개에 질문이 있습니다. `mp review --file`을 다시 실행하세요."를 출력한다.
- **master.md**: 유형 대신 category로 묶는다. 순서: 프로젝트, 연구, 대회·CTF, 교육·수업, 동아리·스터디, 기타. 안에서는 최신순(기간 끝 연월, 없으면 뒤). 표시 보정:
  - 기간 `A ~ A`는 `A`.
  - team_size 1은 `(개인)`(역할에 개인·단독·혼자가 있으면 생략), 2 이상은 `(팀 N명)`.
  - `- 수행 방식: …` 줄 추가.
  - 문서 통계 성과(슬라이드·페이지·장·쪽·파일·Header file·Source file·참고 자료 + 숫자)는 표시하지 않는다.
- **테스트**: 가짜 에이전트의 반영 응답은 Q 줄의 필드에 따라 답을 그 필드에 넣는다("모름"·빈 답은 넣지 않음). 답 → 필드 반영, 결정 먼저 흐름, 2단계 review.md, 기본 질문 덧붙이기(수정일 힌트 포함), category 추정·정렬, 표시 보정을 검증한다.

### 11.5 로컬 웹 UI `mp ui` (2026-11-24)

목표: CLI를 몰라도 결과 보기·결정·답변·수정·반영을 브라우저에서 한다. 카드는 키워드로 한눈에 보이게(저노출·고응집), 스크롤 대신 목차로 이동한다.

- **키워드(경험 카드 필드)**: `keywords`(경험 키워드 2~3개: 무엇을 했나, 활동·기법·대상, 예 "VM 역공학", "입력 복원")와 `outcome_keywords`(성과 키워드 1~2개: 무엇을 이뤘나, 수치 가능, 예 "키 12벌 복원", "취약점 3건 신고"). 기술 스택 이름만으로 된 키워드는 쓰지 않는다(기술은 skills). 각 18자 이내, 넘치면 단어 경계에서 자른다(12자 안팎 명사구 권장). 기본값 `[]`.
  - `mp group` 출력과 `mp review` 반영 출력에 두 필드를 추가한다(반영은 답변으로 바뀔 때만).
  - `mp keywords [--all]`(모델 `models.triage`, 생각 끔): 제외가 아니고 두 필드가 모두 빈 경험(또는 `--all`이면 제외 아닌 전부)을 20개씩 `[키워드 단계]`로 보낸다. 입력은 마스킹한 한 줄 JSON(title, org, role, contribution, metrics, STAR). 출력 `[{id, keywords, outcome_keywords}]`. 예산 9.8, 편집된 카드는 건너뜀.
  - 키워드가 없으면 UI는 성과 첫 항목(24자 줄임)을 성과 키워드 자리에 흐리게 보여 준다.
- **`mp review --apply-only`**: 질의응답 없이 반영 대기(pending_apply) 경험만 반영한다(UI 작업용).
- **서버**: `mp ui [--port N] [--no-open]`. Node `http`, 새 의존성 없음. `127.0.0.1`에만 바인딩(기본 포트 0=임의). 실행마다 32바이트 임의 토큰을 만들어 시작 URL `http://127.0.0.1:PORT/?t=TOKEN`으로 연다. 페이지는 토큰을 메모리에 두고 모든 API 요청에 `X-MP-Token` 헤더로 보낸다. 토큰 불일치 401, Host 헤더가 `127.0.0.1:PORT`·`localhost:PORT`가 아니면 403, POST 본문은 JSON 1MB 이하. CORS 헤더를 내보내지 않는다. Ctrl+C로 종료.
  - 브라우저 열기: WSL(`/proc/version`에 microsoft)이면 `cmd.exe /c start "" URL`, macOS `open`, Windows `cmd /c start`, 그 밖 `xdg-open`. 실패하면 URL만 출력.
  - API(모두 JSON):
    - `GET /api/state` → `{ experiences: UiExperience[], job: JobState | null, output: 결과 폴더 경로 }`. UiExperience는 rel, title, category(추정 포함), period(표시 보정), org, role(팀 규모 표시 포함), contribution, keywords, outcome_keywords, skills, metrics(문서 통계 제외), star, evidence[{path,title}], review, value, questions(id, field, q, a), pending_apply, edited.
    - `POST /api/decide {rels: string[], decision: "adopted"|"held"|"excluded"}`
    - `POST /api/answer {rel, qid, a}`: 빈 문자열이면 무시, `recordAnswer`로 마스킹해 저장.
    - `POST /api/edit {rel, fields}`: 허용 필드 title, period, org, role, team_size, contribution, category, keywords, outcome_keywords, skills, metrics만. zod 검증.
    - `POST /api/accept-edit {rel}`
    - `POST /api/job {kind: "apply"|"keywords"|"master"}` → 같은 CLI를 자식 프로세스로 실행(`review --apply-only --yes`, `keywords --yes`, `master`). 한 번에 하나(실행 중이면 409). `GET /api/job` → `{kind, running, code, lines(마지막 200줄)}`.
    - `GET /files/<rel>`: 결과 폴더 안 `files/`·`experiences/`의 .md만 text/plain으로(경로 탈출 거부).
  - rel은 현재 존재하는 경험 카드여야 한다(없으면 404). 편집된 카드에 쓰기 요청이 오면 409와 "바깥에서 편집됨". 모든 쓰기는 `saveExperience`(state.json 동시 저장).
- **화면**(단일 HTML, 인라인 CSS·JS, 외부 리소스 없음, 라이트 기본·시스템 다크):
  - 왼쪽 고정 사이드바: 할 일(결정 대기·답변 대기·반영 대기 개수, 누르면 그 목록), 분류 목차(개수, 앵커 이동), 수행 방식 필터, 보기 전환(분류별·연도별 타임라인), 상태 필터(채택·보류·제외·대기).
  - 가운데 목록: 경험 한 줄 = 제목 · 기간 · 수행 방식 배지 · 경험 키워드 칩 · 성과 키워드 칩(강조색) · 상태 점. 상단 검색(`/`로 포커스).
  - 오른쪽 상세 패널(`Esc` 닫기): 결정 버튼, 미응답 질문 입력(모름·건너뛰기), 성과·STAR·기술·근거 링크, 복사(한 줄·STAR), 편집 모드(필드 폼). 편집된 카드는 "받아들이기" 버튼만.
  - 결정 대기 목록은 체크박스 다중 선택 + 채택·보류·제외 일괄 버튼.
  - 하단 작업 바: 반영 대기 n개 → "반영 실행", "키워드 만들기", "master 다시 만들기". 실행 중 로그 줄을 1초 간격으로 갱신. 끝나면 상태 새로고침.
  - 좁은 화면(≤ 820px): 사이드바는 상단 접이식, 상세 패널은 전체 화면.
- **`master.html`**: 같은 화면을 읽기 전용으로(데이터는 페이지에 JSON으로 포함, 쓰기·작업 UI 없음, 채택만). 인쇄 시 목록 대신 채택 경험 전체를 펼친 문서형.
- **테스트**: 서버는 임시 폴더 + 가짜 에이전트로 HTTP 요청을 보내 검증(토큰·Host·본문 크기·경로 탈출·409·각 API 저장 결과·작업 실행과 로그). 키워드 단계는 가짜 에이전트 시나리오. 화면 스크립트는 문법 검사와 상태 모델 함수 단위 테스트.

## 12. 관리자 권한 수집 (`--elevated`)

```
mp scan --elevated
 ├─(1) 상승된 수집 프로세스: discovery → prefilter → extractor → privacy
 │      → .mp/staging/<id>.json (SanitizedText + 메타) + manifest.json
 │      에이전트 실행 없음, 네트워크 사용 없음
 └─(2) 원래(일반 권한) 프로세스: staging 읽기 → analyzer ⇄ agent-bridge → store → staging 삭제
```

- Windows: PowerShell `Start-Process -Verb RunAs -Wait`로 `mp __collect` 내부 명령 실행.
- macOS: `sudo mp __collect ...` 실행 후 staging 파일 소유자를 원래 사용자로 `chown`.
- 상승 모드에서도 5.3의 OS 시스템 폴더·다른 사용자 프로필은 제외.
- 일반 실행 시작 시 남아 있는 `staging/`은 삭제.

## 13. 오류 처리 원칙

- 파일 단위 오류는 기록하고 계속 진행한다. 스캔 중단은 `rate_limit`, `auth`, 반복 `crash`, 출력 폴더 쓰기 불가일 때만.
- 카드는 배치 검증 직후 파일 단위로 즉시 기록한다(중단 시 이어하기 = 다음 `scan`이 `state.json`으로 건너뜀).
- Ctrl+C: 진행 중 배치는 버리고 종료. 저장된 카드는 유지.

## 14. 테스트

- 단위: `prefilter`, `privacy`(패턴별 양성/음성 케이스, Luhn, 날짜·학번·버전 번호 오탐 방지), 대학 사전 매칭(짧은 약자 토큰 매칭), `store`(frontmatter 왕복, state 재구성), `discovery`(가상 파일시스템, 깊이·제외 규칙), 배치 구성, 응답 검증.
- 추출기: `test/fixtures/`의 형식별 샘플에 대한 스냅샷 테스트. HWP 샘플은 공공기관 공개 문서 사용.
- 통합: 가짜 ACP 에이전트(테스트용 스크립트)로 `init`(비대화 모드) → `scan` → `group` 전체 흐름. 가짜 에이전트는 고정 JSON 응답, 의도적 권한 요청, 잘못된 JSON, rate limit 오류를 시나리오별로 재현.
- 불변 조건 테스트: 가짜 에이전트가 수신한 모든 프롬프트에 8.2 패턴이 없는지 검사.
- 실제 에이전트 스모크 테스트: v1 에이전트 각각 소규모 fixture 폴더로 수동/선택 실행.
- CI: GitHub Actions, `windows-latest`, `macos-latest`.

## 15. 마일스톤

| 단계 | 내용 | 완료 조건 |
|---|---|---|
| M0 | 검증: (1) HWP 5.0 추출 Node vs pyhwp 실측, DOC/PPT(OLE) Node 추출 품질 실측, (2) 세 에이전트의 내장 도구 차단 방법과 ACP 어댑터 패키지명 확정, (3) 벤더별 약관 확인 | 결과를 `docs/research/`에 문서화하고 스펙 해당 항목 갱신 |
| M1 | `init`(대학명·폴더·에이전트), `doctor`, `scan`(일반 권한, 단일 홈 디스크), PDF/DOCX/PPTX/MD/TXT 추출, privacy, store, Claude 연동 | 성공 기준 1, 3, 5를 Claude로 충족 |
| M2 | HWP/HWPX·DOC/PPT·git 추출, baseline과 `in_resume`, `rescan`, `status` | 성공 기준 2 충족 |
| M3 | Codex·Antigravity 연동, 다중 디스크 탐색, `--elevated` | 성공 기준 4 충족 |
| M4 | `group`, `review`, `master` (11장), 사용량 예산(9.8) | 실기 카드로 경험 묶기·질의응답·master.md 동작 |

## 16. 범위 밖 (v1)

- 로컬 웹 UI, 데스크톱 앱
- 채용 공고 매칭
- 이미지·스캔 PDF(OCR)
- WSL에서 Windows 쪽 디스크 탐색
- 이력서·자소서 초안 작성
- 원본 변경 카드의 필드 단위 병합
