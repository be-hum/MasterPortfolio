# 벤더 약관 조사: 구독 계정 + 공식 CLI + ACP 구동 (Task 0.3)

조사일: 2026-11-24 (모든 URL 접근일 동일). **이 문서는 법률 자문이 아니다.** 공개 문서를 읽고 정리한 것이며, 약관은 수시로 바뀌고 해석 여지가 있다. 출시 전 변호사 검토 또는 벤더 확인을 권장한다.

## 0. 우리 사용 방식과 핵심 구분

- (a) 서드파티 앱이 사용자의 구독 OAuth 토큰을 직접 얻거나 프록시/중계하는 방식: 벤더들이 명시적으로 제한하거나 계정 정지까지 한다.
- (b) 서드파티 클라이언트가 사용자가 이미 설치하고 로그인한 **벤더 공식 CLI를 수정 없이 실행**하고 ACP로 통신하는 방식: 우리가 하려는 것. 토큰은 CLI가 자체 보관하며 우리는 읽지 않는다.
- 전제(제품 설계 요건): 인증 파일/토큰 읽기·복사·전송 금지, 공식 CLI 바이너리 비수정, 로그인은 항상 벤더 자체 흐름, 운영자 서버 경유 없음, 사용자 본인 기기에서 본인 계정으로만 사용.

한계: 어느 벤더도 "ACP 클라이언트가 공식 CLI를 구동하는 것"을 직접 다루는 조항을 (조사 범위 내에서) 찾지 못했다. 아래 판정은 인접 조항에서의 추론이다.

## 1. Anthropic (Claude Code)

### 1.1 인용

출처 A: https://code.claude.com/docs/en/legal-and-compliance (접근 2026-11-24)

- "Consumer Terms of Service - for Free, Pro, Max, and Ultra users"
- "Advertised usage limits for Pro, Max, and Ultra plans assume ordinary, individual usage of Claude Code and the Agent SDK."
- "OAuth authentication is intended exclusively for purchasers of Claude Free, Pro, Max, Ultra, Team, and Enterprise subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications."
- "Developers building products or services that interact with Claude's capabilities, including those using the Agent SDK, should use API key authentication through Claude Console or a supported cloud provider. Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, Max, or Ultra plan credentials on behalf of their users. Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow."
- "Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code as described under 'Can customers offer Claude Code in their products?' above."
- "The Claude Code binary must not be modified. ... customers may not remove, disable, or restrict any authentication method built into it (including methods that permit signing in with a Claude account or the user's own API key)."
- "Customers may not pay for, resell, or intermediate Claude usage on their end users' behalf. Each end user must authenticate with their own Anthropic API key, Claude subscription plan credentials, or 3P inference provider credential."
- "Anthropic reserves the right to take measures to enforce these restrictions and may do so without prior notice."

출처 B: https://www.anthropic.com/legal/consumer-terms (한국어판을 가져옴, 접근 2026-11-24; 영어 원문은 이 조사에서 직접 확인하지 못함)

- 제3조 7항(자동화 접근): "귀하가 Anthropic API 키를 통해 당사 서비스에 접속하거나 당사가 이를 명시적으로 허용하는 경우를 제외하고" (봇·스크립트 등 비인간 수단 접근 금지의 예외 문구. 영어 원문의 일반적 표현은 "Except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it, to access the Services through automated or non-human means" 로 알려져 있으나 미검증.)
- 제4조(자료 사용): "귀하가 계정 설정을 통해 학습을 거부(opt-out)하지 않는 한" 모델 학습에 사용될 수 있음.
- 제2조: "귀하는 귀하의 계정 로그인 정보, Anthropic API 키 또는 계정 자격증명(credentials)을 타인과 공유하거나 ... 수 없습니다."
- 제12조: Anthropic은 "용량 제한을 늘리거나 줄이거나" 할 수 있음.

출처 C: https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan (접근 2026-11-24, 마지막 갱신 2026-10-07로 표기)

- "the Claude Agent SDK and `claude -p` still draw from your subscription limits." (플랜 로그인 시)
- "We've paused the previously-announced changes to Claude Agent SDK usage." (2026-06-15)
- 2026-06-15 갱신: "third-party app usage still draw from your subscription limits."

출처 D (Zed 블로그, 2차 맥락 성격이지만 벤더 발표를 인용): https://zed.dev/blog/anthropic-subscription-changes (접근 2026-11-24)

- 2026-05-14 원안: 6/15부터 "anything running through ACP, `claude -p`, or other third-party tools" 사용량을 구독 한도에서 분리하고 월 Agent SDK 크레딧(Pro $20 / Max5x $100 / Max20x $200)으로 청구하겠다는 계획.
- 2026-06-16 갱신: "Anthropic has told subscribers that the billing change described below is not taking effect yet." / "continue to work with Claude subscriptions exactly as they did before." / "will share advance notice before any future change takes effect."

