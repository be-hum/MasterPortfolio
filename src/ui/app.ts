import { LOGIC_JS } from "./appLogic.js";
import { SETUP_CSS, SETUP_JS } from "./appSetup.js";
import type { UiExperience } from "./model.js";

export type AppOptions = { mode: "live"; token: string } | { mode: "static"; data: UiExperience[]; generatedAt: string };

/** <script> 안에 넣어도 안전한 JSON: </script>·<!-- 방지(<), JS 줄 구분자(U+2028/2029) 이스케이프 */
export const safeJson = (v: unknown): string =>
  JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

const CSS = `
:root{
--bg:#f6f7f9;--surface:#fff;--surface-2:#f1f3f6;--surface-3:#e8ebf0;
--ink:#191c21;--ink-2:#434b57;--ink-3:#5d6673;--line:#e3e6eb;--line-2:#d2d7de;
--accent:#2b56c9;--accent-ink:#fff;--accent-soft:#e8eefc;--accent-soft-ink:#1e44a6;--sel:#eef3fe;
--s-adopted:#1e9e5a;--s-held:#dc9d00;--s-excluded:#a1a8b1;--s-pending:#2f6fe0;
--c-direct:#16764b;--c-relearn:#0b6a7a;--c-assist:#2b56c9;--c-ai:#6f41bb;--c-concept:#8d5509;--c-none:#5d6673;
--warn-bg:#fff5dc;--warn-ink:#6b4800;--ok:#16764b;--danger:#b42318;
--shadow:0 1px 2px rgba(16,24,40,.06),0 12px 32px rgba(16,24,40,.12);
color-scheme:light}
@media (prefers-color-scheme:dark){:root{
--bg:#0f1216;--surface:#171a20;--surface-2:#1f242b;--surface-3:#2a3039;
--ink:#e6e9ed;--ink-2:#bac1cb;--ink-3:#97a0ad;--line:#272d35;--line-2:#363d48;
--accent:#88a8ff;--accent-ink:#0d1117;--accent-soft:#1f2a46;--accent-soft-ink:#bccdff;--sel:#1a2233;
--s-adopted:#3ec07a;--s-held:#f0bb3a;--s-excluded:#6c747f;--s-pending:#6f9bff;
--c-direct:#62d39d;--c-relearn:#5ccad9;--c-assist:#90aeff;--c-ai:#bb9aff;--c-concept:#e5b062;--c-none:#97a0ad;
--warn-bg:#3a2e12;--warn-ink:#f5d38a;--ok:#62d39d;--danger:#ff8f86;
--shadow:0 1px 2px rgba(0,0,0,.4),0 12px 32px rgba(0,0,0,.5);
color-scheme:dark}}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{transition:none!important;animation:none!important}}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.55 "Pretendard","Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
button,input,select,textarea{font:inherit;color:inherit}
button{cursor:pointer}
button:disabled{cursor:not-allowed;opacity:.5}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.grow{flex:1}
.muted{color:var(--ink-3)}
.small{font-size:12px}

/* 레이아웃 */
.app{display:grid;grid-template-columns:240px minmax(0,1fr);min-height:100vh}
.side{position:sticky;top:0;height:100vh;overflow:auto;background:var(--surface);border-right:1px solid var(--line);padding:18px 14px 24px;display:flex;flex-direction:column}
.main{min-width:0;padding:0 28px 120px;transition:margin-right .2s ease}
@media (min-width:1180px){.app.panel-open .main{margin-right:440px}.app.panel-open .jobbar{right:440px}}

/* 사이드바 */
.brand{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;padding:0 4px 14px}
.brand-name{font-size:16px;font-weight:750;letter-spacing:-.01em}
.brand-sub{font-size:12px;color:var(--ink-3);margin-top:2px}
.brand .menu-btn{display:none}
.side-body{display:flex;flex-direction:column;gap:18px;flex:1}
.sec h3{margin:0 0 7px;padding:0 4px;font-size:11.5px;font-weight:700;color:var(--ink-3);letter-spacing:.04em}
.todo{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.todo-btn{display:flex;flex-direction:column;align-items:flex-start;gap:1px;padding:8px 9px;border:1px solid var(--line);border-radius:10px;background:var(--surface);text-align:left}
.todo-btn:hover{border-color:var(--line-2);background:var(--surface-2)}
.todo-btn.on{border-color:var(--accent);background:var(--accent-soft);color:var(--accent-soft-ink)}
.todo-n{font-size:18px;font-weight:750;line-height:1.1;font-variant-numeric:tabular-nums}
.todo-btn.zero .todo-n{color:var(--ink-3)}
.todo-l{font-size:11.5px;color:inherit;opacity:.9;white-space:nowrap}
.toc{display:flex;flex-direction:column;gap:1px}
.toc-a{display:flex;align-items:center;gap:8px;padding:6px 9px;border-radius:8px;color:var(--ink-2);text-decoration:none;font-size:13.5px}
.toc-a:hover{background:var(--surface-2);color:var(--ink)}
.toc-a.on{background:var(--accent-soft);color:var(--accent-soft-ink);font-weight:650}
.toc-l{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.toc-n{font-size:12px;color:var(--ink-3);font-variant-numeric:tabular-nums}
.toc-a.on .toc-n{color:inherit}
.seg{display:grid;grid-template-columns:1fr 1fr;background:var(--surface-2);border-radius:9px;padding:3px;gap:3px}
.seg button{border:0;background:transparent;border-radius:7px;padding:5px 0;font-size:13px;color:var(--ink-2)}
.seg button.on{background:var(--surface);color:var(--ink);font-weight:650;box-shadow:0 1px 2px rgba(16,24,40,.12)}
.fchips{display:flex;flex-wrap:wrap;gap:5px}
.fchips.dim{opacity:.55}
.fchip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);background:var(--surface);border-radius:999px;padding:3px 10px 3px 8px;font-size:12.5px;color:var(--ink-2)}
.fchip:hover{border-color:var(--line-2)}
.fchip.on{border-color:var(--accent);background:var(--accent-soft);color:var(--accent-soft-ink);font-weight:600}
.fchip .n{color:var(--ink-3);font-variant-numeric:tabular-nums;font-weight:400}
.fchip.on .n{color:inherit}
.sw{width:8px;height:8px;border-radius:2px;flex:none;background:var(--c-none)}
.note{margin:6px 4px 0;font-size:11.5px;color:var(--ink-3)}
.side-foot{margin:auto 4px 0;padding-top:16px;font-size:11.5px;color:var(--ink-3);overflow-wrap:anywhere}
.summary{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.stat{border:1px solid var(--line);border-radius:10px;padding:8px 10px}
.stat b{display:block;font-size:18px;line-height:1.15;font-variant-numeric:tabular-nums}
.stat span{font-size:11.5px;color:var(--ink-3)}
.bar{grid-column:1/-1;display:flex;height:8px;border-radius:4px;overflow:hidden;background:var(--surface-2)}
.bar i{display:block}

/* 상단 바 */
.topbar{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:12px;padding:14px 0 12px;background:var(--bg)}
.search{position:relative;flex:1;max-width:560px}
.search input{width:100%;height:36px;padding:0 34px 0 12px;border:1px solid var(--line-2);border-radius:10px;background:var(--surface);outline:0}
.search input:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.search kbd{position:absolute;right:9px;top:50%;transform:translateY(-50%);font:11px/1 ui-monospace,monospace;color:var(--ink-3);border:1px solid var(--line-2);border-radius:4px;padding:2px 5px;background:var(--surface-2)}
.tb-info{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--ink-3);white-space:nowrap;min-width:0}
.pill{display:inline-flex;align-items:center;gap:6px;border:0;background:var(--accent-soft);color:var(--accent-soft-ink);border-radius:999px;padding:3px 6px 3px 10px;font-size:12px;font-weight:600}
.pill span{font-size:14px;line-height:1;opacity:.8}
.linklike{border:0;background:none;padding:0;color:var(--accent);font-size:12.5px;text-decoration:underline;text-underline-offset:2px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 12px;border:1px solid var(--line-2);border-radius:8px;background:var(--surface);color:var(--ink);font-size:13px;white-space:nowrap}
.btn:hover:not(:disabled){border-color:var(--ink-3)}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink);font-weight:650}
.btn.primary:hover:not(:disabled){filter:brightness(1.07)}
.btn.ghost{border-color:transparent;background:transparent;color:var(--ink-2)}
.btn.ghost:hover:not(:disabled){background:var(--surface-2);border-color:transparent}
.btn.sm{height:28px;padding:0 10px;font-size:12.5px}
.topbar .btn{margin-left:auto}

/* 일괄 결정 */
.hintbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;margin:0 0 8px;padding:10px 12px;background:var(--warn-bg);color:var(--warn-ink);border-radius:10px;font-size:13px}
.hintbar p{margin:0;flex:1 1 280px}
.hintbar .hb-main{flex:1 1 320px;min-width:0}
.hintbar .hb-items{list-style:none;margin:6px 0 0;padding:0;display:grid;gap:4px}
.hintbar .ck-s{display:block;font:11.5px/1.45 ui-monospace,"D2Coding",Consolas,monospace;overflow-wrap:anywhere;opacity:.8}
.hintbar .hb-btns{display:flex;flex-wrap:wrap;gap:6px}
.bulk{position:sticky;top:62px;z-index:9;display:flex;align-items:center;gap:10px;margin:0 0 6px;padding:8px 12px;background:var(--surface);border:1px solid var(--line);border-radius:10px;box-shadow:0 1px 2px rgba(16,24,40,.05)}
.bulk[hidden]{display:none}
.bulk-all{display:inline-flex;align-items:center;gap:6px;font-size:13px}
.bulk-n{font-size:12.5px;color:var(--ink-3)}

/* 목록 */
.group{margin-top:18px;scroll-margin-top:68px}
.group:first-child{margin-top:4px}
.group h2{display:flex;align-items:center;gap:8px;margin:0 0 7px 2px;font-size:13px;font-weight:700;color:var(--ink-2)}
.count{font-size:11.5px;font-weight:600;color:var(--ink-3);background:var(--surface-3);border-radius:999px;padding:0 7px;line-height:18px}
.rows{list-style:none;margin:0;padding:0;background:var(--surface);border:1px solid var(--line);border-radius:12px;overflow:hidden}
.rw{display:flex;align-items:stretch;border-top:1px solid var(--line);scroll-margin:72px 0 96px}
.rw:first-child{border-top:0}
.pick{flex:none;align-self:center;width:16px;height:16px;margin:0 0 0 14px;accent-color:var(--accent)}
.row{flex:1;min-width:0;display:grid;grid-template-columns:8px minmax(0,1fr);column-gap:12px;align-items:center;min-height:56px;padding:7px 16px 7px 14px;border:0;background:none;text-align:left;color:inherit}
.row:hover{background:var(--surface-2)}
.row:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.rw.sel .row{background:var(--sel)}
.rw.open .row{box-shadow:inset 3px 0 0 var(--accent);background:var(--sel)}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;flex:none;background:var(--s-pending)}
.s-adopted.dot,.dot.s-adopted{background:var(--s-adopted)}.dot.s-held{background:var(--s-held)}.dot.s-excluded{background:var(--s-excluded)}.dot.s-pending{background:var(--s-pending)}
.rm{min-width:0}
.l1{display:flex;align-items:baseline;gap:8px;min-width:0}
.t{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14.5px;font-weight:650;letter-spacing:-.005em}
.rw.s-excluded .t{color:var(--ink-3);font-weight:500}
.flag{flex:none;font-size:11px;font-weight:600;color:var(--ink-3);border:1px solid var(--line-2);border-radius:5px;padding:0 5px;line-height:16px}
.flag.edited{color:var(--warn-ink);background:var(--warn-bg);border-color:transparent}
.p{flex:none;margin-left:auto;padding-left:8px;font-size:12.5px;color:var(--ink-3);font-variant-numeric:tabular-nums;white-space:nowrap}
.l2{display:flex;align-items:center;gap:5px;margin-top:4px;min-width:0;overflow:hidden;white-space:nowrap;-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 24px),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - 24px),transparent)}
.chip{display:inline-block;flex:none;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;height:20px;line-height:20px;padding:0 7px;border-radius:6px;font-size:12px}
.kw{background:var(--surface-3);color:var(--ink-2)}
.out{background:var(--accent-soft);color:var(--accent-soft-ink);font-weight:600}
.out.faded{background:transparent;color:var(--ink-3);font-weight:400;box-shadow:inset 0 0 0 1px var(--line-2)}
.l2 .muted{font-size:12px}
.badge{display:inline-block;flex:none;height:20px;line-height:18px;padding:0 6px;border-radius:6px;font-size:11.5px;font-weight:650;color:var(--c-none);border:1px solid color-mix(in srgb,currentColor 30%,transparent);background:color-mix(in srgb,currentColor 9%,transparent);white-space:nowrap}
.c-direct{color:var(--c-direct)}.c-relearn{color:var(--c-relearn)}.c-assist{color:var(--c-assist)}.c-ai{color:var(--c-ai)}.c-concept{color:var(--c-concept)}.c-none{color:var(--c-none)}
.sw.c-direct{background:var(--c-direct)}.sw.c-relearn{background:var(--c-relearn)}.sw.c-assist{background:var(--c-assist)}.sw.c-ai{background:var(--c-ai)}.sw.c-concept{background:var(--c-concept)}.sw.c-none{background:var(--c-none)}
.empty{margin-top:24px;padding:40px 24px;text-align:center;background:var(--surface);border:1px dashed var(--line-2);border-radius:12px;color:var(--ink-2)}
.empty h2{margin:0 0 6px;font-size:16px;color:var(--ink)}
.empty p{margin:0 0 12px}
.hint{margin:22px 2px 0;font-size:12px;color:var(--ink-3)}
.hint kbd{font:11px ui-monospace,monospace;border:1px solid var(--line-2);border-radius:4px;padding:0 4px;background:var(--surface)}

/* 상세 패널 */
.panel{position:fixed;top:0;right:0;bottom:0;z-index:30;width:440px;max-width:100%;display:flex;flex-direction:column;background:var(--surface);border-left:1px solid var(--line);box-shadow:var(--shadow);transform:translateX(100%);visibility:hidden;transition:transform .2s ease,visibility .2s}
.panel.open{transform:none;visibility:visible}
.ph{padding:16px 20px 14px;border-bottom:1px solid var(--line)}
.ph-top{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--ink-3)}
.status{display:inline-flex;align-items:center;gap:6px;font-weight:650;color:var(--ink-2)}
.tag{background:var(--surface-2);border-radius:5px;padding:1px 7px}
.icon-btn{width:32px;height:32px;border:0;border-radius:8px;background:transparent;color:var(--ink-2);font-size:20px;line-height:1}
.icon-btn:hover{background:var(--surface-2)}
.ph-title{margin:8px 0 4px;font-size:18px;line-height:1.35;letter-spacing:-.01em;overflow-wrap:anywhere;outline:0}
.ph-meta{display:flex;flex-wrap:wrap;gap:2px 0;font-size:13px;color:var(--ink-2)}
.ph-meta span+span::before{content:"·";margin:0 7px;color:var(--ink-3)}
.ph-contrib{display:flex;align-items:center;gap:8px;margin-top:8px;font-size:12px;color:var(--ink-3)}
.dec{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:12px}
.dec button{display:inline-flex;align-items:center;justify-content:center;gap:7px;height:34px;border:1px solid var(--line-2);border-radius:8px;background:var(--surface);font-size:13.5px;color:var(--ink-2)}
.dec button:hover:not(:disabled){border-color:var(--ink-3);color:var(--ink)}
.dec button.on{background:var(--surface-3);border-color:var(--ink-3);color:var(--ink);font-weight:700}
.warn{margin-top:12px;padding:10px 12px;border-radius:9px;background:var(--warn-bg);color:var(--warn-ink);font-size:13px;display:flex;align-items:center;gap:10px}
.warn p{margin:0;flex:1}
.panel-body{flex:1;overflow:auto;padding:4px 20px 32px}
.ps{padding:14px 0;border-bottom:1px solid var(--line)}
.ps:last-child{border-bottom:0}
.ps h4{margin:0 0 8px;font-size:12px;font-weight:700;color:var(--ink-3);letter-spacing:.03em}
.chips{display:flex;flex-wrap:wrap;gap:5px}
.chips .chip{max-width:100%}
.ps ul{margin:0;padding-left:18px}
.ps li{margin:2px 0;overflow-wrap:anywhere}
.star{display:grid;grid-template-columns:auto 1fr;gap:6px 10px;margin:0}
.star dt{font-size:11.5px;font-weight:700;color:var(--ink-3);padding-top:2px;white-space:nowrap}
.star dd{margin:0;overflow-wrap:anywhere}
.ev a,.ev .linklike{font-size:13.5px;text-align:left;color:var(--accent)}
.broken{color:var(--ink-3);text-decoration:line-through}
.oneline{margin:0 0 8px;padding:8px 10px;border-radius:8px;background:var(--surface-2);font-size:12.5px;color:var(--ink-2);overflow-wrap:anywhere}
.row-btns{display:flex;flex-wrap:wrap;gap:6px}
.q{padding:12px;border-radius:10px;background:var(--surface-2);margin-bottom:8px}
.q-head{display:flex;gap:8px;align-items:baseline;margin-bottom:8px;font-size:13.5px}
.q-field{flex:none;font-size:11px;font-weight:700;color:var(--accent-soft-ink);background:var(--accent-soft);border-radius:5px;padding:1px 6px}
.q textarea,.form input,.form select,.form textarea{width:100%;border:1px solid var(--line-2);border-radius:8px;background:var(--surface);padding:7px 9px;outline:0}
.q textarea{resize:vertical;min-height:64px}
.q textarea:focus,.form input:focus,.form select:focus,.form textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.q-btns{display:flex;gap:6px;margin-top:8px}
.qa{margin:6px 0 0;font-size:13px}
.qa dt{color:var(--ink-3);margin-top:6px}.qa dd{margin:0;overflow-wrap:anywhere}
details summary{cursor:pointer;font-size:12.5px;color:var(--ink-2)}
.form{display:grid;grid-template-columns:1fr 1fr;gap:10px 12px}
.form label{display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:600;color:var(--ink-2);min-width:0}
.form label.full{grid-column:1/-1}
.form input,.form select,.form textarea{font-weight:400;color:var(--ink)}
.form small{font-weight:400;color:var(--ink-3)}
.form textarea{min-height:72px;resize:vertical}
.form-btns{grid-column:1/-1;display:flex;gap:6px;justify-content:flex-end}
.pfoot{padding-top:14px;font-size:11.5px;color:var(--ink-3);overflow-wrap:anywhere}
.fv{display:flex;flex-direction:column;height:100%}
.fv-head{display:flex;flex-direction:column;gap:6px}
.fv-title{font-weight:700;font-size:15px;overflow-wrap:anywhere}
.fv-path{font-size:11.5px;color:var(--ink-3);overflow-wrap:anywhere}
.fv-text{flex:1;overflow:auto;margin:0;padding:16px 20px 32px;font:12.5px/1.6 ui-monospace,"D2Coding",Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--ink-2)}

/* 작업 바 */
.jobbar{position:fixed;left:240px;right:0;bottom:0;z-index:20;display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding:10px 28px;background:color-mix(in srgb,var(--surface) 92%,transparent);backdrop-filter:blur(8px);border-top:1px solid var(--line);transition:right .2s ease}
.jobbar[hidden]{display:none}
.jb-left{display:flex;align-items:center;gap:10px;flex:1 1 460px;min-width:0;font-size:13px}
.jb-left>strong,.jb-left .linklike{white-space:nowrap;flex:none}
.jb-left strong{font-variant-numeric:tabular-nums}
.jb-line{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink-3);font:12px ui-monospace,monospace}
.jb-last{font-size:12px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.jb-last.ok{color:var(--ok)}.jb-last.err{color:var(--danger)}
.jb-right{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.jb-bar{display:inline-block;width:160px;height:8px;border-radius:99px;background:var(--surface-2,#e9ecf1);overflow:hidden;vertical-align:middle;flex:none}
.jb-fill{display:block;height:100%;border-radius:99px;background:var(--accent,#2d5bd7);transition:width .4s ease}
.jb-prog{font-size:13px;font-variant-numeric:tabular-nums;white-space:nowrap;min-width:0;overflow:hidden;text-overflow:ellipsis}
.jb-sep{width:1px;align-self:stretch;background:var(--line,#d0d5dc);margin:2px 4px}
.bye{max-width:520px;margin:18vh auto;padding:0 16px;text-align:center}.bye h1{font-size:22px;margin:0 0 8px}
.jb-log{order:-1;flex-basis:100%;max-height:200px;overflow:auto;margin:0;padding:10px 12px;border-radius:8px;background:var(--surface-2);font:12px/1.5 ui-monospace,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--ink-2)}
.spin{width:14px;height:14px;border:2px solid var(--line-2);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite;flex:none}
@keyframes spin{to{transform:rotate(360deg)}}
.toast{position:fixed;left:50%;bottom:72px;z-index:50;transform:translate(-50%,12px);max-width:min(560px,calc(100% - 32px));padding:9px 16px;border-radius:10px;background:var(--ink);color:var(--bg);font-size:13px;box-shadow:var(--shadow);opacity:0;pointer-events:none;transition:opacity .15s,transform .15s}
.toast.show{opacity:1;transform:translate(-50%,0)}
.toast.err{background:var(--danger);color:#fff}
@media (prefers-color-scheme:dark){.toast.err{color:#1a0d0c}}
#printdoc{display:none}

/* 좁은 화면 */
@media (max-width:820px){
.app{grid-template-columns:minmax(0,1fr);grid-template-rows:auto 1fr}
.side{position:static;height:auto;border-right:0;border-bottom:1px solid var(--line);padding:12px 16px}
.brand{padding:0;align-items:center}
.brand .menu-btn{display:inline-flex}
.side-body{display:none;padding-top:14px}
.side.open .side-body{display:flex}
.side-foot{margin-top:0}
.main{padding:0 16px 140px}
.panel{width:100%;border-left:0}
.jobbar{left:0;padding:8px 16px}
.topbar .btn{display:none}
.bulk{top:62px;flex-wrap:wrap}
}
@media (max-width:520px){.jb-left{flex-basis:100%}.p{display:none}}

/* 인쇄: 목록 대신 채택 경험 문서형 */
@media print{
@page{margin:16mm 14mm}
body{background:#fff;color:#000;font-size:10.5pt}
.app,.toast,.jobbar,.panel{display:none!important}
#printdoc{display:block}
#printdoc h1{font-size:20pt;margin:0}
#printdoc .pd-sub{color:#555;margin:2px 0 14px}
#printdoc h2{font-size:13pt;border-bottom:1.5px solid #000;padding-bottom:3px;margin:18px 0 8px;break-after:avoid}
#printdoc article{break-inside:avoid;margin:0 0 12px;padding-bottom:10px;border-bottom:1px solid #ddd}
#printdoc h3{font-size:11.5pt;margin:0 0 2px}
#printdoc p{margin:2px 0}
#printdoc .pd-meta{color:#333}
#printdoc ul{margin:4px 0;padding-left:18px}
#printdoc dl{display:grid;grid-template-columns:auto 1fr;gap:2px 8px;margin:4px 0 0}
#printdoc dt{font-weight:700}#printdoc dd{margin:0}
}
`;

