# Local Web App (0.4.0) Implementation Plan

> **For agentic workers:** executed natively in-session (one context), final whole-branch review by a fresh reviewer. Steps use checkbox syntax.

**Goal:** Run MasterPortfolio as a background local web app on a fixed localhost URL, with onboarding (intro, Claude Code readiness, help) and a light career-platform design.

**Spec:** `docs/superpowers/specs/2026-11-24-masterportfolio-design.md` §11.7 (also §11.5, §11.6)

## Global Constraints
- Node ≥ 22, no new runtime dependencies; the page stays a single inline HTML (no external resources).
- Ports 4317–4327 on 127.0.0.1; Host check unchanged; APIs accept only the `X-MP-Token` header; the cookie only gates the HTML page.
- Token file `~/.masterportfolio/token` (0600) and `server.json`; tests use temp dirs via env override (`MP_HOME_DIR`), never the real home.
- Tests never call real Claude, real `wsl.exe` or open a real browser.
- Korean UI copy; light theme default; dark selectable; 390px works.

## Review Focus
1. A stale `server.json` (process gone, port reused by another app) must not make `mp start` open the wrong page: identity check via `/api/ping` id.
2. Updating while an old version runs: version mismatch → shutdown + respawn, but never while a job runs.
3. Cookie without header must not reach any `/api/*` write.
4. Detached child must outlive the launcher on Windows and macOS (no console attachment, new session).
5. Onboarding must not block users without Claude Code (can continue with a warning).

---

### Task 1: Background server, fixed port, persistent token, cookie page auth
**Files:** create `src/ui/runtime.ts` (paths, token, server.json, port pick, ping, launch), modify `src/ui/server.ts` (cookie page auth, `/api/ping`, 401 page), `src/commands/start.ts` (launcher), `src/cli.ts` (`serve` hidden command), `src/commands/ui.ts` (serve mode: fixed port, persistent token, server.json lifecycle, no browser), `packaging/windows/MasterPortfolio.cmd`, `packaging/windows/scripts/install.ps1` (shortcut WindowStyle 7).
**Tests:** `test/ui/runtime.test.ts` — token reuse/0600; pickPort skips busy 4317; ping identity; launch: alive+same version → open only; alive+other version and idle → shutdown+spawn; dead server.json → spawn; spawn timeout → code 1. `test/ui/server.test.ts` — `/?t=` sets cookie + 302; `/` with cookie → html; without → 401 page; `/api/*` with cookie only → 401; ping unauthenticated.

### Task 2: Onboarding steps and help content
**Files:** `src/ui/server.ts` (setup-mode `GET /api/claude-status`: `claude --version` + probe with default config), `src/setup/check.ts` (claudeVersion helper), `src/ui/appSetup.ts` (steps: intro, Claude readiness, existing 4, done with "첫 정리 시작"), `src/ui/appHelp.ts` (help page content).
**Tests:** server claude-status with injected deps; appLogic wizard step order/errors.

### Task 3: Light design system, theme toggle, top nav + hash router
**Files:** `src/ui/app.ts` (CSS tokens light/dark, `data-theme`, top nav, router `#/`, `#/exp`, `#/master`, `#/help`; restyle list → card grid, drawer, job bar, banners), `src/ui/appSetup.ts` (restyle wizard/settings + theme setting).
**Tests:** app render tests (live/static contain nav, theme attr); appLogic route parse.

### Task 4: Home (completeness, next steps, recent), Master preview
**Files:** `src/ui/appLogic.ts` (`completeness(exps)`), `src/ui/app.ts` (home view, master view reusing print layout), `src/ui/model.ts` if fields missing.
**Tests:** completeness cases (no adopted → 0; partial fields; ignores non-adopted).

### Task 5: master.html, docs, visual verification, release 0.4.0
**Files:** README.md, packaging READMEs, version files.
**Verify:** headless Chrome screenshots (home/exp/master/help/onboarding, light/dark, 390px); full tests; CI; package; release.
