// purchasing.spec.js
// Purchasing module (Summary, Payruns and Analysis tabs):
//   - Summary: cost department figures, New Purchase Order button, department > subcategories
//   - Purchase orders created from a cost department (Draft, supplier / subcategory / budget entry, Request Approval, Delete)
//   - Payruns: create a payrun from the available payments, view it, request approval, reset to draft, approve → Paid
//   - Analysis: Budgets Not Fully Committed, POs Not Fully Invoiced, Outstanding Payments, Next Payment Run
// Tests that need an invoice create their own AutoTest-PUR-<n> budget entry + PO + invoice (due today) and remove it
// afterwards (unless PURCHASING_CLEANUP=0). Payruns can't be deleted in the app, so each payrun test leaves an
// "AutoPayrun_<n>" payrun behind. Runs against PURCHASING_EVENT_URL (falls back to INVOICE_EVENT_URL / BUDGET_EVENT_URL);
// scripts/fullRegression.js points it at the newly created regression event.
import { test, expect } from '../../fixtures/baseTest.js';

const EVENT_URL = (process.env.PURCHASING_EVENT_URL || process.env.INVOICE_EVENT_URL || process.env.BUDGET_EVENT_URL || '').replace(/\/$/, '');
// A PO is only created automatically on approval for some subcategories (e.g. "Artist Fees" gets none).
const SUBCATEGORY = process.env.PURCHASING_SUBCATEGORY || 'Travel';
// Not linked to Xero, so no invoices are pushed to Xero.
const SUPPLIER = process.env.PURCHASING_SUPPLIER || 'Muddles LTd';
const ENTRY_AMOUNT = 120;
const CLEANUP = process.env.PURCHASING_CLEANUP !== '0';

let budgetingPage;
let purchasingPage;
const createdEntries = [];

const isoDate = (daysAhead = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + daysAhead);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const stamp = () => Date.now().toString().slice(-8);
const near = (actual, expected, message) => expect(actual, message).toBeCloseTo(expected, 2);

// Creates an AutoTest-PUR-<n> budget entry (£120) in the first department and approves it, which creates its Draft PO.
async function createApprovedEntry(page) {
    const department = await budgetingPage.openDepartmentBudgetEntries(0);
    const entryTitle = `AutoTest-PUR-${Date.now()}`;
    await budgetingPage.createBudgetEntry({
        title: entryTitle, subcategory: SUBCATEGORY, supplier: SUPPLIER,
        fixedCost: ENTRY_AMOUNT, budgetedCost: ENTRY_AMOUNT, deptIndex: 0,
    });
    createdEntries.push(entryTitle);

    await budgetingPage.openEntryPopup(entryTitle);
    const drawer = budgetingPage.getDrawer();
    await drawer.getByRole('button', { name: /Request Approval/i }).click();
    await drawer.getByRole('button', { name: /^Approve$/i }).click();
    await expect(drawer.locator('span').filter({ hasText: /^Approved$/i }).first()).toBeVisible();
    await budgetingPage.openTabInPopup('Purchase Orders');
    await expect(
        drawer.locator('tr').filter({ hasText: entryTitle }),
        `Approving a "${SUBCATEGORY}" entry should create a PO — set PURCHASING_SUBCATEGORY to a subcategory that does`,
    ).toBeVisible({ timeout: 15000 });
    return { department, entryTitle };
}

// Opens the entry's PO from a fresh load and approves it.
async function approveEntryPO(entryTitle) {
    expect(await budgetingPage.openCostEntryByTitle(entryTitle, { deptIndex: 0 }), `Entry ${entryTitle} is listed`).toBeTruthy();
    await budgetingPage.openTabInPopup('Purchase Orders');
    await budgetingPage.openPOFromPopup(entryTitle);
    await budgetingPage.approvePO();
    await budgetingPage.verifyPOStatus('Approved');
}

