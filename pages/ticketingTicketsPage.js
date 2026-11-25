import { expect } from '@playwright/test';
import { TicketingPage, getTicketingTestPageUrl } from './ticketingPage.js';
import { toNumber } from './ticketingTrendsPage.js';

// Ticketing > Tickets (bulk entry): a card per ticket with its figures, an "Expand all" per ticket category
// that reveals the sales channels (one row per ticket seller), and the Import / Export menu.
export class TicketsPage {

    constructor(page) {
        this.page = page;
        this.ticketing = new TicketingPage(page);
    }

    async goto() {
        await this.ticketing.navigateToTicketingPage(getTicketingTestPageUrl('bulk'));
        await this.page.getByRole('button', { name: /expand all/i }).first().waitFor({ state: 'visible', timeout: 20000 });
        // Park the mouse: hovering the left edge of the page opens the sidebar over the content.
        await this.page.mouse.move(1000, 900);
    }

    // [{ name, headcount, fixed, available, price, collected, received }] — see TicketingPage.readTicketRows().
    readTicketRows() {
        return this.ticketing.readTicketRows();
    }

    async expandAll() {
        const buttons = this.page.getByRole('button', { name: /expand all/i });
        for (let i = await buttons.count(); i > 0; i--) await buttons.first().click();
        // A category's "Expand all" can leave a ticket collapsed (it depends on what was open already): open the rest one by one.
        const collapsed = this.page.getByRole('button', { name: 'Expand ticket' });
        for (let i = await collapsed.count(); i > 0; i--) await collapsed.first().click();
        await expect(collapsed).toHaveCount(0);
    }

    // The card of one ticket (its figures row plus, once expanded, its sales channels).
    ticketCard(name) {
        return this.page.locator('div.tw-group').filter({
            has: this.page.locator('div[class*="tw-grid-cols-[44px"] > div:nth-child(2)', { hasText: new RegExp(`^${name}$`) }),
        }).first();
    }

    // The sales channel (ticket seller) row of a ticket.
    sellerRow(ticket, supplier) {
        return this.ticketCard(ticket)
            .locator(`div:has(> span[title="${supplier}"])`)
            .filter({ has: this.page.locator('button[aria-label="Ticket sale actions"]') })
            .first();
    }

    // Sales channels of every expanded ticket:
    // [{ ticket, supplier, reference, rebate, directCost, tax, fixed, available, sold, collected, received,
    //    editable: { supplier: false, reference: true, ... } }]
    async readSalesChannels() {
        const rows = await this.page.evaluate(() => [...document.querySelectorAll('button[aria-label="Ticket sale actions"]')].map(button => {
            let row = button.parentElement;
            while (row && !row.querySelector(':scope > span[title]')) row = row.parentElement;
            const card = row.closest('div.tw-group');
            const cells = [...row.children];
            const text = i => cells[i].innerText.trim();
            const editable = i => !!cells[i].querySelector('[contenteditable="true"]');
            return {
                ticket: card.querySelector('div[class*="tw-grid-cols-[44px"]').children[1].innerText.trim(),
                supplier: text(0), reference: text(1), rebate: text(2), directCost: text(3), tax: text(4),
                fixed: text(5), available: text(6), sold: text(7), collected: text(8), received: text(9),
                editable: {
                    supplier: editable(0), reference: editable(1), rebate: editable(2), directCost: editable(3),
                    fixed: editable(5), available: editable(6), sold: editable(7),
                },
                taxIsButton: !!cells[4].querySelector('button'),
            };
        }));
        const num = toNumber;
        return rows.map(row => ({
            ...row,
            rebate: num(row.rebate), directCost: num(row.directCost),
            fixed: num(row.fixed), available: num(row.available), sold: num(row.sold),
            collected: num(row.collected), received: num(row.received),
        }));
    }

    // Sets a number in an editable cell of a sales channel row: 'reference' | 'rebate' | 'directCost' | 'fixed' | 'available' | 'sold'.
    async setChannelValue(ticket, supplier, field, value) {
        const index = ['reference', 'rebate', 'directCost', 'fixed', 'available', 'sold'].indexOf(field);
        const cell = this.sellerRow(ticket, supplier).locator('[contenteditable="true"]').nth(index);
        // Type it: filling a contenteditable doesn't reach the page's change tracking.
        await cell.click({ clickCount: 3 });
        await this.page.keyboard.type(String(value), { delay: 30 });
        await this.page.keyboard.press('Tab');
        await expect(this.unsavedChangesBanner()).toBeVisible({ timeout: 10000 });
    }

