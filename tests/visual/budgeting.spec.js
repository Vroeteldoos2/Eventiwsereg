// tests/visual/budgeting.spec.js
import { expect, runVisualPages, selectDepartmentTab, verifyEntriesTableColumns } from './visualHelpers.js';

// ── Cost Budget drill-down helpers ──────────────────────────────────────────
// Scoped to whichever department/subcategory is first in the list (per the
// "just select the first one" ask).

async function gotoCostBudget({ page, budgetingPage }) {
    budgetingPage.eventBaseUrl = process.env.BUDGET_EVENT_URL;
    await page.goto(`${budgetingPage.eventBaseUrl}/budget/costs`, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
    });
    await expect(page.getByText('Loading Information', { exact: true })).toBeHidden({ timeout: 30000 });
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 30000 });
}

// Clicks the arrow (→) on the first cost department row to enter its
// dedicated Subcategories page.
async function enterFirstCostDepartment(page) {
    const row = page.locator('tr.tw-cursor-pointer').first();
    await row.waitFor({ state: 'visible', timeout: 10000 });
    const previousUrl = page.url();
    await row.locator('button').filter({ has: page.locator('i.mdi-arrow-right') }).first().click();
    await expect(page).not.toHaveURL(previousUrl, { timeout: 15000 });
    await expect(page.getByText('Loading Information', { exact: true })).toBeHidden({ timeout: 30000 });
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 30000 });
}

// From a department's Subcategories page, clicks the arrow (→) on the first
// subcategory row to enter its Budget Entries page.
async function enterFirstCostSubcategory(page) {
    const row = page.locator('tr').filter({ has: page.locator('button i.mdi-arrow-right') }).first();
    const previousUrl = page.url();
    await row.locator('button').filter({ has: page.locator('i.mdi-arrow-right') }).first().click();
    await expect(page).not.toHaveURL(previousUrl, { timeout: 15000 });
    await expect(page.getByText('Loading Information', { exact: true })).toBeHidden({ timeout: 30000 });
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 30000 });
}

// Goes to the Budget Summary page and clicks the first row in the Cost
// Departments table to expand its inline panel (4 tabs: Department Summary,
// Budget Entries, Recharged Entries, Department Info).
async function expandFirstCostDepartmentPanel({ page, budgetingPage }) {
    budgetingPage.eventBaseUrl = process.env.BUDGET_EVENT_URL;
    await budgetingPage.gotoBudgetSummaryPage();
    const costSection = page.locator('div.ew-data-table').filter({ hasText: 'Cost Departments' }).first();
    const row = costSection.locator('tr.tw-cursor-pointer').first();
    await row.waitFor({ state: 'visible', timeout: 10000 });
    await row.click();
    await expect(page.locator('tr.expanded-row').first()).toBeVisible({ timeout: 10000 });
}

const pages = [
    {
        name: 'Budget Summary',
        goto: async ({ budgetingPage }) => {
            budgetingPage.eventBaseUrl = process.env.BUDGET_EVENT_URL;
            await budgetingPage.gotoBudgetSummaryPage();
        },
    },
    {
        name: 'Cost Budget - First Department Subcategories',
        goto: async (ctx) => {
            await gotoCostBudget(ctx);
            await enterFirstCostDepartment(ctx.page);
        },
    },
    {
        name: 'Cost Budget - First Department First Subcategory Budget Entries',
        goto: async (ctx) => {
            await gotoCostBudget(ctx);
            await enterFirstCostDepartment(ctx.page);
            await enterFirstCostSubcategory(ctx.page);
        },
    },
    {
        name: 'Cost Budget - First Department Summary',
        goto: async (ctx) => {
            await expandFirstCostDepartmentPanel(ctx);
        },
    },
    {
        // This table keeps growing as other tests create budget entries under
        // the first department, so a pixel screenshot drifts by design.
        // Check column alignment instead of comparing the full page image.
        name: 'Cost Budget - First Department Budget Entries',
        goto: async (ctx) => {
            await expandFirstCostDepartmentPanel(ctx);
            await selectDepartmentTab(ctx.page, 'Budget Entries');
        },
        verify: verifyEntriesTableColumns,
    },
    {
        // Same growing-row issue as Budget Entries above.
        name: 'Cost Budget - First Department Recharged Entries',
        goto: async (ctx) => {
            await expandFirstCostDepartmentPanel(ctx);
            await selectDepartmentTab(ctx.page, 'Recharged Entries');
        },
        verify: verifyEntriesTableColumns,
    },
    {
        name: 'Cost Budget - First Department Department Info',
        goto: async (ctx) => {
            await expandFirstCostDepartmentPanel(ctx);
            await selectDepartmentTab(ctx.page, 'Department Info');
        },
    },
];

runVisualPages('Visual Comparisons - Budgeting', pages);