// Raises an invoice for the whole PO (Invoices tab) with one payment date (today, or `daysAhead` days on) on the first bank account.
// Returns { invoiceNumber, paymentDate }.
async function raiseInvoice(page, entryTitle, { daysAhead = 0 } = {}) {
    const poDrawer = await budgetingPage.openPOInvoicesForEntry(entryTitle);
    const invoiceNumber = `INV-${Date.now()}`;
    await poDrawer.getByRole('button', { name: /raise.+invoice/i }).click();
    const form = page.locator('.m-wrapper').filter({ hasText: 'Raise Purchase Invoice' }).last();
    await expect(form).toBeVisible();
    await page.locator('dt, label').filter({ hasText: /^\s*Invoice Number\s*$/ }).filter({ visible: true })
        .last().locator('xpath=following::input[1]').fill(invoiceNumber);
    await form.getByRole('button', { name: /^Raise Invoice$/i }).click();

    const payments = page.locator('.m-wrapper').filter({ hasText: 'Invoice Payments' }).last();
    await expect(payments).toBeVisible({ timeout: 15000 });
    await payments.getByRole('button', { name: /New payment date/i }).click();
    const row = payments.locator('table.payment-dates-table tbody tr').last();
    if (daysAhead) {
        await row.locator('input[type="text"]').first().click();
        await purchasingPage.pickCalendarDay(isoDate(daysAhead));
    }
    const paymentDate = await row.locator('input[type="hidden"]').inputValue();
    expect(paymentDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const banks = await row.locator('select option').evaluateAll(options => options.filter(o => o.value && !o.disabled).map(o => o.value));
    if (banks.length) await row.locator('select').selectOption(banks[0]);
    await payments.getByRole('button', { name: /Save Changes/i }).click();
    await expect(payments).toBeHidden({ timeout: 15000 });
    return { invoiceNumber, paymentDate };
}

test.describe('Purchasing', () => {
    test.beforeEach(async ({ budgetingPage: budgeting, purchasingPage: purchasing }) => {
        if (!EVENT_URL) throw new Error('PURCHASING_EVENT_URL / INVOICE_EVENT_URL / BUDGET_EVENT_URL is not set');
        test.setTimeout(420000);
        budgetingPage = budgeting;
        purchasingPage = purchasing;
        budgetingPage.eventBaseUrl = EVENT_URL;
        purchasingPage.eventBaseUrl = EVENT_URL;
    });

    test.afterEach(async () => {
        const titles = createdEntries.splice(0);
        if (!CLEANUP) return;
        for (const title of titles) {
            await budgetingPage.deleteEntryWithPurchaseOrder(title)
                .catch(error => console.log(`⚠️ Clean-up of ${title} failed: ${error.message.split('\n')[0]}`));
        }
    });

    // ── SUMMARY ──────────────────────────────────────────────────────────────────

    test('Summary: cost department figures add up to the totals, and Remaining = Budgeted − Actual', async () => {
        await purchasingPage.gotoPurchasingSummary();
        const totals = await purchasingPage.readDepartmentTotals();
        const departments = await purchasingPage.readDepartments();
        expect(departments.length, 'Cost departments listed').toBeGreaterThan(0);

        for (const key of ['budgeted', 'actual', 'remainingBudget', 'invoiced', 'outstanding']) {
            expect(totals[key], `Total ${key} is shown`).not.toBeUndefined();
            near(departments.reduce((sum, department) => sum + department[key], 0), totals[key], `Total ${key} = sum of the departments`);
        }
        for (const department of departments) {
            near(department.remainingBudget, department.budgeted - department.actual, `${department.name}: Remaining Budget = Budgeted − Actual`);
        }
    });

    test('Summary: the statistic tiles on Summary and Analysis agree, and Outstanding Payments matches the Outstanding total', async ({ page }) => {
        await purchasingPage.gotoPurchasingSummary();
        const summaryTiles = await purchasingPage.readTiles();
        const totals = await purchasingPage.readDepartmentTotals();
        near(summaryTiles['Outstanding Payments'], totals.outstanding, 'Outstanding Payments tile = Outstanding total of the cost departments');

        await purchasingPage.gotoAnalysis();
        const analysisTiles = await purchasingPage.readTiles();
        for (const [title, value] of Object.entries(summaryTiles)) near(analysisTiles[title], value, `${title} tile on Analysis`);
        await expect(page.getByText('Approved budgets without purchase orders')).toBeVisible();
        await expect(page.getByText('Purchase orders awaiting or not fully invoiced')).toBeVisible();
        await expect(page.getByText('Purchase orders awaiting or not fully paid')).toBeVisible();
        await expect(page.getByText('Invoices on the next payment run.')).toBeVisible();
    });

    test('Cost departments: New Purchase Order and view buttons on every department; a department lists its purchase orders', async ({ page }) => {
        await purchasingPage.gotoPurchasingSummary();
        const departments = await purchasingPage.readDepartments();

        await test.step('Each department row has the New Purchase Order and view (arrow) buttons', async () => {
            for (const { name } of departments) {
                const buttons = purchasingPage.departmentRow(name).locator('button');
                expect(await buttons.count(), `${name}: buttons on the row`).toBe(2);
                await expect(buttons.first().locator('i.mdi-receipt-text-plus'), `${name}: New Purchase Order button`).toBeVisible();
                await expect(buttons.last().locator('i.mdi-arrow-right'), `${name}: view button`).toBeVisible();
            }
        });

        await test.step('A department opens to its purchase orders; Actual / Invoiced / Outstanding are their sums', async () => {
            const checked = [];
            for (const department of departments.filter(d => d.actual > 0)) {
                await purchasingPage.departmentRow(department.name).click();
                await page.waitForTimeout(1500);
                const orders = await purchasingPage.readDepartmentPurchaseOrders(department.name);
                expect(orders.length, `${department.name}: purchase orders listed`).toBeGreaterThan(0);
                for (const order of orders) {
                    expect(order.Title, 'PO has a title').toBeTruthy();
                    expect(order.Supplier, `PO ${order.Title} has a supplier`).toBeTruthy();
                }
                const live = orders.filter(order => /^(Approved|Sent|Closed)$/i.test(order.Status));
                const sum = key => live.reduce((total, order) => total + purchasingPage.money(order[key]), 0);
                near(sum('Committed'), department.actual, `${department.name}: Actual = committed value of its approved purchase orders`);
                near(sum('Invoiced'), department.invoiced, `${department.name}: Invoiced = invoiced value of its purchase orders`);
                near(sum('Outstanding'), department.outstanding, `${department.name}: Outstanding = outstanding value of its purchase orders`);
                await purchasingPage.departmentRow(department.name).click();
                checked.push(department.name);
            }
            expect(checked.length, 'Departments with purchase orders checked').toBeGreaterThan(0);
        });
    });

    test('View subcategories: a department lists its subcategories with figures that add up and match the Summary', async ({ page }) => {
        await purchasingPage.gotoPurchasingSummary();
        const departments = await purchasingPage.readDepartments();
        const department = [...departments].sort((a, b) => b.actual - a.actual)[0];
        console.log(`📂 Department: ${department.name}`);
        await purchasingPage.openDepartment(department.name);

        const totals = await purchasingPage.readSubcategoryTotals();
        const subcategories = await purchasingPage.readSubcategories();
        expect(subcategories.length, 'Subcategories listed').toBeGreaterThan(0);

        await test.step('Department totals equal the figures on the Purchasing Summary', async () => {
            for (const key of ['budgeted', 'actual', 'remainingBudget', 'invoiced', 'outstanding']) {
                near(totals[key], department[key], `${department.name}: ${key} on the Summary`);
            }
        });
        await test.step('Subcategory figures add up to the department totals', async () => {
            for (const key of ['budgeted', 'actual', 'remainingBudget', 'invoiced', 'outstanding']) {
                near(subcategories.reduce((sum, subcategory) => sum + subcategory[key], 0), totals[key], `Sum of subcategory ${key}`);
            }
            for (const subcategory of subcategories) {
                near(subcategory.remainingBudget, subcategory.budgeted - subcategory.actual, `${subcategory.name}: Remaining Budget = Budgeted − Actual`);
            }
        });
        await test.step('Customise columns: the Paid column can be shown, and adds up', async () => {
            const wasShown = await purchasingPage.isColumnShown('Paid');
            try {
                await purchasingPage.setColumn('Paid', true);
                const withPaid = await purchasingPage.readSubcategoryTotals();
                expect(withPaid.paid, 'Paid total is shown').not.toBeUndefined();
                const rows = await purchasingPage.readSubcategories();
                near(rows.reduce((sum, subcategory) => sum + (subcategory.paid ?? 0), 0), withPaid.paid, 'Sum of subcategory Paid');
                expect(withPaid.paid, 'Paid cannot exceed Invoiced').toBeLessThanOrEqual(withPaid.invoiced + 0.005);
            } finally {
                await purchasingPage.setColumn('Paid', wasShown);
            }
        });
    });

    // ── PURCHASE ORDERS ──────────────────────────────────────────────────────────

    test('New purchase order from a cost department: Draft, supplier / subcategory / budget entry, Request Approval and Delete @smoke', async ({ page }) => {
        await purchasingPage.gotoPurchasingSummary();
        const [department] = await purchasingPage.readDepartments();
        const before = { tiles: await purchasingPage.readTiles(), department };
        const title = `AutoPO_${stamp()}`;
        let created = false;

        try {
            await purchasingPage.openNewPurchaseOrder(department.name);
            await test.step('The new purchase order starts as a Draft, with supplier, budget entry and subcategory to choose', async () => {
                await expect(page.getByText('Draft', { exact: true }).first()).toBeVisible();
                for (const field of ['Subcategory', 'Supplier', 'Budget Entry']) {
                    await expect(page.locator('dt', { hasText: field }), `${field} field`).toBeVisible();
                }
                expect((await purchasingPage.listOptions('Subcategory')).length, 'Subcategories to choose from').toBeGreaterThan(0);
            });

            await purchasingPage.fillPurchaseOrder({
                title, subcategory: SUBCATEGORY, supplier: SUPPLIER, budgetEntry: /^Travel$/, unitPrice: 500, taxRate: '20%',
            });
            const panel = await purchasingPage.createPurchaseOrderAndView();
            created = true;

            await test.step('The PO is saved as a Draft that can be sent for approval or deleted', async () => {
                await expect(panel).toContainText(title);
                await expect(panel.getByText('Draft', { exact: true }).first()).toBeVisible();
                await expect(panel.getByRole('button', { name: /Request Approval/i })).toBeEnabled();
                await expect(panel.getByRole('button', { name: /Delete/ }).first()).toBeEnabled();
                const text = await panel.innerText();
                expect(text).toMatch(new RegExp(`SUBCATEGORY\\s+${SUBCATEGORY}`));
                expect(text).toMatch(/SUPPLIER\s+Muddles LTd/);
                expect(text).toMatch(/BUDGET ENTRY\s+Travel/);
                expect(text, 'Subtotal').toMatch(/SUBTOTAL\s+£500\.00/);
                expect(text, 'Tax at 20%').toMatch(/TAX\s+£100\.00/);
                expect(text, 'Total').toMatch(/TOTAL\s+£600\.00/);
            });

            await test.step('The Draft PO is listed under its department and leaves the figures unchanged', async () => {
                await page.keyboard.press('Escape');
                await purchasingPage.gotoPurchasingSummary();
                await purchasingPage.departmentRow(department.name).click();
                await page.waitForTimeout(1500);
                const order = (await purchasingPage.readDepartmentPurchaseOrders(department.name)).find(o => o.Title === title);
                expect(order, `${title} listed under ${department.name}`).toBeTruthy();
                expect(order).toMatchObject({ Status: expect.stringMatching(/Draft/), Subcategory: expect.stringContaining(SUBCATEGORY), Supplier: expect.stringContaining(SUPPLIER) });
                near(purchasingPage.money(order.Committed), 500, 'PO value in the list');
                await purchasingPage.departmentRow(department.name).click();

                const after = (await purchasingPage.readDepartments()).find(d => d.name === department.name);
                for (const key of ['budgeted', 'actual', 'invoiced', 'outstanding']) near(after[key], before.department[key], `${key} unchanged by a Draft PO`);
                const tiles = await purchasingPage.readTiles();
                for (const [tile, value] of Object.entries(before.tiles)) near(tiles[tile], value, `${tile} unchanged by a Draft PO`);
            });

            await test.step('Delete the Draft PO', async () => {
                await purchasingPage.departmentRow(department.name).click();
                await page.waitForTimeout(1500);
                await page.locator('tr').filter({ hasText: title }).last().locator('button').last().click();
                await purchasingPage.deleteOpenDraftPurchaseOrder();
                created = false;
                await purchasingPage.gotoPurchasingSummary();
                await purchasingPage.departmentRow(department.name).click();
                await page.waitForTimeout(1500);
                const orders = await purchasingPage.readDepartmentPurchaseOrders(department.name);
                expect(orders.map(o => o.Title), 'Deleted PO no longer listed').not.toContain(title);
            });
        } finally {
            if (created) {
                await purchasingPage.gotoPurchasingSummary();
                await purchasingPage.departmentRow(department.name).click();
                await page.waitForTimeout(1500);
                await page.locator('tr').filter({ hasText: title }).last().locator('button').last().click().catch(() => {});
                await purchasingPage.deleteOpenDraftPurchaseOrder().catch(error => console.log(`⚠️ Clean-up of ${title} failed: ${error.message.split('\n')[0]}`));
            }
        }
    });

    // ── PAYRUNS ──────────────────────────────────────────────────────────────────

    test('Payruns: create a payrun from the available payments, view it, request approval, reset to draft and approve', async ({ page }) => {
        test.fail(true, 'Known bug: automation user cannot approve or reject payruns due to permissions - ClickUp: TODO');
        test.setTimeout(600000);
        await purchasingPage.gotoPayruns();
        // Payment dated tomorrow, so it is on the date strip and counts as the *next* payment run.
        const dayBefore = await purchasingPage.readDayTile(isoDate(1));

        await budgetingPage.gotoBudgetSummaryPage();
        await budgetingPage.selectBudgetVersion('A');
        await budgetingPage.expandAllSections();
        const { department, entryTitle } = await createApprovedEntry(page);
        await approveEntryPO(entryTitle);
        const { invoiceNumber, paymentDate } = await raiseInvoice(page, entryTitle, { daysAhead: 1 });
        console.log(`🧾 ${invoiceNumber} due ${paymentDate} (${department})`);
        const payrunTitle = `AutoPayrun_${stamp()}`;

        await test.step('The invoice payment is available on the Payruns tab for its date', async () => {
            await purchasingPage.gotoPayruns();
            await purchasingPage.selectDay(paymentDate);
            const tile = await purchasingPage.readDayTile(paymentDate);
            expect(tile.payments, 'Payments on the date strip').toBe(dayBefore.payments + 1);
            const available = await purchasingPage.readAvailablePayments();
            const payment = available.find(row => row['Invoice Number'] === invoiceNumber);
            expect(payment, `${invoiceNumber} listed as an available payment`).toBeTruthy();
            near(purchasingPage.money(payment.Amount), ENTRY_AMOUNT, 'Available payment amount');
        });

        await test.step('Create a payrun with the payment', async () => {
            await purchasingPage.createPayrun({ title: payrunTitle, isoDate: paymentDate, invoiceNumbers: [invoiceNumber] });
            const totals = await purchasingPage.readPayrunFormTotals();
            near(totals.runValue, ENTRY_AMOUNT, 'Run Value');
            expect(totals.payments, 'Payments in the run').toBe(1);
            await purchasingPage.submitPayrun();
            await purchasingPage.selectDay(paymentDate);
        });

        await test.step('The new payrun is listed as Draft', async () => {
            const payrun = (await purchasingPage.readPayruns()).find(row => row.Title === payrunTitle);
            expect(payrun, `${payrunTitle} listed`).toBeTruthy();
            expect(payrun.Status).toBe('Draft');
            expect(Number(payrun.Items)).toBe(1);
            near(purchasingPage.money(payrun.Value), ENTRY_AMOUNT, 'Payrun value');
            expect((await purchasingPage.readDayTile(paymentDate)).payruns, 'Payruns on the date strip').toBe(dayBefore.payruns + 1);
            expect(await purchasingPage.readAvailablePayments(), 'The payment is no longer available').not.toEqual(
                expect.arrayContaining([expect.objectContaining({ 'Invoice Number': invoiceNumber })]));
        });

        await test.step('View the payrun (eye icon): Draft, with Request Approval', async () => {
            await purchasingPage.openPayrun(payrunTitle);
            expect(await purchasingPage.payrunStatus()).toBe('Draft');
            const body = await page.locator('body').innerText();
            for (const text of [department, SUBCATEGORY, SUPPLIER, entryTitle, invoiceNumber, '£120.00']) expect(body).toContain(text);
            expect((await purchasingPage.payrunButtons())['Request Approval']).toBe('enabled');
        });

        await test.step('Request approval: Approve, Reject and Reset To Draft are offered', async () => {
            await page.getByRole('button', { name: 'Request Approval', exact: true }).click();
            await expect.poll(() => purchasingPage.payrunStatus(), { message: 'Status after requesting approval' }).not.toBe('Draft');
            const buttons = await purchasingPage.payrunButtons();
            for (const name of ['Approve', 'Reject', 'Reset To Draft']) expect(buttons[name], `${name} button`).not.toBe('missing');
        });

        await test.step('Reset To Draft returns the payrun to Draft', async () => {
            await purchasingPage.resetPayrunToDraft();
            expect(await purchasingPage.payrunStatus()).toBe('Draft');
            await page.getByRole('button', { name: 'Request Approval', exact: true }).click();
            await expect.poll(() => purchasingPage.payrunStatus()).not.toBe('Draft');
        });

        // Soft checks: a failure here is reported, but the approval below still runs.
        await test.step('The invoice is on the Next Payment Run (Analysis)', async () => {
            await purchasingPage.gotoAnalysis();
            const tiles = await purchasingPage.readTiles();
            expect.soft(tiles['Next Payment Run'], 'Invoices on the next payment run').toBeGreaterThanOrEqual(1);
            await purchasingPage.selectTile('Next Payment Run');
            const row = (await purchasingPage.readAnalysisPurchaseOrders()).find(r => r['PO Title'] === entryTitle);
            expect.soft(row, `${entryTitle} listed on the next payment run`).toBeTruthy();
            if (!row) return;
            expect.soft(purchasingPage.money(row['Net Total']), 'Net Total').toBeCloseTo(ENTRY_AMOUNT, 2);
            expect.soft(purchasingPage.money(row['Invoiced Net']), 'Invoiced Net').toBeCloseTo(ENTRY_AMOUNT, 2);
            expect.soft(purchasingPage.money(row['Paid Gross']), 'Paid Gross').toBeCloseTo(0, 2);
            expect.soft(purchasingPage.money(row['Outstanding Gross']), 'Outstanding Gross').toBeCloseTo(ENTRY_AMOUNT, 2);
        });

        await test.step('Approve the payrun: its status changes to Paid', async () => {
            await purchasingPage.gotoPayruns();
            await purchasingPage.selectDay(paymentDate);
            await page.locator('tbody tr').filter({ hasText: payrunTitle }).first().waitFor({ state: 'visible', timeout: 15000 });
            await purchasingPage.openPayrun(payrunTitle);
            const approve = page.getByRole('button', { name: 'Approve', exact: true });
            await expect(approve, 'Approve is available to the approver').toBeEnabled();
            await approve.click();
            await expect.poll(() => purchasingPage.payrunStatus(), { message: 'Status after approving', timeout: 30000 }).toBe('Paid');
            expect(await page.locator('body').innerText()).toMatch(/Paid\s*\n\s*£120\.00/);
        });
    });

    // ── ANALYSIS ─────────────────────────────────────────────────────────────────

    test('Analysis: Budgets Not Fully Committed — totals add up and an approved entry is copied over correctly', async ({ page }) => {
        await purchasingPage.gotoAnalysis();
        const tilesBefore = await purchasingPage.readTiles();
        await purchasingPage.selectTile('Budgets Not Fully Committed');
        const departmentsBefore = await purchasingPage.readAnalysisDepartments();
        near(departmentsBefore.reduce((sum, d) => sum + d.outstanding, 0), tilesBefore['Budgets Not Fully Committed'], 'Tile = sum of the departments');

        await budgetingPage.gotoBudgetSummaryPage();
        await budgetingPage.selectBudgetVersion('A');
        await budgetingPage.expandAllSections();
        const { department, entryTitle } = await createApprovedEntry(page);

        await test.step('The approved entry (no PO approved yet) is counted as not committed', async () => {
            await purchasingPage.gotoAnalysis();
            const tiles = await purchasingPage.readTiles();
            near(tiles['Budgets Not Fully Committed'], tilesBefore['Budgets Not Fully Committed'] + ENTRY_AMOUNT, 'Tile');
            await purchasingPage.selectTile('Budgets Not Fully Committed');
            const departments = await purchasingPage.readAnalysisDepartments();
            const row = departments.find(d => d.name === department);
            const rowBefore = departmentsBefore.find(d => d.name === department);
            near(row.total, rowBefore.total + ENTRY_AMOUNT, `${department}: Budgets Approved`);
            near(row.outstanding, rowBefore.outstanding + ENTRY_AMOUNT, `${department}: Budgets Not Committed`);
            near(departments.reduce((sum, d) => sum + d.outstanding, 0), tiles['Budgets Not Fully Committed'], 'Tile = sum of the departments');

            const entries = await purchasingPage.readAnalysisDepartmentEntries(department);
            const entryRow = page.locator('table table tbody tr').filter({ hasText: entryTitle }).first();
            await expect(entryRow).toBeVisible();
            const entry = entries.find(e => e.Title === entryTitle);
            expect(entry, `${entryTitle} listed under ${department}`).toBeTruthy();
            expect(entry.Status).toBe('Approved');
            expect(entry.Subcategory).toContain(SUBCATEGORY);
            expect(entry.Supplier).toContain(SUPPLIER);
            near(Number(await entryRow.locator('input').first().inputValue()), ENTRY_AMOUNT, 'Budgeted');
            near(purchasingPage.money(entry.Committed), 0, 'Committed');
            near(purchasingPage.money(entry['Accrual Amount']), ENTRY_AMOUNT, 'Accrual Amount');
            // Every entry: Accrual Amount = Budgeted − Committed
            for (const other of entries) {
                const budgeted = Number(await page.locator('table table tbody tr').filter({ hasText: other.Title }).first().locator('input').first().inputValue());
                near(purchasingPage.money(other['Accrual Amount']), budgeted - purchasingPage.money(other.Committed), `${other.Title}: Accrual = Budgeted − Committed`);
            }
            near(entries.reduce((sum, e) => sum + purchasingPage.money(e['Accrual Amount']), 0), row.outstanding, `${department}: entries add up to Budgets Not Committed`);
        });

        await test.step('Approving its purchase order commits the budget', async () => {
            await approveEntryPO(entryTitle);
            await purchasingPage.gotoAnalysis();
            near((await purchasingPage.readTiles())['Budgets Not Fully Committed'], tilesBefore['Budgets Not Fully Committed'], 'Tile back to where it was');
        });
    });

    test('Analysis: POs Not Fully Invoiced — totals add up and an approved PO is copied over correctly', async ({ page }) => {
        await purchasingPage.gotoAnalysis();
        const tilesBefore = await purchasingPage.readTiles();
        await purchasingPage.selectTile('POs Not Fully Invoiced');
        const departmentsBefore = await purchasingPage.readAnalysisDepartments();
        near(departmentsBefore.reduce((sum, d) => sum + d.outstanding, 0), tilesBefore['POs Not Fully Invoiced'], 'Tile = sum of the departments');

        await budgetingPage.gotoBudgetSummaryPage();
        await budgetingPage.selectBudgetVersion('A');
        await budgetingPage.expandAllSections();
        const { department, entryTitle } = await createApprovedEntry(page);
        await approveEntryPO(entryTitle);

        await test.step('The approved PO is not invoiced yet', async () => {
            await purchasingPage.gotoAnalysis();
            const tiles = await purchasingPage.readTiles();
            near(tiles['POs Not Fully Invoiced'], tilesBefore['POs Not Fully Invoiced'] + ENTRY_AMOUNT, 'Tile');
            await purchasingPage.selectTile('POs Not Fully Invoiced');
            const departments = await purchasingPage.readAnalysisDepartments();
            const row = departments.find(d => d.name === department);
            const rowBefore = departmentsBefore.find(d => d.name === department);
            near(row.total, rowBefore.total + ENTRY_AMOUNT, `${department}: POs Approved`);
            near(row.outstanding, rowBefore.outstanding + ENTRY_AMOUNT, `${department}: POs Not Invoiced`);

            const entries = await purchasingPage.readAnalysisDepartmentEntries(department);
            const order = entries.find(e => e['PO Title'] === entryTitle);
            expect(order, `${entryTitle} listed under ${department}`).toBeTruthy();
            expect(order.Status).toBe('Approved');
            expect(order.Department).toBe(department);
            expect(order.Subcategory).toContain(SUBCATEGORY);
            expect(order.Supplier).toContain(SUPPLIER);
            near(purchasingPage.money(order['PO Total']), ENTRY_AMOUNT, 'PO Total');
            near(purchasingPage.money(order['PO Not Invoiced']), ENTRY_AMOUNT, 'PO Not Invoiced');
            near(purchasingPage.money(order.Invoiced), 0, 'Invoiced');
            near(purchasingPage.money(order['Invoiced (Gross)']), 0, 'Invoiced (Gross)');
            // Every PO: PO Total − PO Not Invoiced = Invoiced, and they add up to the department's POs Not Invoiced.
            for (const other of entries) {
                near(purchasingPage.money(other['PO Total']) - purchasingPage.money(other['PO Not Invoiced']), purchasingPage.money(other.Invoiced),
                    `${other['PO Title']}: PO Total − PO Not Invoiced = Invoiced`);
            }
            near(entries.reduce((sum, e) => sum + purchasingPage.money(e['PO Not Invoiced']), 0), row.outstanding, `${department}: POs add up to POs Not Invoiced`);
        });

        await test.step('Invoicing the whole PO removes it', async () => {
            await raiseInvoice(page, entryTitle);
            await purchasingPage.gotoAnalysis();
            near((await purchasingPage.readTiles())['POs Not Fully Invoiced'], tilesBefore['POs Not Fully Invoiced'], 'Tile back to where it was');
        });
    });

    test('Analysis: Outstanding Payments — totals add up and an invoiced PO is copied over correctly', async ({ page }) => {
        await purchasingPage.gotoAnalysis();
        const tilesBefore = await purchasingPage.readTiles();
        await purchasingPage.selectTile('Outstanding Payments');
        const rowsBefore = await purchasingPage.readAnalysisPurchaseOrders();
        near(rowsBefore.reduce((sum, r) => sum + purchasingPage.money(r['Outstanding Gross']), 0), tilesBefore['Outstanding Payments'], 'Tile = sum of Outstanding Gross');

        await budgetingPage.gotoBudgetSummaryPage();
        await budgetingPage.selectBudgetVersion('A');
        await budgetingPage.expandAllSections();
        const { department, entryTitle } = await createApprovedEntry(page);
        await approveEntryPO(entryTitle);
        await raiseInvoice(page, entryTitle);

        await purchasingPage.gotoAnalysis();
        const tiles = await purchasingPage.readTiles();
        near(tiles['Outstanding Payments'], tilesBefore['Outstanding Payments'] + ENTRY_AMOUNT, 'Tile');
        await purchasingPage.selectTile('Outstanding Payments');
        const rows = await purchasingPage.readAnalysisPurchaseOrders();
        const row = rows.find(r => r['PO Title'] === entryTitle);
        expect(row, `${entryTitle} listed`).toBeTruthy();
        expect(row.Status).toBe('Approved');
        expect(row.Department).toBe(department);
        expect(row.Subcategory).toContain(SUBCATEGORY);
        expect(row.Supplier).toContain(SUPPLIER);
        near(purchasingPage.money(row['Net Total']), ENTRY_AMOUNT, 'Net Total');
        near(purchasingPage.money(row['Invoiced Net']), ENTRY_AMOUNT, 'Invoiced Net');
        near(purchasingPage.money(row['Paid Gross']), 0, 'Paid Gross');
        near(purchasingPage.money(row['Outstanding Gross']), ENTRY_AMOUNT, 'Outstanding Gross');
        near(purchasingPage.money(row['Amount Not Invoiced Net']), 0, 'Amount Not Invoiced Net');
        near(rows.reduce((sum, r) => sum + purchasingPage.money(r['Outstanding Gross']), 0), tiles['Outstanding Payments'], 'Tile = sum of Outstanding Gross');
        for (const other of rows) {
            near(purchasingPage.money(other['Net Total']) - purchasingPage.money(other['Invoiced Net']), purchasingPage.money(other['Amount Not Invoiced Net']),
                `${other['PO Title']}: Net Total − Invoiced Net = Amount Not Invoiced Net`);
        }
    });
});
