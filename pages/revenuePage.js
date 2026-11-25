import { expect } from '@playwright/test';
import { TestHelpers } from '../tests/utils/test-helpers';

export class RevenuePage {

    constructor(page) {
        this.page = page;
        this.eventBaseUrl = null;
        this.helpers = new TestHelpers(page);
    }

    // ── NAVIGATION ───────────────────────────────────────────────────────────────

    async gotoRevenueDashboard() {
        if (!this.eventBaseUrl) {
            throw new Error('eventBaseUrl is not set');
        }

        await this.page.goto(`${this.eventBaseUrl}/revenue`, {
            waitUntil: 'domcontentloaded',
            timeout: 60000,
        });
        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        // Page title was renamed "Revenue Dashboard" → "Revenue"; accept either.
        await expect(this.page.getByRole('heading', { name: /^Revenue( Dashboard)?$/ }))
            .toBeVisible({ timeout: 30000 });
    }

    // ── KPI CARDS ────────────────────────────────────────────────────────────────

    // Returns { 'Total Revenue This Month (gross)': 492, 'Total Revenue Entire Event (net)': 88576.67, ... }
    async getKpiCards() {
        const cards = this.page.locator('div.ew-statistic');
        const count = await cards.count();
        const result = {};

        for (let i = 0; i < count; i++) {
            const text = await cards.nth(i).innerText();
            // Text is concatenated like "Total RevenueThis Month (gross)£492.00" — split off the trailing £ amount.
            const match = text.match(/^(.*?)(£[\d,]+\.\d{2}|-£[\d,]+\.\d{2})$/s);
            if (!match) continue;
            const label = match[1].replace(/\n/g, ' ').trim();
            result[label] = this.helpers.parseCurrency(match[2]);
        }
        return result;
    }

    // ── REVENUE STREAMS TABLE ────────────────────────────────────────────────────

    // Parses a row of div.ew-figure boxes (works for the table header totals row
    // and for individual stream rows) into [{ label, value }, ...] in DOM order.
    async _parseFigures(rowOrSection) {
        const figures = rowOrSection.locator('div.ew-figure');
        const count = await figures.count();
        const out = [];
        for (let i = 0; i < count; i++) {
            const fig = figures.nth(i);
            const label = await fig.locator('span').first().innerText().catch(() => '');
            const valueText = await fig.locator('div span').last().innerText().catch(() => '');
            out.push({ label: label.trim(), value: this.helpers.parseCurrency(valueText) });
        }
        return out;
    }

    // Header totals for the whole Revenue Streams table: Budgeted/Actual/Variance/Invoiced/Outstanding
    async getStreamsSummaryTotals() {
        const section = this.page.locator('div.ew-data-table').filter({ hasText: 'Revenue Streams' }).first();
        const headerRow = section.locator('thead tr').first();
        const figures = await this._parseFigures(headerRow);

        const byLabel = {};
        for (const { label, value } of figures) {
            // "Fixed" may render as "Fixed Test" (test-scenario badge); normalize to "Fixed".
            const key = /^fixed( test)?$/i.test(label) ? 'Fixed' : label;
            byLabel[key] = value;
        }
        return byLabel;
    }

    // Sum rows with the exact heading; ticket revenue can have both a regular stream
    // row and an automatically generated ticket-budget row.
    async getStreamRow(streamName) {
        const section = this.page.locator('div.ew-data-table').filter({ hasText: 'Revenue Streams' }).first();
        const rows = section.locator('tr.tw-cursor-pointer')
            .filter({ has: this.page.getByRole('heading', { name: streamName, exact: true }) })
        await rows.first().waitFor({ state: 'visible', timeout: 10000 });

        const figures = [];
        for (let index = 0; index < await rows.count(); index += 1) {
            figures.push(...await this._parseFigures(rows.nth(index)));
        }
        const result = {};
        for (const { label, value } of figures) {
            if (/^fixed( test)?$/i.test(label)) result.fixed = (result.fixed ?? 0) + value;
            else if (/budgeted/i.test(label)) result.budgeted = (result.budgeted ?? 0) + value;
            else if (/^actual$/i.test(label)) result.actual = (result.actual ?? 0) + value;
            else if (/variance/i.test(label)) result.variance = (result.variance ?? 0) + value;
            else if (/invoiced/i.test(label)) result.invoiced = (result.invoiced ?? 0) + value;
            else if (/outstanding/i.test(label)) result.outstanding = (result.outstanding ?? 0) + value;
        }
        return result;
    }

