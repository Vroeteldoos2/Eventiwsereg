import { expect } from '@playwright/test';
import { TestHelpers } from '../tests/utils/test-helpers.js';

export class PurchasingPage {

    constructor(page) {
        this.page = page;
        this.eventBaseUrl = null;
        this.helpers = new TestHelpers(page);
    }

    // ── NAVIGATION ───────────────────────────────────────────────────────────────

    async gotoPurchasingSummary() {
        if (!this.eventBaseUrl) {
            throw new Error('eventBaseUrl is not set');
        }

        await this.page.goto(`${this.eventBaseUrl}/purchasing`, {
            waitUntil: 'domcontentloaded',
            timeout: 60000,
        });
        await expect(this.page.getByRole('heading', { name: 'Purchasing Summary' }))
            .toBeVisible({ timeout: 30000 });
        await expect(this.page.getByText('Loading Information', { exact: true })).toBeHidden({ timeout: 30000 });
    }

    // ── COST DEPARTMENTS TABLE ───────────────────────────────────────────────────

    // Parses a row of div.ew-figure boxes into [{ label, value }, ...] in DOM order.
    async _parseFigures(rowOrSection) {
        const figures = rowOrSection.locator('div.ew-figure');
        const count = await figures.count();
        const out = [];
        for (let i = 0; i < count; i++) {
            const fig = figures.nth(i);
            const label = await fig.locator('span').first().innerText();
            const valueText = await fig.locator('div span').last().innerText();
            out.push({ label: label.trim(), value: this.helpers.parseCurrency(valueText) });
        }
        return out;
    }

    // Header totals: Budgeted/Actual/Remaining Budget/Invoiced/Outstanding
    async getCostDepartmentsSummaryTotals() {
        const section = this.page.locator('div.ew-data-table').filter({ hasText: 'Cost Departments' }).first();
        const headerRow = section.locator('thead tr').first();
        const figures = await this._parseFigures(headerRow);

        const byLabel = {};
        for (const { label, value } of figures) byLabel[label] = value;
        return byLabel;
    }

    async getCostDepartmentNames() {
        const section = this.page.locator('div.ew-data-table').filter({ hasText: 'Cost Departments' }).first();
        const rows = section.locator('tr.tw-cursor-pointer');
        const count = await rows.count();
        const names = [];
        for (let i = 0; i < count; i++) {
            const name = await rows.nth(i).locator('h6, h5, h4').first().innerText();
            if (name.trim()) names.push(name.trim());
        }
        return names;
    }

    // Figures for one named cost department row (e.g. "Artists").
    async getCostDepartmentRow(deptName) {
        const section = this.page.locator('div.ew-data-table').filter({ hasText: 'Cost Departments' }).first();
        const row = section.locator('tr.tw-cursor-pointer').filter({ hasText: deptName }).first();
        await row.waitFor({ state: 'visible', timeout: 10000 });

        const figures = await this._parseFigures(row);
        const result = {};
        for (const { label, value } of figures) {
            if (/^budgeted$/i.test(label)) result.budgeted = value;
            else if (/^actual$/i.test(label)) result.actual = value;
            else if (/remaining budget/i.test(label)) result.remainingBudget = value;
            else if (/^invoiced$/i.test(label)) result.invoiced = value;
            else if (/^outstanding$/i.test(label)) result.outstanding = value;
        }
        return result;
    }

    async expandAllDepartments() {
        await this.page.getByText('Expand all', { exact: true }).click();
        await expect(this.departmentsSection().locator('tbody tr.tw-cursor-pointer').first()).toBeVisible({ timeout: 15000 });
    }

    // ── FIGURES (Summary and department pages) ───────────────────────────────────

