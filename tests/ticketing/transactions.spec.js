// transactions.spec.js
// Ticketing > Transactions and the ticket transactions behind the Tickets / Trends pages:
//   - transactions are processed correctly (the imported template shows up in Transactions, Tickets and the Dashboard)
//   - reversing a transaction updates the numbers on the Tickets page (and the Dashboard)
//   - Add Ticket Transaction ("Log Ticket Transactions": ticket type, seller, quantity, date → Create Transaction)
// Runs against TICKETING_TEST_EVENT_URL (an open event). The Direct Sales sales are replaced by the import template
// (as the Tickets spec's import does); the reverse test puts them back by importing it again.
import { test, expect } from '../../fixtures/baseTest.js';
import { TicketsPage } from '../../pages/ticketingTicketsPage.js';
import { TransactionsPage } from '../../pages/ticketingTransactionsPage.js';
import { TicketingDashboardPage } from '../../pages/ticketingDashboardPage.js';
import { TrendsPage } from '../../pages/ticketingTrendsPage.js';
import { readCsvRecords } from '../utils/spreadsheet.js';

const IMPORT_TEMPLATE = './fixtures/ticket-import-template.csv';
const todayIso = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

test.describe('Ticketing Transactions', () => {

    let tickets;
    let transactions;

    test.beforeEach(async ({ page }) => {
        tickets = new TicketsPage(page);
        transactions = new TransactionsPage(page);
    });

    // Gets Direct Sales back to the import template's figures.
    const importTemplate = async () => {
        await tickets.goto();
        await tickets.importTemplate({ file: IMPORT_TEMPLATE });
    };

    const soldByTicket = async () => {
        await tickets.goto();
        await tickets.expandAll();
        return Object.fromEntries((await tickets.readSalesChannels())
            .filter(channel => channel.supplier === 'Direct Sales').map(channel => [channel.reference, channel.sold]));
    };

    test('transactions are processed correctly: the imported template shows in Transactions, Tickets and the Dashboard', async ({ page }) => {
        test.setTimeout(240000);
        const csv = await readCsvRecords(IMPORT_TEMPLATE);
        await importTemplate();
        await transactions.goto();

        await test.step('Columns', async () => {
            const header = await page.locator('thead').innerText();
            for (const column of ['Record Type', 'Imported', 'Date', 'Ticket', 'Reference', 'Channel', 'Status', 'Quantity', 'Net', 'Tax', 'Gross', 'Refunded']) {
                expect(header, `Column "${column}"`).toContain(column);
            }
        });

        await test.step('Each row of the template is a Sale record on the Direct Sales channel', async () => {
            const records = await transactions.readRecords();
            for (const row of csv) {
                const record = records.find(r => r.channel === 'Direct Sales' && r.reference === row['Ticket Reference']);
                expect(record, `Record for ${row['Ticket Reference']}`).toBeTruthy();
                expect(record).toMatchObject({ recordType: 'Imported', status: 'Sale', quantity: Number(row['Quantity']), quantityRefunded: 0 });
                const [day, month] = row['Date'].split('/').map(Number);
                expect(record.date, 'Date of the sale').toBe(`${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month - 1]} ${day}`);
                expect(record.net + record.tax, 'Gross = net + tax').toBeCloseTo(record.gross, 2);
            }
        });

        await test.step('The channel filter narrows the records', async () => {
            const filter = page.locator('select').filter({ hasText: 'All Channels' }).first();
            await filter.selectOption({ label: 'Showing: Direct Sales' });
            await expect.poll(async () => {
                const records = await transactions.readRecords();
                return records.length > 0 && records.every(record => record.channel === 'Direct Sales');
            })
                .toBe(true);
            const shown = await transactions.readRecords();
            expect(shown.length).toBeGreaterThan(0);
            expect(shown.every(record => record.channel === 'Direct Sales')).toBe(true);
        });

        await test.step('The same sales are on the Tickets page and the Dashboard', async () => {
            const sold = await soldByTicket();
            for (const row of csv) expect(sold[row['Ticket Reference']], `${row['Ticket Reference']} sold`).toBe(Number(row['Quantity']));
            const dashboard = new TicketingDashboardPage(page);
            await dashboard.goto();
            const total = (await dashboard.readKpis())['Tickets Sold'].value;
            expect(total, 'Tickets Sold on the Dashboard includes the imported sales')
                .toBeGreaterThanOrEqual(csv.reduce((sum, row) => sum + Number(row['Quantity']), 0));
        });
    });

    // The "Reverse" button of the Reverse Transaction dialog does nothing when pressed: no request, no message,
    // and the dialog stays open.
    test('reversing a transaction updates the numbers on the Tickets page and the Dashboard', async ({ page }) => {
        test.fail(true, 'Known bug: Reverse Transaction does nothing - ClickUp: TODO');
        test.setTimeout(300000);
        await importTemplate();
        const before = await soldByTicket();
        const dashboard = new TicketingDashboardPage(page);
        await dashboard.goto();
        const soldBefore = (await dashboard.readKpis())['Tickets Sold'].value;

        try {
            await transactions.goto();
            const [record] = (await transactions.readRecords()).filter(r => r.channel === 'Direct Sales' && r.quantity >= 2);
            expect(record, 'A Direct Sales record with at least 2 tickets to reverse from').toBeTruthy();

            const dialog = await transactions.openReverseDialog(record.ticket, record.channel);
            await expect(dialog).toContainText(record.ticket);
            await dialog.locator('input[type="number"]').fill('1');
            await dialog.getByRole('button', { name: 'Reverse', exact: true }).click();
            await expect(dialog, 'The dialog closes once the transaction is reversed').toBeHidden({ timeout: 10000 });

            await transactions.goto();
            const reversed = (await transactions.readRecords()).find(r => r.channel === 'Direct Sales' && r.ticket === record.ticket);
            expect(reversed.quantityRefunded, 'Quantity refunded on the Transactions page').toBe(1);
            expect((await soldByTicket())[record.reference], 'Sold on the Tickets page').toBe(before[record.reference] - 1);
            await dashboard.goto();
            expect((await dashboard.readKpis())['Tickets Sold'].value, 'Tickets Sold on the Dashboard').toBe(soldBefore - 1);
        } finally {
            await importTemplate();
        }
    });

    test('Add Ticket Transaction opens "Log Ticket Transactions" from a sales channel and from Trends', async ({ page }) => {
        await tickets.goto();
        const names = (await tickets.readTicketRows()).map(row => row.name);
        await tickets.expandAll();
        const [channel] = await tickets.readSalesChannels();

        await test.step('From a sales channel: its ticket is filled in, with quantity and date', async () => {
            const menu = await tickets.openChannelMenu(channel.ticket, channel.supplier);
            await menu.getByText('Add Ticket Transaction', { exact: true }).click();
            const drawer = page.locator('div.drawer').last();
            await expect(drawer).toContainText('Log Ticket Transactions');
            await expect(drawer).toContainText('Select the ticket type, add quantity and date, then click button to add.');
            await expect(drawer).toContainText('Transaction #1');
            await expect(drawer.locator('dl').filter({ hasText: 'Ticket Type' }).first()).toContainText(channel.ticket);
            for (const field of ['Ticket Seller', 'Quantity', 'Date']) await expect(drawer).toContainText(field);
            expect(Number(await drawer.locator('input[type="number"]').inputValue()), 'Quantity starts at 1').toBe(1);
            expect(await drawer.locator('input[type="hidden"]').first().inputValue(), 'Date starts as today').toBe(todayIso());
            await expect(drawer).toContainText('These ticket(s) have been refunded or cancelled');
            await expect(drawer).toContainText('These ticket(s) have no monetary value');
            await expect(drawer.getByRole('button', { name: 'Create Transaction' })).toBeVisible();
            await drawer.locator('button').filter({ has: page.locator('i.mdi-close') }).first().click();
            await expect(drawer).toBeHidden();
        });

        await test.step('From Trends: add a transaction row and choose the ticket type', async () => {
            const trends = new TrendsPage(page);
            await trends.goto();
            await page.getByText('Log Ticket Transaction').click();
            const drawer = page.locator('div.drawer').last();
            await expect(drawer).toContainText('Tickets: 0');
            await drawer.getByRole('button', { name: 'Add Transaction' }).click();
            await expect(drawer).toContainText('Tickets: 1');
            await drawer.locator('dl').filter({ hasText: 'Ticket Type' }).first().locator('[contenteditable="true"]').click();
            const options = (await page.locator('.v-popper__popper--shown').last().innerText()).split('\n').map(t => t.trim()).filter(Boolean);
            expect(options.sort(), 'Ticket types to choose from').toEqual([...names].sort());
        });
    });

    // The Ticket Seller list in the drawer says "There are no options available to select" for every ticket (even a
    // brand-new one), so "Create Transaction" stays disabled and no transaction can be added.
    test('Add Ticket Transaction: choose the ticket seller, quantity and date, then create the transaction', async ({ page }) => {
        test.fail(true, 'Known bug: Ticket Seller list is empty in Add Ticket Transaction - ClickUp: TODO');
        await tickets.goto();
        await tickets.expandAll();
        const [channel] = await tickets.readSalesChannels();
        const menu = await tickets.openChannelMenu(channel.ticket, channel.supplier);
        await menu.getByText('Add Ticket Transaction', { exact: true }).click();
        const drawer = page.locator('div.drawer').last();
        await expect(drawer).toContainText('Log Ticket Transactions');

        await drawer.locator('dl').filter({ hasText: 'Ticket Seller' }).locator('[contenteditable="true"]').click();
        const options = await page.locator('.v-popper__popper--shown').last().innerText();
        expect(options, `The ticket seller list offers ${channel.supplier}`).toContain(channel.supplier);
        await expect(drawer.getByRole('button', { name: 'Create Transaction' }), 'Create Transaction is enabled once a seller is chosen').toBeEnabled();
    });
});
