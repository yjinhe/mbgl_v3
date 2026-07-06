# Tangji V3 DoD Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining gaps in `docs/GOAL.md` and `docs/SPEC.md` after the first vertical slice: C-end weekly report/export/recycle, B-end detail charts/staff management, compliance/style evidence, and final verification.

**Architecture:** Keep the existing monorepo and large-file frontend shape. Add missing backend behavior in `apps/api/src/routes/app.ts` using existing record serialization helpers, then expose it in the current React files with prototype classes and token-based styles. Strengthen tests at the API and E2E layer before implementation changes.

**Tech Stack:** Fastify, Prisma, Vitest, Supertest, React 18, Vite, ECharts option constructors from `@tangji/shared`, Playwright.

---

### Task 1: App Weekly Report And Export API

**Files:**
- Modify: `apps/api/test/api.test.ts`
- Modify: `apps/api/src/routes/app.ts`

- [ ] **Step 1: Write failing tests**

Add API coverage that creates one record per metric, calls `GET /api/app/report/weekly`, checks metric sections, then calls `GET /api/app/export/csv?metric=bp` and `GET /api/app/export/csv?metric=all` to check CSV/ZIP headers and real content.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @tangji/api test -- --runInBand`

Expected: FAIL because `/api/app/report/weekly` is not registered and all export only returns a glucose header.

- [ ] **Step 3: Implement minimal backend**

Add `weeklyReport(app, user)` using `statsForMetric()` plus latest serialized records. Replace the CSV placeholder with metric-aware CSV generation and `archiver` ZIP output for `metric=all`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @tangji/api test`

Expected: PASS.

### Task 2: App Report, Recycle, And Export UI

**Files:**
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Write failing E2E checks**

Add a Playwright smoke path that opens stats, enters the weekly report subpage, verifies `#reportCard`, opens Mine, opens recycle bin, and verifies the restore/export actions are visible.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm e2e`

Expected: FAIL because the report subpage and recycle UI are not rendered.

- [ ] **Step 3: Implement UI**

Extend `sub` to include `report` and `recycle`, add `ReportSub`, `RecycleSub`, export buttons using `window.open`, and Mine data/privacy cells. Use existing `.subpage`, `.report`, `.rec`, `.cell`, `.btn`, `.asheet`-style classes and token colors.

- [ ] **Step 4: Run E2E to verify it passes**

Run: `pnpm e2e`

Expected: PASS.

### Task 3: Console Detail Charts And Staff Actions

**Files:**
- Modify: `apps/console/src/main.tsx`
- Modify: `apps/api/test/api.test.ts`
- Modify: `apps/api/src/routes/pharmacy.ts`

- [ ] **Step 1: Write failing tests**

Add API tests for `POST /api/pharmacy/staff` and `PATCH /api/pharmacy/staff/:id` disable/enable behavior.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @tangji/api test`

Expected: FAIL if staff create/update endpoints are missing or incomplete.

- [ ] **Step 3: Implement backend and UI**

Use existing route patterns to add create/update staff endpoints if absent. In console, render a compact trend panel in customer detail driven by the same serialized record data and add staff add/disable/enable controls.

- [ ] **Step 4: Run tests and build**

Run: `pnpm --filter @tangji/api test && pnpm --filter @tangji/console build`

Expected: PASS.

### Task 4: Compliance, Style Evidence, And Docs

**Files:**
- Modify: `docs/SELF-CHECK.md`
- Modify: `docs/STYLE-DIFF.md`
- Modify: `README.md`
- Create/Update: `docs/screenshots/*.png`

- [ ] **Step 1: Run scans**

Run: `rg "糖尿病|高血压|高脂血症|痛风|诊断|用药建议" apps packages docs --glob '!docs/SPEC.md' --glob '!docs/GOAL.md'`

Expected: Only allowed disclaimer text or documentation context remains.

- [ ] **Step 2: Run token/color scan**

Run: `rg "#[0-9A-Fa-f]{3,8}|rgba\\(" apps packages --glob '!**/*.svg'`

Expected: New app styles use tokens; inherited extracted prototype CSS and SVG white are documented exceptions.

- [ ] **Step 3: Capture screenshots**

Run: `pnpm e2e` or Playwright screenshot helper after both apps start.

Expected: `docs/screenshots/web-home.png`, report/recycle screenshots, and console dashboard/detail screenshots exist.

- [ ] **Step 4: Update self-check and style diff**

Mark completed checklist items and document any remaining non-blocking environment issue with exact command evidence.

### Task 5: Final Verification And Commit

**Files:**
- All changed files

- [ ] **Step 1: Full verification**

Run: `pnpm test`, `pnpm --filter @tangji/web build`, `pnpm --filter @tangji/console build`, `pnpm e2e`.

Expected: PASS, except any external browser/runtime issue must be recorded in Known Issues with the exact failure.

- [ ] **Step 2: Commit**

Run: `git status --short`, review changed files, then `git add ... && git commit -m "P7: close Tangji V3 DoD gaps"`.

Expected: Clean worktree after commit.