    unsavedChangesBanner() {
        return this.page.getByText('You have unsaved ticket changes');
    }

    async saveChanges() {
        await this.page.getByRole('button', { name: 'Save Changes', exact: true }).click();
        await expect(this.unsavedChangesBanner()).toBeHidden({ timeout: 20000 });
    }

    // Menu of a sales channel row ("Ticket sale actions"): returns the items shown.
    async openChannelMenu(ticket, supplier) {
        await this.sellerRow(ticket, supplier).locator('button[aria-label="Ticket sale actions"]').click();
        const menu = this.page.locator('.v-popper__popper--shown').last();
        await menu.waitFor({ state: 'visible', timeout: 5000 });
        return menu;
    }

    // Menu of a ticket row ("…" button): returns the popup.
    async openTicketMenu(ticket) {
        await this.ticketCard(ticket).locator('div[class*="tw-grid-cols-[44px"]').first()
            .locator('button:has(i.mdi-dots-horizontal)').click();
        const menu = this.page.locator('.v-popper__popper--shown').last();
        await menu.waitFor({ state: 'visible', timeout: 5000 });
        return menu;
    }

    async closeMenus() {
        await this.page.mouse.click(1000, 900);
        await expect(this.page.locator('.v-popper__popper--shown')).toBeHidden({ timeout: 5000 });
    }

    // Tax rate of a sales channel row ("20%" button → list of rates).
    async setChannelTax(ticket, supplier, rate) {
        const taxButton = this.sellerRow(ticket, supplier).locator('button:not([aria-label])').first();
        await taxButton.click();
        const list = this.page.locator('.v-popper__popper--shown').last();
        await list.getByText(rate, { exact: true }).click();
        await expect(taxButton).toContainText(rate);
    }

    // ── BANK TRANSACTIONS ────────────────────────────────────────────────────────

    // Row menu > Add Bank Transaction: money received relating to a ticket sale.
    async addBankTransaction(ticket, supplier, { name, amount, bankAccount = 'sgeorge' }) {
        const menu = await this.openChannelMenu(ticket, supplier);
        await menu.getByText('Add Bank Transaction', { exact: true }).click();
        const dialog = this.page.locator('.m-wrapper').filter({ hasText: 'Create Bank Transaction' }).last();
        await dialog.waitFor({ state: 'visible', timeout: 10000 });
        await dialog.locator('select').first().selectOption({ label: bankAccount });
        await dialog.locator('input[maxlength="255"]').fill(name);
        await dialog.locator('input[type="number"]').fill(String(amount));
        const created = this.page.waitForResponse(r => r.request().method() === 'POST' && /\/transactions$/.test(r.url()), { timeout: 15000 });
        await dialog.getByRole('button', { name: 'Add Transaction' }).click();
        expect((await created).ok(), 'Bank transaction created').toBe(true);
        await dialog.waitFor({ state: 'hidden', timeout: 15000 });
    }

    // Row menu > View Bank Transactions: [{ from, loggedBy, date, amount }] (the dialog is left open).
    async openBankTransactions(ticket, supplier) {
        const menu = await this.openChannelMenu(ticket, supplier);
        const transactionsLoaded = this.page.waitForResponse(
            response => response.request().method() === 'GET' && /\/bank-transactions(?:\?|$)/.test(response.url()),
            { timeout: 15000 },
        );
        await menu.getByText('View Bank Transactions', { exact: true }).click();
        await transactionsLoaded;
        const dialog = this.page.locator('.m-wrapper').filter({ hasText: 'Bank Transactions' }).last();
        await dialog.waitFor({ state: 'visible', timeout: 10000 });
        return dialog;
    }

    async readBankTransactions(dialog) {
        const rows = await dialog.locator('tbody tr').evaluateAll(trs =>
            trs.map(tr => [...tr.children].map(cell => cell.innerText.trim())));
        return rows.filter(cells => cells.length >= 4).map(([from, loggedBy, date, amount]) => ({ from, loggedBy, date, amount: toNumber(amount) }));
    }

