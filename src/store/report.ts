import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

export type ScanReport = {
  startedAt: string; created: string[]; changed: string[];
  skippedSensitive: { path: string; reason: string }[]; skippedLarge: { path: string; size: number }[];
  skippedLong: { path: string; chars: number }[]; extractFailed: { path: string; reason: string }[];
  analysisFailed: string[]; inaccessible: string[]; unsupported: number; stoppedReason: string | null;
  /** 이미 카드가 있는 파일의 사본(새 경로) — 다시 분석하지 않음 */
  knownDuplicates?: { path: string; card: string }[];
  /** 2단계(판정) 결과 (9.6). judged: 이번 스캔에서 판정한 카드 수, unjudged: 남은 미판정 카드 수 */
  judgement?: { judged: number; unjudged: number; skippedEdited: string[] };
  /** 생성물로 보여 순회에서 제외한 폴더·파일 수 (9.7 B) */
  generatedExcluded?: number;
  /** 0단계(선별)에서 drop된 파일 (9.7 E) */
  skippedIrrelevant?: string[];
  /** 폴더 범위(5.5): 이번 실행의 포함·제외·나중에 수와 새로 판단한 폴더 */
  scope?: { included: number; excluded: number; later: number; decided: { path: string; decision: "include" | "exclude"; by: "llm" | "user" }[] };
  /** 사용량(9.8): 단계별 토큰 합계, 5시간 창 사용률(못 받았으면 null) */
  usage?: {
    tokens: Record<string, { inputTokens: number; outputTokens: number; cachedReadTokens: number; cachedWriteTokens: number; totalTokens: number }>;
    share: number;
    /** 요금제 배수(planScale). 1보다 크면 Pro 기준 환산을 함께 적는다 */
    scale?: number;
    fiveHour: { start: number; last: number; spent: number; resetsAt: number | null } | null;
  };
};

const p1 = (x: number) => `${Math.round(x * 1000) / 10}`;
function usageLines(u: NonNullable<ScanReport["usage"]>): string[] {
  const stages = Object.entries(u.tokens);
  if (!stages.length && !u.fiveHour) return [];
  const n = (x: number) => x.toLocaleString("en-US");
  return [
    "## 사용량", "",
    ...stages.map(([st, t]) => `- ${st}: 입력 ${n(t.inputTokens)} / 출력 ${n(t.outputTokens)} / 캐시 읽기 ${n(t.cachedReadTokens)} / 캐시 쓰기 ${n(t.cachedWriteTokens)} (합계 ${n(t.totalTokens)}) 토큰`),
    u.fiveHour
      ? `- 5시간 사용률: ${p1(u.fiveHour.start)}% → ${p1(u.fiveHour.last)}% (이번 실행 +${p1(u.fiveHour.spent)}%p, 예산 ${p1(u.share)}%p)`
        + ((u.scale ?? 1) > 1 ? ` · Pro 기준(×${u.scale}): +${p1(u.fiveHour.spent * u.scale!)}%p / 예산 ${p1(u.share * u.scale!)}%p` : "")
      : "- 5시간 사용률: 정보 없음 (예산 미적용)",
    "",
  ];
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)}MB`;
const one = (s: string) => s.replace(/\r?\n|\r/g, " ");
const base = (p: string) => one(basename(p.replace(/\\/g, "/"))).replace(/`/g, "\\`");

export async function writeScanReport(outputDir: string, r: ScanReport): Promise<string> {
  const m = r.startedAt.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  const stamp = m ? `${m[1]}-${m[2]}${m[3]}` : r.startedAt.replace(/[^\dA-Za-z]+/g, "-");
  const sec = (title: string, items: string[]) => (items.length ? [`## ${title} (${items.length})`, "", ...items, ""] : []);
  const lines = [
    `# 스캔 보고서 ${r.startedAt}`, "",
    ...(r.stoppedReason ? [`> 중단됨: ${r.stoppedReason}`, ""] : []),
    ...(r.judgement ? [`판정 완료 ${r.judgement.judged} / 미판정 ${r.judgement.unjudged}`, ""] : []),
    ...(r.scope ? [`폴더 범위: 포함 ${r.scope.included}, 제외 ${r.scope.excluded}, 나중에 ${r.scope.later}`, ""] : []),
    ...(r.usage ? usageLines(r.usage) : []),
    ...sec("이번에 새로 판단한 폴더", (r.scope?.decided ?? []).map((d) => `- ${one(d.path)} — ${d.decision === "include" ? "포함" : "제외"} (${d.by === "user" ? "사용자" : "LLM"})`)),
    ...sec("신규 카드", r.created.map((c) => `- [${c}](../${encodeURI(c)})`)),
    ...sec("편집된 카드라 판정 생략", (r.judgement?.skippedEdited ?? []).map((c) => `- [${c}](../${encodeURI(c)})`)),
    ...sec("원본 변경 — 다음 버전에서 `mp rescan`으로 다시 처리 예정", r.changed.map((p) => `- ${one(p)}`)),
    ...sec("이미 분석된 파일의 사본 (건너뜀)", (r.knownDuplicates ?? []).map((d) => `- ${one(d.path)} — [${d.card}](../${encodeURI(d.card)})`)),
    ...sec("선별 단계에서 제외", (r.skippedIrrelevant ?? []).map((p) => `- ${one(p)}`)),
    ...sec("민감 파일로 건너뜀", r.skippedSensitive.map((s) => `- ${one(s.path)} — ${one(s.reason)}`)),
    ...sec("크기 초과(50MB)로 건너뜀", r.skippedLarge.map((s) => `- \`${base(s.path)}\` — ${one(s.path)} (${mb(s.size)})`)),
    ...sec("텍스트 길이 초과(30,000자)로 건너뜀", r.skippedLong.map((s) => `- \`${base(s.path)}\` — ${one(s.path)} (${s.chars.toLocaleString("en-US")}자)`)),
    ...sec("추출 실패", r.extractFailed.map((s) => `- ${one(s.path)} — ${one(s.reason)}`)),
    ...sec("분석 실패", r.analysisFailed.map((p) => `- ${one(p)}`)),
    ...sec("접근 불가", r.inaccessible.map((p) => `- ${one(p)}`)),
    `미지원 형식: ${r.unsupported}개`, "",
    ...(r.generatedExcluded ? [`생성물로 보여 제외 ${r.generatedExcluded}개`, ""] : []),
  ];
  await mkdir(join(outputDir, "reports"), { recursive: true });
  let rel = `reports/scan-${stamp}.md`, n = 2;
  for (;;) {
    try { await writeFile(join(outputDir, rel), lines.join("\n"), { flag: "wx" }); return rel; }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      rel = `reports/scan-${stamp}-${n++}.md`;
    }
  }
}
