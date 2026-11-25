// tests/visual/ticketing.spec.js
import { runVisualPages } from './visualHelpers.js';
import { getTicketingPageUrl } from '../../pages/ticketingPage.js';

// NOTE: ticketingPage.selectRevenueTab() uses an exact-text match on
// "Revenue", which also matches the *global sidebar* nav link of the same
// name and navigates away from Ticketing entirely. Scoping to a sibling of
// the (working) Sales button avoids that collision.
// (Left as a local workaround per request — not fixed in ticketingPage.js.)
async function selectTicketingRevenueTab(page) {
    const salesBtn = page.getByRole('button', { name: /Sales/i }).first();
    await salesBtn.waitFor({ state: 'visible', timeout: 10000 });
    const toolbar = salesBtn.locator('xpath=..');
    const revenueTab = toolbar.getByRole('button', { name: /Revenue/i }).first();
    await revenueTab.click();
    await page.waitForTimeout(600);
}

const pages = [
    {
        name: 'Ticketing Dashboard',
        goto: async ({ ticketingPage }) => {
            await ticketingPage.navigateToTicketingPage(getTicketingPageUrl());
        },
    },
    {
        name: 'Ticketing Dashboard - Sales Tab',
        goto: async ({ page, ticketingPage }) => {
            await ticketingPage.navigateToTicketingPage(getTicketingPageUrl());
            await ticketingPage.selectSalesTab();
        },
    },
    {
        name: 'Ticketing Dashboard - Revenue Tab',
        goto: async ({ page, ticketingPage }) => {
            await ticketingPage.navigateToTicketingPage(getTicketingPageUrl());
            await selectTicketingRevenueTab(page);
        },
    },
    {
        name: 'Ticketing - Bulk Entry',
        goto: async ({ ticketingPage }) => {
            await ticketingPage.goToBulkEntry();
        },
    },
];

runVisualPages('Visual Comparisons - Ticketing', pages);
