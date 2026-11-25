import { expect } from '@playwright/test';
import { TicketingPage, getTicketingTestPageUrl } from './ticketingPage.js';
import { toNumber } from './ticketingTrendsPage.js';

// Ticketing > Transactions: one row per sale / refund record, with filters and a reverse (undo) button per row.
export class TransactionsPage {

    constructor(page) {
        this.page = page;
        this.ticketing = new TicketingPage(page);
    }

    async goto() {
        await this.ticketing.navigateToTicketingPage(getTicketingTestPageUrl('transactions'));
        await expect(this.page.getByText('Record Type', { exact: false }).first()).toBeVisible({ timeout: 20000 });
        await this.page.mouse.move(1000, 900);
    }

    // [{ recordType, imported, date, ticket, reference, channel, status, quantity, quantityRefunded, net, tax, gross }]
    async readRecords() {
        const rows = await this.page.locator('tbody tr').evaluateAll(trs =>
            trs.map(tr => [...tr.children].map(cell => cell.innerText.trim().replace(/\s+/g, ' '))));
        return rows.filter(cells => cells.length >= 12).map(cells => ({
            recordType: cells[0], imported: cells[1], date: cells[2], ticket: cells[3], reference: cells[4],
            channel: cells[5], status: cells[6], quantity: toNumber(cells[7]), quantityRefunded: toNumber(cells[8]),
            net: toNumber(cells[9]), tax: toNumber(cells[10]), gross: toNumber(cells[11]),
        }));
    }

    recordRow(ticket, channel = 'Direct Sales') {
        return this.page.locator('tbody tr').filter({ hasText: ticket }).filter({ hasText: channel }).first();
    }

    // Opens the "Reverse Transaction" dialog of a record (the arrow button at the end of its row).
    async openReverseDialog(ticket, channel = 'Direct Sales') {
        await this.recordRow(ticket, channel).locator('button').last().click();
        const dialog = this.page.locator('.m-wrapper').filter({ hasText: 'Reverse Transaction' }).last();
        await dialog.waitFor({ state: 'visible', timeout: 10000 });
        return dialog;
    }
}
