import { expect } from '@playwright/test';
import { TicketingPage, getTicketingTestPageUrl } from './ticketingPage.js';
import { toNumber } from './ticketingTrendsPage.js';

// Ticketing > Dashboard: four KPI tiles, the "Tickets Sold" chart and the "Monthly Ticket Sales" chart.
export class TicketingDashboardPage {

    constructor(page) {
        this.page = page;
        this.ticketing = new TicketingPage(page);
    }

    async goto() {
        await this.ticketing.navigateToTicketingPage(getTicketingTestPageUrl('dashboard'));
        await expect(this.tiles()).toHaveCount(4, { timeout: 20000 });
        await this.page.mouse.move(1000, 900);
    }

    tiles() {
        return this.page.locator('div.ew-statistic');
    }

    // { 'Tickets Sold': { subtitle: 'Net tickets sold', text: '287', value: 287 }, ... }
    async readKpis() {
        const tiles = await this.tiles().evaluateAll(els => els.map(el => ({
            title: el.querySelector('h4')?.innerText.trim(),
            subtitle: el.querySelector('p')?.innerText.trim(),
            text: el.querySelector('span')?.innerText.trim(),
        })));
        return Object.fromEntries(tiles.map(({ title, subtitle, text }) => [title, { subtitle, text, value: toNumber(text.replace('%', '')) }]));
    }

    // The card holding a chart, found from its title (the "Tickets Sold" tile shares the title — take the later one).
    chartCard(title) {
        return this.page.getByText(title, { exact: true }).last().locator('xpath=ancestor::div[.//canvas][1]');
    }
}
