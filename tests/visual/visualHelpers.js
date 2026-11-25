// tests/visual/visualHelpers.js
// Shared plumbing for the visual regression spec files (budgeting.spec.js,
// revenue.spec.js, ticketing.spec.js, ...). Keeping these split by module
// means a run can target/skip one area at a time, e.g.:
//   npx playwright test tests/visual/ticketing.spec.js
import { test, expect } from '../../fixtures/baseTest.js';

export { test, expect };

// Clicks a named tab button inside an expanded department/stream panel.
// "Department Summary" is the default tab shown on expand, so there's
// nothing to click for it.
export async function selectDepartmentTab(page, tabName) {
    if (tabName === 'Department Summary') return;
    const tab = page.locator('button').filter({ hasText: new RegExp(`^${tabName}$`, 'i') }).first();
    await tab.waitFor({ state: 'visible', timeout: 10000 });
    await tab.click();
}

// Budget Entries / Recharged Entries tables grow continuously as other tests
// create entries, so pixel screenshots drift by design — check column order
// instead of comparing the full page image.
export async function verifyEntriesTableColumns(page) {
    const headerRow = page.locator('thead tr').filter({ hasText: /^Status/ }).first();
    const headerTexts = (await headerRow.locator('th, td').allTextContents())
        .map(t => t.trim())
        .filter(Boolean);
    expect(headerTexts).toEqual(['Status', 'Title', 'Subcategory', 'Supplier', 'Fixed', 'Budgeted']);
}

// Add a new entry to a module's `pages` array for each page/state you want
// under visual regression. `goto` receives the test fixtures and should
// leave the page settled on the state to be captured. An optional `verify`
// replaces the screenshot comparison with a custom assertion (see
// verifyEntriesTableColumns above) for pages whose content can't be
// pixel-compared reliably.
export function runVisualPages(describeName, pages) {
    test.describe(describeName, () => {
        for (const { name, goto, verify } of pages) {
            test(name, async ({ page, budgetingPage, ticketingPage }) => {
                await goto({ page, budgetingPage, ticketingPage });
                if (verify) {
                    await verify(page);
                    return;
                }
                const slug = name.toLowerCase().replace(/\s+/g, '-');
                await expect(page).toHaveScreenshot(`${slug}.png`, {
                    fullPage: true,
                    // The Event Profit Overview widget's "Last updated ..."
                    // line is a relative timestamp that changes wording on
                    // every run — mask it everywhere. No-op on pages (e.g.
                    // Ticketing) where the widget doesn't exist.
                    mask: [page.getByText(/Last updated/i)],
                });
            });
        }
    });
}