    // { budgeted, actual, remainingBudget, invoiced, paid, outstanding, variance, markupAmount } from a row of
    // figure boxes. The account's own labels vary ("Actual Test", "Outstanding Test"), so match on the start.
    async readFigures(rowOrSection) {
        const keys = [
            [/^budgeted/i, 'budgeted'], [/^actual/i, 'actual'], [/^remaining/i, 'remainingBudget'],
            [/^invoiced/i, 'invoiced'], [/^paid/i, 'paid'], [/^outstanding/i, 'outstanding'],
            [/^variance/i, 'variance'], [/^markup/i, 'markupAmount'],
        ];
        const figures = {};
        for (const { label, value } of await this._parseFigures(rowOrSection)) {
            const key = keys.find(([pattern]) => pattern.test(label));
            if (key) figures[key[1]] = value;
        }
        return figures;
    }

    departmentsSection() {
        return this.page.locator('div.ew-data-table').filter({ hasText: 'Cost Departments' }).first();
    }

    // Totals shown above the Cost Departments list.
    async readDepartmentTotals() {
        return this.readFigures(this.departmentsSection().locator('thead').first());
    }

    // [{ name, budgeted, actual, remainingBudget, invoiced, outstanding, ... }] — one per cost department.
    async readDepartments() {
        const rows = this.departmentsSection().locator('tr.tw-cursor-pointer');
        const departments = [];
        for (let i = 0; i < await rows.count(); i++) {
            const row = rows.nth(i);
            const name = (await row.innerText()).split('\n').map(line => line.trim()).filter(Boolean)[0];
            departments.push({ name, ...await this.readFigures(row) });
        }
        return departments;
    }

    departmentRow(name) {
        return this.departmentsSection().locator('tr.tw-cursor-pointer')
            .filter({ has: this.page.getByText(name, { exact: true }) }).first();
    }

    // Arrow button of a department row: opens the department (its subcategories). A department URL can't be
    // loaded directly (it redirects back to the Purchasing Summary), so go in through the list.
    async openDepartment(name) {
        await this.departmentRow(name).locator('button').last().click();
        await this.page.waitForURL(/\/purchasing\/summary\/\d+/, { timeout: 15000 });
        await expect(this.subcategoriesSection().locator('tr.tw-cursor-pointer').first()).toBeVisible({ timeout: 20000 });
        await expect(this.page.getByText('Loading Information', { exact: true })).toBeHidden({ timeout: 15000 });
    }

    subcategoriesSection() {
        return this.page.locator('div.ew-data-table').filter({ hasText: 'Subcategories' }).first();
    }

    async readSubcategoryTotals() {
        return this.readFigures(this.subcategoriesSection().locator('thead').first());
    }

    // [{ name, budgeted, actual, remainingBudget, invoiced, outstanding, ... }] — one per subcategory.
    async readSubcategories() {
        const rows = this.subcategoriesSection().locator('tr.tw-cursor-pointer');
        const subcategories = [];
        for (let i = 0; i < await rows.count(); i++) {
            const row = rows.nth(i);
            const name = (await row.innerText()).split('\n').map(line => line.trim()).filter(Boolean)[0];
            subcategories.push({ name, ...await this.readFigures(row) });
        }
        return subcategories;
    }

    // Customise columns (Summary / department pages): the optional columns and whether each is ticked.
    async openColumnPicker() {
        await this.page.getByText('Customise columns', { exact: true }).click();
        const dialog = this.page.locator('.m-wrapper').filter({ hasText: 'Customise columns shown' }).last();
        await dialog.waitFor({ state: 'visible', timeout: 10000 });
        return dialog;
    }

    async closeColumnPicker(dialog) {
        await dialog.locator('button.m-close').click();
        await dialog.waitFor({ state: 'hidden', timeout: 10000 });
    }

