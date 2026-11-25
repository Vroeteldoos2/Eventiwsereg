# Eventwise QA regression

Playwright end-to-end regression tests for Eventwise.

## Setup

Install Node.js (LTS), then install the project dependencies and Chromium:

```powershell
npm ci
npx playwright install chromium
```

Create a local `.env` from the example and fill in the required login and event settings:

```powershell
Copy-Item .env.example .env
```

Set `USER_EMAIL` and `USER_PASSWORD`. Set `EXISTING_EVENT_URL` or `PURCHASING_EVENT_URL` for the event
used by the full regression, along with any stage-specific URLs required by the suites. Use open test events
for tests that modify data. Keep `.env` and real credentials private; never commit them.

## Running tests

```powershell
npm run test:fullRegression
npm run test:fullRegression -- --only=login,budgeting
npm run test:smoke
npm run test:visual
npm run test:headed
```

The full regression accepts `--only=<comma-separated-stage-names>` to run selected stages. Run
`npm run test:fullRegression -- --dry-run` to list stages without starting tests. Visual tests use the separate
Playwright visual configuration. `npm run test:headed` opens a visible browser; `HEADED=true` can also be set
for a regular Playwright run.

## Scheduled runs and CI secrets

GitHub Actions runs the regression on Thursday and Sunday at 20:00 UTC, or manually via **Actions → Playwright
Regression → Run workflow**. The optional `only` input accepts comma-separated full-regression stages.

Set the repository Actions secret `ENV_FILE` to the complete contents of the CI `.env` file, including the
required credentials and event URLs. When set, the workflow writes that secret to `.env`; otherwise, it builds
`.env` from the individual repository secrets and variables. Do not expose the secret in logs or commit it.

## Reports

Each full-regression stage writes JSON to `test-results/<stage>/results.json` and an HTML report to
`playwright-report/<stage>/`. `test-results/summary.json` gives per-stage totals for `pass`, `fail`, `flaky`,
`expected-fail`, and `skipped`. A `flaky` test failed initially and passed on retry; `expected-fail` is a test
marked as an expected failure that failed as expected. Check the stage JSON and HTML report for individual test
details and failure traces.
