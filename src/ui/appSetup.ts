/**
 * 처음 설정 마법사와 설정 화면(11.6). mp ui(live)에서만 넣는다 — master.html(static)에는 없다.
 * app.ts의 APP_JS·LOGIC_JS와 같은 스코프에서 돈다(el, api, toast, S, keepFocus 등을 그대로 쓴다).
 * 데이터는 모두 textContent·속성으로만 넣는다. alert/confirm/prompt는 쓰지 않는다(자동화를 막는다).
 */
export const SETUP_CSS = `
.app[hidden],.setup[hidden],.overlay[hidden]{display:none}
.setup{max-width:780px;margin:0 auto;padding:28px 20px 80px}
.su-head{display:flex;align-items:baseline;gap:10px;margin:0 2px 16px}
.steps{list-style:none;margin:0 0 12px;padding:0;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}
.st{display:flex;align-items:center;gap:8px;min-width:0;padding:8px 10px;border:1px solid var(--line);border-radius:10px;background:var(--surface);font-size:13px;color:var(--ink-3)}
.st.on{border-color:var(--accent);background:var(--accent-soft);color:var(--accent-soft-ink);font-weight:650}
.st.done{color:var(--ink-2)}
.st-n{flex:none;display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--surface-3);font-size:12px;font-weight:700;font-variant-numeric:tabular-nums}
.st.on .st-n{background:var(--accent);color:var(--accent-ink)}
.st.done .st-n{background:var(--s-adopted);color:var(--surface)}
.st-l{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:20px 22px}
.card+.card{margin-top:12px}
.card h2{margin:0 0 2px;font-size:15px;letter-spacing:-.005em}
.su-title{margin:0 0 4px;font-size:19px;line-height:1.35;letter-spacing:-.01em;outline:0}
.lead{margin:0 0 14px;color:var(--ink-2);font-size:13.5px}
.inp{width:100%;min-width:0;height:36px;padding:0 10px;border:1px solid var(--line-2);border-radius:8px;background:var(--surface);color:var(--ink);outline:0}
.inp:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.inline{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.inline .inp{flex:1 1 240px;width:auto}
.inline .btn{height:36px}
.sub-h{display:block;margin:18px 0 6px;font-size:12px;font-weight:700;color:var(--ink-3);letter-spacing:.03em}
.sub-h .count{margin-left:6px}
.kwc-list{display:flex;flex-wrap:wrap;gap:6px}
.kwc{display:inline-flex;align-items:center;gap:6px;padding:4px 12px 4px 9px;border:1px solid var(--line-2);border-radius:999px;font-size:13px;cursor:pointer}
.kwc input{margin:0;accent-color:var(--accent)}
.kwc:has(input:checked){border-color:var(--accent);background:var(--accent-soft);color:var(--accent-soft-ink)}
.cklist{list-style:none;margin:0;padding:0;border:1px solid var(--line);border-radius:10px;overflow:hidden}
.cklist li{border-top:1px solid var(--line)}
.cklist li:first-child{border-top:0}
.ck{display:flex;align-items:flex-start;gap:10px;padding:8px 12px;cursor:pointer}
.ck:hover{background:var(--surface-2)}
.ck input{flex:none;width:16px;height:16px;margin:3px 0 0;accent-color:var(--accent)}
.ck-t{display:flex;flex-direction:column;min-width:0}
.ck-l{overflow-wrap:anywhere}
.ck-s{font-size:12px;color:var(--ink-3);overflow-wrap:anywhere}
.frow{display:flex;align-items:center;gap:10px;padding:6px 8px 6px 12px}
.frow .ck-l{flex:1;font-size:13.5px}
.plans{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:12px 0 0;padding:0;border:0;min-width:0}
.plans legend{padding:0;margin:0 0 6px;font-size:12px;font-weight:700;color:var(--ink-3);letter-spacing:.03em}
.plan{display:flex;align-items:flex-start;gap:9px;padding:11px 12px;border:1px solid var(--line-2);border-radius:10px;cursor:pointer}
.plan:hover{border-color:var(--ink-3)}
.plan:has(input:checked){border-color:var(--accent);background:var(--accent-soft);color:var(--accent-soft-ink)}
.plan input{margin:3px 0 0;accent-color:var(--accent)}
.plan b{display:block;font-size:14px}
.plan small{font-size:12px;color:var(--ink-3)}
.plan:has(input:checked) small{color:inherit;opacity:.85}
.su-foot{display:flex;align-items:center;gap:8px;margin-top:20px;padding-top:16px;border-top:1px solid var(--line)}
.su-foot .btn{height:36px;padding:0 16px}
.errs{margin:12px 0 0;padding:10px 12px 10px 30px;border-radius:9px;background:color-mix(in srgb,var(--danger) 10%,transparent);color:var(--danger);font-size:13px;overflow-wrap:anywhere}
.errs li+li{margin-top:2px}
.ov-in>.errs{margin:0 0 12px}
.pickmsg{margin:8px 0 0;font-size:12.5px;color:var(--ink-2)}
.pickmsg.err{color:var(--danger)}
.sum{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px 16px;margin:0}
.sum dt{padding-top:1px;font-size:12px;font-weight:700;color:var(--ink-3);white-space:nowrap}
.sum dd{margin:0;overflow-wrap:anywhere}
.sum ul{margin:0;padding-left:18px}
.checks{list-style:none;margin:12px 0 0;padding:0;display:flex;flex-direction:column;gap:6px}
.chk{display:grid;grid-template-columns:20px minmax(0,1fr);gap:2px 8px;padding:8px 10px;border-radius:8px;background:var(--surface-2);font-size:13.5px}
.chk-m{font-weight:800;text-align:center}
.chk.is-ok .chk-m{color:var(--ok)}
.chk.is-fail .chk-m{color:var(--danger)}
.chk.is-warn{background:var(--warn-bg);color:var(--warn-ink)}
.chk-l{overflow-wrap:anywhere}
.chk-f{grid-column:2;font-size:12.5px;color:var(--ink-2);overflow-wrap:anywhere}
.waiting{display:flex;align-items:center;gap:8px;margin-top:12px;font-size:13px;color:var(--ink-2)}
.side-set{margin:auto 0 0;align-self:flex-start}
.side-set+.side-foot{margin-top:8px}
.overlay{position:fixed;inset:0;z-index:40;overflow:auto;background:var(--bg)}
.ov-in{max-width:860px;margin:0 auto;padding:0 20px 64px}
.ov-head{position:sticky;top:0;z-index:2;display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;padding:16px 0 12px;background:var(--bg)}
.ov-head h1{margin:0;font-size:19px;letter-spacing:-.01em;outline:0}
.dirty{font-size:12px;color:var(--warn-ink);background:var(--warn-bg);border-radius:999px;padding:1px 9px}
.ov-head .warn{flex-basis:100%;margin-top:4px}
.share{display:flex;align-items:center;gap:10px;margin-top:6px}
.share input[type=range]{flex:1;min-width:0;accent-color:var(--accent)}
.share .inp{width:84px;flex:none}
.tbl-tools{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:10px 0 8px}
.tbl-tools .inp{flex:1 1 220px;width:auto;height:32px}
.tbl{width:100%;border-collapse:collapse;font-size:13px}
.tbl th{padding:6px 8px;border-bottom:1px solid var(--line);text-align:left;font-size:11.5px;font-weight:700;color:var(--ink-3);white-space:nowrap}
.tbl td{padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:middle}
.tbl td.path{width:100%;font:12.5px/1.45 ui-monospace,"D2Coding",Consolas,monospace;overflow-wrap:anywhere;word-break:break-all}
.tbl td.nw{white-space:nowrap}
.tbl tr.cf td{background:var(--warn-bg);color:var(--warn-ink)}
.cf-in{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.cf-in p{margin:0;flex:1 1 260px}
.btn.danger{background:var(--danger);border-color:var(--danger);color:var(--surface);font-weight:650}
.dec-include{color:var(--ok);font-weight:650}
.dec-exclude{color:var(--ink-3);font-weight:650}
.mono{font:12.5px/1.5 ui-monospace,"D2Coding",Consolas,monospace;overflow-wrap:anywhere}
@media (max-width:640px){
.setup{padding:18px 16px 64px}
.card{padding:16px}
.steps{display:flex}
.st{flex:none}
.st.on{flex:1}
.st:not(.on) .st-l{display:none}
.plans{grid-template-columns:minmax(0,1fr)}
.ov-in{padding:0 16px 64px}
.tbl thead{display:none}
.tbl,.tbl tbody,.tbl tr,.tbl td{display:block}
.tbl tr{display:grid;grid-template-columns:auto auto auto minmax(0,1fr);gap:4px 10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line)}
.tbl td{padding:0;border:0}
.tbl td.path{grid-column:1/-1}
.tbl td.act{justify-self:end}
.tbl tr.cf{display:block;padding:0}
.tbl tr.cf td{padding:10px}
}
`;

