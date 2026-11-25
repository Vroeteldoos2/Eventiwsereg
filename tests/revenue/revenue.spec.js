// revenue.spec.js
// Revenue module — revenue entries and customer invoices:
//   - Revenue stream totals match the Budgeting (Budget Summary) page
//   - Create a revenue entry: saved correctly, stream totals update
//   - Raise a customer invoice: values copied over, Details/Activity tabs, PO number and
//     custom payment terms, Xero indicator
//   - Invoice actions: download PDF, send by email, manage payment dates
//   - Raise a credit note (included in totals, pop-up message) and delete the invoice
//   - Publish to Xero (only when REVENUE_XERO_CUSTOMER is set)
// Each test creates its own AutoRevenue_<n> entry and removes it (crediting and deleting
// any invoice first). Runs against REVENUE_EVENT_URL — scripts/fullRegression.js points
// it at the newly created regression event.
import { test, expect } from '../../fixtures/baseTest.js';
import { cleanupWithWarning } from '../utils/test-helpers.js';
import { readFile } from 'node:fs/promises';
import { readPdfText } from '../utils/pdf.js';

const EVENT_URL = (process.env.REVENUE_EVENT_URL || process.env.REVENUE_TICKETS_EVENT_URL || '').replace(/\/$/, '');
const STREAM = process.env.REVENUE_STREAM || 'Merchandise';
const SUBCATEGORY = process.env.REVENUE_SUBCATEGORY || 'Shirts';
// A customer NOT linked to Xero — invoices for Xero-linked customers are pushed to Xero
// automatically on creation.
const CUSTOMER = process.env.REVENUE_CUSTOMER || 'Muddles LTd';
const XERO_CUSTOMER = process.env.REVENUE_XERO_CUSTOMER;
const INVOICE_EMAIL = process.env.REVENUE_INVOICE_EMAIL || process.env.USER_EMAIL;
const ENTRY_PREFIX = 'AutoRevenue_';
const QTY = 2;
const UNIT_PRICE = 50;
const NET = QTY * UNIT_PRICE;      // £100
const GROSS = NET * 1.2;           // £120 at 20%

const newTitle = () => `${ENTRY_PREFIX}${Date.now().toString().slice(-6)}`;
const money = value => `£${value.toFixed(2)}`;

async function createEntry(revenuePage, title, customer = CUSTOMER) {
    await revenuePage.gotoRevenueDashboard();
    await revenuePage.createRevenueEntry({ streamName: STREAM, title, subcategory: SUBCATEGORY, customer, qty: QTY, unitPrice: UNIT_PRICE });
}

async function streamFigures(budgetingPage) {
    const { header, rows } = await budgetingPage.getSectionFigures('Revenue Streams');
    return { header, stream: rows[STREAM] };
}