### 1.2 분석

- (a) 유형은 명시 금지: 로그인 제공, 구독 자격증명 경유, 토큰 수집/저장/중계 금지. 우리는 하지 않음.
- (b) 유형은 문서가 오히려 허용 쪽: "an end user from signing in to the unmodified Claude Code binary with their own Claude subscription"을 막지 않는다고 명시. 단 그 문구는 "플랫폼이 Claude Code를 호스팅하는 경우" 맥락이며 ACP 로컬 구동을 직접 지칭하지는 않는다.
- 위험 지점 1: 소비자 약관의 "비인간 수단/스크립트" 금지 조항. "명시적으로 허용하는 경우" 예외가 있고, 위 문서들이 Claude Code 및 Agent SDK 로그인 사용을 한도 내 허용함을 시사하나, 우리 용도(분석 자동화 일괄 실행)가 "ordinary, individual usage"에 해당하는지는 불명확. 과도한 자동 대량 실행은 위험.
- 위험 지점 2: 사용 한도/과금 정책이 변동 중(6월 원안 보류, 10월 크레딧 추가). 재개 시 ACP 경유 사용이 별도 풀로 분리될 수 있음. 정책 위반이 아니라 비용/한도 변화.
- 위험 지점 3: Zed가 사용하는 ACP 어댑터가 Agent SDK 기반이면 Anthropic은 "Developers ... including those using the Agent SDK, should use API key authentication"이라 안내한다. 즉 **Agent SDK를 포함한 어댑터를 우리가 번들/구동하는 경우** 위 문구에 걸릴 수 있다. 공식 `claude` 바이너리를 직접 구동하는 경로와 SDK 어댑터 경유 경로를 구분해야 한다(미확인 사항).
- 구독 vs API: 구독은 위 소비자 약관 + 한도, API 키는 Commercial Terms. 학습: 소비자 약관은 opt-out 하지 않으면 학습 사용 가능(사용자 문서 민감도 관련), API(상용)는 별도.
- 판정: **불명확 (허용 쪽에 가까움)**.

## 2. OpenAI (Codex CLI)

### 2.1 인용

출처 A: https://developers.openai.com/codex/auth (→ https://learn.chatgpt.com/docs/auth 로 리다이렉트, 접근 2026-11-24)

- "Sign in with ChatGPT for subscription access" / "Sign in with an API key for usage-based access."
- "When you sign in with ChatGPT, Codex usage follows your ChatGPT workspace permissions, role-based access control (RBAC)," ... "With an API key, usage follows your API organization's retention and data-sharing settings instead."
- "Use API key authentication for programmatic Codex CLI workflows, such as CI/CD jobs."
- "API keys are still the recommended default for automation."
- "Access tokens are intended for trusted scripts, schedulers, and private CI runners."
- "Don't expose Codex execution in untrusted or public environments."
- 이 페이지는 구체적 사용 한도 수치를 명시하지 않음.

출처 B: https://github.com/openai/codex/blob/main/README.md (접근 2026-11-24)

- "We recommend signing into your ChatGPT account to use Codex as part of your Plus, Pro, Business, Edu, or Enterprise plan."
- "This repository is licensed under the Apache-2.0 License" (ACP 언급 없음)

출처 C: https://openai.com/policies/terms-of-use/ (접근 2026-11-24)

- "You may not share your account credentials or make your account available to anyone else"
- "Automatically or programmatically extract data or Output (defined below)."
- "Use Output to develop models that compete with OpenAI."
- "We may use Content to provide, maintain, develop, and improve our Services" / "If you do not want us to use your Content to train our models, you can opt out by following the instructions"

출처 D (Zed 블로그, 벤더 입장 아님): https://zed.dev/blog/codex-is-live-in-zed 및 https://zed.dev/docs/ai/external-agents

- "the billing and legal/terms arrangement is directly between you and OpenAI"; "Codex owns its own authentication and billing."; "Codex may support ChatGPT login, Codex API keys, OpenAI API keys, or Codex-native configuration".
- OpenAI의 승인/보증 문구는 확인되지 않음.

### 2.2 분석

