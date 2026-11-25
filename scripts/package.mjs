#!/usr/bin/env node
// MasterPortfolio 배포 묶음 만들기(Linux·macOS 빌드 머신에서 실행).
//   node scripts/package.mjs [win-x64|mac-arm64|mac-x64|all]   (기본 all)
// 결과: release/MasterPortfolio-<버전>-<대상>.zip
//   묶음 = 공식 Node 실행기(runtime/) + 앱(app/: dist, data, 운영 의존성) + 실행·설치 스크립트 + 안내문
// 필요한 도구: npm, curl, tar, unzip, zip
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NODE_VERSION = "24.14.1";
const REL = join(ROOT, "release");
const CACHE = join(REL, "cache");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

const TARGETS = {
  "win-x64": { os: "windows", archive: `node-v${NODE_VERSION}-win-x64.zip`, npmOs: "win32", npmCpu: "x64" },
  "mac-arm64": { os: "macos", archive: `node-v${NODE_VERSION}-darwin-arm64.tar.gz`, npmOs: "darwin", npmCpu: "arm64" },
  "mac-x64": { os: "macos", archive: `node-v${NODE_VERSION}-darwin-x64.tar.gz`, npmOs: "darwin", npmCpu: "x64" },
};

const run = (cmd, args, cwd = ROOT) => execFileSync(cmd, args, { cwd, stdio: "inherit" });
const log = (m) => console.log(`\n▶ ${m}`);

function nodeShasums() {
  const p = join(CACHE, `SHASUMS256-${NODE_VERSION}.txt`);
  if (!existsSync(p)) run("curl", ["-fsSL", "-o", p, `https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt`]);
  return new Map(readFileSync(p, "utf8").trim().split("\n").map((l) => { const [h, f] = l.trim().split(/\s+/); return [f, h]; }));
}

function fetchNode(archive, sums) {
  const p = join(CACHE, archive);
  if (!existsSync(p)) run("curl", ["-fL", "--progress-bar", "-o", p, `https://nodejs.org/dist/v${NODE_VERSION}/${archive}`]);
  const want = sums.get(archive);
  const got = createHash("sha256").update(readFileSync(p)).digest("hex");
  if (!want || want !== got) { rmSync(p, { force: true }); throw new Error(`SHA256 불일치: ${archive}`); }
  return p;
}

/** 대상 OS·CPU용 운영 의존성을 담은 앱 폴더. pdfjs-dist의 선택 의존성(@napi-rs/canvas)은 OS별 네이티브 바이너리라 대상별로 설치한다 */
function stageApp(target) {
  const t = TARGETS[target];
  const app = join(REL, "stage", `app-${target}`);
  rmSync(app, { recursive: true, force: true });
  mkdirSync(app, { recursive: true });
  for (const f of ["dist", "data", "package.json", "package-lock.json"]) cpSync(join(ROOT, f), join(app, f), { recursive: true });
  log(`운영 의존성 설치(${t.npmOs}/${t.npmCpu})`);
  // --omit=optional: pdfjs-dist의 @napi-rs/canvas(렌더링용 네이티브, 약 39MB)는 텍스트 추출에 필요 없다
  run("npm", ["ci", "--omit=dev", "--omit=optional", "--ignore-scripts", "--no-audit", "--no-fund", `--os=${t.npmOs}`, `--cpu=${t.npmCpu}`], app);
  pruneApp(join(app, "node_modules"));
  return app;
}

/** 실행에 필요 없는 파일을 지운다: 소스맵·타입 선언·@types, pdfjs의 쓰지 않는 빌드(앱은 legacy/build/pdf.mjs + pdf.worker.mjs만 씀) */
function pruneApp(nm) {
  const before = dirSize(nm);
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(map|d\.ts|d\.mts|d\.cts|tsbuildinfo)$/.test(e.name) || /^(README|CHANGELOG|HISTORY)(\.md)?$/i.test(e.name)) rmSync(p);
    }
  };
  walk(nm);
  rmSync(join(nm, "@types"), { recursive: true, force: true });
  // .bin은 명령줄 단축용 심볼릭 링크라 실행에 필요 없고, Windows 압축 해제에서 "심볼릭 링크를 생성할 수 없습니다" 오류를 낸다
  rmSync(join(nm, ".bin"), { recursive: true, force: true });
  const pdfjs = join(nm, "pdfjs-dist");
  for (const x of ["build", "web", "types", "image_decoders", "legacy/web", "legacy/image_decoders", "legacy/webpack.mjs"]) rmSync(join(pdfjs, x), { recursive: true, force: true });
  for (const f of readdirSync(join(pdfjs, "legacy", "build"))) if (!["pdf.mjs", "pdf.worker.mjs"].includes(f)) rmSync(join(pdfjs, "legacy", "build", f));
  console.log(`  정리: ${mb(before)} → ${mb(dirSize(nm))}`);
}
const dirSize = (d) => readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? dirSize(join(d, e.name)) : e.isFile() ? statSync(join(d, e.name)).size : 0), 0);
const mb = (b) => `${(b / 1048576).toFixed(1)}MB`;
const findSymlinks = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => {
  const p = join(d, e.name);
  if (lstatSync(p).isSymbolicLink()) return [p];
  return e.isDirectory() ? findSymlinks(p) : [];
});