test.describe('Revenue - entries and customer invoices', () => {

    test.beforeEach(async ({ revenuePage, budgetingPage }) => {
        if (!EVENT_URL) throw new Error('REVENUE_EVENT_URL is not set');
        revenuePage.eventBaseUrl = EVENT_URL;
        budgetingPage.eventBaseUrl = EVENT_URL;
    });

    test.afterEach(async ({ revenuePage }) => {
        await cleanupWithWarning('revenue entries', () => revenuePage.deleteRevenueEntries(STREAM, new RegExp(`^${ENTRY_PREFIX}\\d+$`)));
    });

    test('Revenue stream totals match the Budgeting page', async ({ revenuePage, budgetingPage }) => {
        await revenuePage.gotoRevenueDashboard();
        const revenue = await budgetingPage.getSectionFigures('Revenue Streams');

        // Budget Summary shows Fixed/Budgeted by default — add Actual and Variance, then restore.
        await budgetingPage.gotoBudgetSummaryPage();
        await budgetingPage.selectBudgetVersion('A');
        const previousColumns = await budgetingPage.setCustomColumns({ Actual: true, Variance: true });
        let budget;
        try {
            budget = await budgetingPage.getSectionFigures('Revenue Streams');
        } finally {
            await cleanupWithWarning('Budget Summary columns', () => budgetingPage.setCustomColumns(previousColumns));
        }

        expect(Object.keys(revenue.rows).sort(), 'Same revenue streams on both pages').toEqual(Object.keys(budget.rows).sort());
        for (const column of ['budgeted', 'actual', 'variance']) {
            expect(revenue.header[column], `Revenue Streams ${column} total`).toBeCloseTo(budget.header[column], 2);
            for (const [name, figures] of Object.entries(revenue.rows)) {
                console.log(`  ${name} ${column}: Revenue £${figures[column]} / Budget £${budget.rows[name][column]}`);
                expect(figures[column], `${name} ${column}`).toBeCloseTo(budget.rows[name][column], 2);
            }
        }
    });

    test('Create a revenue entry: saved correctly and stream totals update @smoke', async ({ page, revenuePage, budgetingPage }) => {
        await revenuePage.gotoRevenueDashboard();
        const before = await streamFigures(budgetingPage);
        const title = newTitle();

        await createEntry(revenuePage, title);
        const drawer = revenuePage.revenueEntryDrawer();
        await expect(drawer.getByText(title, { exact: true }).first()).toBeVisible();
        await expect(drawer).toContainText(money(NET));    // Net Total
        await expect(drawer).toContainText(money(GROSS));  // Gross Total
        await expect(drawer).toContainText(SUBCATEGORY);
        await expect(drawer).toContainText(CUSTOMER);

        await revenuePage.gotoRevenueDashboard();
        const after = await streamFigures(budgetingPage);
        await revenuePage.expandStreamRow(STREAM);
        const row = await revenuePage.readRevenueEntryRow(title);
        expect(row).toMatchObject({ title, subcategory: SUBCATEGORY, customer: CUSTOMER, net: NET, invoiced: 0, outstanding: 0 });

        for (const [label, figures] of [['Stream', 'stream'], ['Total', 'header']]) {
            expect(after[figures].actual, `${label} Actual +${NET}`).toBeCloseTo(before[figures].actual + NET, 2);
            expect(after[figures].variance, `${label} Variance +${NET}`).toBeCloseTo(before[figures].variance + NET, 2);
            expect(after[figures].budgeted, `${label} Budgeted unchanged`).toBeCloseTo(before[figures].budgeted, 2);
        }
        await page.keyboard.press('Escape');
    });

    test('Raise a customer invoice: values copied, Details/Activity, PO number and payment terms', async ({ page, revenuePage, budgetingPage }) => {
        const title = newTitle();
        await createEntry(revenuePage, title);
        await revenuePage.gotoRevenueDashboard();
        const before = await streamFigures(budgetingPage);
        await revenuePage.openRevenueEntry(STREAM, title);

        await revenuePage.raiseInvoiceForEntry({
            onReview: async wizard => {
                const line = wizard.locator('tbody tr').first();
                await expect(line).toContainText(String(QTY));
                await expect(line).toContainText(money(UNIT_PRICE));
                await expect(line).toContainText(money(NET));
                await expect(line).toContainText(money(GROSS));
                await expect(line).toContainText('20%');
                await expect(wizard).toContainText(CUSTOMER);
            },
        });

        const view = revenuePage.invoiceView();
        const invoiceNumber = (await view.getByText(/^EW-SI-\d+$/).first().innerText()).trim();
        await expect(view).toContainText(title);
        await expect(view).toContainText(CUSTOMER);
        expect(await revenuePage.readInvoiceTotals()).toMatchObject({ subtotal: NET, tax: GROSS - NET, total: GROSS, outstanding: GROSS });

        await test.step('Customer is not linked to Xero — indicator shown as not connected', async () => {
            await expect(view.locator('img[alt="Not connected to Xero"]')).toBeVisible();
        });

        await test.step('Activity tab records the invoice', async () => {
            await view.getByRole('button', { name: /^Activity/ }).click();
            await expect(view.getByText(`Customer invoice ${invoiceNumber} created`)).toBeVisible();
            await view.getByRole('button', { name: /^Details/ }).click();
        });

        const poNumber = `PO${Math.floor(100000 + Math.random() * 900000)}`;
        const paymentTerms = `Terms ${Math.floor(1000 + Math.random() * 9000)}: payment within 14 days`;
        await test.step('PO number and custom payment terms are saved', async () => {
            // Go back to the saved invoice (entry > Invoices) and add them there.
            await revenuePage.openRevenueEntry(STREAM, title);
            expect(await revenuePage.openFirstInvoiceFromEntry()).toBe(true);
            await revenuePage.setInvoicePoNumberAndTerms({ poNumber, paymentTerms });
            await revenuePage.openRevenueEntry(STREAM, title);
            expect(await revenuePage.openFirstInvoiceFromEntry()).toBe(true);
            // The reopened view fills these in once its data loads.
            await expect(revenuePage.page.getByPlaceholder('Customers PO number...')).toHaveValue(poNumber);
            await expect(revenuePage.page.getByPlaceholder('Optional')).toHaveValue(paymentTerms);
        });

        await test.step('Stream Invoiced / Outstanding include the invoice', async () => {
            await revenuePage.gotoRevenueDashboard();
            const after = await streamFigures(budgetingPage);
            expect(after.stream.invoiced, 'Invoiced (net)').toBeCloseTo(before.stream.invoiced + NET, 2);
            expect(after.stream.outstanding, 'Outstanding (gross)').toBeCloseTo(before.stream.outstanding + GROSS, 2);
            await revenuePage.expandStreamRow(STREAM);
            expect(await revenuePage.readRevenueEntryRow(title)).toMatchObject({ invoiced: NET, outstanding: GROSS });
        });
        await page.keyboard.press('Escape');
    });

    test('Invoice actions: download PDF, send by email, manage payment dates', async ({ revenuePage }) => {
        test.fail(true, 'Known bug: customer invoice payment dates cannot be saved - ClickUp: TODO');
        const title = newTitle();
        await createEntry(revenuePage, title);
        await revenuePage.raiseInvoiceForEntry();
        const view = revenuePage.invoiceView();
        const invoiceNumber = (await view.getByText(/^EW-SI-\d+$/).first().innerText()).trim();

        await test.step('Download invoice (PDF) — includes the PO number and custom payment terms', async () => {
            // Add PO number / terms on the saved invoice (see the invoice test), then download.
            const poNumber = `PO${Math.floor(100000 + Math.random() * 900000)}`;
            const paymentTerms = `Terms ${Math.floor(1000 + Math.random() * 9000)}: payment within 14 days`;
            await revenuePage.openRevenueEntry(STREAM, title);
            expect(await revenuePage.openFirstInvoiceFromEntry()).toBe(true);
            await revenuePage.setInvoicePoNumberAndTerms({ poNumber, paymentTerms });

            const downloadPromise = revenuePage.page.waitForEvent('download', { timeout: 30000 });
            await revenuePage.clickInvoiceAction('Download invoice (PDF)');
            const download = await downloadPromise;
            expect(download.suggestedFilename()).toMatch(new RegExp(`^sales_invoice_${invoiceNumber}_.*\\.pdf$`, 'i'));
            const pdf = await readFile(await download.path());
            expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');

            const text = await readPdfText(await download.path());
            console.log(`📄 PDF text: ${text.slice(0, 300)}…`);
            // Amounts in the PDF are printed without the £ sign ("Total 120.00").
            for (const expected of [invoiceNumber, CUSTOMER, title, poNumber, paymentTerms, `Total ${GROSS.toFixed(2)}`]) {
                expect(text, `PDF should contain "${expected}"`).toContain(expected);
            }
        });

        await test.step('Send invoice by email', async () => {
            test.skip(!INVOICE_EMAIL, 'Set REVENUE_INVOICE_EMAIL to send the invoice email.');
            await revenuePage.sendInvoiceByEmail(INVOICE_EMAIL);
        });

        await test.step('Manage payment dates: add, edit, mark paid; totals and currency', async () => {
            const page = revenuePage.page;
            await revenuePage.clickInvoiceAction('Manage payment dates');
            const payments = page.locator('.m-wrapper').filter({ hasText: 'Invoice Payments' }).last();
            await payments.waitFor({ state: 'visible', timeout: 10000 });
            const total = payments.locator('dl').filter({ hasText: 'Total Payments' });
            await expect(payments.locator('dl').filter({ hasText: 'Invoice Value' })).toContainText(money(GROSS));
            await expect(total).toContainText('£0.00');

            const rows = payments.locator('table tbody tr').filter({ has: page.locator('input[type="number"]') });
            await payments.getByRole('button', { name: /New payment date/i }).click();
            await payments.getByRole('button', { name: /New payment date/i }).click();
            await expect(rows).toHaveCount(2);
            for (const [index, amount] of [[0, 70], [1, 50]]) {
                const row = rows.nth(index);
                await expect(row.locator('input[type="hidden"]')).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
                await row.locator('input[type="number"]').fill(amount.toFixed(2));
                await row.locator('select').selectOption({ index: 0 });
                await row.getByRole('checkbox').check();
            }
            await expect(total).toContainText(money(GROSS));

            // Remove a row: the total follows.
            await payments.getByRole('button', { name: /New payment date/i }).click();
            await expect(rows).toHaveCount(3);
            await rows.nth(2).locator('input[type="number"]').fill('10.00');
            await expect(total).toContainText(money(GROSS + 10));
            await rows.nth(2).getByRole('button', { name: 'Remove payment date' }).click();
            await expect(rows).toHaveCount(2);
            await expect(total).toContainText(money(GROSS));

            // NOTE: on event 206 (Xero-connected account) "Save Changes" stays disabled for an
            // invoice that isn't in Xero — reported to the developers. This fails until resolved.
            const save = payments.getByRole('button', { name: /Save Changes/i });
            await expect(save, 'Save Changes should be enabled for valid payment dates').toBeEnabled();
            await save.click();
            await expect(payments).toBeHidden({ timeout: 15000 });

            // Reopen: the payment dates persisted, and the invoice is fully paid.
            await revenuePage.clickInvoiceAction('Manage payment dates');
            await payments.waitFor({ state: 'visible', timeout: 10000 });
            await expect(rows).toHaveCount(2);
            await expect(rows.nth(0).locator('input[type="number"]')).toHaveValue('70.00');
            await expect(rows.nth(1).locator('input[type="number"]')).toHaveValue('50.00');
            await expect(rows.nth(0).getByRole('checkbox')).toBeChecked();
            await expect(total).toContainText(money(GROSS));
            await payments.getByRole('button', { name: 'Cancel', exact: true }).click();

            expect(await revenuePage.readInvoiceTotals()).toMatchObject({ total: GROSS, lessPaymentsCredits: -GROSS, outstanding: 0 });
        });
    });

    test('Raise a credit note, then delete the invoice', async ({ page, revenuePage }) => {
        const title = newTitle();
        await createEntry(revenuePage, title);
        await revenuePage.raiseInvoiceForEntry();
        const view = revenuePage.invoiceView();
        const invoiceNumber = (await view.getByText(/^EW-SI-\d+$/).first().innerText()).trim();

        await test.step('An invoice with an outstanding balance is not deleted', async () => {
            const status = await revenuePage.deleteInvoice();
            expect(status, 'API refuses to delete an invoice with an outstanding balance').toBe(422);
            await revenuePage.openRevenueEntry(STREAM, title);
            expect(await revenuePage.openFirstInvoiceFromEntry(), 'Invoice still exists').toBe(true);
        });

        await test.step('Credit note: pop-up message and included in the totals', async () => {
            const toast = await revenuePage.raiseCreditNote();
            expect(toast).toMatch(/credit note/i);
            await view.getByRole('button', { name: /^Payments\/Credits/ }).click();
            const creditRow = view.getByRole('row').filter({ hasText: /Credit Note/i }).first();
            await expect(creditRow).toBeVisible();
            await expect(creditRow).toContainText(money(NET));   // listed net; the totals below use gross
            expect(await revenuePage.readInvoiceTotals()).toMatchObject({ total: GROSS, lessPaymentsCredits: -GROSS, outstanding: 0 });
        });

        await test.step('Delete invoice', async () => {
            expect(await revenuePage.deleteInvoice()).toBe(204);
            await revenuePage.openRevenueEntry(STREAM, title);
            expect(await revenuePage.openFirstInvoiceFromEntry(), `${invoiceNumber} should be gone`).toBe(false);
        });
        await page.keyboard.press('Escape');
    });

    test('Publish to Xero: Xero-linked customer invoice is pushed and shows the Xero indicator', async ({ revenuePage }) => {
        test.skip(!XERO_CUSTOMER, 'Set REVENUE_XERO_CUSTOMER (e.g. XeroContactTest) to push a test invoice to Xero.');
        const title = newTitle();
        await createEntry(revenuePage, title, XERO_CUSTOMER);
        await revenuePage.raiseInvoiceForEntry();
        await expect(revenuePage.page.getByText(/successfully pushed to Xero/i).first()).toBeVisible({ timeout: 20000 });
        const view = revenuePage.invoiceView();
        await expect(view.locator('img[alt="Connected to Xero"]')).toBeVisible();
        await revenuePage.openInvoiceActionsMenu();
        await expect(revenuePage.page.getByText('View in Xero', { exact: true })).toBeVisible();
        await revenuePage.page.keyboard.press('Escape');
    });
});