    // ── TICKETS STREAM ───────────────────────────────────────────────────────────
    // Expanding the Tickets stream row opens a panel with "Tickets" / "Ticket Sellers"
    // tabs and a "Mode: …" selector (Combined / Face Value Only / Rebate Only).

    ticketsStreamRow() {
        const section = this.page.locator('div.ew-data-table').filter({ hasText: 'Revenue Streams' }).first();
        return section.locator('tr.tw-cursor-pointer')
            .filter({ has: this.page.getByRole('heading', { name: 'Tickets', exact: true }) })
            .first();
    }

    // The panel is the table row rendered straight after the stream row.
    ticketsPanel() {
        return this.ticketsStreamRow().locator('xpath=following-sibling::tr[1]');
    }

    async expandTicketsStream() {
        const row = this.ticketsStreamRow();
        await row.waitFor({ state: 'visible', timeout: 10000 });
        await row.click();
        await this.ticketsPanel().getByText(/Mode:/).first().waitFor({ state: 'visible', timeout: 10000 });
        await this.ticketsPanel().locator('table').filter({ hasText: 'Ticket Name' }).first()
            .waitFor({ state: 'visible', timeout: 10000 });
    }

    async selectTicketsTab(tabName) {
        await this.ticketsPanel().getByRole('button', { name: tabName, exact: true }).click();
        await this.page.waitForTimeout(800);
    }

    // Seller buttons listed on the "Ticket Sellers" tab.
    async getTicketSellers() {
        const known = ['Tickets', 'Ticket Sellers', ''];
        const names = await this.ticketsPanel().locator('button:visible').allInnerTexts();
        return names.map(n => n.trim()).filter(n => !known.includes(n) && !/^Mode:/.test(n));
    }

    async selectTicketSeller(sellerName) {
        await this.ticketsPanel().getByRole('button', { name: sellerName, exact: true }).click();
        await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        await this.page.waitForTimeout(1000);
    }

    // Reads the visible ticket table in the panel into row objects keyed by column
    // header. The repeated Net/Gross columns are prefixed with their group, e.g.
    // { 'Ticket Name': 'Main', Fixed: 500, Price: 80, 'Budgeted Net': 333333.33, ... }.
    // Expanded seller sub-rows are nested tables and are skipped.
    async readTicketsTable() {
        const table = this.ticketsPanel().locator('table:visible').filter({ hasText: 'Ticket Name' }).first();
        // A seller with no tickets shows no table at all.
        if (!await table.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false)) return [];
        // Rows load after the table shell renders.
        await table.locator(':scope > tbody > tr').first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
        await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

        const headerRows = table.locator(':scope > thead > tr');
        const groups = (await headerRows.first().locator('th').allInnerTexts()).map(t => t.trim()).filter(Boolean);
        const headers = (await headerRows.last().locator('th').allInnerTexts()).map(t => t.trim());
        let group = -1;
        const keys = headers.map(h => {
            if (h !== 'Net' && h !== 'Gross') return h;
            if (h === 'Net') group += 1;
            return `${groups[group] ?? `Group ${group}`} ${h}`;
        });

