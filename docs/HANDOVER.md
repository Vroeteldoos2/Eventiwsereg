# Eventwise Regression Automation: Handover

Last updated: 3 Nov 2026

This folder contains the automated regression suite for **Eventwise** (staging: `https://eventwise.synergi.dev`).
It is a Playwright (JavaScript) test suite that drives the web app in a real browser and checks budgeting, revenue,
ticketing, purchasing, approvals, KPI, event settings and account-level pages.
For the framework design in more depth, see `FRAMEWORK-SETUP.md` in this folder.

---

## 1. What you have

- About **234 tests in 27 spec files**, covering every main module of the app (section 6).
- A **page object** per module (`pages/`), shared fixtures and helpers.
- A **full regression runner** (`scripts/fullRegression.js`) that runs every module as its own stage with its own
  HTML report.
- A **visual regression** set (screenshot comparison) for the budgeting, revenue and ticketing screens.
- **No test creates a new event.** Everything runs against an existing event that is set in `.env`.

---

## 2. Software to install

| Software | Needed? | Notes |
|---|---|---|
| **Node.js** (LTS, which includes **npm**) | Required | Download from https://nodejs.org. Built and last run with Node 24.14 and npm 11.9; any current LTS should work. Check with `node -v` and `npm -v` |
| **Google Chrome / Chromium** | Installed by Playwright | You do not install this yourself. `npx playwright install chromium` downloads the browser the tests use |
| **Visual Studio Code** | Recommended | Download from https://code.visualstudio.com. Any editor works, but VS Code is what the suite was written in |
| **Playwright Test for VS Code** extension (`ms-playwright.playwright`) | Optional | Run and debug a single test from the editor, and pick locators |
| **Git** | Optional | Only if the code is put back into a repository. Not needed to run the tests |
| **Windows** | Used so far | The suite was developed on Windows 11. The visual baselines are named `-chromium-win32`, so on macOS or Linux the visual tests need their baselines regenerated (`--update-snapshots`) |

Other packages (`@playwright/test` 1.58, `dotenv`, `pdfjs-dist`) are installed automatically by `npm install`; nothing
else is needed. You also need **network access to https://eventwise.synergi.dev** and the automation login in `.env`.

## 3. Getting started

**Prerequisites:** the software in section 2 and access to the staging app.

```bash
npm install
npx playwright install chromium      # first time only
```

Create a local `.env` from `.env.example` and set the test login and event URLs. Never commit real credentials.

**Run everything (full regression):**

```bash
npm run test:fullRegression
```

**Other useful runs:**

```bash
npm run test:fullRegression -- --dry-run              # list the stages, run nothing (safe)
npm run test:fullRegression -- --only=budgeting,kpi   # just those stages
npm run test:fullRegression -- --event=<event url>    # run against a different event
npm run test:budgeting                                # one module (see package.json for all of them)
npx playwright test tests/kpi/kpi.spec.js             # one spec file
npm run test:headed                                    # run the default suite with a visible browser
npm run test:smoke                                      # run tests tagged @smoke
npm run test:visual                                     # run the visual regression project
npm run report                                        # open the last HTML report
```

A normal run of the full regression takes real actions in the app (creates and deletes entries, POs, invoices, etc.).
Use `--dry-run` first if you only want to check what would run.

After a full run, reports are in `playwright-report/<stage>/` (one per stage) and failure screenshots and traces are in
`test-results/<stage>/`. Each stage also writes `results.json`; the runner writes per-stage counts to
`test-results/summary.json`. These folders are generated, so they can be deleted at any time.

---

## 4. How it works (short version)

- **Login once.** `global-setup.js` logs in with `USER_EMAIL` / `USER_PASSWORD` and saves the session to `auth.json`.
  Every test starts already logged in. `auth.json` is regenerated on every run.
- **Page Object Model.** Each app module has a class in `pages/` (locators in the constructor, actions as methods).
  Specs call these methods and stay readable.
- **Fixtures.** `fixtures/baseTest.js` extends Playwright's `test`, so a spec just asks for
  `{ budgetingPage, ticketingPage, ... }`. Specs import `test` and `expect` from this file.
