import { resolveOutputDir } from "../core/paths.js";
import { checkEnvironment } from "../setup/check.js";

export async function runDoctor(opts: { skipAgent?: boolean }): Promise<number> {
  const items = await checkEnvironment(await resolveOutputDir(), opts);
  let fail = 0;
  for (const it of items) {
    if (it.ok) console.log(`✔ ${it.label}`);
    else if (it.warn) console.log(it.label.startsWith("git") ? `! ${it.label}` : `ℹ ${it.label.replace("\n", "\n  ")}`);
    else { fail++; console.log(`✘ ${it.label}\n   → ${it.fix}`); }
  }
  // 설정이 없거나 읽을 수 없으면 "문제 n개" 요약 없이 바로 끝낸다(기존 동작)
  if (items.some((i) => !i.ok && !i.warn && /^(설정 없음|설정 파일을 읽을 수 없음)/.test(i.label))) return 1;
  console.log(fail ? `\n문제 ${fail}개` : "\n모든 점검 통과");
  return fail ? 1 : 0;
}
