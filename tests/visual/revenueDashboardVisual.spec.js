// tests/visual/revenueDashboardVisual.spec.js
// Covers the standalone "Revenue" sidebar module (/revenue) — distinct from
// Revenue Budget (a Budgeting sub-tab, see revenue.spec.js) and the
// Ticketing Dashboard's own "£ Revenue" tab (see ticketing.spec.js).
import { runVisualPages } from './visualHelpers.js';

const pages = [
    {
        name: 'Revenue Dashboard',
        goto: async ({ page, budgetingPage }) => {
            budgetingPage.eventBaseUrl = process.env.BUDGET_EVENT_URL;
            await page.goto(`${budgetingPage.eventBaseUrl}/revenue`, {
                waitUntil: 'domcontentloaded',
                timeout: 60000,
            });
            await page.waitForLoadState('networkidle');
        },
    },
];

runVisualPages('Visual Comparisons - Revenue Dashboard', pages);
