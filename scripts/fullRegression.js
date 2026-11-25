// Runs every regression suite against an existing event: event dashboard, budgeting, purchase orders, price per head,
// budget v actuals, revenue, ticketing, invoices, purchasing, approvals, event settings, KPI, and the account-level
// suites (dashboard, sales invoices, entries, settings, team utilisation). No event is created.
//
//   npm run test:fullRegression                       (event from EXISTING_EVENT_URL, else PURCHASING_EVENT_URL in .env)
//   npm run test:fullRegression -- --event=<event url>
//   npm run test:fullRegression -- --only=budgeting,kpi   (just those stages)
//   npm run test:fullRegression -- --dry-run   (list the stages, run nothing)
//
// Each stage gets its own HTML report and test-results folder so the second run
// doesn't wipe the first one's artifacts.
import { spawnSync } from 'child_process';
import dotenv from 'dotenv';

dotenv.config();

// --dry-run lists the stages without running anything.
const DRY_RUN = process.argv.includes('--dry-run');
function runPlaywright(specs, stage, extraEnv = {}) {
    console.log(`
▶ ${stage}: ${specs.join(' ')}
`);
    if (DRY_RUN) return 0;
    const result = spawnSync('npx', [
        'playwright', 'test', ...specs,
        '--reporter=list,html',
        `--output=test-results/${stage}`,
    ], {
        stdio: 'inherit',
        shell: true,
        env: {
            ...process.env,
            ...extraEnv,
            PLAYWRIGHT_HTML_OUTPUT_DIR: `playwright-report/${stage}`,
            PLAYWRIGHT_HTML_OPEN: 'never',
        },
    });
    return result.status ?? 1;
}

// --event=<url> (or the older --existing=<url>) overrides the event from .env.
const eventArg = process.argv.find(arg => arg.startsWith('--event=') || arg.startsWith('--existing='));
const eventUrl = ((eventArg && eventArg.split('=')[1]) || process.env.EXISTING_EVENT_URL || process.env.PURCHASING_EVENT_URL || '').replace(/\/$/, '');
if (!eventUrl) {
    console.error('✖ No event to run against. Pass --event=<url> or set EXISTING_EVENT_URL / PURCHASING_EVENT_URL in .env.');
    process.exit(1);
}
console.log(`
📍 No event is created; every suite runs against ${eventUrl}`);

const followUpEnv = {
    DASHBOARD_EVENT_URL:      eventUrl,
    TICKETING_EVENT_URL:      `${eventUrl}/tickets/dashboard`,
    TICKETING_BULK_ENTRY_URL: `${eventUrl}/tickets/bulk`,
    BUDGET_EVENT_URL:         eventUrl,
    // Entries need a subcategory that creates a PO on approval (the first entry's subcategory isn't always one).
    BUDGET_SUBCATEGORY:       process.env.BUDGET_SUBCATEGORY || 'Travel',
};
// With a dedicated ticketing event (TICKETING_REGRESSION_EVENT_URL, e.g. 264) the ticketing module runs on it while every
// other stage uses the main event. The event is kept, so the stages that create entries / POs / invoices clean up after themselves.
const ticketingEventUrl = process.env.TICKETING_REGRESSION_EVENT_URL ? process.env.TICKETING_REGRESSION_EVENT_URL.replace(/\/$/, '') : eventUrl;

const statuses = {};
// --only=a,b,c runs just those stages (names as in the Reports list).
const onlyArg = process.argv.find(arg => arg.startsWith('--only='));
const only = onlyArg ? onlyArg.slice('--only='.length).split(',').map(name => name.trim()).filter(Boolean) : null;
const stage = (name, specs, env = followUpEnv) => {
    if (only && !only.includes(name)) return;
    statuses[name] = runPlaywright(specs, name, env);
};

// Test-data setup: adds the tickets (Earlybird, Main, VIP, Direct Sales) if the event has none. Needed by the ticketing,
// revenue tickets, price per head and Budget v Actuals stages. Does nothing when the event already has tickets.
stage('setup-tickets', ['tests/setup/ensureTickets.spec.js'], { ...followUpEnv, ENSURE_TICKETS_EVENT_URL: ticketingEventUrl });

