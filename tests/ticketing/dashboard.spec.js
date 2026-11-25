// dashboard.spec.js
// Ticketing > Dashboard: four KPI tiles (Tickets Sold, Tickets Held With Sellers, Tickets Remaining,
// Sell-through Rate) plus the "Tickets Sold" and "Monthly Ticket Sales" charts. Read-only.
// Runs against TICKETING_TEST_EVENT_URL (falls back to DASHBOARD_EVENT_URL / TICKETING_EVENT_URL).
import { test, expect } from '../../fixtures/baseTest.js';
import { TicketingPage, getTicketingTestPageUrl } from '../../pages/ticketingPage.js';
import { TicketingDashboardPage } from '../../pages/ticketingDashboardPage.js';
import { TrendsPage } from '../../pages/ticketingTrendsPage.js';

const TILES = {
    'Tickets Sold': 'Net tickets sold',
    'Tickets Held With Sellers': 'Unsold tickets allocated to sellers',
    'Tickets Remaining': 'Unsold across all channels',
    'Sell-through Rate': 'Percentage of allocated tickets sold',
};

test.describe('Ticketing Dashboard', () => {

    let dashboard;

    test.beforeEach(async ({ page }) => {
        dashboard = new TicketingDashboardPage(page);
        await dashboard.goto();
    });

    test('shows the four KPI tiles @smoke', async () => {
        const kpis = await dashboard.readKpis();
        expect(Object.keys(kpis)).toEqual(Object.keys(TILES));
        for (const [title, subtitle] of Object.entries(TILES)) {
            expect(kpis[title].subtitle, `${title} subtitle`).toBe(subtitle);
            expect(kpis[title].value, `${title} should be a number`).not.toBeNaN();
            expect(kpis[title].value, `${title} should not be negative`).toBeGreaterThanOrEqual(0);
        }
        expect(kpis['Sell-through Rate'].text, 'Sell-through Rate is a percentage').toMatch(/^\d+(\.\d)?%$/);
        expect(kpis['Sell-through Rate'].value).toBeLessThanOrEqual(100);
        console.log('📊 KPIs:', Object.fromEntries(Object.entries(kpis).map(([title, kpi]) => [title, kpi.text])));
    });

    test('KPI figures agree with the Tickets and Trends pages', async ({ page }) => {
        const kpis = await dashboard.readKpis();
        const sold = kpis['Tickets Sold'].value;
        const remaining = kpis['Tickets Remaining'].value;
        const held = kpis['Tickets Held With Sellers'].value;

        // Tickets page: every ticket's Available count (all channels).
        const ticketing = new TicketingPage(page);
        await ticketing.navigateToTicketingPage(getTicketingTestPageUrl('bulk'));
        const rows = await ticketing.readTicketRows();
        expect(rows.length, 'Tickets page should list tickets').toBeGreaterThan(0);
        const available = rows.reduce((total, row) => total + row.available, 0);
        console.log(`🎟️ Available ${available}, sold ${sold}, remaining ${remaining}, held with sellers ${held}`);

        expect(remaining, 'Tickets Remaining = tickets available − tickets sold').toBe(available - sold);
        expect(kpis['Sell-through Rate'].value, 'Sell-through Rate = sold ÷ available').toBeCloseTo(
            Number((sold / available * 100).toFixed(1)), 1);
        expect(held, 'Tickets held with sellers are part of the unsold tickets').toBeLessThanOrEqual(remaining);

        // Trends page: year-to-date actual sales.
        const trends = new TrendsPage(page);
        await trends.goto();
        const summary = await trends.readSummary();
        expect(summary.rows['Actual Sales'][1], 'Tickets Sold = Trends YTD actual sales').toBe(sold);
    });

    test('Tickets Sold and Monthly Ticket Sales charts are shown @smoke', async ({ page }) => {
        for (const title of ['Tickets Sold', 'Monthly Ticket Sales']) {
            const card = dashboard.chartCard(title);
            await expect(card.locator('canvas').first(), `${title} chart`).toBeVisible();
        }

        await test.step('Chart menu offers a PNG download', async () => {
            const card = dashboard.chartCard('Monthly Ticket Sales');
            await card.locator('button:has(i.mdi-cog)').first().click();
            const download = page.waitForEvent('download', { timeout: 15000 });
            await page.getByText('Download Image', { exact: true }).click();
            expect((await download).suggestedFilename()).toMatch(/\.png$/i);
        });
    });
});