- **One worker.** `playwright.config.js` sets `workers: 1` and `fullyParallel: false`. The tests share one staging account and event, so running
  them in parallel would make them interfere with each other.
- **Env-driven.** Each module reads its own event URL from `.env`, so the same tests can point at any event.
- **Reporting.** Each stage of the full regression has HTML and JSON reports; failures keep a screenshot and trace.
- **Base URL.** `BASE_URL` defaults to `https://eventwise.synergi.dev`; set it to point the suite at another deployment.
- **Visual tests.** The default run excludes `tests/visual/`; use `npm run test:visual` to run them separately.

### Folder layout

```
pages/                 Page objects, one per module (budgeting, revenue, ticketing, purchasing, ...)
tests/                 Spec files, grouped by module
  utils/               Shared helpers (currency parsing, CSV/XLSX/PDF readers)
  setup/               Test-data setup (adds tickets to the event if it has none)
  visual/              Screenshot comparison tests and their baseline images
fixtures/              baseTest.js plus test data files (ticket import template, etc.)
scripts/fullRegression.js   The full regression runner
docs/                  This document and FRAMEWORK-SETUP.md
global-setup.js        Logs in once and saves auth.json
playwright.config.js   Runner settings (timeouts, viewport, reporter)
.env.example           Safe template for environment variables (see section 5)
.env                   Local login, event URLs and test data; never commit credentials
```

---

## 5. Configuration (`.env`)

| Variable | What it is for |
|---|---|
| `USER_EMAIL`, `USER_PASSWORD` | The automation login used by `global-setup.js` |
| `REGRESSION_ACCOUNT_NAME`, `REGRESSION_ACCOUNT_ID` | The account the tests use (defaults to Global Events Ltd / 14) |
| `EXISTING_EVENT_URL` | The event the full regression runs against (falls back to `PURCHASING_EVENT_URL`) |
| `TICKETING_REGRESSION_EVENT_URL` | Optional separate event for the ticketing module and ticket setup |
| `DASHBOARD_EVENT_URL`, `BUDGET_EVENT_URL`, `INVOICE_EVENT_URL`, `REVENUE_EVENT_URL`, `REVENUE_TICKETS_EVENT_URL`, `PRICE_PER_HEAD_EVENT_URL`, `BVA_EVENT_URL`, `EVENT_SETTINGS_EVENT_URL`, `PURCHASING_EVENT_URL`, `TICKETING_TEST_EVENT_URL` | Event used by each module when its spec is run on its own. The full regression overrides these with the one event |
| `KPI_CLOSED_EVENT_URL` | A closed event, used by the KPI "closed event" test |
| `BUDGET_SUBCATEGORY`, `BUDGET_SUPPLIER`, `BUDGET_FIXED_COST`, `BUDGET_BUDGETED_COST`, `BUDGET_ACTUAL_COST` and the other `BUDGET_*` values | Test data for creating budget entries |
| `REVENUE_CUSTOMER`, `REVENUE_INVOICE_EMAIL` | Customer and email used by the revenue and invoice tests |
| `REGRESSION_EVENT_NAME` | Optional. The account dashboard tests filter the event list to this event |
| `REGRESSION_TAX_RATE` | Tax rate chosen during ticket setup |
| `QA_EMAIL` | Email target for PO/KPI email checks and the account reply-to preference |
| `UTILISATION_TEAM_MEMBER` | Team member used by the utilisation time-log comparison |
| `BASE_URL` | Application base URL; defaults to `https://eventwise.synergi.dev` |

See `.env.example` for the complete variable list and safe placeholders. GitHub Actions reads login and event URL values
from repository secrets and runs on Windows; scheduled runs are Thursday and Sunday at 20:00 UTC, with optional
comma-separated stages on manual dispatch.

Notes:
- The customer is `Muddles LTd` on purpose. It is **not linked to Xero**, so tests do not push invoices to Xero.
  Use a Xero-linked contact only when a test needs Xero.
- Some events are **closed** and reject saves ("You are unable to perform this action as the event is closed"). Tests
  that change data must point at an **open** event. Check this first if many tests fail on save.

---

## 6. What is covered