function extractRuntime(target, archivePath, dest) {
  const tmp = join(REL, "stage", `rt-${target}`);
  rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true });
  if (archivePath.endsWith(".zip")) run("unzip", ["-q", archivePath, "-d", tmp]);
  else run("tar", ["-xzf", archivePath, "-C", tmp]);
  const [inner] = readdirSync(tmp);
  renameSync(join(tmp, inner), dest);
  // 문서·헤더·corepack은 실행에 필요 없다(npm은 Claude 연결 어댑터를 npx로 받을 때 필요)
  for (const x of ["include", "share", "CHANGELOG.md", "README.md", "corepack", "corepack.cmd", "node_modules/corepack", "bin/corepack", "lib/node_modules/corepack"]) rmSync(join(dest, x), { recursive: true, force: true });
}

function build(target, sums) {
  const app = stageApp(target);
  const t = TARGETS[target];
  log(`${target} 묶음`);
  const base = join(REL, `MasterPortfolio-${target}`);
  const dir = join(base, "MasterPortfolio");
  rmSync(base, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  extractRuntime(target, fetchNode(t.archive, sums), join(dir, "runtime"));
  cpSync(app, join(dir, "app"), { recursive: true });
  cpSync(join(ROOT, "packaging", t.os), dir, { recursive: true });
  if (t.os === "windows") cpSync(join(ROOT, "packaging", "assets", "MasterPortfolio.ico"), join(dir, "MasterPortfolio.ico"));
  else {
    cpSync(join(ROOT, "packaging", "assets", "MasterPortfolio.png"), join(dir, "MasterPortfolio.png"));
    chmodSync(join(dir, "MasterPortfolio.command"), 0o755);
    chmodSync(join(dir, "runtime", "bin", "node"), 0o755);
  }
  writeFileSync(join(dir, "VERSION.txt"), `MasterPortfolio ${pkg.version}\nNode.js ${NODE_VERSION} (${target})\n`);
  const zip = join(REL, `MasterPortfolio-${pkg.version}-${target}.zip`);
  rmSync(zip, { force: true });
  if (t.os === "windows") {
    // Windows는 일반 권한으로 심볼릭 링크를 만들 수 없다. 링크가 하나라도 있으면 묶지 않는다
    const links = findSymlinks(dir);
    if (links.length) throw new Error(`Windows 묶음에 심볼릭 링크가 있습니다: ${links.slice(0, 5).join(", ")}`);
    run("zip", ["-qr", "-X", zip, "MasterPortfolio"], base);
  } else {
    // -y: 심볼릭 링크 유지(macOS runtime/bin/npx·npm), 실행 권한은 zip이 그대로 기록한다
    run("zip", ["-qry", "-X", zip, "MasterPortfolio"], base);
  }
  console.log(`  → ${zip}`);
}

const want = process.argv[2] ?? "all";
const targets = want === "all" ? Object.keys(TARGETS) : [want];
for (const t of targets) if (!TARGETS[t]) { console.error(`알 수 없는 대상: ${t} (가능: ${Object.keys(TARGETS).join(", ")}, all)`); process.exit(2); }
mkdirSync(CACHE, { recursive: true });
const sums = nodeShasums();
log("빌드(tsc)");
run("npm", ["run", "build"]);
rmSync(join(REL, "stage"), { recursive: true, force: true });
for (const t of targets) build(t, sums);
rmSync(join(REL, "stage"), { recursive: true, force: true });
log("완료");