- Codex CLI 자체가 ChatGPT 구독 로그인을 공식 지원하며 Apache-2.0 오픈소스. Zed가 codex-acp로 ChatGPT 로그인을 사용 가능하게 했고 OpenAI가 이를 막았다는 증거는 못 찾음(침묵은 허용 증거가 아님).
- 위험: (1) "programmatically extract" 조항의 해석. 코딩 에이전트 정상 사용은 해당하지 않는다고 보는 것이 자연스러우나 자동화 일괄 사용 시 모호. (2) 자동화는 API 키 권장이라는 가이드. 구독은 "interactive" 용도를 기본 전제로 하는 뉘앙스. (3) 토큰을 우리가 읽거나 복사하면 자격증명 공유 조항 및 비공식 사용 위험. 공식 CLI에 맡기면 해당 없음.
- 한도/요율: 구독 플랜 한도는 플랜별이며 변경 가능(본 조사에서 수치 미확인).
- 판정: **불명확 (허용 쪽에 가까움)**. 명시적 금지 문구는 발견되지 않음.

## 3. Google (Gemini CLI)

### 3.1 인용

출처 A: https://geminicli.com/docs/resources/tos-privacy/ 및 https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/resources/tos-privacy.md (접근 2026-11-24; 도구가 발췌 형태로 반환하여 짧은 구절만 인용)

- 제3자 소프트웨어: "Directly accessing the services powering Gemini CLI" 를 "third-party software, tools, or services" 로 하는 것(문서의 예: OpenClaw + Gemini CLI OAuth)은 "is a violation of applicable terms and policies." 그리고 "may be grounds for suspension or termination of your account."
- Google 계정 로그인: Gemini Code Assist 개인용 약관/개인정보 고지 적용. Google AI Pro/Ultra 구독 시 "Google One Additional Terms of Service"와 Google Privacy Policy도 적용. 조직 관리 계정은 관리자가 제한 가능.
- Gemini Developer API 키: "Your use of Gemini CLI is governed by the Gemini API Terms of Service." 무료/유료에 따라 약관이 다름. Vertex AI: Google Cloud Platform Service Terms.
- "Your Gemini CLI Usage Statistics are handled in accordance with Google's Privacy Policy." 통계 전송 opt-out 가능.
- 이 페이지는 학습 사용 여부를 직접 말하지 않고 각 개인정보 고지로 링크함(무료 개인 플랜이 학습에 사용될 수 있는지는 링크된 고지에서 별도 확인 필요, 미확인). 한도 수치는 쿼터 문서 참조.

출처 B: https://zed.dev/docs/ai/external-agents (접근 2026-11-24)

- "Gemini CLI owns its own authentication and may prompt you to log in with Google," (Zed 문서는 구독에 대해 직접 언급하지 않음)

2차 맥락(비공식, 포럼/언론): https://discuss.ai.google.dev 의 "Mass 403 ToS bans ... OpenClaw" 스레드들, https://gigazine.net/gsc_news/en/20260224-google-gemini-openclaw-accounts-banned , PCWorld. 내용: OpenClaw가 설치된 Gemini CLI에서 OAuth 자격증명을 추출해 구독 보조 토큰을 쓴 사용자들이 Google 계정/서비스 정지(Antigravity, Gemini CLI, 일부는 Gmail/Workspace까지)를 당했다는 보고. 대부분 사용자 일화이며 Google의 공식 설명은 확인 못함.

### 3.2 분석

- 공식 문서가 (a) 유형(서드파티가 서비스에 직접 접근)을 명시 위반으로 규정하고 실제 집행 정황(2차 자료)이 있다. 경계: 우리가 공식 `gemini` CLI를 그대로 실행하고 그 CLI가 서비스에 접근하는 (b) 유형은 문장상 "Directly accessing"에 해당하지 않으나, 정지 사례가 "자격증명 추출" 방식이었는지 "프로세스 구동" 방식이었는지 구분이 완전히 입증되지는 않았다. Gemini CLI는 자체 ACP 모드(`--experimental-acp`)를 제공하고 Zed가 공식 파트너로 소개한 점은 (b)를 지지하는 맥락(본 조사에서 1차 인용 미확보, 확인 필요).
- 위험: 집행이 자동화/대량 사용 패턴 탐지에 기반하면 오탐 가능. 계정 정지는 Google 계정 전체에 영향을 줄 수 있어 사용자 피해가 크다(고지 필요).
- 판정: **불명확 (3사 중 가장 위험)**. 공식 CLI 구동은 문언상 금지가 아니지만 집행 사례가 있어 경고 필수. API 키 사용 경로를 대안으로 제공 권장.

## 4. ACP 관련 공식 입장

- ACP는 Zed 주도 오픈 프로토콜. https://zed.dev/docs/ai/external-agents : "External Agents are agents that integrate with Zed through the Agent Client Protocol (ACP)." / "Zed does not charge for External Agents." / "Claude Agent owns its own authentication and billing."
- 위 문서들은 Zed 측 설명이며 Anthropic/OpenAI/Google의 ACP 클라이언트 허용 선언은 아님. 단 Anthropic의 6월 계획(ACP 명시 언급)은 오히려 Anthropic이 ACP 경유 사용을 인지하고 있으며 현재(2026-10 기준) 구독 한도 내 사용으로 취급함을 보여준다.