Each row is a stage in the full regression (`--only=<stage>`), its spec location and the npm script for running it alone.

| Stage | Specs | Covers |
|---|---|---|
| `login` | `tests/login.spec.js` | Login with configured credentials |
| `setup-tickets` | `tests/setup/ensureTickets.spec.js` | **Setup, not a test.** Makes sure the event's Project Start is early enough and that it has tickets (adds Earlybird / Main / VIP if there are none) |
| `event-dashboard` | `tests/eventDashboard.spec.js` | Quick Create shortcuts (budget entry, purchase order, ticket type, supplier invoice), search |
| `purchase-order` | `tests/budgeting/purchaseOrder.spec.js` | Purchase orders from budget entries |
| `budgeting` | `tests/budgeting/` (budgetEntry, budgetExport, budgetingTotals, departmentBudget) | Budget entries, exports, totals, department budgets |
| `price-per-head` | `tests/budgeting/pricePerHead.spec.js` | Revenue stream price-per-head configuration |
| `budget-v-actuals` | `tests/budgetVActuals/` | Budget v Actuals page |
| `revenue-tickets` | `tests/revenue/revenueTickets.spec.js` | Revenue > Tickets |
| `ticketing` | `tests/ticketing/` (dashboard, trends, tickets, transactions) | Ticketing dashboard, sales trends, targets, annotations, ticket import/export, transactions |
| `invoice` | `tests/budgeting/invoice.spec.js` | Supplier invoices, credit notes |
| `purchasing` | `tests/purchasing/` | Purchasing summary, payruns, analysis |
| `approvals` | `tests/approvals/` | Event approvals (entries, POs, invoices, payruns, departments) |
| `event-settings` | `tests/eventSettings/` | General, subcategories, reporting settings |
| `kpi` | `tests/kpi/` | KPI dashboard |
| `revenue` | `tests/revenue/revenue.spec.js` | Revenue entries and customer invoices |
| `account-dashboard` | `tests/accountDashboardTests.spec.js` | Account dashboard (event list, filters) |
| `account-sales-invoices` | `tests/accountSalesInvoices.spec.js` | Account sales invoices |
| `account-entries` | `tests/accountEntries.spec.js` | Account Entries pages |
| `account-settings` | `tests/accountSettings/` | Account settings and reporting |
| `team-utilisation` | `tests/teamUtilisation/` | Team utilisation |

**Not part of the full regression:** the visual tests in `tests/visual/` (screenshot comparison of the Budget Summary,
cost and revenue budgets, ticketing dashboard and revenue dashboard). Run them with `npm run test:visual`.
Baseline images are in the `*-snapshots` folders next to each spec. After an intended UI change, update them with
`npx playwright test --config=playwright.visual.config.js --update-snapshots`.

**Known issues:** tests for current application bugs are marked with `test.fail(true, ...)` and a temporary ClickUp
placeholder. Remove that annotation once the bug is fixed and verified.

**Smoke suite:** `npm run test:smoke` runs the fast core checks whose titles include `@smoke`.

**Skipped tests:** a few tests are marked `test.skip` (for example some Event Dashboard shortcuts and some budget entry
and revenue tests). They are known to need changes or are waiting on app fixes. Search for `test.skip` to list them.

---

## 7. Test data and clean-up

- Tests that create data use **recognisable prefixes** (`AutoTest-...`, `AutoPO_...`, `AutoShortcut-...`,
  `sgautomation...`) and only delete data with those prefixes. They never delete real data.
- Most tests put back what they change (settings, targets, annotations). Entries, POs and invoices are deleted at the
  end of the test.
- **Things that are left behind on the event** (the app does not allow deleting them):
  - Each purchasing **payrun** test run leaves one `AutoPayrun_<n>` payrun.
  - Each run of the dashboard **Create Ticket Type** test adds three tickets named `AutoShortcut-<n> Earlybird / Main /
    VIP`. They are given unique names on purpose so the event's real tickets stay untouched. If they build up, remove
    them in the app.
  - The ticket **import** test replaces the Direct Sales sales with the template data
    (`fixtures/ticket-import-template.csv`).
- Because tests share one event, tables such as Budget Entries grow over time. This is why those tables are not
  compared pixel by pixel in the visual tests.

