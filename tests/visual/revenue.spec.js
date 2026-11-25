// tests/visual/revenue.spec.js
import { runVisualPages, selectDepartmentTab } from './visualHelpers.js';

// ── Revenue Budget drill-down helpers ───────────────────────────────────────
// Reusable across any revenue stream, not just "Bar" — pass a different
// streamName/subcategoryName to add more drill-down pages later.

async function gotoRevenueBudget({ page, budgetingPage }) {
    budgetingPage.eventBaseUrl = process.env.BUDGET_EVENT_URL;
    await budgetingPage.gotoRevenueBudgetPage();
}

// Clicks the arrow (→) button on a revenue stream row to enter its dedicated
// page (e.g. Revenue Budget list > Bar > Subcategories).
async function enterRevenueStream(page, streamName) {
    const row = page.locator('tr.tw-cursor-pointer').filter({ hasText: streamName }).first();
    await row.waitFor({ state: 'visible', timeout: 10000 });
    await row.locator('button').filter({ has: page.locator('i.mdi-arrow-right') }).first().click();
    await page.waitForLoadState('networkidle');
}

// From a stream's subcategories page, clicks the arrow (→) next to a named
// subcategory row to enter its Revenue Per Head Entries page.
async function enterSubcategory(page, subcategoryName) {
    const row = page.locator('tr').filter({ hasText: subcategoryName }).first();
    await row.locator('button').filter({ has: page.locator('i.mdi-arrow-right') }).first().click();
    await page.waitForLoadState('networkidle');
}

// On the main Revenue Streams list, clicking the row itself (not its arrow)
// expands an inline panel with 5 tabs: Department Summary, Revenue Per Head
// Configuration, Budget Entries, Recharged Entries, Department Info.
async function expandRevenueStreamPanel(page, streamName) {
    const row = page.locator('tr.tw-cursor-pointer').filter({ hasText: streamName }).first();
    await row.waitFor({ state: 'visible', timeout: 10000 });
    await row.click();
    await page.waitForTimeout(800);
}

const pages = [
    {
        name: 'Revenue Budget',
        goto: async (ctx) => {
            await gotoRevenueBudget(ctx);
        },
    },
    {
        name: 'Revenue Budget - Bar Subcategories',
        goto: async (ctx) => {
            await gotoRevenueBudget(ctx);
            await enterRevenueStream(ctx.page, 'Bar');
        },
    },
    {
        name: 'Revenue Budget - Bar Main Per Head Entries',
        goto: async (ctx) => {
            await gotoRevenueBudget(ctx);
            await enterRevenueStream(ctx.page, 'Bar');
            await enterSubcategory(ctx.page, 'Bar Main');
        },
    },
    {
        name: 'Revenue Budget - Bar Department Summary',
        goto: async (ctx) => {
            await gotoRevenueBudget(ctx);
            await expandRevenueStreamPanel(ctx.page, 'Bar');
        },
    },
    {
        name: 'Revenue Budget - Bar Revenue Per Head Configuration',
        goto: async (ctx) => {
            await gotoRevenueBudget(ctx);
            await expandRevenueStreamPanel(ctx.page, 'Bar');
            await selectDepartmentTab(ctx.page, 'Revenue Per Head Configuration');
        },
    },
    {
        name: 'Revenue Budget - Bar Budget Entries',
        goto: async (ctx) => {
            await gotoRevenueBudget(ctx);
            await expandRevenueStreamPanel(ctx.page, 'Bar');
            await selectDepartmentTab(ctx.page, 'Budget Entries');
        },
    },
    {
        name: 'Revenue Budget - Bar Recharged Entries',
        goto: async (ctx) => {
            await gotoRevenueBudget(ctx);
            await expandRevenueStreamPanel(ctx.page, 'Bar');
            await selectDepartmentTab(ctx.page, 'Recharged Entries');
        },
    },
    {
        name: 'Revenue Budget - Bar Department Info',
        goto: async (ctx) => {
            await gotoRevenueBudget(ctx);
            await expandRevenueStreamPanel(ctx.page, 'Bar');
            await selectDepartmentTab(ctx.page, 'Department Info');
        },
    },
];

runVisualPages('Visual Comparisons - Revenue', pages);