/** 화면 스크립트(LOGIC_JS와 같은 스코프). 데이터는 모두 textContent·속성으로만 넣는다 */
const APP_JS = String.raw`
var LIVE = MODE === "live";
var CONTRIB_CLASS = { "직접 수행": "direct", "학습 후 재수행": "relearn", "AI 보조": "assist", "AI 주도": "ai", "개념 해석": "concept" };
var CONTRIB_HELP = {
  "직접 수행": "본인이 처음부터 직접 수행",
  "학습 후 재수행": "강의·가이드로 배운 뒤 혼자 다시 수행",
  "AI 보조": "본인이 주도하고 AI는 보조 도구로 사용",
  "AI 주도": "AI 에이전트가 대부분 수행하고 본인은 방향 설정·검증",
  "개념 해석": "본인은 개념·설계 해석을 맡고 구현은 AI·타인이 수행"
};
var FIELD_LABEL = { role: "역할", period: "기간", contribution: "수행 방식", org: "소속", team_size: "팀 규모", skills: "기술", metrics: "성과", title: "제목", category: "분류" };
var STAGE_LABEL = { walk: "파일 찾기", hash: "파일 확인", scope: "폴더 범위", "judge-pending": "이전 카드 판정", triage: "선별", extract: "카드 추출", judge: "판정", group: "경험 묶기", review: "반영", keywords: "키워드" };
function progressText(p) {
  var num = function (n) { return Number(n).toLocaleString("ko-KR"); };
  var parts = [(STAGE_LABEL[p.stage] || p.stage) + (p.total || p.done ? " " + (p.total ? num(p.done) + "/" + num(p.total) : num(p.done) + "개") : "")];
  if (p.overall !== null && p.overall !== undefined) parts.push("전체 " + Math.round(p.overall * 100) + "%");
  if (p.etaSec !== null && p.etaSec !== undefined) parts.push(p.etaSec < 60 ? "1분 안에 끝남" : "약 " + Math.round(p.etaSec / 60) + "분 남음");
  else if (p.overall !== null && p.overall !== undefined && p.overall < 1) parts.push("남은 시간 계산 중");
  return parts.join(" · ");
}
var JOB_LABEL = { all: "한 번에 정리", scan: "새 자료 스캔", group: "경험 묶기", apply: "반영 실행", keywords: "키워드 만들기", master: "master 다시 만들기" };
var TODO = [["decide", "결정 대기"], ["answer", "답변 대기"], ["apply", "반영 대기"]];
var STATUS_ORDER = ["pending", "adopted", "held", "excluded"];
var DEFAULT_STATUSES = LIVE ? ["pending", "adopted"] : null;
var DECISIONS = [["adopted", "채택"], ["held", "보류"], ["excluded", "제외"]];

var S = {
  exps: [], output: "", generatedAt: "", job: null, loading: LIVE, error: null, hints: null, hintsAsked: false, lastScan: null, staleClosed: false,
  view: "category", statuses: DEFAULT_STATUSES ? DEFAULT_STATUSES.slice() : null, contribs: [], q: "", todo: null,
  sel: null, open: null, order: [], activeG: null, checked: {}, skipped: {}, drafts: {},
  editing: false, form: null, form0: null, fileView: null, showLog: false, polling: false, menu: false
};

function $(id) { return document.getElementById(id); }
var PROPS = { value: 1, checked: 1, disabled: 1, hidden: 1, indeterminate: 1, open: 1 };
function el(tag, a, kids) {
  var n = document.createElement(tag);
  if (a) Object.keys(a).forEach(function (k) {
    var v = a[k];
    if (v === null || v === undefined || v === false && !PROPS[k]) return;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), v);
    else if (PROPS[k]) n[k] = v;
    else n.setAttribute(k, v === true ? "" : String(v));
  });
  (kids || []).forEach(function (c) {
    if (c === null || c === undefined || c === false) return;
    n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  });
  return n;
}
function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
function byRel(rel) { for (var i = 0; i < S.exps.length; i++) if (S.exps[i].rel === rel) return S.exps[i]; return null; }
function busy() { return !!(S.job && S.job.running); }
function cssq(s) { return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, "\\$&"); }
function narrow() { return window.matchMedia && matchMedia("(max-width: 820px)").matches; }
function filt() { return { statuses: S.statuses, contribs: S.contribs, category: null, q: S.q, todo: S.todo }; }
function encPath(p) { return p.split("/").map(encodeURIComponent).join("/"); }
function isDefault() {
  return !S.todo && !S.q && !S.contribs.length && JSON.stringify(S.statuses) === JSON.stringify(DEFAULT_STATUSES);
}

function toast(msg, kind) {
  var t = $("toast");
  t.textContent = msg;
  t.className = "toast show" + (kind ? " " + kind : "");
  clearTimeout(S.toastT);
  S.toastT = setTimeout(function () { t.className = "toast"; }, kind === "err" ? 5000 : 2600);
}
function errMsg(r) { return (r.json && r.json.error) || "요청 실패 (" + r.status + ")"; }
function netErr() { toast("서버에 연결할 수 없습니다. 터미널에서 mp ui가 실행 중인지 확인하세요.", "err"); }

function api(method, path, body) {
  var h = { "X-MP-Token": TOKEN };
  if (body !== undefined) h["Content-Type"] = "application/json";
  return fetch(path, { method: method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" })
    .then(function (r) {
      return r.text().then(function (t) {
        var j = null;
        try { j = JSON.parse(t); } catch (e) { j = null; }
        return { status: r.status, ok: r.ok, json: j, text: t };
      });
    });
}

function load() {
  return api("GET", "/api/state").then(function (r) {
    S.loading = false;
    if (!r.ok) S.error = errMsg(r);
    else if (r.json.setup) { enterSetup(); return; }
    else {
      S.error = null; S.exps = r.json.experiences || []; S.output = r.json.output || ""; S.job = r.json.job || null; S.lastScan = r.json.lastScan || null;
      if (busy()) ensurePoll();
      if (!S.hintsAsked) { S.hintsAsked = true; fetchHints(); }
    }
    renderPrint(); render();
    if (S.settings) renderSettings(); // 작업이 끝나면 저장·초기화 버튼을 다시 켠다
  }, function () { S.loading = false; S.error = "서버에 연결할 수 없습니다. 터미널에서 mp ui가 실행 중인지 확인하세요."; render(); });
}

/* ---------- 렌더 ---------- */
/** 다시 그린 뒤에도 같은 data-k 요소에 포커스·커서를 되돌린다 */
function keepFocus(fn) {
  var ae = document.activeElement, fk = ae && ae.getAttribute ? ae.getAttribute("data-k") : null;
  var caret = fk && ae.value !== undefined && typeof ae.selectionStart === "number" ? [ae.selectionStart, ae.selectionEnd] : null;
  fn();
  if (fk) {
    var n = document.querySelector('[data-k="' + cssq(fk) + '"]');
    if (n && n !== document.activeElement) {
      n.focus({ preventScroll: true });
      if (caret && n.setSelectionRange) try { n.setSelectionRange(caret[0], caret[1]); } catch (e) { /* type=number 등 */ }
    }
  }
}
function render() {
  keepFocus(function () {
    var vis = filterList(S.exps, filt());
    var groups = groupList(vis, S.view);
    S.order = [];
    groups.forEach(function (g) { g.items.forEach(function (e) { S.order.push(e.rel); }); });
    if (S.activeG && !groups.some(function (g) { return g.key === S.activeG; })) S.activeG = null;
    renderSide(groups); renderTop(vis); renderBulk(vis); renderList(groups); renderPanel(); renderJob(); renderHints();
    $("app").classList.toggle("panel-open", !!S.open);
  });
  markToc(); observe();
}

function sec(title, kids) { return el("section", { class: "sec" }, [el("h3", { text: title })].concat(kids)); }
function fchip(k, kids, on, fn, title) {
  return el("button", { type: "button", class: "fchip" + (on ? " on" : ""), "data-k": k, "aria-pressed": String(!!on), title: title, onclick: fn }, kids);
}
function contribKey(e) { return e.contribution || NO_CONTRIB; }

function renderSide(groups) {
  var sb = clear($("side-body"));
  if (LIVE) {
    var c = todoCounts(S.exps);
    sb.appendChild(sec("할 일", [el("div", { class: "todo" }, TODO.map(function (t) {
      var on = S.todo === t[0];
      return el("button", { type: "button", class: "todo-btn" + (on ? " on" : "") + (c[t[0]] ? "" : " zero"), "data-k": "todo:" + t[0], "aria-pressed": String(on),
        title: on ? "다시 누르면 전체 목록" : t[1] + " 목록 보기", onclick: function () { setTodo(t[0]); } },
        [el("span", { class: "todo-n", text: String(c[t[0]]) }), el("span", { class: "todo-l", text: t[1] })]);
    }))]));
  } else if (S.exps.length) {
    var cats = countBy(S.exps, function (e) { return e.category; });
    var cc = countBy(S.exps, contribKey);
    var keys = CONTRIBUTIONS.concat([NO_CONTRIB]).filter(function (k) { return cc[k]; });
    sb.appendChild(sec("요약", [el("div", { class: "summary" }, [
      el("div", { class: "stat" }, [el("b", { text: String(S.exps.length) }), el("span", { text: "채택한 경험" })]),
      el("div", { class: "stat" }, [el("b", { text: String(Object.keys(cats).length) }), el("span", { text: "분류" })]),
      el("div", { class: "bar", role: "img", "aria-label": "수행 방식 분포: " + keys.map(function (k) { return k + " " + cc[k] + "개"; }).join(", ") },
        keys.map(function (k) { var i = el("i", { class: "sw c-" + (CONTRIB_CLASS[k] || "none"), title: k + " " + cc[k] + "개" }); i.style.flex = String(cc[k]); i.style.borderRadius = "0"; i.style.width = "auto"; i.style.height = "100%"; return i; }))
    ])]));
  }

  var toc = el("nav", { class: "toc", "aria-label": "목차" });
  groups.forEach(function (g) {
    toc.appendChild(el("a", { href: "#" + g.key, class: "toc-a", "data-g": g.key, "data-k": "toc:" + g.key,
      onclick: function () { S.activeG = g.key; S.lockToc = Date.now(); markToc(); closeMenu(); } },
      [el("span", { class: "toc-l", text: g.label }), el("span", { class: "toc-n", text: String(g.items.length) })]));
  });
  if (!groups.length) toc.appendChild(el("p", { class: "note", text: "표시할 경험이 없습니다" }));
  sb.appendChild(sec(S.view === "year" ? "목차 · 연도" : "목차 · 분류", [toc]));

  sb.appendChild(sec("보기", [el("div", { class: "seg", role: "group", "aria-label": "보기" }, [["category", "분류별"], ["year", "연도별"]].map(function (v) {
    return el("button", { type: "button", class: S.view === v[0] ? "on" : "", "data-k": "view:" + v[0], "aria-pressed": String(S.view === v[0]),
      onclick: function () { S.view = v[0]; S.activeG = null; render(); window.scrollTo(0, 0); } }, [v[1]]);
  }))]));

  if (LIVE) {
    var sc = countBy(S.exps, function (e) { return e.review; });
    sb.appendChild(sec("상태", [
      el("div", { class: "fchips" + (S.todo ? " dim" : "") }, STATUS_ORDER.map(function (s) {
        return fchip("st:" + s, [el("span", { class: "dot s-" + s }), REVIEW_LABEL[s], el("span", { class: "n", text: String(sc[s] || 0) })],
          !S.todo && S.statuses.indexOf(s) >= 0, function () { toggleStatus(s); });
      })),
      S.todo ? el("p", { class: "note", text: "할 일 목록을 보는 중에는 상태 필터를 쓰지 않습니다." }) : null
    ]));
  }

  var base = LIVE ? S.exps.filter(function (e) { return S.todo ? inTodo(e, S.todo) : S.statuses.indexOf(e.review) >= 0; }) : S.exps;
  var ccount = countBy(base, contribKey);
  var ckeys = CONTRIBUTIONS.concat([NO_CONTRIB]).filter(function (k) { return ccount[k] || S.contribs.indexOf(k) >= 0; });
  if (ckeys.length) sb.appendChild(sec("수행 방식", [el("div", { class: "fchips" }, ckeys.map(function (k) {
    return fchip("ct:" + k, [el("span", { class: "sw c-" + (CONTRIB_CLASS[k] || "none") }), k, el("span", { class: "n", text: String(ccount[k] || 0) })],
      S.contribs.indexOf(k) >= 0, function () { toggleContrib(k); }, CONTRIB_HELP[k] || "수행 방식을 아직 정하지 않음");
  }))]));

  if (LIVE) sb.appendChild(el("button", { type: "button", class: "btn side-set", "data-k": "settings", "aria-haspopup": "dialog", title: "스캔 폴더·요금제·폴더 범위 판단·환경 점검", onclick: openSettings, text: "⚙ 설정" }));
  if (LIVE && S.output) sb.appendChild(el("p", { class: "side-foot", text: "결과 폴더 · " + S.output }));
  else if (!LIVE) sb.appendChild(el("p", { class: "side-foot", text: "내 PC에만 저장된 파일입니다. 수정은 experiences/의 경험 카드에서 한 뒤 mp master를 다시 실행하세요." }));
}

function renderTop(vis) {
  var T = clear($("tb-info"));
  if (S.loading || S.error) return;
  if (S.todo) {
    var label = TODO.filter(function (t) { return t[0] === S.todo; })[0][1];
    T.appendChild(el("button", { type: "button", class: "pill", "data-k": "pill", title: "전체 목록으로", onclick: function () { setTodo(S.todo); } },
      [label + "만 보기", el("span", { "aria-hidden": "true", text: "×" })]));
  }
  T.appendChild(el("span", { text: vis.length + "개" + (S.exps.length !== vis.length ? " / 전체 " + S.exps.length : "") }));
  if (!isDefault()) T.appendChild(el("button", { type: "button", class: "linklike", "data-k": "reset", onclick: resetFilters, text: "필터 초기화" }));
}

function renderBulk(vis) {
  var B = $("bulk");
  var on = LIVE && S.todo === "decide" && vis.length > 0 && !S.error;
  B.hidden = !on;
  clear(B);
  if (!on) return;
  var sel = vis.filter(function (e) { return S.checked[e.rel]; }).map(function (e) { return e.rel; });
  var all = sel.length === vis.length;
  var cb = el("input", { type: "checkbox", "data-k": "bulk-all", checked: all, onchange: function () {
    vis.forEach(function (e) { if (cb.checked) S.checked[e.rel] = true; else delete S.checked[e.rel]; });
    render();
  } });
  cb.indeterminate = sel.length > 0 && !all;
  B.appendChild(el("label", { class: "bulk-all" }, [cb, "전체 선택"]));
  B.appendChild(el("span", { class: "bulk-n", text: sel.length ? sel.length + "개 선택됨" : "체크해서 한 번에 결정" }));
  B.appendChild(el("span", { class: "grow" }));
  DECISIONS.forEach(function (d) {
    B.appendChild(el("button", { type: "button", class: "btn sm" + (d[0] === "adopted" ? " primary" : ""), "data-k": "bulk:" + d[0],
      disabled: !sel.length || busy(), title: busy() ? "작업 실행 중" : null, onclick: function () { decide(sel, d[0], false); } }, [d[1]]));
  });
}

function emptyBox(title, text, action) {
  return el("div", { class: "empty" }, [el("h2", { text: title }), text ? el("p", { text: text }) : null, action || null]);
}

function renderList(groups) {
  var L = clear($("list"));
  if (S.loading) { L.appendChild(emptyBox("불러오는 중…")); return; }
  if (S.error) { L.appendChild(emptyBox("불러오지 못했습니다", S.error, el("button", { type: "button", class: "btn", onclick: load, text: "다시 시도" }))); return; }
  if (!S.exps.length) {
    L.appendChild(LIVE ? emptyBox("아직 경험 카드가 없습니다", "아래 작업 바에서 [새 자료 스캔] → [경험 묶기]를 실행하면 여기에 나타납니다.")
      : emptyBox("채택된 경험이 없습니다", "mp review(또는 mp ui)로 경험을 채택한 뒤 mp master를 다시 실행하세요."));
    return;
  }
  if (!groups.length) {
    L.appendChild(emptyBox(S.todo ? "할 일이 없습니다" : "조건에 맞는 경험이 없습니다", null,
      el("button", { type: "button", class: "btn", onclick: resetFilters, text: "필터 초기화" })));
    return;
  }
  var decideMode = LIVE && S.todo === "decide";
  groups.forEach(function (g) {
    L.appendChild(el("section", { class: "group", id: g.key, "aria-labelledby": "h-" + g.key }, [
      el("h2", { id: "h-" + g.key }, [g.label, el("span", { class: "count", text: String(g.items.length) })]),
      el("ul", { class: "rows" }, g.items.map(function (e) { return row(e, decideMode); }))
    ]));
  });
}

function badge(c) {
  return el("span", { class: "badge c-" + (CONTRIB_CLASS[c] || "none"), title: CONTRIB_HELP[c] || "", text: c });
}

function row(e, decideMode) {
  var c = chipsOf(e);
  var li = el("li", { class: "rw s-" + e.review + (S.sel === e.rel ? " sel" : "") + (S.open === e.rel ? " open" : ""), "data-rel": e.rel });
  if (decideMode) li.appendChild(el("input", { type: "checkbox", class: "pick", "data-k": "pick:" + e.rel, "aria-label": e.title + " 선택", checked: !!S.checked[e.rel],
    onchange: function (ev) { if (ev.target.checked) S.checked[e.rel] = true; else delete S.checked[e.rel]; render(); } }));
  var flags = [];
  if (LIVE) {
    var nq = unanswered(e).length;
    if (e.edited) flags.push(el("span", { class: "flag edited", text: "편집됨", title: "바깥에서 편집됨 — 상세에서 받아들이기" }));
    if (nq && e.review !== "excluded") flags.push(el("span", { class: "flag", text: "질문 " + nq, title: "미응답 질문 " + nq + "개" }));
    if (e.pending_apply) flags.push(el("span", { class: "flag", text: "반영 대기", title: "아직 반영되지 않은 답이 있음" }));
  }
  var l2 = [];
  if (e.contribution) l2.push(badge(e.contribution));
  c.kw.forEach(function (k) { l2.push(el("span", { class: "chip kw", text: k })); });
  c.out.forEach(function (k) { l2.push(el("span", { class: "chip out", text: outMark(k) + " " + k })); });
  if (c.fallback) l2.push(el("span", { class: "chip out faded", text: c.fallback, title: "성과 키워드 없음 — 성과 첫 항목" }));
  if (!c.kw.length && !c.out.length && !c.fallback) l2.push(el("span", { class: "muted", text: [e.org, e.role].filter(Boolean).join(" · ") || "키워드 없음" }));
  var btn = el("button", { type: "button", class: "row", "data-k": "row:" + e.rel, "aria-current": S.open === e.rel ? "true" : null,
    onclick: function () { openItem(e.rel); }, onfocus: function () { S.sel = e.rel; markSel(); } }, [
    el("span", { class: "dot s-" + e.review, title: REVIEW_LABEL[e.review] }, [el("span", { class: "sr", text: REVIEW_LABEL[e.review] })]),
    el("span", { class: "rm" }, [
      el("span", { class: "l1" }, [el("span", { class: "t", text: e.title })].concat(flags, [el("span", { class: "p", text: e.period || "기간 미상" })])),
      el("span", { class: "l2" }, l2)
    ])
  ]);
  li.appendChild(btn);
  return li;
}

function markSel() {
  [].forEach.call(document.querySelectorAll(".rw"), function (li) { li.classList.toggle("sel", li.getAttribute("data-rel") === S.sel); });
}
function markToc() {
  var links = document.querySelectorAll(".toc-a");
  var act = S.activeG || (links[0] && links[0].getAttribute("data-g"));
  [].forEach.call(links, function (a) {
    var on = a.getAttribute("data-g") === act;
    a.classList.toggle("on", on);
    if (on) a.setAttribute("aria-current", "location"); else a.removeAttribute("aria-current");
  });
}
var seen = {};
function observe() {
  if (S.io) S.io.disconnect();
  if (!("IntersectionObserver" in window)) return;
  seen = {};
  S.io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) { seen[en.target.id] = en.isIntersecting; });
    if (S.lockToc && Date.now() - S.lockToc < 800) return;
    var secs = document.querySelectorAll(".group");
    for (var i = 0; i < secs.length; i++) if (seen[secs[i].id]) { if (S.activeG !== secs[i].id) { S.activeG = secs[i].id; markToc(); } return; }
  }, { rootMargin: "-64px 0px -55% 0px" });
  [].forEach.call(document.querySelectorAll(".group"), function (s) { S.io.observe(s); });
}
window.addEventListener("scroll", function () {
  if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
    var secs = document.querySelectorAll(".group");
    if (secs.length && !(S.lockToc && Date.now() - S.lockToc < 800)) { S.activeG = secs[secs.length - 1].id; markToc(); }
  }
}, { passive: true });

/* ---------- 상세 패널 ---------- */
function psec(title, kids) { return el("section", { class: "ps" }, [el("h4", { text: title })].concat(kids)); }

function renderPanel() {
  var P = $("panel");
  var e = S.open ? byRel(S.open) : null;
  if (!e) {
    if (S.open && !S.loading) { S.open = null; S.editing = false; S.fileView = null; }
    P.classList.remove("open"); P.setAttribute("aria-hidden", "true"); P.inert = true; clear(P); S.panelRel = null;
    return;
  }
  var oldBody = P.querySelector(".panel-body");
  var keep = S.panelRel === e.rel && oldBody ? oldBody.scrollTop : 0;
  clear(P);
  P.classList.add("open"); P.setAttribute("aria-hidden", "false"); P.inert = false;
  S.panelRel = e.rel;
  if (S.fileView) { P.appendChild(fileViewEl()); return; }
  var meta = [e.period || "기간 미상", e.org, e.role || (e.team ? "팀 규모 " + e.team : null)].filter(Boolean);
  var head = el("div", { class: "ph" }, [
    el("div", { class: "ph-top" }, [
      el("span", { class: "status" }, [el("span", { class: "dot s-" + e.review }), REVIEW_LABEL[e.review]]),
      el("span", { class: "tag", text: e.category }),
      LIVE && e.value ? el("span", { class: "tag", text: "가치 " + e.value }) : null,
      el("span", { class: "grow" }),
      el("button", { type: "button", class: "icon-btn", id: "panel-close", "data-k": "close", "aria-label": "닫기 (Esc)", title: "닫기 (Esc)", onclick: closePanel, text: "×" })
    ]),
    el("h2", { class: "ph-title", id: "panel-title", tabindex: "-1", text: e.title }),
    el("div", { class: "ph-meta" }, meta.map(function (m) { return el("span", { text: m }); })),
    e.contribution ? el("div", { class: "ph-contrib" }, [badge(e.contribution), el("span", { text: CONTRIB_HELP[e.contribution] || "" })]) : null,
    LIVE && e.edited ? el("div", { class: "warn" }, [
      el("p", { text: "바깥에서 편집된 카드입니다. 받아들이면 지금 내용을 기준으로 다시 결정·답변·수정할 수 있습니다." }),
      el("button", { type: "button", class: "btn sm", "data-k": "accept", disabled: busy(), onclick: function () { acceptEdit(e); }, text: "받아들이기" })
    ]) : null,
    LIVE && !e.edited ? el("div", { class: "dec", role: "group", "aria-label": "결정" }, DECISIONS.map(function (d) {
      var on = e.review === d[0];
      return el("button", { type: "button", class: on ? "on" : "", "aria-pressed": String(on), "data-k": "dec:" + d[0], disabled: busy(),
        title: busy() ? "작업 실행 중" : null, onclick: function () { if (on) toast("이미 " + d[1] + " 상태입니다"); else decide([e.rel], d[0], true); } },
        [el("span", { class: "dot s-" + d[0] }), d[1]]);
    })) : null
  ]);
  var body = el("div", { class: "panel-body" });
  if (LIVE && !e.edited && !S.editing) { var qs = questionsSec(e); if (qs) body.appendChild(qs); }
  if (S.editing && LIVE && !e.edited) body.appendChild(editForm(e));
  else viewSections(e).forEach(function (s) { body.appendChild(s); });
  body.appendChild(el("p", { class: "pfoot", text: "원본 카드 · " + e.rel }));
  P.appendChild(head); P.appendChild(body);
  body.scrollTop = keep;
}

function viewSections(e) {
  var out = [];
  var c = chipsOf(e);
  if (c.kw.length || c.out.length) out.push(psec("키워드", [el("div", { class: "chips" },
    c.kw.map(function (k) { return el("span", { class: "chip kw", text: k }); })
      .concat(c.out.map(function (k) { return el("span", { class: "chip out", text: outMark(k) + " " + k }); })))]));
  else if (LIVE) out.push(psec("키워드", [el("p", { class: "muted small", text: "키워드가 없습니다. 아래 작업 바의 [키워드 만들기]나 편집으로 채울 수 있습니다." })]));
  if (e.metrics.length) out.push(psec("성과", [el("ul", {}, e.metrics.map(function (m) { return el("li", { text: m }); }))]));
  if (e.star) out.push(psec("STAR 요약", [el("dl", { class: "star" }, [
    el("dt", { text: "상황 S" }), el("dd", { text: e.star.s }), el("dt", { text: "과제 T" }), el("dd", { text: e.star.t }),
    el("dt", { text: "행동 A" }), el("dd", { text: e.star.a }), el("dt", { text: "결과 R" }), el("dd", { text: e.star.r })])]));
  if (e.skills.length) out.push(psec("기술", [el("div", { class: "chips" }, e.skills.map(function (s) { return el("span", { class: "chip kw", text: s }); }))]));
  if (e.evidence.length) out.push(psec("근거 파일 " + e.evidence.length + "개", [el("ul", { class: "ev" }, e.evidence.map(function (v) {
    if (v.title === null) return el("li", {}, [el("span", { class: "broken", text: v.path.replace(/^files\//, "") }), " (카드 없음)"]);
    if (LIVE) return el("li", {}, [el("button", { type: "button", class: "linklike", "data-k": "ev:" + v.path, title: v.path, onclick: function () { openFile(v.path, v.title); }, text: v.title })]);
    return el("li", {}, [el("a", { href: encPath(v.path), title: v.path, text: v.title })]);
  }))]));
  var line = oneLine(e);
  out.push(psec("복사", [el("p", { class: "oneline", text: line }), el("div", { class: "row-btns" }, [
    el("button", { type: "button", class: "btn sm", "data-k": "copy1", onclick: function (ev) { copy(line, ev.currentTarget); }, text: "한 줄 복사" }),
    e.star ? el("button", { type: "button", class: "btn sm", "data-k": "copy2", onclick: function (ev) { copy(starText(e), ev.currentTarget); }, text: "STAR 복사" }) : null,
    LIVE && !e.edited ? el("span", { class: "grow" }) : null,
    LIVE && !e.edited ? el("button", { type: "button", class: "btn sm", "data-k": "edit", disabled: busy(), title: busy() ? "작업 실행 중" : "필드 직접 수정",
      onclick: function () { S.editing = true; S.form = formInit(e); S.form0 = formInit(e); render(); var f = document.querySelector(".form input"); if (f) f.focus(); }, text: "편집" }) : null
  ])]));
  return out;
}

function questionsSec(e) {
  var qs = e.questions;
  if (!qs.length) return null;
  var openQ = qs.filter(function (q) { return q.a === null && !S.skipped[e.rel + "|" + q.id]; });
  var skipped = qs.filter(function (q) { return q.a === null && S.skipped[e.rel + "|" + q.id]; });
  var answered = qs.filter(function (q) { return q.a !== null; });
  var n = openQ.length + skipped.length;
  var kids = openQ.map(function (q) { return qCard(e, q); });
  if (skipped.length) kids.push(el("button", { type: "button", class: "linklike", "data-k": "unskip", text: "건너뛴 질문 " + skipped.length + "개 다시 보기",
    onclick: function () { skipped.forEach(function (q) { delete S.skipped[e.rel + "|" + q.id]; }); render(); } }));
  if (answered.length) kids.push(el("details", {}, [el("summary", { text: "답변한 질문 " + answered.length + "개" }),
    el("dl", { class: "qa" }, [].concat.apply([], answered.map(function (q) { return [el("dt", { text: q.q }), el("dd", { text: q.a })]; })))]));
  return psec(n ? "질문 " + n + "개" : "질문", kids);
}

function qCard(e, q) {
  var key = e.rel + "|" + q.id;
  var ta = el("textarea", { rows: "3", "data-k": "qa:" + key, "aria-label": q.q, placeholder: "답변 입력 (Ctrl+Enter 저장)", value: S.drafts[key] || "",
    oninput: function () { S.drafts[key] = ta.value; },
    onkeydown: function (ev) { if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") { ev.preventDefault(); answer(e, q, ta.value); } } });
  return el("div", { class: "q" }, [
    el("div", { class: "q-head" }, [el("span", { class: "q-field", text: FIELD_LABEL[q.field] || q.field }), el("span", { text: q.q })]),
    ta,
    el("div", { class: "q-btns" }, [
      el("button", { type: "button", class: "btn sm primary", "data-k": "qs:" + key, disabled: busy(), onclick: function () { answer(e, q, ta.value); }, text: "저장" }),
      el("button", { type: "button", class: "btn sm", "data-k": "qm:" + key, disabled: busy(), onclick: function () { answer(e, q, "모름"); }, text: "모름" }),
      el("button", { type: "button", class: "btn sm ghost", "data-k": "qk:" + key, onclick: function () { S.skipped[key] = true; render(); }, text: "건너뛰기" })
    ])
  ]);
}

function formInit(e) {
  var r = e.raw || {};
  return {
    title: e.title, period: r.period || "", org: e.org || "", role: r.role || "", team_size: r.team_size ? String(r.team_size) : "",
    contribution: e.contribution || "", category: r.category || "",
    keywords: e.keywords.join(", "), outcome_keywords: e.outcome_keywords.join(", "), skills: e.skills.join(", "),
    metrics: (r.metrics || e.metrics).join("\n")
  };
}
function field(label, key, opt) {
  opt = opt || {};
  var input;
  var on = function (ev) { S.form[key] = ev.target.value; };
  if (opt.options) {
    input = el("select", { "data-k": "f:" + key, onchange: on }, opt.options.map(function (o) { return el("option", { value: o[0], text: o[1] }); }));
    input.value = S.form[key];
  } else if (opt.multi) input = el("textarea", { "data-k": "f:" + key, value: S.form[key], oninput: on, placeholder: opt.ph || null });
  else input = el("input", { type: opt.type || "text", "data-k": "f:" + key, value: S.form[key], oninput: on, placeholder: opt.ph || null, min: opt.min || null });
  return el("label", { class: opt.full ? "full" : null }, [label, opt.help ? el("small", { text: opt.help }) : null, input]);
}
function editForm(e) {
  var cats = [["", "자동 (추정: " + e.category + ")"]].concat(CATEGORIES.map(function (c) { return [c, c]; }));
  var cons = [["", "미정"]].concat(CONTRIBUTIONS.map(function (c) { return [c, c]; }));
  var form = el("form", { class: "form", onsubmit: function (ev) { ev.preventDefault(); saveEdit(e); } }, [
    field("제목", "title", { full: true }),
    field("기간", "period", { ph: "2025-03 ~ 2025-06" }),
    field("팀 규모", "team_size", { type: "number", min: "1", ph: "1 = 개인" }),
    field("소속", "org"),
    field("역할", "role"),
    field("수행 방식", "contribution", { options: cons }),
    field("분류", "category", { options: cats }),
    field("경험 키워드", "keywords", { full: true, help: "무엇을 했나 · 쉼표로 구분, 최대 3개, 각 18자 이내", ph: "VM 역공학, 입력 복원" }),
    field("성과 키워드", "outcome_keywords", { full: true, help: "무엇을 이뤘나 · 쉼표로 구분, 최대 2개", ph: "키 12벌 복원" }),
    field("기술", "skills", { full: true, help: "쉼표로 구분", ph: "Python, PyTorch" }),
    field("성과", "metrics", { full: true, multi: true, help: "한 줄에 하나" }),
    el("div", { class: "form-btns" }, [
      el("button", { type: "button", class: "btn", "data-k": "f-cancel", onclick: function () { S.editing = false; render(); }, text: "취소" }),
      el("button", { type: "submit", class: "btn primary", "data-k": "f-save", disabled: busy(), text: "저장" })
    ])
  ]);
  return psec("편집", [form]);
}

function fileViewEl() {
  var f = S.fileView;
  return el("div", { class: "fv" }, [
    el("div", { class: "ph fv-head" }, [
      el("div", { class: "ph-top" }, [
        el("button", { type: "button", class: "btn sm", "data-k": "fv-back", onclick: function () { S.fileView = null; render(); }, text: "← 상세로" }),
        el("span", { class: "grow" }),
        el("button", { type: "button", class: "icon-btn", "data-k": "close", "aria-label": "닫기 (Esc)", onclick: closePanel, text: "×" })
      ]),
      el("div", { class: "fv-title", text: f.title }),
      el("div", { class: "fv-path", text: f.path })
    ]),
    el("pre", { class: "fv-text", tabindex: "0", text: f.text !== null ? f.text : f.err || "불러오는 중…" })
  ]);
}

/* ---------- 동작 ---------- */
function setTodo(k) {
  S.todo = S.todo === k ? null : k; S.checked = {}; S.activeG = null;
  render(); window.scrollTo(0, 0);
}
function toggleStatus(s) {
  if (S.todo) { S.todo = null; S.statuses = [s]; }
  else {
    var i = S.statuses.indexOf(s);
    if (i >= 0) S.statuses.splice(i, 1); else S.statuses.push(s);
  }
  render();
}
function toggleContrib(k) {
  var i = S.contribs.indexOf(k);
  if (i >= 0) S.contribs.splice(i, 1); else S.contribs.push(k);
  render();
}
function resetFilters() {
  S.todo = null; S.statuses = DEFAULT_STATUSES ? DEFAULT_STATUSES.slice() : null; S.contribs = []; S.q = ""; $("q").value = "";
  render();
}
function focusRow(rel) {
  var b = rel && document.querySelector('[data-k="' + cssq("row:" + rel) + '"]');
  if (b) { b.focus({ preventScroll: true }); b.parentNode.scrollIntoView({ block: "nearest" }); }
}
function openItem(rel) {
  if (S.open !== rel) { S.editing = false; S.fileView = null; }
  S.open = rel; S.sel = rel;
  render();
  if (narrow()) { var t = $("panel-title"); if (t) t.focus(); }
}
function closePanel() {
  var r = S.open;
  S.open = null; S.editing = false; S.fileView = null;
  render(); focusRow(r);
}
function closeMenu() { S.menu = false; $("side").classList.remove("open"); $("menu-btn").setAttribute("aria-expanded", "false"); }

function copy(text, btn) {
  var done = function () {
    if (!btn) return;
    var o = btn.textContent; btn.textContent = "복사됨"; btn.disabled = true;
    setTimeout(function () { btn.textContent = o; btn.disabled = false; }, 1200);
  };
  if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(text).then(done, function () { legacyCopy(text); done(); }); return; }
  legacyCopy(text); done();
}
function legacyCopy(text) {
  var ta = el("textarea", { value: text });
  ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); } finally { document.body.removeChild(ta); }
}

function decide(rels, d, fromPanel) {
  if (!rels.length) return;
  var idx = fromPanel ? S.order.indexOf(rels[0]) : -1;
  var label = REVIEW_LABEL[d];
  api("POST", "/api/decide", { rels: rels, decision: d }).then(function (r) {
    if (r.ok) toast(rels.length > 1 ? rels.length + "개를 " + label + "했습니다" : label + "했습니다");
    else if (r.status === 409 && r.json && r.json.edited) toast("바깥에서 편집된 카드 " + r.json.edited.length + "개는 건너뛰었습니다" + (r.json.saved && r.json.saved.length ? " (" + r.json.saved.length + "개 저장)" : ""), "err");
    else toast(errMsg(r), "err");
    S.checked = {};
    return load().then(function () {
      if (fromPanel && S.open && idx >= 0 && S.order.indexOf(S.open) < 0) {
        var next = S.order[Math.min(idx, S.order.length - 1)];
        if (next) { openItem(next); focusRow(next); }
      }
    });
  }, netErr);
}
function answer(e, q, a) {
  if (!a.trim()) { toast("답변을 입력하세요. 모르면 [모름], 나중에 하려면 [건너뛰기]", "err"); return; }
  var key = e.rel + "|" + q.id;
  api("POST", "/api/answer", { rel: e.rel, qid: q.id, a: a }).then(function (r) {
    if (r.ok) { delete S.drafts[key]; toast("답변을 저장했습니다 · 반영 대기에 추가됨"); load(); }
    else toast(errMsg(r), "err");
  }, netErr);
}
function acceptEdit(e) {
  api("POST", "/api/accept-edit", { rel: e.rel }).then(function (r) {
    if (r.ok) { toast("편집을 받아들였습니다"); load(); } else toast(errMsg(r), "err");
  }, netErr);
}
function saveEdit(e) {
  var f = S.form, f0 = S.form0, out = {}, bad = null;
  if (f.title !== f0.title) { if (!f.title.trim()) bad = "제목을 입력하세요"; out.title = f.title.trim(); }
  ["period", "org", "role"].forEach(function (k) { if (f[k] !== f0[k]) out[k] = f[k].trim() || null; });
  if (f.team_size !== f0.team_size) {
    var t = String(f.team_size).trim();
    if (!t) out.team_size = null;
    else if (!/^\d+$/.test(t) || Number(t) < 1) bad = "팀 규모는 1 이상의 정수로 입력하세요";
    else out.team_size = Number(t);
  }
  if (f.contribution !== f0.contribution) out.contribution = f.contribution || null;
  if (f.category !== f0.category) out.category = f.category || null;
  ["keywords", "outcome_keywords", "skills"].forEach(function (k) { if (f[k] !== f0[k]) out[k] = splitList(f[k]); });
  if (f.metrics !== f0.metrics) out.metrics = splitList(f.metrics, "\n");
  if (bad) { toast(bad, "err"); return; }
  if (!Object.keys(out).length) { S.editing = false; render(); toast("바뀐 내용이 없습니다"); return; }
  api("POST", "/api/edit", { rel: e.rel, fields: out }).then(function (r) {
    if (r.ok) { S.editing = false; toast("저장했습니다"); load(); }
    else toast(errMsg(r), "err");
  }, netErr);
}
function openFile(path, title) {
  S.fileView = { path: path, title: title, text: null, err: null };
  render();
  api("GET", "/files/" + encPath(path)).then(function (r) {
    if (!S.fileView || S.fileView.path !== path) return;
    if (r.ok) S.fileView.text = r.text; else S.fileView.err = errMsg(r);
    renderPanel();
  }, function () { if (S.fileView) { S.fileView.err = "불러오지 못했습니다."; renderPanel(); } });
}

/* ---------- 종료 ---------- */
function shutdown() {
  if (busy()) return;
  api("POST", "/api/shutdown", {}).then(function () {
    document.body.textContent = "";
    var box = el("div", { class: "bye" }, [
      el("h1", { text: "MasterPortfolio를 종료했습니다" }),
      el("p", { text: "이 탭을 닫아도 됩니다. 다시 열려면 MasterPortfolio.bat을 실행하세요." })
    ]);
    document.body.appendChild(box);
  }, netErr);
}

/* ---------- 새 폴더 제안(WSL 등): 화면을 열 때 한 번 ---------- */
function fetchHints() {
  api("GET", "/api/folder-hints").then(function (r) {
    if (r.ok && r.json.folders && r.json.folders.length) {
      // WSL 폴더는 자료가 있을 가능성이 높아 미리 체크, 드라이브·클라우드는 사용자가 고른다
      S.hints = r.json.folders.map(function (h) { return { path: h.path, label: h.label, kind: h.kind, checked: h.kind === "wsl" }; });
      renderHints();
    }
  }, function () { /* 제안은 없어도 된다 */ });
}
/** add: 체크한 폴더는 추가, 나머지는 다시 묻지 않음. add=false: 모두 다시 묻지 않음 */
function answerHints(add) {
  var list = S.hints || [];
  var on = add ? list.filter(function (h) { return h.checked; }) : [];
  var off = list.filter(function (h) { return on.indexOf(h) < 0; });
  if (add && !on.length) { toast("추가할 폴더를 체크하세요", "err"); return; }
  api("POST", "/api/folder-hints", { add: on.map(function (h) { return h.path; }), dismiss: off.map(function (h) { return h.path; }) }).then(function (r) {
    if (!r.ok) { toast(errMsg(r), "err"); return; }
    S.hints = null; renderHints();
    toast(add ? "스캔 폴더에 " + r.json.added + "개를 추가했습니다 · [새 자료 스캔]을 누르면 탐색합니다" : "이 폴더들은 다시 묻지 않습니다(⚙ 설정의 [제안 보기]에서 추가할 수 있음)");
    if (S.settings) fetchSettings(false, false);
  }, netErr);
}
/** 마지막 스캔이 이 일수보다 오래됐으면 새 자료 스캔을 권한다 */
var STALE_DAYS = 7;
function staleDays() {
  if (S.staleClosed || busy() || S.loading || S.error) return null;
  if (!S.lastScan) return S.exps.length ? null : -1; // 한 번도 스캔하지 않음
  var d = Math.floor((Date.now() - Date.parse(S.lastScan)) / 86400000);
  return d >= STALE_DAYS ? d : null;
}
function renderHints() {
  var H = $("hintbar");
  if (!H) return;
  var list = S.hints || [];
  var stale = staleDays();
  H.hidden = !list.length && stale === null;
  clear(H);
  if (stale !== null) {
    H.appendChild(el("p", {}, [el("strong", { text: stale < 0 ? "아직 스캔한 적이 없습니다." : "마지막 스캔이 " + stale + "일 전입니다." }), " 그사이 새로 생긴 과제·발표 자료가 있을 수 있습니다."]));
    H.appendChild(el("div", { class: "hb-btns" }, [
      el("button", { type: "button", class: "btn sm primary", "data-k": "stale:all", onclick: function () { startJob("all"); }, text: "한 번에 정리" }),
      el("button", { type: "button", class: "btn sm", "data-k": "stale:scan", onclick: function () { startJob("scan"); }, text: "새 자료 스캔만" }),
      el("button", { type: "button", class: "btn sm ghost", "data-k": "stale:close", onclick: function () { S.staleClosed = true; renderHints(); }, text: "닫기" })
    ]));
  }
  if (!list.length) return;
  H.appendChild(el("div", { class: "hb-main" }, [
    el("p", {}, [el("strong", { text: "자료가 있을 만한 새 폴더 " + list.length + "개를 찾았습니다." }), " 스캔 대상에 넣을 폴더를 체크하세요."]),
    el("ul", { class: "hb-items" }, list.map(function (h) {
      return el("li", {}, [el("label", { class: "ck" }, [
        el("input", { type: "checkbox", "data-k": "hint:f:" + h.path, checked: !!h.checked, onchange: function (ev) { h.checked = ev.target.checked; } }),
        el("span", { class: "ck-t" }, [el("span", { class: "ck-l", text: h.label }), h.label !== h.path ? el("span", { class: "ck-s", text: h.path }) : null])
      ])]);
    }))
  ]));
  H.appendChild(el("div", { class: "hb-btns" }, [
    el("button", { type: "button", class: "btn sm primary", "data-k": "hint:add", disabled: busy(), title: busy() ? "작업이 끝난 뒤 추가할 수 있습니다" : "체크한 폴더는 추가하고, 체크하지 않은 폴더는 다시 묻지 않습니다", onclick: function () { answerHints(true); }, text: "체크한 폴더 추가" }),
    el("button", { type: "button", class: "btn sm", "data-k": "hint:no", disabled: busy(), onclick: function () { answerHints(false); }, text: "다시 묻지 않기" }),
    el("button", { type: "button", class: "btn sm ghost", "data-k": "hint:later", onclick: function () { S.hints = null; renderHints(); }, text: "나중에" })
  ]));
}

/* ---------- 작업 ---------- */
var BASE_TITLE = document.title;
/** 작업이 끝났을 때 다른 창에서 일하고 있어도 알 수 있게: 탭 제목·운영체제 알림 */
function askNotify() {
  try { if (window.Notification && Notification.permission === "default") Notification.requestPermission(); } catch (e) { /* 지원 안 함 */ }
}
function notifyDone(text, ok) {
  document.title = (ok ? "✓ " : "! ") + text + " · " + BASE_TITLE;
  try { if (document.hidden && window.Notification && Notification.permission === "granted") new Notification("MasterPortfolio", { body: text }); } catch (e) { /* 지원 안 함 */ }
}
function jobTitle() {
  var j = S.job;
  if (!j || !j.running) return;
  var p = j.progress, pct = p && p.overall !== null && p.overall !== undefined ? Math.round(p.overall * 100) + "% " : "";
  document.title = "(" + pct + (JOB_LABEL[j.kind] || j.kind) + " 중) " + BASE_TITLE;
}
document.addEventListener("visibilitychange", function () { if (!document.hidden && !busy() && document.title !== BASE_TITLE) document.title = BASE_TITLE; });
function startJob(kind) {
  if (busy()) return;
  askNotify();
  api("POST", "/api/job", { kind: kind }).then(function (r) {
    if (!r.ok) { toast(errMsg(r), "err"); return; }
    S.job = r.json.job; S.showLog = false;
    toast(JOB_LABEL[kind] + "을(를) 시작했습니다");
    render(); ensurePoll();
  }, netErr);
}
function stopJob() {
  if (!busy() || S.job.stopped) return;
  api("POST", "/api/job/stop", {}).then(function (r) {
    if (!r.ok) { toast(errMsg(r), "err"); return; }
    S.job = r.json.job; renderJob();
  }, netErr);
}
function ensurePoll() { if (S.polling) return; S.polling = true; setTimeout(tick, 1000); }
function tick() {
  api("GET", "/api/job").then(function (r) {
    if (r.ok) S.job = r.json.job;
    if (S.job && S.job.running) { renderJob(); jobTitle(); setTimeout(tick, 1000); return; }
    S.polling = false;
    if (S.job && S.job.stopped) { toast(JOB_LABEL[S.job.kind] + " 중지 — " + S.job.summary); notifyDone(JOB_LABEL[S.job.kind] + " 중지", true); }
    else if (S.job) {
      var okd = S.job.code === 0;
      notifyDone(JOB_LABEL[S.job.kind] + (okd ? " 완료" : " 실패") + (S.job.summary ? " — " + S.job.summary : ""), okd);
      toast(JOB_LABEL[S.job.kind] + (okd ? " 완료" + (S.job.summary ? " — " + S.job.summary : "") : " 실패(코드 " + S.job.code + ") — " + (S.job.summary || "로그를 확인하세요")), okd ? null : "err");
      if (!okd) S.showLog = true;
    }
    load();
  }, function () { setTimeout(tick, 2000); });
}
function renderJob() {
  if (!LIVE) return;
  var J = $("jobbar");
  J.hidden = false;
  var oldLog = J.querySelector(".jb-log");
  var stick = !oldLog || oldLog.scrollTop + oldLog.clientHeight >= oldLog.scrollHeight - 8;
  clear(J);
  var j = S.job, run = busy(), pend = todoCounts(S.exps).apply;
  var left = el("div", { class: "jb-left" });
  if (run) {
    left.appendChild(el("span", { class: "spin", "aria-hidden": "true" }));
    left.appendChild(el("strong", { text: (JOB_LABEL[j.kind] || j.kind) + (j.step ? " " + (j.step.index + 1) + "/" + j.step.count + " · " + (JOB_LABEL[j.step.kind] || j.step.kind) : "") + " 실행 중" }));
    var pr = j.progress;
    if (pr) {
      var pct = pr.overall !== null && pr.overall !== undefined ? pr.overall : (pr.total ? pr.done / pr.total : 0);
      var bar = el("span", { class: "jb-bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round(pct * 100)) });
      var fill = el("span", { class: "jb-fill" });
      fill.style.width = Math.max(2, Math.round(pct * 100)) + "%";
      bar.appendChild(fill);
      left.appendChild(bar);
      left.appendChild(el("span", { class: "jb-prog", text: progressText(pr) }));
    } else {
      left.appendChild(el("span", { class: "jb-line", text: j.lines.length ? j.lines[j.lines.length - 1] : "" }));
    }
    left.appendChild(el("button", { type: "button", class: "btn danger", "data-k": "job:stop", disabled: !!j.stopped,
      title: "작업과 에이전트를 멈춥니다. 이미 만든 카드는 저장되어 있고 다음 실행에서 이어서 처리합니다",
      onclick: stopJob, text: j.stopped ? "중지하는 중…" : "중지" }));
  } else {
    left.appendChild(el("span", {}, ["반영 대기 ", el("strong", { text: String(pend) }), "개"]));
    if (j) left.appendChild(el("span", { class: "jb-last " + (j.code === 0 || j.stopped ? "ok" : "err"), title: j.summary || "",
      text: "최근: " + (JOB_LABEL[j.kind] || j.kind) + (j.stopped ? " 중지" : j.code === 0 ? " 완료" : " 실패(코드 " + j.code + ")") + (j.summary ? " — " + j.summary : "") }));
  }
  if (j && j.lines.length) left.appendChild(el("button", { type: "button", class: "linklike", "data-k": "log", "aria-expanded": String(S.showLog),
    onclick: function () { S.showLog = !S.showLog; renderJob(); }, text: S.showLog ? "로그 닫기" : "로그 보기" }));
  var right = el("div", { class: "jb-right" }, [
    el("button", { type: "button", class: "btn primary", "data-k": "job:all", disabled: run, title: "새 자료 스캔 → 경험 묶기 → 반영 → 키워드 → master를 차례로 실행(에이전트 사용). 돌려 두고 다른 일을 하다 끝나면 알림을 받습니다", onclick: function () { startJob("all"); }, text: "한 번에 정리" }),
    el("span", { class: "jb-sep", "aria-hidden": "true" }),
    el("button", { type: "button", class: "btn", "data-k": "job:scan", disabled: run, title: "설정한 폴더에서 새로 생긴 자료를 찾아 카드로 만들기(바뀐 파일은 알려 주기만 함, 에이전트 사용)", onclick: function () { startJob("scan"); }, text: "새 자료 스캔" }),
    el("button", { type: "button", class: "btn", "data-k": "job:group", disabled: run, title: "아직 경험에 묶이지 않은 카드를 경험으로 묶기(에이전트 사용)", onclick: function () { startJob("group"); }, text: "경험 묶기" }),
    el("span", { class: "jb-sep", "aria-hidden": "true" }),
    el("button", { type: "button", class: "btn", "data-k": "job:apply", disabled: run || !pend, title: !pend ? "반영할 답이 없습니다" : "답변을 카드 필드·STAR에 반영(에이전트 사용)", onclick: function () { startJob("apply"); }, text: "반영 실행" }),
    el("button", { type: "button", class: "btn", "data-k": "job:keywords", disabled: run, title: "키워드가 빈 경험에 키워드 만들기(에이전트 사용)", onclick: function () { startJob("keywords"); }, text: "키워드 만들기" }),
    el("button", { type: "button", class: "btn", "data-k": "job:master", disabled: run, title: "master.md·master.html 다시 쓰기", onclick: function () { startJob("master"); }, text: "master 다시 만들기" }),
    el("span", { class: "jb-sep", "aria-hidden": "true" }),
    el("button", { type: "button", class: "btn", "data-k": "quit", disabled: run, title: "화면 서버를 끄고 MasterPortfolio를 마칩니다", onclick: shutdown, text: "종료" })
  ]);
  J.appendChild(left); J.appendChild(right);
  if (S.showLog && j) {
    var pre = el("pre", { class: "jb-log", tabindex: "0", text: j.lines.join("\n") || "(출력 없음)" });
    J.appendChild(pre);
    if (stick) pre.scrollTop = pre.scrollHeight;
  }
}

/* ---------- 인쇄용 문서 ---------- */
function renderPrint() {
  var D = clear($("printdoc"));
  var ad = S.exps.filter(function (e) { return e.review === "adopted"; });
  D.appendChild(el("h1", { text: "Master Record" }));
  D.appendChild(el("p", { class: "pd-sub", text: "채택한 경험 " + ad.length + "개" + (S.generatedAt ? " · " + S.generatedAt + " 생성" : "") }));
  groupList(ad, "category").forEach(function (g) {
    D.appendChild(el("h2", { text: g.label }));
    g.items.forEach(function (e) {
      var meta = [e.period, e.org, e.role || (e.team ? "팀 규모 " + e.team : null)].filter(Boolean).join(" · ");
      var kws = [e.keywords.length ? "키워드: " + e.keywords.join(", ") : null, e.outcome_keywords.length ? "성과 키워드: " + e.outcome_keywords.join(", ") : null].filter(Boolean).join(" · ");
      D.appendChild(el("article", {}, [
        el("h3", { text: e.title }),
        meta ? el("p", { class: "pd-meta", text: meta }) : null,
        e.contribution ? el("p", { text: "수행 방식: " + e.contribution }) : null,
        kws ? el("p", { text: kws }) : null,
        e.metrics.length ? el("ul", {}, e.metrics.map(function (m) { return el("li", { text: m }); })) : null,
        e.star ? el("dl", {}, [el("dt", { text: "S" }), el("dd", { text: e.star.s }), el("dt", { text: "T" }), el("dd", { text: e.star.t }),
          el("dt", { text: "A" }), el("dd", { text: e.star.a }), el("dt", { text: "R" }), el("dd", { text: e.star.r })]) : null
      ]));
    });
  });
}

/* ---------- 키보드·초기화 ---------- */
function editable(t) { return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable); }
document.addEventListener("keydown", function (ev) {
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  var t = ev.target;
  // 처음 설정·설정 화면이 열려 있으면 목록 단축키를 쓰지 않는다
  if (S.setup) return;
  if (S.settings) { if (ev.key === "Escape") settingsEsc(ev); return; }
  if (ev.key === "Escape") {
    if (editable(t)) { t.blur(); return; }
    if (S.fileView) { S.fileView = null; render(); return; }
    if (S.open) { ev.preventDefault(); closePanel(); return; }
    if (S.menu) { closeMenu(); return; }
    return;
  }
  if (editable(t)) return;
  if (ev.key === "/") { ev.preventDefault(); $("q").focus(); $("q").select(); return; }
  if (ev.key === "j" || ev.key === "k") {
    if (!S.order.length) return;
    ev.preventDefault();
    var i = S.order.indexOf(S.sel);
    i = i < 0 ? 0 : Math.max(0, Math.min(S.order.length - 1, i + (ev.key === "j" ? 1 : -1)));
    S.sel = S.order[i];
    if (S.open) openItem(S.sel); else markSel();
    focusRow(S.sel);
    return;
  }
  if (ev.key === "Enter" && S.sel && !(t && (t.tagName === "BUTTON" || t.tagName === "A"))) { ev.preventDefault(); openItem(S.sel); }
});
$("q").addEventListener("input", function () { S.q = this.value; S.activeG = null; render(); });
$("q").addEventListener("keydown", function (ev) {
  if (ev.key === "Enter" && S.order.length) { ev.preventDefault(); S.sel = S.order[0]; markSel(); focusRow(S.sel); }
});
$("print-btn").addEventListener("click", function () { window.print(); });
$("menu-btn").addEventListener("click", function () {
  S.menu = !S.menu; $("side").classList.toggle("open", S.menu); this.setAttribute("aria-expanded", String(S.menu));
});
window.addEventListener("beforeprint", renderPrint);

if (LIVE) { $("brand-sub").textContent = "로컬 편집 화면"; render(); load(); }
else {
  var data = JSON.parse($("data").textContent);
  S.exps = data.experiences || []; S.generatedAt = data.generatedAt || "";
  $("brand-sub").textContent = S.generatedAt ? S.generatedAt + " 생성" : "읽기 전용";
  renderPrint(); render();
}
`;

