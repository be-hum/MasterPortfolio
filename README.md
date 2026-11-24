# MasterPortfolio

PC 곳곳에 흩어진 과제·보고서·발표자료·코드 저장소에서 **이력서·포트폴리오에 쓸 경험을 찾아 정리**하는 로컬 프로그램입니다.

- **내 구독으로 분석**: 이미 쓰고 있는 Claude Code(구독)를 [Agent Client Protocol](https://agentclientprotocol.com)로 구동합니다. 별도 API 비용이나 운영 서버가 없습니다.
- **개인정보 보호**: 신분·금융 서류, 계정 비밀(복구 코드·키)로 보이는 파일은 건너뛰고, 나머지는 주민번호·전화번호·계좌 등을 로컬에서 가린 뒤에만 보냅니다. 에이전트의 파일 읽기·실행 도구는 막습니다.
- **결과는 Markdown**: 파일마다 카드, 경험마다 경험 카드(STAR 요약), 이력서용 정리본 `master.md`·`master.html`. Obsidian·VS Code·메모장 어디서든 열립니다.
- **사용량 절약**: 로컬 사전 필터, 빠른 모델(선별·추출)과 정밀 모델(판정·묶기) 분리, 5시간 사용량 예산(요금제 배수 환산) 안에서 멈추고 다음 실행에서 이어 합니다.

## 다운로드와 실행

[Releases](../../releases)에서 운영체제에 맞는 zip을 받습니다. Node.js 설치는 필요 없습니다(포함).

| 운영체제 | 파일 | 실행 |
|---|---|---|
| Windows 10/11 (x64) | `MasterPortfolio-<버전>-win-x64.zip` | 압축 해제 → `install.cmd`(바로가기 설치) 또는 `MasterPortfolio.cmd` |
| macOS (Apple Silicon) | `MasterPortfolio-<버전>-mac-arm64.zip` | 압축 해제 → `MasterPortfolio.command` (처음엔 Control-클릭 → 열기) |
| macOS (Intel) | `MasterPortfolio-<버전>-mac-x64.zip` | 위와 같음 |

준비물: [Claude Code](https://claude.com/claude-code) 설치와 로그인, 인터넷 연결.

처음 실행하면 터미널에서 대학명·스캔할 폴더·결과 폴더를 정하고, 그다음부터는 브라우저 화면이 열립니다.

1. 작업 바에서 **새 자료 스캔** → **경험 묶기**
2. 왼쪽 **할 일**에서 경험을 채택·보류·제외하고, 질문에 답한 뒤 **반영 실행**
3. **master 다시 만들기** → 결과 폴더의 `master.html`(이력서용 정리본)

화면은 `127.0.0.1`에서만 열리고, 실행마다 바뀌는 토큰으로 보호됩니다.

## 명령줄(CLI)

```
mp start      # 처음이면 설정, 이후 브라우저 화면
mp ui         # 브라우저 화면 (결과 보기·결정·답변·수정·작업 실행)
mp init       # 대학명·스캔 폴더·에이전트·결과 폴더 설정
mp scan       # 새로 생기거나 바뀐 파일 분석 → 파일 카드
mp group      # 파일 카드 → 경험 카드 + 보강 질문
mp review     # 결정(채택·보류·제외) → 질문 답변 → 반영
mp keywords   # 경험·성과 키워드
mp master     # master.md·master.html
mp doctor     # 환경 점검
```

## 개발

```
npm ci
npm test            # vitest (가짜 ACP 에이전트로 전체 흐름 검증)
npm run build       # tsc → dist/
npm run package     # release/*.zip (Windows·macOS, 공식 Node 실행기 포함, SHA256 검증)
```

설계 문서: [docs/superpowers/specs/](docs/superpowers/specs/)