export const SETUP_JS = String.raw`
/* ---------- 공통: 폴더 선택 창·환경 점검 ---------- */
function pickFolder(ctx, target, initial, title, done, rr) {
  if (ctx.picking) return;
  ctx.picking = target; ctx.pickMsg = null; rr();
  api("POST", "/api/pick-folder", { initial: initial || undefined, title: title }).then(function (r) {
    ctx.picking = null;
    if (r.ok) { if (r.json.path) done(r.json.path); }
    else ctx.pickMsg = { target: target, text: errMsg(r) + (r.status === 400 ? " — 경로를 직접 입력하세요." : "") };
    rr();
  }, function () { ctx.picking = null; netErr(); rr(); });
}
function pickNote(ctx, target) {
  if (ctx.picking === target) return el("p", { class: "pickmsg", role: "status", text: "폴더 선택 창을 확인하세요. 다른 창 뒤에 가려져 있을 수 있습니다." });
  if (ctx.pickMsg && ctx.pickMsg.target === target) return el("p", { class: "pickmsg err", role: "alert", text: ctx.pickMsg.text });
  return null;
}
function runCheck(ctx, rr) {
  if (ctx.checking) return;
  ctx.checking = true; rr();
  api("POST", "/api/check", {}).then(function (r) {
    ctx.checking = false;
    ctx.checks = r.ok ? r.json.items : [{ ok: false, label: "점검하지 못했습니다", fix: errMsg(r) }];
    rr();
  }, function () { ctx.checking = false; netErr(); rr(); });
}
var MARK = { ok: "✔", warn: "!", fail: "✘" };
var MARK_SR = { ok: "통과", warn: "주의", fail: "실패" };
function checkList(ctx) {
  var out = [];
  if (ctx.checking) out.push(el("p", { class: "waiting", role: "status" }, [el("span", { class: "spin", "aria-hidden": "true" }), "점검 중 · Claude 연결 확인 중… 최대 1분"]));
  if (ctx.checks) out.push(el("ul", { class: "checks", "aria-label": "점검 결과" }, ctx.checks.map(function (it) {
    var m = checkMark(it);
    return el("li", { class: "chk is-" + m }, [
      el("span", { class: "chk-m", "aria-hidden": "true", text: MARK[m] }),
      el("span", { class: "chk-l" }, [el("span", { class: "sr", text: MARK_SR[m] + ": " }), it.label]),
      it.fix ? el("span", { class: "chk-f", text: "해결: " + it.fix }) : null
    ]);
  })));
  return out;
}
function errList(errs) {
  return errs && errs.length ? el("ul", { class: "errs", role: "alert" }, errs.map(function (e) { return el("li", { text: e }); })) : null;
}
function inp(k, val, set, a) {
  var o = { type: "text", class: "inp", "data-k": k, value: val, autocomplete: "off", spellcheck: "false", oninput: function (ev) { set(ev.target.value); } };
  Object.keys(a || {}).forEach(function (x) { o[x] = a[x]; });
  return el("input", o);
}
/** Enter로 폼 제출(다음) 대신 다른 동작을 하는 입력칸 */
function onEnter(fn) { return function (ev) { if (ev.key === "Enter" && !ev.isComposing) { ev.preventDefault(); ev.stopPropagation(); fn(); } }; }
function stripQuotes(p) { var s = String(p || "").trim(); return s.length >= 2 && /^(["']).*\1$/.test(s) ? s.slice(1, -1).trim() : s; }

/* ---------- 처음 설정 마법사 ---------- */
var W = null;
var STEPS = ["대학", "폴더", "요금제·결과 폴더", "점검"];
var PLAN_HELP = { 1: "기준 (1배)", 5: "Pro의 5배", 20: "Pro의 20배" };

function wizInit() {
  return { step: 1, university: "", sugUni: null, keywords: [], kwIn: "", folders: [], pathIn: "", planScale: 1, output: "", outputAuto: true,
    errs: [], busy: null, picking: null, pickMsg: null, saved: false, savedOut: "", checks: null, checking: false };
}
function enterSetup() {
  S.setup = true;
  $("app").hidden = true; $("setup").hidden = false;
  $("brand-sub").textContent = "처음 설정";
  if (W) { renderSetup(); return; }
  W = wizInit();
  renderSetup(); focusStep();
  suggestFor("", null);
}
function suggestFor(uni, then) {
  W.busy = "suggest"; renderSetup();
  api("GET", "/api/setup/suggest?university=" + encodeURIComponent(uni)).then(function (r) {
    if (!W) return;
    W.busy = null;
    if (!r.ok) { toast(errMsg(r), "err"); renderSetup(); return; }
    var j = r.json;
    W.sugUni = uni;
    if (uni) {
      var old = {};
      W.keywords.forEach(function (k) { old[k.text] = k; });
      var next = j.keywords.map(function (t) { return { text: t, checked: old[t] ? old[t].checked : true, manual: false }; });
      W.keywords.forEach(function (k) { if (k.manual && !next.some(function (n) { return n.text === k.text; })) next.push(k); });
      W.keywords = next;
    }
    W.folders = mergeFolders(W.folders, j.folders || []);
    if (W.outputAuto && j.defaultOutput) W.output = j.defaultOutput;
    renderSetup();
    if (then) then();
  }, function () { if (W) { W.busy = null; netErr(); renderSetup(); } });
}
function goStep(n) {
  W.step = n; W.errs = []; W.pickMsg = null;
  renderSetup(); focusStep();
  window.scrollTo(0, 0);
}
function focusStep() {
  var f = W.step === 1 ? document.querySelector('[data-k="w:uni"]') : $("su-title");
  if (f) f.focus({ preventScroll: true });
}
function wizFind() {
  var u = W.university.trim();
  if (!u) { W.errs = ["대학 이름을 입력하거나 [건너뛰기]를 누르세요"]; renderSetup(); return; }
  W.errs = []; suggestFor(u, null);
}
function wizSkip() {
  W.university = ""; W.keywords = []; W.sugUni = "";
  W.folders = W.folders.filter(function (f) { return f.kind !== "keyword" || f.checked; });
  goStep(2);
}
function wizNext() {
  if (!W || W.busy) return;
  if (W.step === 1) {
    var u = W.university.trim();
    if (u && u !== W.sugUni) { suggestFor(u, function () { goStep(2); }); return; }
    goStep(2); return;
  }
  if (W.step < 4) {
    var e = wizardErrors(W.step, W);
    if (e.length) { W.errs = e; renderSetup(); return; }
    goStep(W.step + 1); return;
  }
  if (!W.saved) saveSetup(); else finishSetup();
}
/** 폼 제출(Enter): 포커스한 입력칸에 따라 추가·찾기, 그 밖은 다음 (한글 조합 중 Enter가 제출로 이어져도 같은 결과) */
function wizSubmit() {
  var a = document.activeElement, k = a && a.getAttribute ? a.getAttribute("data-k") : null;
  if (k === "w:uni") wizFind();
  else if (k === "w:kwin") wizAddKw();
  else if (k === "w:path") wizAddPath(W.pathIn);
  else wizNext();
}
function wizPrev() { if (W.step > 1 && !W.saved && !W.busy) goStep(W.step - 1); }
function wizAddKw() {
  var t = W.kwIn.trim();
  if (!t) return;
  var ex = W.keywords.filter(function (k) { return k.text === t; })[0];
  if (ex) ex.checked = true; else W.keywords.push({ text: t, checked: true, manual: true });
  W.kwIn = ""; renderSetup();
}
function wizAddPath(p) {
  if (!W) return;
  var s = stripQuotes(p);
  if (!s) return;
  W.folders = addFolderTo(W.folders, s); W.pathIn = ""; W.errs = [];
  renderSetup();
}
function saveSetup() {
  var e = wizardErrors(2, W).concat(wizardErrors(3, W));
  if (e.length) { W.errs = e; renderSetup(); return; }
  postSetup(setupPayload(W));
}
/** adopt: 고른 결과 폴더에 이미 있는 MasterPortfolio 설정을 그대로 쓴다(덮어쓰지 않음) */
function postSetup(payload) {
  W.busy = "save"; W.errs = []; W.existing = null; renderSetup();
  api("POST", "/api/setup", payload).then(function (r) {
    W.busy = null;
    if (r.status === 409 && r.json && r.json.existing) {
      W.existing = r.json.existing; W.errs = [errMsg(r)];
      renderSetup(); return;
    }
    if (r.ok || r.status === 409) {
      W.saved = true; W.savedOut = r.ok ? r.json.output : W.output.trim();
      renderSetup(); focusStep();
      runCheck(W, renderSetup);
      return;
    }
    W.errs = r.json && r.json.errors && r.json.errors.length ? r.json.errors : [errMsg(r)];
    renderSetup();
  }, function () { W.busy = null; netErr(); renderSetup(); });
}
function finishSetup() {
  W = null; S.setup = false; S.loading = true;
  clear($("setup")); $("setup").hidden = true; $("app").hidden = false;
  $("brand-sub").textContent = "로컬 편집 화면";
  render();
  load().then(function () { toast("설정을 마쳤습니다. 아래 [새 자료 스캔]으로 자료를 찾아보세요"); var b = document.querySelector('[data-k="job:scan"]'); if (b) b.focus(); });
}

function renderSetup() {
  if (!W) return;
  keepFocus(function () {
    var R = clear($("setup"));
    var st = W.step;
    R.appendChild(el("header", { class: "su-head" }, [el("span", { class: "brand-name", text: "Master Record" }), el("span", { class: "brand-sub", text: "처음 설정" })]));
    R.appendChild(el("ol", { class: "steps", "aria-label": "설정 단계" }, STEPS.map(function (s, i) {
      var n = i + 1, on = n === st, done = n < st || (n === 4 && W.saved);
      return el("li", { class: "st" + (on ? " on" : done ? " done" : ""), "aria-current": on ? "step" : null }, [
        el("span", { class: "st-n", "aria-hidden": "true", text: done && !on ? "✓" : String(n) }),
        el("span", { class: "st-l" }, [el("span", { class: "sr", text: n + "단계 " }), s, done && !on ? el("span", { class: "sr", text: " (완료)" }) : null])
      ]);
    })));
    var body = st === 1 ? step1() : st === 2 ? step2() : st === 3 ? step3() : step4();
    body.push(errList(W.errs));
    if (W.existing) {
      var ex = W.existing;
      body.push(el("div", { class: "su-row" }, [
        el("button", { type: "button", class: "btn primary", "data-k": "w:adopt", disabled: !!W.busy,
          onclick: function () { var p = setupPayload(W); p.adopt = true; p.output = ex; postSetup(p); }, text: "기존 결과 그대로 사용" }),
        el("span", { class: "muted small", text: "또는 3단계에서 다른 결과 폴더를 고르세요" })
      ]));
    }
    body.push(wizFoot());
    R.appendChild(el("form", { class: "card su-card", novalidate: true, "aria-labelledby": "su-title",
      onsubmit: function (ev) { ev.preventDefault(); wizSubmit(); } }, body));
  });
}
function wizFoot() {
  var b = !!W.busy;
  if (W.step === 4 && W.saved) return el("div", { class: "su-foot" }, [
    el("button", { type: "button", class: "btn", "data-k": "w:recheck", disabled: W.checking, onclick: function () { runCheck(W, renderSetup); }, text: "다시 점검" }),
    el("span", { class: "grow" }),
    el("button", { type: "submit", class: "btn primary", "data-k": "w:start", text: "시작하기" })
  ]);
  return el("div", { class: "su-foot" }, [
    el("button", { type: "button", class: "btn", "data-k": "w:prev", disabled: W.step === 1 || b, onclick: wizPrev, text: "이전" }),
    el("span", { class: "grow" }),
    W.step === 1 ? el("button", { type: "button", class: "btn ghost", "data-k": "w:skip", disabled: b, onclick: wizSkip, text: "건너뛰기" }) : null,
    el("button", { type: "submit", class: "btn primary", "data-k": "w:next", disabled: b,
      text: W.step === 4 ? (W.busy === "save" ? "저장 중…" : "설정 저장") : "다음" })
  ]);
}
function stepHead(title, lead) {
  return [el("h1", { class: "su-title", id: "su-title", tabindex: "-1", text: title }), lead ? el("p", { class: "lead", text: lead }) : null];
}
function step1() {
  var out = stepHead("어느 대학에 다니나요?", "대학 이름으로 약칭·영문명을 찾아 자료 폴더를 고르는 데 씁니다. 대학과 관계없이 쓰려면 [건너뛰기]를 누르세요.");
  out.push(el("label", { class: "sub-h", for: "w-uni", text: "대학 이름" }));
  out.push(el("div", { class: "inline" }, [
    inp("w:uni", W.university, function (v) { W.university = v; }, { id: "w-uni", placeholder: "예: 연세대학교", onkeydown: onEnter(wizFind) }),
    el("button", { type: "button", class: "btn", "data-k": "w:find", disabled: !!W.busy, onclick: wizFind, text: W.busy === "suggest" && W.university.trim() ? "찾는 중…" : "이름 찾기" })
  ]));
  if (W.keywords.length) {
    out.push(el("h3", { class: "sub-h" }, ["검색 이름", el("span", { class: "count", text: W.keywords.filter(function (k) { return k.checked; }).length + "/" + W.keywords.length })]));
    out.push(el("p", { class: "lead small", text: "폴더·파일 이름에서 찾을 이름입니다. 쓰지 않을 이름은 체크를 푸세요." }));
    out.push(el("div", { class: "kwc-list", role: "group", "aria-label": "검색 이름" }, W.keywords.map(function (k, i) {
      return el("label", { class: "kwc" }, [el("input", { type: "checkbox", "data-k": "w:kw:" + k.text, checked: k.checked,
        onchange: function (ev) { W.keywords[i].checked = ev.target.checked; renderSetup(); } }), k.text]);
    })));
  }
  if (W.sugUni !== null && W.sugUni !== "" || W.keywords.length) out.push(el("div", { class: "inline", style: "margin-top:10px" }, [
    inp("w:kwin", W.kwIn, function (v) { W.kwIn = v; }, { placeholder: "검색 이름 추가 (예: 학교 약칭)", "aria-label": "검색 이름 추가", onkeydown: onEnter(wizAddKw) }),
    el("button", { type: "button", class: "btn", "data-k": "w:kwadd", onclick: wizAddKw, text: "추가" })
  ]));
  return out;
}
function step2() {
  var n = W.folders.filter(function (f) { return f.checked; }).length;
  var out = stepHead("어느 폴더에서 자료를 찾을까요?", "체크한 폴더 안의 문서·보고서·발표 자료를 찾아 분석합니다. 나중에 설정에서 바꿀 수 있습니다.");
  out.push(el("div", { class: "inline" }, [
    el("button", { type: "button", class: "btn", "data-k": "w:pick", disabled: !!W.picking, onclick: function () {
      pickFolder(W, "folders", "", "스캔할 폴더 선택", wizAddPath, renderSetup); }, text: "폴더 선택…" }),
    inp("w:path", W.pathIn, function (v) { W.pathIn = v; }, { placeholder: "또는 경로 입력 (예: D:\\자료)", "aria-label": "폴더 경로 입력", onkeydown: onEnter(function () { wizAddPath(W.pathIn); }) }),
    el("button", { type: "button", class: "btn", "data-k": "w:padd", onclick: function () { wizAddPath(W.pathIn); }, text: "추가" })
  ]));
  out.push(pickNote(W, "folders"));
  var wsl = W.folders.filter(function (f) { return f.kind === "wsl"; });
  if (wsl.length) out.push(el("p", { class: "note", "data-k": "w:wslnote", role: "status",
    text: "WSL(리눅스)에서 자료가 있을 만한 폴더 " + wsl.length + "개를 찾아 스캔 대상에 넣었습니다(홈 폴더 전체는 넣지 않음). 원치 않으면 아래에서 체크를 끄세요." }));
  if (!W.folders.length) out.push(el("p", { class: "lead", style: "margin-top:14px", text: W.busy === "suggest" ? "폴더를 찾는 중…" : "제안할 폴더가 없습니다. [폴더 선택]이나 경로 입력으로 추가하세요." }));
  groupFolders(W.folders).forEach(function (g) {
    var c = g.items.filter(function (f) { return f.checked; }).length;
    out.push(el("h3", { class: "sub-h", id: "fg-" + g.key }, [g.label, el("span", { class: "count", text: c + "/" + g.items.length })]));
    out.push(el("ul", { class: "cklist", "aria-labelledby": "fg-" + g.key }, g.items.map(function (f) {
      return el("li", {}, [el("label", { class: "ck" }, [
        el("input", { type: "checkbox", "data-k": "w:f:" + f.path, checked: f.checked, onchange: function (ev) { f.checked = ev.target.checked; W.errs = []; renderSetup(); } }),
        el("span", { class: "ck-t" }, [el("span", { class: "ck-l", text: f.label }), f.label !== f.path ? el("span", { class: "ck-s", text: f.path }) : null])
      ])]);
    })));
  });
  out.push(el("p", { class: "lead small", style: "margin:12px 0 0", text: "선택한 폴더 " + n + "개" }));
  return out;
}
function step3() {
  var out = stepHead("요금제와 결과 폴더", null);
  out.push(el("fieldset", { class: "plans" }, [el("legend", { text: "Claude 요금제 · 사용량 예산을 Pro 기준으로 환산" })].concat(PLANS.map(function (p) {
    return el("label", { class: "plan" }, [
      el("input", { type: "radio", name: "w-plan", "data-k": "w:plan:" + p[0], checked: W.planScale === p[0], onchange: function () { W.planScale = p[0]; W.errs = []; renderSetup(); } }),
      el("span", {}, [el("b", { text: p[1] }), el("small", { text: PLAN_HELP[p[0]] })])
    ]);
  }))));
  out.push(el("label", { class: "sub-h", for: "w-out", text: "결과 폴더" }));
  out.push(el("p", { class: "lead small", style: "margin:0 0 8px", text: "경험 카드와 master 파일을 저장할 폴더입니다. 없으면 만듭니다. 스캔 폴더와 달라야 합니다." }));
  out.push(el("div", { class: "inline" }, [
    inp("w:out", W.output, function (v) { W.output = v; W.outputAuto = false; }, { id: "w-out", placeholder: "결과 폴더 경로" }),
    el("button", { type: "button", class: "btn", "data-k": "w:opick", disabled: !!W.picking, onclick: function () {
      pickFolder(W, "output", W.output, "결과 폴더 선택", function (p) { if (W) { W.output = p; W.outputAuto = false; } }, renderSetup); }, text: "폴더 선택…" })
  ]));
  out.push(pickNote(W, "output"));
  return out;
}
function step4() {
  if (W.saved) {
    var out = stepHead("환경 점검", "설정을 저장했습니다. 이 PC에서 분석할 준비가 됐는지 확인합니다.");
    out.push(el("dl", { class: "sum" }, [el("dt", { text: "결과 폴더" }), el("dd", { class: "mono", text: W.savedOut })]));
    out = out.concat(checkList(W));
    if (W.checks && !W.checking) out.push(el("p", { class: "lead small", style: "margin:12px 0 0",
      text: W.checks.every(function (c) { return c.ok || c.warn; }) ? "준비됐습니다. [시작하기]를 누르세요." : "실패한 항목이 있어도 시작할 수 있습니다. 분석 작업 전에 해결하고 설정 화면에서 다시 점검하세요." }));
    return out;
  }
  var p = setupPayload(W);
  var plan = PLANS.filter(function (x) { return x[0] === W.planScale; })[0];
  var o = stepHead("이대로 저장할까요?", "저장하면 결과 폴더를 만들고 설정 파일을 씁니다. 다음으로 환경을 점검합니다.");
  o.push(el("dl", { class: "sum" }, [
    el("dt", { text: "대학" }), el("dd", { text: p.university || "건너뜀" }),
    el("dt", { text: "검색 이름" }), el("dd", { text: p.keywords.length ? p.keywords.join(", ") : "없음" }),
    el("dt", { text: "스캔 폴더 " + p.folders.length + "개" }), el("dd", {}, [el("ul", {}, p.folders.map(function (f) { return el("li", { class: "mono", text: f }); }))]),
    el("dt", { text: "요금제" }), el("dd", { text: plan ? plan[1] : "-" }),
    el("dt", { text: "결과 폴더" }), el("dd", { class: "mono", text: p.output })
  ]));
  return o;
}
document.addEventListener("keydown", function (ev) {
  // 마법사: 입력칸·버튼 밖(제목, 체크 상자 등)에서 Enter도 다음
  if (!S.setup || !W || ev.key !== "Enter" || ev.isComposing || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  var t = ev.target, tag = t && t.tagName;
  if (tag === "BUTTON" || tag === "A" || tag === "TEXTAREA" || tag === "SELECT" || (tag === "INPUT" && t.type !== "checkbox" && t.type !== "radio")) return;
  ev.preventDefault(); wizNext();
});

/* ---------- 설정 화면 ---------- */
var ST = null;
function formOf(j) { return { scanFolders: j.scanFolders.slice(), planScale: j.planScale, fiveHourShare: j.fiveHourShare, keywords: j.keywords.join(", ") }; }
function openSettings() {
  if (S.settings) return;
  ST = { data: null, err: null, form: null, base: null, pct: "", pathIn: "", sugg: null, suggBusy: false, scopeQ: "", confirm: null,
    checks: null, checking: false, saving: false, errs: [], picking: null, pickMsg: null, leave: false };
  S.settings = true; closeMenu();
  $("app").inert = true; $("settings").hidden = false;
  renderSettings();
  fetchSettings(true, true);
}
function fetchSettings(resetForm, focus) {
  return api("GET", "/api/settings").then(function (r) {
    if (!ST) return;
    if (!r.ok) { ST.err = errMsg(r); renderSettings(); return; }
    ST.err = null; ST.data = r.json;
    if (resetForm || !ST.form) { ST.form = formOf(r.json); ST.base = formOf(r.json); ST.pct = String(Math.round(r.json.fiveHourShare * 100)); }
    renderSettings();
    if (focus) { var t = $("set-title"); if (t) t.focus(); }
  }, function () { if (ST) { ST.err = "서버에 연결할 수 없습니다. 터미널에서 mp ui가 실행 중인지 확인하세요."; renderSettings(); } });
}
function setDirty() { return !!(ST && ST.form && (Object.keys(settingsDiff(ST.form, ST.base)).length || pctToShare(ST.pct) !== ST.base.fiveHourShare)); }
function closeSettings(force) {
  if (!ST) return;
  if (!force && setDirty()) { ST.leave = true; renderSettings(); var k = document.querySelector('[data-k="set:stay"]'); if (k) k.focus(); return; }
  ST = null; S.settings = false;
  clear($("settings")); $("settings").hidden = true; $("app").inert = false;
  var b = document.querySelector('[data-k="settings"]');
  if (b && b.offsetParent) b.focus(); else if ($("q")) $("q").focus();
}
function settingsEsc(ev) {
  var t = ev.target;
  if (editable(t)) { t.blur(); return; }
  ev.preventDefault();
  if (ST && ST.confirm) { ST.confirm = null; renderSettings(); }
  else if (ST && ST.leave) { ST.leave = false; renderSettings(); }
  else closeSettings(false);
}
function setAddPath(p) {
  if (!ST) return;
  var s = stripQuotes(p);
  if (!s) return;
  var k = folderKey(s);
  if (ST.form.scanFolders.some(function (f) { return folderKey(f) === k; })) { toast("이미 목록에 있는 폴더입니다"); return; }
  ST.form.scanFolders.unshift(s); ST.pathIn = ""; ST.errs = [];
  renderSettings();
}
function saveSettings() {
  if (!ST || !ST.form || ST.saving) return;
  var share = pctToShare(ST.pct);
  if (share === null) { ST.errs = ["예산 비율은 5~100 사이 숫자로 입력하세요"]; renderSettings(); return; }
  ST.form.fiveHourShare = share;
  var body = settingsDiff(ST.form, ST.base);
  if (!Object.keys(body).length) { toast("바뀐 내용이 없습니다"); return; }
  if (body.scanFolders && !body.scanFolders.length) { ST.errs = ["스캔할 폴더를 하나 이상 남겨 두세요"]; renderSettings(); return; }
  ST.saving = true; ST.errs = []; renderSettings();
  api("POST", "/api/settings", body).then(function (r) {
    if (!ST) return;
    ST.saving = false;
    if (r.ok) { toast("설정을 저장했습니다"); ST.leave = false; fetchSettings(true, false); return; }
    ST.errs = r.json && r.json.errors && r.json.errors.length ? r.json.errors : [errMsg(r)];
    renderSettings();
  }, function () { if (ST) { ST.saving = false; netErr(); renderSettings(); } });
}
function showSuggest() {
  if (!ST || !ST.data || ST.suggBusy) return;
  ST.suggBusy = true; renderSettings();
  api("GET", "/api/setup/suggest?university=" + encodeURIComponent(ST.data.university || "")).then(function (r) {
    if (!ST) return;
    ST.suggBusy = false;
    if (r.ok) ST.sugg = r.json.folders || []; else toast(errMsg(r), "err");
    renderSettings();
  }, function () { if (ST) { ST.suggBusy = false; netErr(); renderSettings(); } });
}
function resetScope(path) {
  api("POST", "/api/settings/scope-reset", { path: path }).then(function (r) {
    if (!ST) return;
    ST.confirm = null;
    if (r.ok) { toast(r.json.removed ? "판단 " + r.json.removed + "개를 지웠습니다 · 다음 스캔에서 다시 판단합니다" : "지울 판단이 없습니다"); fetchSettings(false, false); }
    else { toast(errMsg(r), "err"); renderSettings(); }
    var q = document.querySelector('[data-k="set:scopeq"]'); if (q) q.focus();
  }, netErr);
}

function renderSettings() {
  if (!ST) return;
  keepFocus(function () {
    var O = clear($("settings"));
    var dirty = setDirty();
    var head = el("div", { class: "ov-head" }, [
      el("h1", { id: "set-title", tabindex: "-1", text: "설정" }),
      dirty ? el("span", { class: "dirty", text: "저장하지 않은 변경 있음" }) : null,
      el("span", { class: "grow" }),
      el("button", { type: "button", class: "btn primary", "data-k": "set:save", disabled: !ST.form || ST.saving || busy(), title: busy() ? "작업 실행 중에는 저장할 수 없습니다" : null,
        onclick: saveSettings, text: ST.saving ? "저장 중…" : "저장" }),
      el("button", { type: "button", class: "icon-btn", "data-k": "set:close", "aria-label": "설정 닫기 (Esc)", title: "닫기 (Esc)", onclick: function () { closeSettings(false); }, text: "×" }),
      ST.leave ? el("div", { class: "warn", role: "alert" }, [
        el("p", { text: "저장하지 않은 변경이 있습니다. 버리고 닫을까요?" }),
        el("button", { type: "button", class: "btn sm", "data-k": "set:stay", onclick: function () { ST.leave = false; renderSettings(); }, text: "계속 편집" }),
        el("button", { type: "button", class: "btn sm", "data-k": "set:discard", onclick: function () { closeSettings(true); }, text: "버리고 닫기" })
      ]) : null,
      busy() ? el("p", { class: "lead small", style: "flex-basis:100%;margin:0", text: "작업 실행 중에는 설정을 저장할 수 없습니다. 끝난 뒤 저장하세요." }) : null
    ]);
    var inner = el("div", { class: "ov-in" }, [head]);
    O.appendChild(inner);
    if (ST.errs.length) inner.appendChild(errList(ST.errs));
    if (!ST.data) {
      inner.appendChild(el("div", { class: "card" }, ST.err ? [el("p", { text: ST.err }), el("button", { type: "button", class: "btn", onclick: function () { fetchSettings(true, true); }, text: "다시 시도" })]
        : [el("p", { class: "muted", text: "불러오는 중…" })]));
      return;
    }
    [setFolders(), setPlan(), setKeywords(), setScope(), setOutput(), setCheck()].forEach(function (c) { inner.appendChild(c); });
  });
}
function card(id, title, lead, kids) {
  return el("section", { class: "card", "aria-labelledby": id }, [el("h2", { id: id, text: title }), lead ? el("p", { class: "lead small", text: lead }) : null].concat(kids));
}
function setFolders() {
  var f = ST.form;
  var kids = [
    f.scanFolders.length ? el("ul", { class: "cklist" }, f.scanFolders.map(function (p, i) {
      return el("li", { class: "frow" }, [el("span", { class: "ck-l mono", text: p }),
        el("button", { type: "button", class: "btn sm", "data-k": "set:rm:" + p, "aria-label": p + " 제거", onclick: function () { f.scanFolders.splice(i, 1); renderSettings(); }, text: "제거" })]);
    })) : el("p", { class: "lead", text: "스캔 폴더가 없습니다. 아래에서 추가하세요." }),
    el("div", { class: "inline", style: "margin-top:10px" }, [
      el("button", { type: "button", class: "btn", "data-k": "set:pick", disabled: !!ST.picking, onclick: function () {
        pickFolder(ST, "folders", "", "스캔할 폴더 선택", setAddPath, renderSettings); }, text: "폴더 선택…" }),
      inp("set:path", ST.pathIn, function (v) { ST.pathIn = v; }, { placeholder: "또는 경로 입력", "aria-label": "폴더 경로 입력", onkeydown: onEnter(function () { setAddPath(ST.pathIn); }) }),
      el("button", { type: "button", class: "btn", "data-k": "set:padd", onclick: function () { setAddPath(ST.pathIn); }, text: "추가" }),
      el("button", { type: "button", class: "btn ghost", "data-k": "set:sugg", disabled: ST.suggBusy, onclick: showSuggest, text: ST.suggBusy ? "찾는 중…" : "제안 보기" })
    ]),
    pickNote(ST, "folders")
  ];
  if (ST.sugg) {
    var rest = newSuggestions(ST.sugg, f.scanFolders);
    kids.push(el("h3", { class: "sub-h", text: "제안 (아직 목록에 없는 폴더)" }));
    kids.push(rest.length ? el("ul", { class: "cklist" }, rest.map(function (s) {
      return el("li", { class: "frow" }, [el("span", { class: "ck-t", style: "flex:1" }, [el("span", { class: "ck-l", text: s.label }), s.label !== s.path ? el("span", { class: "ck-s", text: s.path }) : null]),
        el("button", { type: "button", class: "btn sm", "data-k": "set:sa:" + s.path, onclick: function () { setAddPath(s.path); }, text: "추가" })]);
    })) : el("p", { class: "lead small", text: "새로 제안할 폴더가 없습니다." }));
  }
  return card("set-h-f", "스캔 폴더", "이 폴더들 안에서 새 자료를 찾습니다. 바꾼 뒤 [저장]을 누르세요.", kids);
}
function setPlan() {
  var f = ST.form;
  var num, range;
  var sync = function (v, from) {
    ST.pct = v;
    var s = pctToShare(v);
    if (s !== null) { f.fiveHourShare = s; if (from !== range) range.value = String(Math.round(s * 100)); }
    if (from !== num) num.value = v;
  };
  range = el("input", { type: "range", min: "5", max: "100", step: "1", value: String(Math.round(f.fiveHourShare * 100)), "data-k": "set:range", "aria-label": "예산 비율 (%)",
    oninput: function (ev) { sync(ev.target.value, range); }, onchange: function () { renderSettings(); } });
  num = el("input", { type: "number", class: "inp", min: "5", max: "100", step: "1", value: ST.pct, "data-k": "set:pct", "aria-label": "예산 비율 (%) 숫자 입력",
    oninput: function (ev) { sync(ev.target.value, num); }, onchange: function () { renderSettings(); } });
  return card("set-h-p", "요금제와 사용량", "사용량 예산을 Pro 기준으로 환산합니다.", [
    el("fieldset", { class: "plans" }, [el("legend", { text: "Claude 요금제" })].concat(PLANS.map(function (p) {
      return el("label", { class: "plan" }, [
        el("input", { type: "radio", name: "set-plan", "data-k": "set:plan:" + p[0], checked: f.planScale === p[0], onchange: function () { f.planScale = p[0]; renderSettings(); } }),
        el("span", {}, [el("b", { text: p[1] }), el("small", { text: PLAN_HELP[p[0]] })])
      ]);
    }))),
    el("h3", { class: "sub-h", text: "예산 비율 (5~100%, Pro 기준)" }),
    el("p", { class: "lead small", style: "margin:0", text: "5시간 사용량 가운데 이 도구가 쓸 몫입니다. 낮출수록 다른 Claude 사용에 여유가 남습니다." }),
    el("div", { class: "share" }, [range, num, el("span", { text: "%" })])
  ]);
}
function setKeywords() {
  return card("set-h-k", "대학 검색 이름", ST.data.university ? "대학: " + ST.data.university + " · 쉼표로 구분합니다." : "쉼표로 구분합니다.", [
    inp("set:kw", ST.form.keywords, function (v) { ST.form.keywords = v; }, { "aria-label": "대학 검색 이름 (쉼표 구분)", placeholder: "예: 연세대, 연세대학교, Yonsei", onchange: function () { renderSettings(); },
      onkeydown: onEnter(saveSettings) })
  ]);
}
function scopeResults() {
  var all = ST.data.scope || [];
  var rows = filterScope(all, ST.scopeQ);
  var tb = el("tbody");
  rows.forEach(function (r) {
    tb.appendChild(el("tr", {}, [
      el("td", { class: "path", text: r.path }),
      el("td", { class: "nw dec-" + r.decision, text: SCOPE_LABEL[r.decision] || r.decision }),
      el("td", { class: "nw", text: SCOPE_LABEL[r.by] || r.by }),
      el("td", { class: "nw muted", text: String(r.at || "").slice(0, 10) }),
      el("td", { class: "nw act" }, [el("button", { type: "button", class: "btn sm", "data-k": "set:rs:" + r.path, "aria-label": r.path + " 판단 초기화", disabled: busy(),
        onclick: function () { ST.confirm = r.path; renderSettings(); var c = document.querySelector('[data-k="set:rsno"]'); if (c) c.focus(); }, text: "초기화" })])
    ]));
    if (ST.confirm === r.path) tb.appendChild(el("tr", { class: "cf" }, [el("td", { colspan: "5" }, [el("div", { class: "cf-in", role: "alert" }, [
      el("p", { text: "이 경로와 하위 폴더의 판단을 지웁니다. 다음 스캔에서 다시 판단합니다." }),
      el("button", { type: "button", class: "btn sm", "data-k": "set:rsno", onclick: function () { ST.confirm = null; renderSettings(); }, text: "취소" }),
      el("button", { type: "button", class: "btn sm danger", "data-k": "set:rsyes", onclick: function () { resetScope(r.path); }, text: "초기화" })
    ])])]));
  });
  return {
    count: rows.length + "개" + (rows.length !== all.length ? " / 전체 " + all.length : ""),
    body: rows.length ? el("table", { class: "tbl" }, [
      el("thead", {}, [el("tr", {}, [el("th", { text: "경로" }), el("th", { text: "판단" }), el("th", { text: "판단 주체" }), el("th", { text: "날짜" }), el("th", {}, [el("span", { class: "sr", text: "초기화" })])])]),
      tb
    ]) : el("p", { class: "lead small", text: "찾는 판단이 없습니다." })
  };
}
function setScope() {
  var all = ST.data.scope || [];
  var kids = [];
  if (!all.length) kids.push(el("p", { class: "lead", style: "margin:0", text: "아직 판단한 폴더가 없습니다. 첫 스캔에서 자동으로 정리합니다." }));
  else {
    var res = scopeResults();
    var count = el("span", { class: "muted small", "aria-live": "polite", text: res.count });
    var box = el("div", {}, [res.body]);
    // 검색칸은 다시 만들지 않는다(한글 입력 조합이 끊기지 않게): 개수와 표만 바꾼다
    kids.push(el("div", { class: "tbl-tools" }, [
      inp("set:scopeq", ST.scopeQ, function (v) {
        ST.scopeQ = v; ST.confirm = null;
        var r2 = scopeResults(); count.textContent = r2.count; clear(box).appendChild(r2.body);
      }, { type: "search", placeholder: "경로·포함·제외·LLM·사용자로 찾기", "aria-label": "폴더 범위 판단 찾기" }),
      count
    ]));
    kids.push(box);
  }
  return card("set-h-s", "폴더 범위 판단", "스캔할 때 폴더마다 포함·제외를 정해 둔 기록입니다. 초기화하면 그 경로와 하위 판단이 지워지고 다음 스캔에서 다시 판단합니다.", kids);
}
function setOutput() {
  return card("set-h-o", "결과 폴더", null, [el("p", { class: "mono", style: "margin:0", text: ST.data.output }),
    el("p", { class: "lead small", style: "margin:6px 0 0", text: "결과 폴더는 여기서 바꿀 수 없습니다. 바꾸려면 터미널에서 mp init을 실행하세요." })]);
}
function setCheck() {
  return card("set-h-c", "환경 점검", "Node·결과 폴더 쓰기·스캔 폴더 읽기·Claude 연결을 확인합니다.", [
    el("button", { type: "button", class: "btn", "data-k": "set:check", disabled: ST.checking, onclick: function () { runCheck(ST, renderSettings); }, text: ST.checks ? "다시 점검" : "환경 점검" })
  ].concat(checkList(ST)));
}
`;