---

## 8. Known application issues

These were found while building the tests. **Tests for them fail on purpose** (they show the bug) and should pass
once the app is fixed. Status is as of the last check, so re-test before raising anything again.

- **Ticketing:** custom sales targets show `NaN` in the weekly Detailed View; the Create Ticket Target wizard ignores
  the quantity on most events; breakeven is wrong on some events; Reverse Transaction, Delete Ticket Sale and
  delete-bank-transaction buttons do nothing; the Ticket Seller list is empty in Add Ticket Transaction; ticking a
  custom target does not show it in the graph.
- **Invoices:** customer invoice payment dates cannot be saved; a supplier credit note raised while the Xero push is
  still running is dropped after 10 to 25 seconds (a credit raised after the sync is kept).
- **Budget v Actuals:** the Bar row excludes budget entries.
- **Purchasing:** the automation user cannot approve or reject payruns (permission), so Approve to Paid fails.
- **Account level:** the Resource Plan is hidden from the automation login; the Request / Approve / Reject buttons are
  missing on the account Entries pages, so the approval tests wait for the fix.
- Some older specs are out of date against the current UI (for example `budgetingTotals` expects an "Event Profit
  Overview" card and `departmentBudget` expects a "Production" department). They fail until updated.

---

## 9. Limitations and gotchas

- **One worker only.** Tests cannot run in parallel on the shared event.
- **Event creation is not automated.** The creation, copy and create-from-template flows are tested manually.
- **Quirks of the app the tests work around:**
  - Many buttons are icon-only (icon font), so page objects locate them by CSS class (for example `i.mdi-plus`).
  - Some pages (purchasing department and payrun detail) redirect if opened by URL, so tests navigate by clicking.
  - A loading overlay can block clicks, so the helpers wait for it to disappear.
  - The "Quick Create > Ticket Type" window is titled **Add Tickets**, while the Tickets page uses "Let's setup your
    tickets for ...". The helpers accept both.
- **Analytics:** Playwright sets `navigator.webdriver = true`, so the app's PostHog analytics does not record
  automation visits. This was checked and left as it is.
- Tests run headless by default at 1920x1080. Use `HEADED=true` or `npm run test:headed` for local debugging.
- GitHub Actions runs the full regression on Windows and uploads reports and test results for 14 days.

---

## 10. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Everything fails at login | Check `USER_EMAIL` / `USER_PASSWORD` in `.env`; delete `auth.json` and rerun |
| Many tests fail when saving | The event in `.env` may be closed; point to an open event |
| Ticketing, revenue-tickets, price-per-head or Budget v Actuals fail | The event may have no tickets; run `--only=setup-tickets` first |
| "No event to run against" | Set `EXISTING_EVENT_URL` in `.env` or pass `--event=<url>` |
| A page shows a 404 | The event URL in `.env` has the wrong value or extra quotes |
| A visual test fails after a UI change | If the change is intended, update the baselines with `--update-snapshots` |
| A test cannot find a button | The app UI probably changed; open the failing test's trace (`npx playwright show-trace <trace.zip>`) and update the locator in the page object |

---

## 11. Adding or changing tests

1. Put the locators and actions in the module's page object in `pages/`.
2. Write the spec in `tests/<module>/`, importing `test` and `expect` from `fixtures/baseTest.js`.
3. Use a unique prefix for any data the test creates and delete it at the end (see `purchaseOrder.spec.js` for the
   pattern).
4. Add the spec to a stage in `scripts/fullRegression.js` (or reuse an existing folder stage) and add an npm script
   in `package.json` if you want a shortcut.
5. Check the stage list with `npm run test:fullRegression -- --dry-run`.

---

## 12. Handover checklist

- [ ] `npm install` and `npx playwright install chromium` completed.
- [ ] `.env` has working values and the automation login can sign in.
- [ ] The event(s) in `.env` are open and reachable.
- [ ] `npm run test:fullRegression -- --dry-run` lists all stages.
- [ ] A first full run was done and the reports in `playwright-report/` were looked at.
- [ ] The known-issue failures in section 8 are understood so they are not mistaken for new regressions.