        const text = new Set(['Ticket Name', 'Category']);
        const rows = await table.locator(':scope > tbody > tr').evaluateAll(trs => trs.map(tr =>
            [...tr.children].map(td => {
                const input = td.querySelector('input');
                return (input ? input.value : td.innerText).trim();
            })));
        return rows
            .filter(cells => cells.length === keys.length)
            .map(cells => Object.fromEntries(keys.map((key, i) =>
                [key, text.has(key) ? cells[i] : this.helpers.parseCurrency(cells[i])])))
            .filter(row => row['Ticket Name']);
    }

    ticketModeLabel() {
        return this.ticketsPanel().getByText(/Mode:/).first();
    }

    async getTicketMode() {
        return (await this.ticketModeLabel().innerText()).replace(/^\s*Mode:\s*/, '').trim();
    }

    // The options popup needs a beat to settle after closing, so a second click can
    // land while it is still animating out — retry until it is open.
    async openTicketModeMenu() {
        const menu = this.page.locator('.v-popper__popper--shown').filter({ hasText: 'Rebate Only' });
        await expect(async () => {
            if (!await menu.isVisible()) await this.ticketModeLabel().click();
            await expect(menu).toBeVisible({ timeout: 2000 });
        }).toPass({ timeout: 15000 });
        return menu;
    }

    async selectTicketMode(modeName) {
        const menu = await this.openTicketModeMenu();
        await menu.getByText(modeName, { exact: true }).click();
        await expect(this.ticketModeLabel()).toContainText(modeName);
        await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        await this.page.waitForTimeout(1000);
        console.log(`🎟️ Ticket mode: ${modeName}`);
    }

    // ── ADD TICKETS WINDOW ───────────────────────────────────────────────────────
    // The same "Add Tickets" window opens from the shortcut menu (+ > Ticket Type)
    // and from the "New Ticket" button on the Budgeting Tickets stream.

    addTicketsWindow() {
        return this.page.getByText('Add Tickets', { exact: true })
            .locator('xpath=ancestor::div[.//button[normalize-space()="Create Tickets"]][1]');
    }

    // Everything that should be identical whichever route opened the window.
    async getAddTicketsWindowLayout() {
        const win = this.addTicketsWindow();
        await win.waitFor({ state: 'visible', timeout: 15000 });
        const selects = win.locator('select');
        const selectOptions = [];
        for (let i = 0; i < await selects.count(); i++) {
            selectOptions.push((await selects.nth(i).locator('option').allInnerTexts()).map(t => t.trim()));
        }
        return {
            title: (await win.locator('h4').first().innerText()).trim(),
            columns: (await win.locator('thead th').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim()),
            buttons: (await win.locator('button:visible').allInnerTexts()).map(t => t.trim()).filter(Boolean),
            ticketRows: await win.locator('tbody tr').count(),
            selectOptions,
            taxRate: (await win.locator('dl').filter({ hasText: 'Tax Rate' }).locator('dd').innerText()).trim(),
        };
    }

    async closeAddTicketsWindow() {
        const win = this.addTicketsWindow();
        // A Quick Create menu left open over the window swallows clicks — dismiss it first.
        const quickCreate = this.page.locator('.v-popper__popper--shown').filter({ hasText: 'Quick Create' });
        if (await quickCreate.isVisible().catch(() => false)) {
            await win.locator('h4').first().click();
            await quickCreate.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
        }
        await win.locator('button').filter({ has: this.page.locator('i.mdi-close') }).first().click();
        await win.waitFor({ state: 'hidden', timeout: 10000 });
    }

    // Fills the first ticket row and clicks "Create Tickets". Allocated/Rebate are
    // the default "Direct Sales" seller column.
    async createTicketInAddTicketsWindow({ name, category, price, headcount, fixed, allocated, rebate }) {
        const win = this.addTicketsWindow();
        const row = win.locator('tbody tr').first();
        const cells = row.locator(':scope > td');

        const nameField = cells.nth(0).locator('[contenteditable="true"]');
        await nameField.click();
        await nameField.pressSequentially(name, { delay: 30 });

        await cells.nth(2).locator('select').selectOption({ label: category });

        const priceField = cells.nth(4).locator('[contenteditable="true"]');
        await priceField.click({ clickCount: 3 });
        await priceField.pressSequentially(String(price), { delay: 30 });

        await cells.nth(5).locator('input').fill(String(headcount));
        await cells.nth(6).locator('input').fill(String(fixed));
        await cells.nth(7).locator('input[type="number"]').first().fill(String(allocated));
        await cells.nth(7).locator('input[step="0.01"]').fill(String(rebate));

        await win.getByRole('button', { name: 'Create Tickets' }).click();
        // A "Tickets Created" confirmation offers "Visit Tickets" / "No thanks" — stay put.
        const created = this.page.getByRole('heading', { name: 'Tickets Created' });
        await expect(created).toBeVisible({ timeout: 15000 });
        await this.page.getByRole('button', { name: 'No thanks', exact: true }).click();
        await expect(created).toBeHidden({ timeout: 10000 });
        if (await win.isVisible().catch(() => false)) await this.closeAddTicketsWindow();
        await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        console.log(`✅ Ticket created: ${name}`);
    }

    // ── REVENUE ENTRIES (read-only list shown after expanding a stream row) ─────

    async expandStreamRow(streamName) {
        const section = this.page.locator('div.ew-data-table').filter({ hasText: 'Revenue Streams' }).first();
        const row = section.locator('tr.tw-cursor-pointer').filter({ hasText: streamName }).first();
        await row.waitFor({ state: 'visible', timeout: 10000 });
        await row.click();

        await this.page.getByText('Revenue Entries', { exact: true })
            .waitFor({ state: 'visible', timeout: 10000 });
        await this.page.getByText('Loading...', { exact: true })
            .waitFor({ state: 'hidden', timeout: 10000 })
            .catch(() => {});
    }

    // Returns the Title column values from the "Revenue Entries" table —
    // use after expandStreamRow() to confirm a newly created entry appears.
    // Bumps "items per page" to its max first so entries beyond page 1 aren't missed.
    async getRevenueEntryTitles() {
        const panel = this.page.locator('table').filter({ hasText: 'Subcategory' }).filter({ hasText: 'Customer' }).first();

        const perPageSelect = this.page.locator('select').filter({ hasText: '10' }).first();
        if (await perPageSelect.isVisible().catch(() => false)) {
            const options = await perPageSelect.locator('option').allTextContents();
            const max = options.map(o => parseInt(o, 10)).filter(n => !isNaN(n)).sort((a, b) => b - a)[0];
            if (max) {
                await perPageSelect.selectOption(String(max));
                await this.page.waitForTimeout(500);
            }
        }

        const rows = panel.locator('tbody tr');
        const count = await rows.count();
        const titles = [];
        for (let i = 0; i < count; i++) {
            const title = await rows.nth(i).locator('td').first().innerText().catch(() => '');
            if (title.trim()) titles.push(title.trim());
        }
        return titles;
    }

    // ── NEW REVENUE ENTRY ────────────────────────────────────────────────────────

    // Clicks the cash-plus icon on a named stream row (on the standalone /revenue
    // Revenue Dashboard — NOT the Budgeting module's /budget/revenue, whose "+" button
    // opens an unrelated "New Budget Entry" planning-entry drawer instead) to open the
    // "New Revenue Entry" drawer, fills it out, and creates the entry. Leaves the page
    // on the resulting "Revenue Entry" detail drawer (for chaining into raiseInvoice()).
    async createRevenueEntry({ streamName, title, subcategory, customer, qty, unitPrice }) {
        const section = this.page.locator('div.ew-data-table').filter({ hasText: 'Revenue Streams' }).first();
        const streamRow = section.locator('tr.tw-cursor-pointer').filter({ hasText: streamName }).first();
        await streamRow.waitFor({ state: 'visible', timeout: 10000 });
        await streamRow.locator('button').filter({ has: this.page.locator('i.mdi-cash-plus') }).first().click();
        await this.page.getByText('New Revenue Entry', { exact: true }).waitFor({ state: 'visible', timeout: 10000 });

        // Title
        await this.page.locator('input').first().fill(title);
        await this.page.waitForTimeout(300);

        // Subcategory — second contenteditable field (first is Revenue Stream, pre-filled)
        const subcatField = this.page.locator('[contenteditable="true"]').nth(1);
        await subcatField.click();
        await this.page.waitForTimeout(600);
        await this.page.getByText(subcategory, { exact: true }).click();
        await this.page.waitForTimeout(800);

        // Customer — searchable field rendered with a "Type to search" placeholder span
        const customerField = this.page.getByText('Type to search', { exact: true });
        await customerField.click();
        await this.page.keyboard.type(customer, { delay: 40 });
        await this.page.waitForTimeout(800);
        await this.page.getByText(customer, { exact: true }).last().click();
        await this.page.waitForTimeout(500);
        // Selecting a customer reopens its dropdown — dismiss by clicking the drawer title
        await this.page.getByText('New Revenue Entry', { exact: true }).click();
        await this.page.waitForTimeout(300);

        // Line item — one row exists by default once Subcategory is set (no need
        // to click "+ Add line item" for the first row)
        const descInput = this.page.getByPlaceholder('Enter a description');
        await descInput.click();
        await descInput.fill(title);

        const editableCells = this.page.locator('[contenteditable="true"]').filter({ hasText: '0' });
        await editableCells.first().click({ clickCount: 3 });
        await this.page.keyboard.type(String(qty), { delay: 30 });
        await editableCells.last().click({ clickCount: 3 });
        await this.page.keyboard.type(String(unitPrice), { delay: 30 });
        await this.page.waitForTimeout(300);

        await this.page.getByRole('button', { name: 'Create Revenue Entry' }).click();
        await this.page.waitForTimeout(1500);

        await expect(this.page.getByText(title, { exact: true }).first())
            .toBeVisible({ timeout: 10000 });
        console.log(`✅ Revenue entry created: ${title}`);
    }

    // ── INVOICING ────────────────────────────────────────────────────────────────

    // From an open "Revenue Entry" drawer (e.g. right after createRevenueEntry()),
    // raises a sales invoice for its line item(s) and verifies the success toast.
    // `onReview(wizard)` runs on the final step, before "Raise Invoice" is clicked.
    async raiseInvoiceForEntry({ onReview } = {}) {
        await this.page.locator('button, a').filter({ hasText: /^Invoices$/ }).first().click();
        await this.page.waitForTimeout(600);

        await this.page.locator('button, a').filter({ hasText: /raise.+invoice/i }).first().click();
        await this.page.waitForTimeout(800);

        // If the customer has no saved address, "Raise Sales Invoice" shows a
        // warning + "Update Customer" button before the line-item selection step.
        const updateCustomerBtn = this.page.getByRole('button', { name: 'Update Customer' });
        if (await updateCustomerBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await updateCustomerBtn.click();
            await this.page.waitForTimeout(800);
            await this.page.getByRole('button', { name: "Yes, I'm sure" }).click();
            await this.page.waitForTimeout(1200);
        }

        // Line item(s) are preselected by default — proceed.
        await this.page.getByRole('button', { name: 'Next' }).click();
        await this.page.waitForTimeout(800);

        if (onReview) {
            await onReview(this.page.locator('div.m-wrapper').filter({ hasText: 'Raise Sales Invoice' }).last());
        }
        await this.page.getByRole('button', { name: 'Raise Invoice' }).click();
        await this.page.waitForTimeout(1500);

        const successToast = this.page.locator('div.toast-success').filter({ hasText: /invoice created/i }).first();
        await expect(successToast).toBeVisible({ timeout: 10000 });
        console.log('✅ Invoice raised successfully');
    }

    // The "View Customer Invoice" view opens automatically right after
    // raiseInvoiceForEntry(). NOTE: a leftover drawer/backdrop from the Raise Invoice
    // wizard's closing transition sits on top of it — force-clicking through it is NOT
    // safe here, it can land on a different underlying element (confirmed: force-clicking
    // "Save" once triggered a second, unwanted "Raise an invoice" action instead). This
    // needs a real fix for the stacking, not a force bypass. See open investigation.
    async setInvoicePoNumberAndTerms({ poNumber, paymentTerms }) {
        const poInput = this.page.getByPlaceholder("Customers PO number...");
        await poInput.waitFor({ state: 'visible', timeout: 10000 });

        await poInput.fill(poNumber, { force: true });
        await this.page.getByPlaceholder('Optional').fill(paymentTerms, { force: true });

        // dispatchEvent fires directly on the target element (no simulated mouse
        // coordinates), so — unlike click({force:true}) — it can't misfire onto an
        // overlapping element from the leftover backdrop.
        // Wait for the invoice update request itself — navigating away before it completes
        // loses the change.
        const saved = this.page.waitForResponse(r => r.request().method() === 'POST'
            && /\/invoices\/\d+$/.test(r.url()) && r.request().postData()?.includes(poNumber), { timeout: 15000 });
        await this.page.getByRole('button', { name: 'Save' }).dispatchEvent('click');
        expect((await saved).ok(), 'PO number / payment terms saved').toBe(true);
        // The view can briefly re-render right after saving — wait for the field to
        // actually reflect the saved value rather than a fixed delay, to avoid reading
        // back a stale/reset instance.
        await expect(poInput).toHaveValue(poNumber, { timeout: 10000 });
        console.log(`✅ Invoice updated — PO: ${poNumber}, Terms: ${paymentTerms}`);
    }

    // Reads back the current values of the PO Number / Custom Payment Terms
    // fields on an open "View Customer Invoice" modal.
    async getInvoicePoNumberAndTerms() {
        const poInput = this.page.getByPlaceholder("Customers PO number...");
        await poInput.waitFor({ state: 'visible', timeout: 10000 });
        const poNumber = await poInput.inputValue();
        const paymentTerms = await this.page.getByPlaceholder('Optional').inputValue();
        return { poNumber, paymentTerms };
    }

    // ── INVOICE ACTIONS MENU ─────────────────────────────────────────────────────
    // From the open "View Customer Invoice" modal, opens the "Actions" dropdown.
    async openInvoiceActionsMenu() {
        const actionsBtn = this.page.getByText('Actions', { exact: true }).first();
        await actionsBtn.click();
        await this.page.waitForTimeout(400);
    }

    // Text of every item in the open Actions dropdown (call after openInvoiceActionsMenu()).
    async getInvoiceActionsMenuItems() {
        const menu = this.page.locator('.v-popper__popper--shown, [role="menu"]').last();
        const items = menu.locator('li, a, button').filter({ hasText: /.+/ });
        return items.allTextContents();
    }

    // From an open "View Customer Invoice" modal, opens Actions > "Send invoice
    // by email", adds the given address, and sends it.
    async sendInvoiceByEmail(emailAddress) {
        await this.openInvoiceActionsMenu();
        await this.page.getByText('Send invoice by email', { exact: true }).click();
        await this.page.waitForTimeout(800);

        const emailInput = this.page.getByPlaceholder('Type an email address and press enter to add');
        await emailInput.click();
        await emailInput.type(emailAddress);
        await this.page.keyboard.press('Enter');
        await this.page.waitForTimeout(500);

        await this.page.getByRole('button', { name: 'Send Email' }).click();
        await this.page.waitForTimeout(1500);

        const successToast = this.page.locator('div.toast-success').filter({ hasText: /invoice sent/i }).first();
        await expect(successToast).toBeVisible({ timeout: 10000 });
        console.log(`✅ Invoice emailed to: ${emailAddress}`);
    }

    // From an open "View Customer Invoice" modal, opens Actions > "Manage payment
    // dates", adds a new payment date (today's date + first bank account, both
    // pre-filled defaults), and saves. Success is confirmed by the "Payments/
    // Credits" tab appearing on the invoice modal afterwards (no toast is shown).
    async addPaymentDate() {
        await this.openInvoiceActionsMenu();
        await this.page.getByText('Manage payment dates', { exact: true }).click();
        await this.page.waitForTimeout(800);

        await this.page.getByText('New payment date', { exact: true }).click();
        await this.page.waitForTimeout(800);

        // Date is preselected to today and left as-is; explicitly pick the first
        // bank account option for determinism.
        await this.page.locator('select').first().selectOption({ index: 0 });
        await this.page.waitForTimeout(300);

        await this.page.getByRole('button', { name: 'Save Changes' }).click();
        await this.page.waitForTimeout(1500);

        await expect(this.page.getByRole('button', { name: /Payments\/Credits/i }))
            .toBeVisible({ timeout: 10000 });
        console.log('✅ Payment date added');
    }

    // ── REVENUE ENTRY DRAWER ─────────────────────────────────────────────────────

    revenueEntryDrawer() {
        return this.page.getByText('Revenue Entry', { exact: true })
            .locator('xpath=ancestor::div[.//button[contains(., "Delete Entry")]][1]');
    }

    // Row for `title` in a stream's "Revenue Entries" list (call after expandStreamRow()).
    // (The whole expanded panel is itself a table row, so anchor on the title cell's own row.)
    revenueEntryRow(title) {
        const titleCell = typeof title === 'string' ? this.page.getByText(title, { exact: true }) : this.page.getByText(title);
        return titleCell.first().locator('xpath=ancestor::tr[1]');
    }

    // { Title, Subcategory, Customer, Budget, 'Net Total', Invoiced, Outstanding } for one entry.
    async readRevenueEntryRow(title) {
        const row = this.revenueEntryRow(title);
        await row.waitFor({ state: 'visible', timeout: 10000 });
        const cells = (await row.locator('td').allInnerTexts()).map(t => t.trim());
        return {
            title: cells[0], subcategory: cells[1], customer: cells[2], budget: cells[3],
            net: this.helpers.parseCurrency(cells[4]),
            invoiced: this.helpers.parseCurrency(cells[5]),
            outstanding: this.helpers.parseCurrency(cells[6]),
        };
    }

    // Opens an existing entry's drawer from the Revenue page (eye button on its row).
    async openRevenueEntry(streamName, title) {
        await this.gotoRevenueDashboard();
        await this.expandStreamRow(streamName);
        await this.revenueEntryRow(title).locator('button').last().click();
        await expect(this.revenueEntryDrawer().getByText(title, { exact: true }).first()).toBeVisible({ timeout: 10000 });
    }

    // Opens the first invoice listed on the open entry drawer's "Invoices" tab.
    async openFirstInvoiceFromEntry() {
        const drawer = this.revenueEntryDrawer();
        await drawer.getByRole('button', { name: 'Invoices', exact: true }).click();
        const eye = drawer.locator('tbody tr').locator('button').filter({ has: this.page.locator('i.mdi-eye') }).first();
        if (!await eye.isVisible({ timeout: 3000 }).catch(() => false)) return false;
        await eye.click();
        await this.invoiceView().waitFor({ state: 'visible', timeout: 10000 });
        return true;
    }

    // ── CUSTOMER INVOICE VIEW ────────────────────────────────────────────────────

    invoiceView() {
        return this.page.getByText('View Customer Invoice', { exact: true })
            .locator('xpath=ancestor::div[.//button[normalize-space(.)="Details"]][1]');
    }

    // Totals block of the Details tab: { subtotal, tax, total, lessPaymentsCredits, outstanding }.
    async readInvoiceTotals() {
        const view = this.invoiceView();
        await view.getByRole('button', { name: /^Details/ }).click();
        const value = async label => {
            const row = view.getByRole('row', { name: new RegExp(`^${label}`, 'i') }).first();
            if (!await row.isVisible().catch(() => false)) return 0;
            return this.helpers.parseCurrency((await row.innerText()).replace(new RegExp(label, 'i'), ''));
        };
        return {
            subtotal: await value('Subtotal'),
            tax: await value('Tax'),
            total: await value('Total'),
            lessPaymentsCredits: await value('Less Payments\\/Credits'),
            outstanding: await value('Outstanding'),
        };
    }

    // Clicks an item in the invoice's "Actions" menu, e.g. 'Raise a credit note'.
    async clickInvoiceAction(actionName) {
        await this.openInvoiceActionsMenu();
        await this.page.getByText(actionName, { exact: true }).click();
    }

    // Actions > Raise a credit note, for the full invoice amount. Returns the toast text.
    async raiseCreditNote() {
        await this.clickInvoiceAction('Raise a credit note');
        const form = this.page.locator('.m-wrapper').filter({ hasText: 'Raise Credit Note' }).last();
        await form.waitFor({ state: 'visible', timeout: 10000 });
        // The form loads the currency conversion rate in the background; submitting before
        // it arrives fails with "The conversion rate field is required" — wait, retry once.
        await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        const conversionError = form.getByText(/conversion rate/i);
        for (let attempt = 0; attempt < 2; attempt++) {
            await form.getByRole('button', { name: /^Raise Credit Note$/i }).click();
            const outcome = await Promise.race([
                form.waitFor({ state: 'hidden', timeout: 20000 }).then(() => 'saved'),
                conversionError.first().waitFor({ state: 'visible', timeout: 20000 }).then(() => 'conversion-error'),
            ]).catch(() => 'timeout');
            if (outcome === 'saved') break;
            console.log(`⚠️ Credit note not raised (${outcome}) — retrying after the form finishes loading`);
            await this.page.waitForTimeout(3000);
        }
        await expect(form).toBeHidden({ timeout: 20000 });
        const toast = this.page.locator('div.toast-success').filter({ hasText: /credit note/i }).first();
        await expect(toast).toBeVisible({ timeout: 10000 });
        console.log('✅ Credit note raised');
        return (await toast.innerText()).trim();
    }

    // Actions > Delete invoice. Xero-published invoices go through "Check Invoice" then
    // "Void in Xero & Delete"; others confirm with "Delete". The app refuses (silently in
    // the UI — the API answers 422) while an outstanding balance remains.
    async deleteInvoice() {
        await this.clickInvoiceAction('Delete invoice');
        const dialog = this.page.locator('.m-wrapper').filter({ hasText: 'Delete Invoice' }).last();
        await dialog.waitFor({ state: 'visible', timeout: 10000 });
        const check = dialog.getByRole('button', { name: 'Check Invoice', exact: true });
        if (await check.isVisible().catch(() => false)) {
            await check.click();
            await expect(dialog.getByRole('button', { name: 'Void in Xero & Delete', exact: true })).toBeVisible({ timeout: 15000 });
        }
        const response = this.page.waitForResponse(r => r.request().method() === 'DELETE' && /\/invoices\/\d+/.test(r.url()), { timeout: 20000 });
        await dialog.getByRole('button', { name: /^(Delete|Void in Xero & Delete)$/ }).click();
        return (await response).status();
    }

    // Removes every revenue entry on `streamName` whose title matches `pattern`, crediting
    // and deleting its invoices first. Used to clean up after (and before) test runs.
    async deleteRevenueEntries(streamName, pattern) {
        for (let attempt = 0; attempt < 10; attempt++) {
            await this.gotoRevenueDashboard();
            await this.expandStreamRow(streamName);
            const row = this.revenueEntryRow(pattern);
            if (!await row.isVisible({ timeout: 3000 }).catch(() => false)) return;
            const title = (await row.locator('td').first().innerText()).trim();
            await row.locator('button').last().click();
            await expect(this.revenueEntryDrawer().getByText(title, { exact: true }).first()).toBeVisible({ timeout: 10000 });

            if (await this.openFirstInvoiceFromEntry()) {
                if ((await this.readInvoiceTotals()).outstanding > 0) await this.raiseCreditNote();
                await this.deleteInvoice();
                continue; // reload and reopen the entry
            }
            await this.revenueEntryDrawer().getByRole('button', { name: /Delete Entry/ }).click();
            await expect(this.page.locator('div.toast-success').filter({ hasText: /Revenue entry deleted/i }).first())
                .toBeVisible({ timeout: 10000 });
            console.log(`🗑️ Revenue entry deleted: ${title}`);
        }
        throw new Error(`Could not clean up revenue entries matching ${pattern}`);
    }
}