    // Clean-up: removes the bank transactions the tests create ("AutoBankTx_<digits>") on a ticket's sales channels —
    // and only those. (The delete button in the list doesn't respond, so this goes through the API.)
    async deleteTestBankTransactions(ticketName) {
        const removed = await this.page.evaluate(async ({ ticketName }) => {
            const [, account, event] = location.pathname.match(/\/account\/(\d+)\/event\/(\d+)/);
            const base = `/api/account/${account}/event/${event}`;
            const xsrf = decodeURIComponent((document.cookie.match(/XSRF-TOKEN=([^;]+)/) || [])[1] || '');
            const headers = { Accept: 'application/json', 'X-XSRF-TOKEN': xsrf, 'X-Requested-With': 'XMLHttpRequest' };
            const ticketsResponse = await fetch(`${base}/tickets`, { headers, credentials: 'same-origin' });
            if (!ticketsResponse.ok) throw new Error(`Could not load tickets for bank-transaction cleanup: ${ticketsResponse.status}`);
            const ticket = (await ticketsResponse.json()).find(t => t.name === ticketName);
            if (!ticket) throw new Error(`Could not find test ticket ${ticketName} for bank-transaction cleanup`);
            const deleted = [];
            for (const sale of ticket?.ticket_sales ?? []) {
                const list = await (await fetch(`${base}/ticket-types/${ticket.id}/sales-channels/${sale.id}/bank-transactions?paginated=1&perPage=100&page=1`, { headers, credentials: 'same-origin' })).json();
                for (const transaction of list.data ?? []) {
                    if (!/^AutoBankTx_\d+$/.test(transaction.name)) continue;
                    const response = await fetch(`${base}/transactions/${transaction.id}`, { method: 'DELETE', headers, credentials: 'same-origin' });
                    if (!response.ok) throw new Error(`Could not delete bank transaction ${transaction.name}: ${response.status}`);
                    deleted.push(`${transaction.name}:${response.status}`);
                }
            }
            return deleted;
        }, { ticketName });
        if (removed.length) console.log(`🗑️ Test bank transactions deleted: ${removed.join(', ')}`);
    }

    // ── TEST TICKETS ─────────────────────────────────────────────────────────────

    eventBaseUrl() {
        return getTicketingTestPageUrl('bulk').replace(/\/tickets\/bulk$/, '');
    }

    // Creates a throw-away ticket (AutoTicket_<n>, Direct Sales seller, 100 available / 100 fixed) through the
    // "New Ticket" button of the Tickets revenue stream, so tests can change it without touching real tickets.
    async createTestTicket(budgetingPage, revenuePage, { price = 50, headcount = 10, fixed = 100, allocated = 100, rebate = 2 } = {}) {
        const name = `AutoTicket_${Date.now().toString().slice(-6)}`;
        budgetingPage.eventBaseUrl = this.eventBaseUrl();
        await budgetingPage.gotoRevenueBudgetPage();
        const section = this.page.locator('div.ew-data-table').filter({ hasText: 'Revenue Streams' }).first();
        await section.locator('tr.tw-cursor-pointer')
            .filter({ has: this.page.getByRole('heading', { name: 'Tickets', exact: true }) })
            .first().click();
        await this.page.getByRole('button', { name: /New Ticket/ }).first().click();
        const win = revenuePage.addTicketsWindow();
        await win.waitFor({ state: 'visible', timeout: 15000 });
        const category = (await win.locator('tbody tr').first().locator('td').nth(2).locator('select option').first().innerText()).trim();
        await revenuePage.createTicketInAddTicketsWindow({ name, category, price, headcount, fixed, allocated, rebate });
        return name;
    }

    // Deletes tickets created by tests (AutoTicket_<n>) from the Tickets page.
    async deleteTestTickets() {
        return this.ticketing.deleteTicketTypes(this.eventBaseUrl(), /^AutoTicket_\d+$/);
    }

    // ── IMPORT ───────────────────────────────────────────────────────────────────

    // Imports a CSV of ticket orders for a seller, replacing that seller's existing sales.
    async importTemplate({ seller = 'Direct Sales', file = './fixtures/ticket-import-template.csv' } = {}) {
        await this.ticketing.clickImportTicketData();
        await this.ticketing.verifyAndSelectSeller(seller);
        await this.ticketing.attachImportTemplate(file);
        await this.ticketing.verifyValidateImportEnabled();
        await this.ticketing.tickReplaceExistingSales();
        await this.ticketing.clickValidateAndImport();
        await this.ticketing.verifyImportSuccess();
    }

    // ── EXPORT ───────────────────────────────────────────────────────────────────

    async openExportDialog() {
        await this.page.getByText('Import / Export').click();
        await this.page.getByText('Export Data', { exact: true }).click();
        const dialog = this.page.locator('.m-wrapper').filter({ hasText: 'Export Ticket Data' }).last();
        await dialog.waitFor({ state: 'visible', timeout: 10000 });
        return dialog;
    }
}