    columnCheckbox(dialog, label) {
        return dialog.locator('label').filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) }).locator('input[type="checkbox"]');
    }

    async isColumnShown(label) {
        const dialog = await this.openColumnPicker();
        const shown = await this.columnCheckbox(dialog, label).isChecked();
        await this.closeColumnPicker(dialog);
        return shown;
    }

    async setColumn(label, shown) {
        const dialog = await this.openColumnPicker();
        const checkbox = this.columnCheckbox(dialog, label);
        if (shown) await checkbox.check(); else await checkbox.uncheck();
        await this.closeColumnPicker(dialog);
    }

    // ── NEW PURCHASE ORDER (button on a cost department row) ────────────────────

    // "New Purchase Order" button of a department row.
    async openNewPurchaseOrder(departmentName) {
        await this.departmentRow(departmentName).locator('button').first().click();
        await this.page.getByText('New Purchase Order', { exact: true }).waitFor({ state: 'visible', timeout: 10000 });
    }

    // Field of the New Purchase Order panel ('Subcategory' | 'Supplier' | 'Budget Entry'): its selector input.
    purchaseOrderField(name) {
        return this.page.locator('dt', { hasText: name }).locator('xpath=following-sibling::dd[1]').locator('[contenteditable="true"]');
    }

    // Opens a field's selector, optionally types to search, and picks the option matching `optionText`.
    // Returns the option's text.
    async chooseOption(fieldName, search, optionText = search) {
        await this.purchaseOrderField(fieldName).click();
        if (search) await this.page.keyboard.type(search, { delay: 40 });
        const option = this.page.locator('.selector-dropdown a').filter({ hasText: optionText }).first();
        await option.waitFor({ state: 'visible', timeout: 10000 });
        const chosen = (await option.innerText()).trim();
        await option.click();
        await expect(this.purchaseOrderField(fieldName)).toContainText(chosen);
        return chosen;
    }

    // Options a field's selector offers (the selector is closed again).
    async listOptions(fieldName) {
        await this.purchaseOrderField(fieldName).click();
        const dropdown = this.page.locator('.selector-dropdown a');
        await expect(dropdown.first()).toBeVisible({ timeout: 10000 });
        const options = (await dropdown.allInnerTexts()).map(text => text.trim()).filter(Boolean);
        await this.page.keyboard.press('Escape');
        await this.page.locator('h2').first().click();
        await expect(dropdown.first()).toBeHidden();
        return options;
    }

    // Fills the New Purchase Order panel (title, subcategory, supplier, optional budget entry, one line item).
    async fillPurchaseOrder({ title, subcategory, supplier, budgetEntry, unitPrice = 500, taxRate }) {
        const titleField = this.page.locator('h2 [contenteditable="true"]').first();
        await titleField.click();
        await titleField.pressSequentially(title, { delay: 30 });
        await this.chooseOption('Subcategory', subcategory, new RegExp(`^${subcategory}$`));
        await this.chooseOption('Supplier', supplier);
        if (budgetEntry) await this.chooseOption('Budget Entry', '', budgetEntry);
        const lineRow = this.page.locator('table.table tbody tr[data-draggable="true"]').first();
        await lineRow.getByPlaceholder('Enter a description').fill(title);
        const price = lineRow.locator('td').nth(3).locator('[contenteditable="true"]');
        await price.click({ clickCount: 3 });
        await price.pressSequentially(String(unitPrice), { delay: 30 });
        if (taxRate) {
            await lineRow.getByRole('button', { name: 'None', exact: true }).click();
            const option = this.page.getByText(taxRate).first();
            await option.waitFor({ state: 'visible', timeout: 10000 });
            await option.click();
        }
    }

    // Create & View: returns the PO panel once it is showing as a Draft.
    async createPurchaseOrderAndView() {
        await this.page.getByRole('button', { name: 'Create & View', exact: true }).click();
        const panel = this.page.locator('.modal-shell').first();
        await panel.getByRole('button', { name: /Request Approval/i }).waitFor({ state: 'visible', timeout: 20000 });
        return panel;
    }

    // Draft PO panel > Delete (no confirmation).
    async deleteOpenDraftPurchaseOrder() {
        const panel = this.page.locator('.modal-shell').first();
        const deleted = this.page.waitForResponse(
            r => r.request().method() === 'DELETE' && /\/purchaseorders\/\d+\/delete/.test(r.url()), { timeout: 20000 });
        await panel.getByRole('button', { name: /Delete/ }).first().click();
        expect((await deleted).ok(), 'Draft purchase order deleted').toBe(true);
        await panel.waitFor({ state: 'hidden', timeout: 15000 });
    }

    // Purchase orders listed under an expanded department row, keyed by column:
    // [{ Status, Reference, Title, Subcategory, Supplier, Committed, Invoiced, Outstanding }]
    async readDepartmentPurchaseOrders(name) {
        const body = this.departmentsSection().locator('tbody')
            .filter({ has: this.page.locator('tr.tw-cursor-pointer').filter({ has: this.page.getByText(name, { exact: true }) }) }).first();
        return this.readTable(body.locator('tr.expanded-row table').first());
    }

    // ── ANALYSIS ─────────────────────────────────────────────────────────────────

    async gotoAnalysis() {
        await this.gotoPurchasingSummary();
        await this.page.locator('a[href$="/purchasing/analysis"]:visible').first().click();
        await this.page.waitForURL(/\/purchasing\/analysis/, { timeout: 15000 });
        await expect(this.page.getByText('Select one of the statistics above')).toBeVisible({ timeout: 20000 });
    }

    // The four statistic tiles (identical on Summary and Analysis): the number on each, by tile title.
    async readTiles() {
        const titles = ['Budgets Not Fully Committed', 'POs Not Fully Invoiced', 'Outstanding Payments', 'Next Payment Run'];
        const tiles = {};
        for (const title of titles) {
            const heading = this.page.getByText(title, { exact: true }).first();
            await heading.waitFor({ state: 'visible', timeout: 20000 });
            const text = await heading.evaluate(node => {
                let el = node;
                while (el.parentElement && !/[0-9]\s*$/.test(el.innerText.trim())) el = el.parentElement;
                return el.innerText;
            });
            const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
            tiles[title] = this.helpers.parseCurrency(lines[lines.length - 1]);
        }
        return tiles;
    }

    async selectTile(title) {
        await this.page.getByText(title, { exact: true }).first().click();
        await expect(this.page.getByText('Loading Information', { exact: true })).toBeHidden({ timeout: 15000 });
    }

    // Everything on one page of results: the biggest page size offered by the first page-size selector.
    async showAllRows() {
        const perPage = this.page.locator('select').filter({ has: this.page.locator('option', { hasText: /^10$/ }) }).first();
        if (await perPage.count()) {
            const options = await perPage.locator('option').allInnerTexts();
            await perPage.selectOption({ label: options[options.length - 1] });
            await expect(this.page.getByText('Loading Information', { exact: true })).toBeHidden({ timeout: 15000 });
        }
    }

    // Any table as [{ Header: 'cell text' }] (money kept as text; see money()).
    async readTable(table) {
        return table.evaluate(t => {
            const headers = [...t.querySelectorAll(':scope > thead th')].map(th => th.innerText.trim().replace(/\s+/g, ' '));
            return [...t.querySelectorAll(':scope > tbody > tr')].map(tr => {
                const cells = [...tr.children].map(cell => cell.innerText.trim().replace(/\s+/g, ' '));
                return Object.fromEntries(headers.map((header, i) => [header, cells[i] ?? '']).filter(([header]) => header));
            }).filter(row => Object.values(row).some(Boolean));
        });
    }

    money(text) {
        return this.helpers.parseCurrency(text);
    }

    // Department tiles (Budgets Not Fully Committed / POs Not Fully Invoiced): [{ name, total, outstanding }]
    // where total is "Budgets Approved" / "POs Approved" and outstanding is "Budgets Not Committed" / "POs Not Invoiced".
    async readAnalysisDepartments() {
        await this.showAllRows();
        const rows = await this.page.locator('table').first().evaluate(table => [...table.querySelectorAll(':scope > tbody > tr')]
            .filter(tr => tr.children.length === 2)
            .map(tr => [tr.children[0].innerText.trim(), tr.children[1].innerText.trim().replace(/\s+/g, ' ')]));
        return rows
            .map(([name, figures]) => ({ name, amounts: figures.match(/-?£[\d,]+\.\d{2}/g) ?? [] }))
            .filter(row => row.amounts.length === 2)
            .map(({ name, amounts }) => ({ name, total: this.money(amounts[0]), outstanding: this.money(amounts[1]) }));
    }

    // Expands a department of an Analysis table and returns its entries as header-keyed objects
    // (Budgets: Status Title Subcategory Supplier Budgeted Committed Accrual Amount;
    //  POs: Status PO Title Department Subcategory Supplier PO Total PO Not Invoiced Invoiced Invoiced (Gross)).
    async readAnalysisDepartmentEntries(name) {
        await this.page.locator('table').first().locator('> tbody > tr').filter({ has: this.page.getByText(name, { exact: true }) })
            .first().getByText(name, { exact: true }).first().click();
        const nested = this.page.locator('table table').first();
        await nested.waitFor({ state: 'visible', timeout: 10000 });
        return this.readTable(nested);
    }

    // Tables of the Outstanding Payments / Next Payment Run tiles.
    async readAnalysisPurchaseOrders() {
        // This message is the page's intentional empty state for events without POs.
        if (await this.page.getByText('There are no purchase orders to show').isVisible()) return [];
        await this.showAllRows();
        return this.readTable(this.page.locator('table').first());
    }

    // ── PAYRUNS ──────────────────────────────────────────────────────────────────

    async gotoPayruns() {
        await this.gotoPurchasingSummary();
        await this.page.locator('a[href$="/purchasing/payruns"]:visible').first().click();
        await this.page.waitForURL(/\/purchasing\/payruns/, { timeout: 15000 });
        await expect(this.page.getByText(/^Payruns for /)).toBeVisible({ timeout: 20000 });
        await expect(this.page.getByText('Loading Information', { exact: true })).toBeHidden({ timeout: 15000 });
    }

    // Date strip tile ("Friday 23rd"): { payruns, payments } as the tile says ("1 payrun", "No payments").
    async readDayTile(isoDate) {
        const day = Number(isoDate.slice(8, 10));
        // The strip's text reads: "Friday", "23rd", "1 payrun", "No payments", then the next day.
        const lines = (await this.page.locator('.date-selector').first().innerText()).split('\n').map(line => line.trim()).filter(Boolean);
        const at = lines.findIndex(line => new RegExp(`^${day}(st|nd|rd|th)$`).test(line));
        if (at < 0) throw new Error(`Day ${day} is not on the Payruns date strip`);
        const count = line => Number(line?.match(/^(\d+) /)?.[1] ?? 0);
        return { payruns: count(lines[at + 1]), payments: count(lines[at + 2]) };
    }

    // Selects a day on the date strip (it must be one of the five days shown).
    async selectDay(isoDate) {
        const day = Number(isoDate.slice(8, 10));
        const suffix = day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd' : day % 10 === 3 && day !== 13 ? 'rd' : 'th';
        await this.page.locator('.date-selector').getByText(`${day}${suffix}`, { exact: true }).first().click();
        await expect(this.page.getByText('Loading Information', { exact: true })).toBeHidden({ timeout: 15000 });
    }

    // Available payments for the selected date: [{ 'Invoice Number': …, 'Due Date': …, Amount: … }]
    async readAvailablePayments() {
        const tables = this.page.locator('table').filter({ has: this.page.getByText('Invoice Number') });
        if (!await tables.count()) return [];
        return this.readTable(tables.first());
    }

    // Picks a day (YYYY-MM-DD) in the open flatpickr calendar, moving on a month if it isn't shown.
    async pickCalendarDay(isoDate) {
        const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const [year, month, day] = isoDate.split('-').map(Number);
        const calendar = this.page.locator('.flatpickr-calendar.open');
        await calendar.waitFor({ state: 'visible', timeout: 5000 });
        const target = calendar.locator('.flatpickr-day[aria-label="' + months[month - 1] + ' ' + day + ', ' + year + '"]').first();
        for (let i = 0; i < 12 && !await target.count(); i++) await calendar.locator('.flatpickr-next-month').click();
        await target.click();
    }

    // Create Payrun form: title, payment date and the payments to include (by invoice number).
    async createPayrun({ title, isoDate, invoiceNumbers }) {
        await this.page.getByRole('button', { name: 'Create Payrun' }).last().click();
        const inputs = this.page.getByPlaceholder('Required');
        await inputs.first().waitFor({ state: 'visible', timeout: 10000 });
        await inputs.first().fill(title);
        await inputs.last().click();
        await this.pickCalendarDay(isoDate);
        for (const invoiceNumber of invoiceNumbers) {
            const row = this.page.locator('tbody tr').filter({ hasText: invoiceNumber }).first();
            await row.waitFor({ state: 'visible', timeout: 15000 });
            await row.locator('input[type="checkbox"]').first().check({ force: true });
        }
        await expect.poll(async () => (await this.readPayrunFormTotals()).payments)
            .toBe(invoiceNumbers.length);
    }

    // Run Value / Payments figures at the foot of the Create Payrun form.
    async readPayrunFormTotals() {
        const text = await this.page.locator('div').filter({ hasText: /^Cancel\s+Run Value/ }).last().innerText();
        return {
            runValue: this.money(text.match(/Run Value\s*\n?\s*(£[\d,.-]+)/)?.[1] ?? ''),
            payments: Number(text.match(/Payments\s*\n?\s*(\d+)/)?.[1] ?? 0),
        };
    }

    async submitPayrun() {
        await this.page.getByRole('button', { name: 'Create Payrun' }).last().click();
        await expect(this.page.getByText('Your payrun has been created successfully')).toBeVisible({ timeout: 20000 });
        await expect(this.page.getByText('Loading Information')).toBeHidden({ timeout: 20000 });
        await expect(this.page.getByText(/^Payruns for /)).toBeVisible({ timeout: 20000 });
    }

    // Payruns of the selected date: [{ Title, Value, Items, 'Payment Date', Status }]
    async readPayruns() {
        const table = this.page.locator('table').filter({ has: this.page.getByText('Payment Date', { exact: true }) }).last();
        if (!await table.count()) return [];
        return this.readTable(table);
    }

    // Eye icon of a payrun row: opens the payrun.
    async openPayrun(title) {
        await this.page.locator('tbody tr').filter({ hasText: title }).locator('button').last().click();
        await expect(this.page.getByRole('button', { name: /Return to Payruns/ })).toBeVisible({ timeout: 20000 });
    }

    // Status text shown on an open payrun ("Draft", "Awaiting Approval", "Paid", …).
    async payrunStatus() {
        const text = (await this.page.locator('body').innerText()).replace(/\n\s*\n+/g, '\n');
        return text.match(/\nStatus\n([^\n]+)/)?.[1]?.trim();
    }

    // Buttons of an open payrun: { 'Request Approval': 'enabled' | 'disabled' | 'missing', Approve: …, Reject: …, 'Reset To Draft': … }
    async payrunButtons() {
        const state = {};
        for (const name of ['Request Approval', 'Approve', 'Reject', 'Reset To Draft']) {
            const button = this.page.getByRole('button', { name, exact: true });
            state[name] = await button.count() ? (await button.first().isEnabled() ? 'enabled' : 'disabled') : 'missing';
        }
        return state;
    }

    async resetPayrunToDraft(comment = 'Reset by automated test') {
        await this.page.getByRole('button', { name: 'Reset To Draft', exact: true }).click();
        await this.page.getByRole('textbox').last().fill(comment);
        await this.page.getByRole('button', { name: 'Submit', exact: true }).click();
        await expect(this.page.getByRole('button', { name: 'Request Approval', exact: true })).toBeVisible({ timeout: 15000 });
    }
}