/** 단일 HTML 앱(인라인 CSS·JS, 외부 리소스 없음). live는 mp ui 서버용, static은 master.html(읽기 전용, 채택만) */
export function renderApp(o: AppOptions): string {
  const live = o.mode === "live";
  const head = `var MODE = ${safeJson(o.mode)};\nvar TOKEN = ${live ? safeJson(o.token) : "null"};\n`;
  const data = live ? "" : `<script type="application/json" id="data">${safeJson({ generatedAt: o.generatedAt, experiences: o.data })}</script>\n`;
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Master Record</title>
<style>${CSS}${live ? SETUP_CSS : ""}</style>
</head>
<body>
<div class="app" id="app">
<aside class="side" id="side" aria-label="목차와 필터">
  <div class="brand">
    <div><div class="brand-name">Master Record</div><div class="brand-sub" id="brand-sub"></div></div>
    <button type="button" class="btn sm menu-btn" id="menu-btn" aria-expanded="false" aria-controls="side-body">목차·필터</button>
  </div>
  <div class="side-body" id="side-body"></div>
</aside>
<main class="main" id="main">
  <div class="topbar">
    <div class="search"><input id="q" type="search" placeholder="제목·키워드·기술·성과로 찾기" aria-label="경험 찾기" autocomplete="off" spellcheck="false"><kbd aria-hidden="true">/</kbd></div>
    <div class="tb-info" id="tb-info" aria-live="polite"></div>
    <button type="button" class="btn" id="print-btn">인쇄·PDF</button>
  </div>
${live ? `  <div class="hintbar" id="hintbar" role="status" hidden></div>\n` : ""}  <div class="bulk" id="bulk" hidden></div>
  <div class="list" id="list"></div>
  <p class="hint"><kbd>/</kbd> 찾기 · <kbd>j</kbd> <kbd>k</kbd> 이동 · <kbd>Enter</kbd> 열기 · <kbd>Esc</kbd> 닫기</p>
</main>
<aside class="panel" id="panel" aria-label="경험 상세" aria-hidden="true"></aside>
${live ? `<div class="jobbar" id="jobbar" hidden></div>\n` : ""}</div>
${live ? `<div class="setup" id="setup" hidden></div>\n<div class="overlay" id="settings" role="dialog" aria-modal="true" aria-labelledby="set-title" hidden></div>\n` : ""}<div class="toast" id="toast" role="status" aria-live="polite"></div>
<div id="printdoc"></div>
${data}<script>
(function () {
"use strict";
${head}${LOGIC_JS}${live ? SETUP_JS : ""}${APP_JS}
})();
</script>
</body>
</html>
`;
}