## 5. 요약 표

| 벤더 | 판정 | 핵심 인용 | 판정을 바꿀 요인 |
|---|---|---|---|
| Anthropic (Claude Code) | 불명확 (허용 쪽) | "Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription" / 단, "Developers ... including those using the Agent SDK, should use API key authentication" (https://code.claude.com/docs/en/legal-and-compliance) | 6월 보류된 "ACP/claude -p를 별도 크레딧 풀로 분리" 정책 재개(비용 변화); Agent SDK 기반 어댑터 번들 시 금지 해석 가능; 소비자 약관 자동화 접근 조항의 집행 변화; Anthropic의 명시적 허용 서면 확인 시 "허용" |
| OpenAI (Codex CLI) | 불명확 (허용 쪽) | "Sign in with ChatGPT for subscription access" / "API keys are still the recommended default for automation." (https://developers.openai.com/codex/auth) | 약관의 "programmatically extract" 적용 확대 또는 서드파티 구독 사용 제한 발표 시 "금지"; OpenAI의 ACP/서드파티 클라이언트 허용 공식 문구 확인 시 "허용" |
| Google (Gemini CLI) | 불명확 (위험 높음) | "Directly accessing the services powering Gemini CLI ... using third-party software ... is a violation of applicable terms and policies." (https://geminicli.com/docs/resources/tos-privacy/) | 공식 CLI 구동 사용자에게도 정지가 확인되면 "금지"(v1 제외); Google의 ACP/서드파티 클라이언트 구동 허용 공식 확인 시 "허용" |

"금지" 판정은 없으므로 브리프 규칙상 v1에서 제외되는 에이전트는 없다. 다만 Gemini는 기본 비활성 또는 강한 경고, API 키 경로 병행을 권장한다.

## 6. 구현상 권고 (약관 위험 완화)

1. 인증 토큰/자격증명 파일을 읽거나 복사·전송하지 않는다. 로그인은 사용자가 벤더 CLI에서 직접 수행.
2. 공식 CLI 바이너리를 수정하지 않고 그대로 실행하며 인증 방식을 제한하지 않는다.
3. Agent SDK 기반 어댑터를 쓰는 경우(Claude) 위험이 늘 수 있으므로 공식 `claude` 직접 구동 가능 여부를 M0에서 확인.
4. 대량/고빈도 자동 실행을 피하고 사용자 주도 실행, 속도 제한을 둔다.
5. API 키 인증 대안을 모든 에이전트에 제공한다.
6. "Claude Code", "Codex", "Gemini" 명칭은 평문 사실 서술로만 사용하고 로고/제휴 암시 금지(Anthropic 문서의 상표 조항).
7. 분기마다 이 문서의 URL을 재확인한다.

## 7. 데이터/학습 관련 주의

- 사용자의 포트폴리오 문서가 벤더 서버로 전송된다(운영자 서버는 아니나 벤더로는 간다). 구독 계정은 계정 설정에 따라 학습 사용 가능성이 있다(Anthropic 소비자 약관은 opt-out 방식, OpenAI도 opt-out 방식, Google은 플랜별 고지 확인 필요). API 키 경로는 일반적으로 학습 제외이나 각 벤더 약관 확인 필요.

## 8. 사용자 대상 고지 문구 (한국어, 초안)

> 이 도구는 사용자가 직접 설치하고 로그인한 Claude Code, Codex CLI, Gemini CLI를 사용자의 컴퓨터에서 그대로 실행하여 분석을 수행합니다. 로그인 정보와 문서는 운영자에게 전송되지 않으며 운영자는 어떠한 API 비용도 부담하지 않습니다. 다만 분석 내용은 사용자가 선택한 AI 서비스 제공사로 전송되고, 해당 사의 약관, 사용 한도, 데이터 학습 설정(옵트아웃 여부)이 적용됩니다. 각 제공사는 구독 계정의 자동화·서드파티 이용에 대한 정책을 변경할 수 있으며, 특히 정책 위반으로 판단될 경우 계정 사용 제한이 있을 수 있으므로(과거 일부 서드파티 도구 사용자에게 계정 정지 사례가 보고됨) 본인의 구독 약관을 확인한 후 사용하십시오. 이 도구는 제공사와 제휴하거나 승인받은 것이 아니며, 본 안내는 법률 자문이 아닙니다. 걱정되면 API 키 방식으로 사용할 수 있습니다.
