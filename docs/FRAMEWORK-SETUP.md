# Eventwise Playwright Framework — Setup & Architecture

This document explains how the automated test framework for Eventwise
(`eventwise.synergi.dev`) is put together: the stack, the folder structure,
how login/session state works, how configuration and environment variables
flow through the suite, and how to run it. It does not catalogue every
individual test — see the companion test-catalogue doc for that.

## 1. Stack

| Component | Version / Tool |
|---|---|
| Test runner | [Playwright Test](https://playwright.dev) `1.58.2` |
| Language | JavaScript (ES Modules — `"type": "module"` in `package.json`) |
| Browser | Chromium (Desktop Chrome profile, see `playwright.config.js`) |
| Env config | `dotenv` (`.env` file at repo root) |
| Target app | `https://eventwise.synergi.dev` |

No test framework abstraction beyond Playwright itself is used (no Cucumber,
no Jest) — `@playwright/test`'s own `test`/`expect` is the whole runner.

## 2. Folder structure

```
Playwright-EW/
├─ pages/                  # Page Object Model classes — one per app module
│  ├─ loginPage.js
│  ├─ dashboardPage.js
│  ├─ budgetingPage.js
│  ├─ ticketingPage.js
│  ├─ purchasingPage.js
│  ├─ teamMembers.js
│  └─ newEventCreation.js   # ticket setup modal helpers (used by the Create Ticket Type shortcut)
├─ tests/                  # Spec files — one `*.spec.js` per feature area
│  ├─ budgeting/           # budgetEntry, purchaseOrder, invoice, budgetingTotals
│  ├─ visual/              # visual regression suite (see §7)
│  ├─ utils/
│  │  ├─ setup.js          # shared beforeEach helpers (e.g. setupBudgetingTest)
│  │  └─ test-helpers.js   # TestHelpers class — currency parsing, overlay waits, etc.
│  ├─ ticketing.spec.js
│  ├─ eventDashboard.spec.js
│  ├─ teamMembers.spec.js
│  └─ login.spec.js
├─ fixtures/
│  └─ baseTest.js          # Extends Playwright's `test` with page-object fixtures
├─ fixtures/ticket-import-template.csv  # Test data file used by ticketing import tests
├─ global-setup.js         # Logs in once, saves session to auth.json
├─ playwright.config.js
├─ .env.example            # Safe template for credentials, target URLs and test data
├─ .env                    # Local credentials, target URLs and test data (not committed)
└─ auth.json               # Saved login session (git-ignored, regenerated per run)
```

## 3. Configuration (`playwright.config.js`)

Key settings and why they're set this way:

- **`globalSetup: './global-setup.js'`** — runs once before the whole suite,
  logs into the app, and writes the session to `auth.json`. Every test then
  starts already authenticated (see §4).
- **`baseURL: process.env.BASE_URL`** — defaults to `https://eventwise.synergi.dev`; lets page objects use
  relative `page.goto('/auth/login')` where convenient. Direct navigation URLs use the shared `pages/env.js` value.
- **`storageState: 'auth.json'`** — every browser context loads the saved
  session instead of logging in per test.
- **`workers: 1`** — tests run serially, not in parallel. The suite drives a
  shared staging event/account, so concurrent runs would race on the same
  data.
- **`fullyParallel: false`** — specs do not run concurrently against the shared event.
- **Headless by default** — set `HEADED=true` or use `npm run test:headed` for local debugging.
- **`viewport: { width: 1920, height: 1080 }`** — fixed desktop viewport,
  important for the visual regression suite where screenshot dimensions
  must be reproducible.
- **`screenshot: 'only-on-failure'`, `trace: 'retain-on-failure'`** — failure
  artifacts are kept; passing runs don't accumulate debug output.
- **Reporters** — list, HTML and JSON; full-regression stages save JSON separately and write counts to
  `test-results/summary.json`.
- **Retries** — one retry in CI, none locally.
- **Visual project** — excluded from the default Chromium run and invoked separately with `npm run test:visual`.

## 4. Authentication flow

1. `global-setup.js` requires `USER_EMAIL` / `USER_PASSWORD`, launches a headless browser, goes to `/auth/login`,
   waits for the login form and authenticated account button, and calls `context.storageState({ path: 'auth.json' })`.
2. `playwright.config.js` sets `use.storageState: 'auth.json'`, so **every**
   test context (in every spec file) starts already logged in — no test
   needs to call `login()` itself unless it's specifically testing the login
   flow (`login.spec.js`).
3. `auth.json` is git-ignored and regenerated at the start of every test run.

## 5. Page Object Model + fixtures

- Each file in `pages/` is a plain class: constructor takes `page` and
  defines locators; methods perform actions (`gotoXPage()`,
  `createBudgetEntry()`, etc.) and sometimes assertions.
- `fixtures/baseTest.js` extends Playwright's `test` so specs can request a
  page object directly as a fixture instead of constructing it:

  ```js
  import { test, expect } from '../fixtures/baseTest.js';

  test('...', async ({ page, budgetingPage, ticketingPage }) => {
      await budgetingPage.gotoBudgetSummaryPage();
  });
  ```

  Fixtures currently provided: `loginPage`, `dashboardPage`, `budgetingPage`,
  `ticketingPage`, `teamMembersPage`, `helpers` (a `TestHelpers` instance).
- Some page objects need event-specific context that fixtures can't supply
  automatically (e.g. which event's budget to load). For those,
  `tests/utils/setup.js` exposes helpers like `setupBudgetingTest(page)` that
  construct the page object **and** set `eventBaseUrl` from `.env`, for use
  in a `test.beforeEach`.
- `TestHelpers` (`tests/utils/test-helpers.js`) holds cross-cutting utilities
  that aren't tied to one page: `parseCurrency()` (strips `£`/commas),
  `clearUIOverlays()`, `verifyMatch()` (asserts and screenshots on mismatch).

## 6. Environment variables (`.env`)

| Variable | Purpose |
|---|---|
| `USER_EMAIL`, `USER_PASSWORD` | Login credentials used by `global-setup.js` |
| `REGRESSION_ACCOUNT_NAME`, `REGRESSION_ACCOUNT_ID` | Account selected by regression tests and used for account-level navigation |
| `REGRESSION_TAX_RATE` | Tax rate selected during regression event ticket setup |
| `DASHBOARD_EVENT_URL` | Direct URL to the dashboard test event |
| `BUDGET_EVENT_URL` | Base URL for the budgeting test event (`budgetingPage.eventBaseUrl`) |
| `BUDGET_SUBCATEGORY`, `BUDGET_SUPPLIER`, `BUDGET_FIXED_COST`, `BUDGET_BUDGETED_COST`, `BUDGET_ACTUAL_COST` | Test data for budget entry creation |
| `BUDGET_REVENUE_STREAM`, `BUDGET_REVENUE_SUBCATEGORY` | Test data for revenue budget entries |
| `TICKETING_EVENT_URL` | Direct URL to the ticketing dashboard for the test event |
| `TICKETING_BULK_ENTRY_URL` | Direct URL to the ticketing Bulk Entry page |

The `.env` file itself is not committed (see `.gitignore`); a teammate
joining the project needs a copy with valid values and access to the staging
account under test. `REGRESSION_ACCOUNT_NAME` and `REGRESSION_ACCOUNT_ID`
default to "Global Events Ltd" and `14` when omitted.

## 7. Visual regression suite (`tests/visual/`)

A newer addition alongside the functional tests: `toHaveScreenshot()`-based
checks for key screens (Budget Summary, Ticketing Dashboard, Revenue/Cost
Budget drill-downs). Notable conventions established here:

- One `pages` array of `{ name, goto }` entries per spec file, looped over
  to generate one `test()` per entry — adding a new page to check means
  adding an array entry, not writing a new test from scratch.
- Baselines live in `<spec-file>-snapshots/` (Playwright's default) and must
  be committed; regenerate with `--update-snapshots` after an intentional UI
  change.
- Tables that grow indefinitely from other tests' data (e.g. Budget Entries,
  Recharged Entries lists) are **not** screenshot-compared — full-page pixel
  diffs there fail every time the row count changes a scrollbar's presence.
  Those entries use an optional `verify(page)` function instead of
  `toHaveScreenshot()`, asserting structural things (e.g. column header
  order) that don't drift with row count.

## 8. Running the suite

```bash
npm install
npx playwright install        # first time only — installs the Chromium binary

# Whole suite
npx playwright test

# One spec file
npx playwright test tests/budgeting/budgetingTotals.spec.js

# Named npm shortcuts (see package.json) — headless by default
npm run test:budgeting
npm run test:ticketing
npm run test:eventDashboard
npm run test:headed       # visible browser for local debugging
npm run test:visual       # visual project only
npm run test:fullRegression   # every suite against an existing event (no event is created)
npm run test:fullRegression -- --event=<event url>   # pick the event; default is EXISTING_EVENT_URL / PURCHASING_EVENT_URL in .env
npm run test:fullRegression -- --dry-run             # list the stages, run nothing

# Visual regression suite
npm run test:visual
npx playwright test --config=playwright.visual.config.js --update-snapshots   # after an intended UI change

# View the last HTML report
npm run report
```

## 9. Known quirks worth knowing about

- **Icon-font buttons**: many buttons are icon-only, rendered via an
  icon-font ligature (ad shows up as a private-use-area glyph in
  accessibility snapshots, e.g. `󰿆`). Locating these by visible text is
  unreliable — page objects generally locate by CSS class instead
  (`i.mdi-arrow-right`, `i.mdi-plus`, etc.) and click the parent `button`.
- **"Unread Notifications" toast**: a banner that often appears bottom-left
  after navigation. It hasn't blocked any current locators, but it's a
  recurring visual element to be aware of if a screenshot or click seems
  off.
- **Shared staging data**: because `workers: 1` and all specs hit the same
  configured account / test event, tests that create data (budget entries,
  bank transactions, etc.) leave it behind permanently. This is why some
  tables (see §7) grow over time and can't be screenshot-compared safely.