stage('event-dashboard', ['tests/eventDashboard.spec.js']);
stage('purchase-order', ['tests/budgeting/purchaseOrder.spec.js']);

// Budget entries, exports, totals and department budgets.
stage('budgeting', [
    'tests/budgeting/budgetEntry.spec.js',
    'tests/budgeting/budgetExport.spec.js',
    'tests/budgeting/budgetingTotals.spec.js',
    'tests/budgeting/departmentBudget.spec.js',
]);

// Revenue streams > price per head configuration, Budget v Actuals and Revenue > Tickets.
stage('price-per-head', ['tests/budgeting/pricePerHead.spec.js'], { ...followUpEnv, PRICE_PER_HEAD_EVENT_URL: eventUrl });
stage('budget-v-actuals', ['tests/budgetVActuals/'], { ...followUpEnv, BVA_EVENT_URL: eventUrl });
stage('revenue-tickets', ['tests/revenue/revenueTickets.spec.js'], { ...followUpEnv, REVENUE_TICKETS_EVENT_URL: eventUrl });

// Ticketing Dashboard, Trends, Tickets and Transactions pages; these change data (sales targets,
// annotations, Sold, imports) so they use TICKETING_TEST_EVENT_URL and put it back.
stage('ticketing', ['tests/ticketing/'], { ...followUpEnv, TICKETING_TEST_EVENT_URL: ticketingEventUrl });

// Supplier invoices (Budget Entry > PO > Invoices).
stage('invoice', ['tests/budgeting/invoice.spec.js'], { ...followUpEnv, INVOICE_EVENT_URL: eventUrl });

// Purchasing Summary / Payruns / Analysis. Creates its own budget entries, POs and invoices, and one
// AutoPayrun_<n> payrun per run (payruns can't be deleted in the app).
stage('purchasing', ['tests/purchasing/'], { ...followUpEnv, PURCHASING_EVENT_URL: eventUrl });

// Event Approvals pages (Budget Entries, Purchase Orders, Supplier Invoices, Payruns, Departments).
stage('approvals', ['tests/approvals/'], { ...followUpEnv, APPROVALS_EVENT_URL: eventUrl });

// Event Settings (General, Subcategories, Reporting) — every test puts back what it changes.
stage('event-settings', ['tests/eventSettings/'], { ...followUpEnv, EVENT_SETTINGS_TEST_EVENT_URL: eventUrl });

// KPI Dashboard (the event's KPI report) — every test puts back what it changes. The closed-event check uses
// KPI_CLOSED_EVENT_URL from .env.
stage('kpi', ['tests/kpi/'], { ...followUpEnv, KPI_EVENT_URL: eventUrl });

// Revenue entries and customer invoices. The stream comes from .env. The customer comes from
// REVENUE_CUSTOMER in .env (a contact that is NOT linked to Xero, so no invoices are pushed to Xero).
stage('revenue', ['tests/revenue/revenue.spec.js'], {
    ...followUpEnv,
    REVENUE_EVENT_URL: eventUrl,
});

// Account level (the regression account): dashboard, sales invoices and Account Settings (each test puts back what
// it changes).
stage('account-dashboard', ['tests/accountDashboardTests.spec.js'], {});
stage('account-sales-invoices', ['tests/accountSalesInvoices.spec.js'], {});
stage('account-entries', ['tests/accountEntries.spec.js'], {});
stage('account-settings', ['tests/accountSettings/'], followUpEnv);
stage('team-utilisation', ['tests/teamUtilisation/'], {});

const failed = Object.entries(statuses).filter(([, status]) => status !== 0).map(([name]) => name);
console.log(`\nReports: ${Object.keys(statuses).map(name => `playwright-report/${name}`).join(', ')}`);
console.log(failed.length ? `\n✖ Stages with failures: ${failed.join(', ')}` : '\n✔ Every stage passed');
process.exit(failed.length ? 1 : 0);
