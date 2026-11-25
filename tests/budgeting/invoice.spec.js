// invoice.spec.js
// Purchasing — supplier invoices raised against a purchase order
// (Budget Entry > Purchase Orders > the PO > Invoices tab):
//   - Raise an invoice and view it: details, Details / Activity / Purchase Orders / Attachments tabs
//   - Description, unit price and tax rate are calculated correctly, edits made while raising the
//     invoice show in the view, attachments are kept
//   - Xero indicator (coloured when the supplier is linked to Xero, grey when not), publish to Xero
//   - Manage payment dates (edit date / amount / bank / Paid, add new, totals and currency)
//   - Credit note (in the totals, pop-up message, "CR" on the PO's Invoices tab) and delete invoice
// Each test creates its own AutoTest-INV-<n> budget entry + PO and removes it afterwards (invoices,
// PO, entry) unless INVOICE_CLEANUP=0. Runs against INVOICE_EVENT_URL (falls back to BUDGET_EVENT_URL);
// scripts/fullRegression.js points it at the newly created regression event.
import { test, expect } from '../../fixtures/baseTest.js';
import { cleanupWithWarning } from '../utils/test-helpers.js';

const EVENT_URL = (process.env.INVOICE_EVENT_URL || process.env.BUDGET_EVENT_URL || '').replace(/\/$/, '');
// A PO is only created automatically on approval for some subcategories (e.g. "Artist Fees" gets none).
const SUBCATEGORY = process.env.INVOICE_SUBCATEGORY || 'Travel';
// Linked to Xero: invoices are pushed to Xero when created.
const XERO_SUPPLIER = process.env.BUDGET_SUPPLIER;
// Not linked to Xero: invoice view shows the grey "Not connected to Xero" indicator.
const NON_XERO_SUPPLIER = process.env.INVOICE_NON_XERO_SUPPLIER || 'Muddles LTd';
const ENTRY_AMOUNT = Number(process.env.BUDGET_FIXED_COST || 1000);
const CLEANUP = process.env.INVOICE_CLEANUP !== '0';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

let budgetingPage;
const createdEntries = [];

const amountOf = text => Number(text.replace(/[^\d.-]/g, ''));

// "£1,000.00" in some places, "£1000.00" / "£ 1000.00" in others (inputs) — match any of them.
function moneyPattern(value) {
    const [whole, pence] = value.toFixed(2).split('.');
    return new RegExp(`£\\s?${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',?')}\\.${pence}`);
}

async function expectAmount(locator, expected, message) {
    await expect.poll(async () => amountOf(await locator.innerText()), { message }).toBeCloseTo(expected, 2);
}

async function createApprovedPO(page, { supplier = XERO_SUPPLIER } = {}) {
    if (!supplier) throw new Error('No supplier configured (BUDGET_SUPPLIER)');
    const department = await budgetingPage.openDepartmentBudgetEntries(0);
    const entryTitle = `AutoTest-INV-${Date.now()}`;

    await budgetingPage.createBudgetEntry({
        title: entryTitle,
        subcategory: SUBCATEGORY,
        supplier,
        fixedCost: ENTRY_AMOUNT,
        budgetedCost: ENTRY_AMOUNT,
        deptIndex: 0,
    });
    createdEntries.push(entryTitle);

    await budgetingPage.openEntryPopup(entryTitle);
    const entryDrawer = budgetingPage.getDrawer();
    await entryDrawer.getByRole('button', { name: /Request Approval/i }).click();
    await entryDrawer.getByRole('button', { name: /^Approve$/i }).click();
    await expect(entryDrawer.locator('span').filter({ hasText: /^Approved$/i }).first()).toBeVisible();
    await budgetingPage.openTabInPopup('Purchase Orders');
    await expect(
        entryDrawer.locator('tr').filter({ hasText: entryTitle }),
        `Approving a "${SUBCATEGORY}" entry should create a PO — set INVOICE_SUBCATEGORY to a subcategory that does`,
    ).toBeVisible({ timeout: 15000 });
    await budgetingPage.openPOFromPopup(entryTitle);

    const poDrawer = page.locator('.modal-shell').first();
    await poDrawer.getByRole('button', { name: /Request Approval/i }).click();
    await budgetingPage.approvePO();
    await budgetingPage.verifyPOStatus('Approved');
    const poAmount = await poDrawer.getByText(/£[\d,]+\.\d{2}/).first().innerText();
    await budgetingPage.openTabInPO('Invoices');

    return { department, entryTitle, poDrawer, poAmount, supplier };
}

function invoiceForm(page) {
    return page.locator('.m-wrapper').filter({ hasText: 'Raise Purchase Invoice' }).last();
}

function invoicePaymentDialog(page) {
    return page.locator('.m-wrapper').filter({ hasText: 'Invoice Payments' }).last();
}

async function openRaiseInvoiceForm(page, poDrawer, invoiceNumber) {
    await poDrawer.getByRole('button', { name: /raise.+invoice/i }).click();
    const form = invoiceForm(page);
    await expect(form).toBeVisible();
    const invoiceNumberInput = page.locator('dt, label')
        .filter({ hasText: /^\s*Invoice Number\s*$/ })
        .filter({ visible: true })
        .last().locator('xpath=following::input[1]');
    await invoiceNumberInput.fill(invoiceNumber);
    return form;
}

// Opens an invoice row from the PO's Invoices tab and returns its "View Supplier Invoice" modal.
async function openInvoiceView(page, poDrawer, invoiceNumber) {
    const invoiceRow = poDrawer.locator('tr').filter({ hasText: invoiceNumber }).first();
    await expect(invoiceRow).toBeVisible();
    await invoiceRow.locator('button').click();
    const heading = page.getByRole('heading', { name: 'View Supplier Invoice', exact: true });
    await expect(heading).toBeVisible();
    return {
        heading,
        invoiceRow,
        view: heading.locator('xpath=ancestor::div[.//button[normalize-space(.)="Details"]][1]'),
    };
}

// Edits a payment-date row's date through its flatpickr calendar (a day in the current month that
// isn't today); returns the new date as YYYY-MM-DD.
async function setPaymentDate(page, row) {
    const today = new Date();
    const day = today.getDate() === 1 ? 2 : 1;
    await row.locator('input[type="text"]').first().click();
    const calendar = page.locator('.flatpickr-calendar.open');
    await calendar.waitFor({ state: 'visible', timeout: 5000 });
    await calendar.locator(`.flatpickr-day[aria-label="${MONTHS[today.getMonth()]} ${day}, ${today.getFullYear()}"]`).first().click();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    await expect(row.locator('input[type="hidden"]')).toHaveValue(iso);
    return iso;
}

// Raises an invoice for a Xero-linked supplier, credits it in full, then checks the credit note is
// still applied once the invoice has been through the Xero sync (PO > Invoices tab from a fresh load).
// The Xero job has no completion signal after the toast, so the short settling pause remains before
// reopening the invoice list and checking that it is outstanding before the credit note is raised.
// raiseAfterSync delays raising the credit note until the invoice is pushed to Xero.
async function creditNoteOnXeroInvoice(page, { raiseAfterSync }) {
    const { entryTitle, poDrawer } = await createApprovedPO(page);
    const poAmount = amountOf(await poDrawer.getByText(/£[\d,]+\.\d{2}/).first().innerText());
    const creditPattern = new RegExp(`CR\\s*${moneyPattern(poAmount).source}`);
    const invoiceNumber = `INV-${Date.now()}`;
    const form = await openRaiseInvoiceForm(page, poDrawer, invoiceNumber);
    await form.getByRole('button', { name: /^Raise Invoice$/i }).click();
    const payments = invoicePaymentDialog(page);
    await expect(payments).toBeVisible({ timeout: 15000 });
    await payments.getByRole('button', { name: /Save Changes/i }).click();
    await expect(page.getByText('Your invoice has been created successfully')).toBeVisible();

    let invoices = await budgetingPage.openTabInPO('Invoices').then(() => poDrawer);
    if (raiseAfterSync) {
        await test.step('Wait for the invoice to be pushed to Xero', async () => {
            await expect(page.getByText(/successfully pushed to Xero/i).first()).toBeVisible({ timeout: 30000 });
            // The toast confirms submission, not completion of the asynchronous Xero sync.
            await page.waitForTimeout(15000);
            invoices = await budgetingPage.openPOInvoicesForEntry(entryTitle);
            await expectAmount(
                invoices.locator('tr').filter({ hasText: invoiceNumber }).first().locator('td').nth(5),
                poAmount, 'Invoice is still fully outstanding before the credit note');
        });
    }

    const { view } = await openInvoiceView(page, invoices, invoiceNumber);
    await expect(view.locator('img[alt="Connected to Xero"]')).toBeVisible();
    await page.getByRole('link', { name: 'Raise a credit note', exact: true }).click();
    const creditNoteForm = page.locator('.m-wrapper').filter({ hasText: 'Raise Credit Note' }).last();
    await expect(creditNoteForm).toBeVisible();
    await creditNoteForm.getByRole('button', { name: /^Raise Credit Note$/i }).click();
    await expect(creditNoteForm).toBeHidden({ timeout: 20000 });

    await test.step('Credited straight away', async () => {
        await view.getByRole('button', { name: /^Payments\/Credits/ }).click();
        await expect(view.getByRole('row').filter({ hasText: 'Credit Note' }).first()).toContainText(moneyPattern(poAmount));
        await view.getByRole('button', { name: /^Details/ }).click();
        await expect(view.getByRole('row', { name: /^Outstanding/ })).toContainText('£0.00');
    });
    await test.step('Still credited once the Xero sync has run', async () => {
        if (!raiseAfterSync) {
            await expect(page.getByText(/successfully pushed to Xero/i).first()).toBeVisible({ timeout: 30000 });
        }
        // The invoice sync runs as a server-side job with no UI completion indicator to wait on.
        await page.waitForTimeout(20000);
        const revisited = await budgetingPage.openPOInvoicesForEntry(entryTitle);
        const row = revisited.locator('tr').filter({ hasText: invoiceNumber }).first();
        await expect(row.locator('td').nth(4), 'Credit note dropped after the Xero sync').toContainText(creditPattern);
        await expectAmount(row.locator('td').nth(5), 0, 'Outstanding stays nil after the Xero sync');
    });
}

test.describe('Purchase supplier invoices', () => {
    test.beforeEach(async ({ page, budgetingPage: fixture }) => {
        if (!EVENT_URL) throw new Error('INVOICE_EVENT_URL / BUDGET_EVENT_URL is not set');
        test.setTimeout(420000);
        budgetingPage = fixture;
        budgetingPage.eventBaseUrl = EVENT_URL;
        await budgetingPage.gotoBudgetSummaryPage();
        await budgetingPage.selectBudgetVersion('A');
        await budgetingPage.expandAllSections();
    });

    test.afterEach(async () => {
        const titles = createdEntries.splice(0);
        if (!CLEANUP) return;
        for (const title of titles) {
            await cleanupWithWarning(`budget entry ${title}`, () => budgetingPage.deleteEntryWithPurchaseOrder(title));
        }
    });

    test('raises an invoice with PO details and verifies supplier and invoice values', async ({ page }) => {
        const { entryTitle, poDrawer, poAmount, supplier } = await createApprovedPO(page);
        const invoiceNumber = `INV-${Date.now()}`;
        const form = await openRaiseInvoiceForm(page, poDrawer, invoiceNumber);
        const text = await form.innerText();
        const poNumber = await poDrawer.getByText(/^(?:PO|EW)\d+$/).innerText();
        const sourceAmount = amountOf(poAmount);

        const invoiceTitle = page.locator('dt, label')
            .filter({ hasText: /^\s*Invoice Title\s*$/ })
            .filter({ visible: true })
            .last().locator('xpath=following::input[1]');
        await expect(invoiceTitle).toHaveValue(entryTitle);
        const poInvoiceRow = form.getByRole('row').filter({ hasText: poNumber });
        await expect(poInvoiceRow.locator('td').nth(0)).toHaveText(poNumber);
        await expect(poInvoiceRow.locator('td').nth(1).getByRole('textbox')).toHaveValue(entryTitle);
        await expectAmount(poInvoiceRow.locator('td').nth(3), sourceAmount, 'Unit price copied from the PO');
        await expect(poInvoiceRow.locator('td').nth(4)).toContainText('None');
        await expect(poInvoiceRow.locator('td').nth(5)).toContainText(poAmount);
        await expect(poInvoiceRow.locator('td').nth(6)).toContainText(poAmount);
        expect(text).toContain('Invoice Date');
        expect(text).toContain('Due Date');
        expect(text).toContain(poNumber);
        expect(text).toContain('Description');
        expect(text).toContain('Unit Price');
        expect(text).toContain('Total');
        await expect(form.getByText(supplier, { exact: true })).toBeVisible();
        expect(text).toContain(poAmount);

        const invoiceDate = page.locator('dt, label').filter({ hasText: /^\s*Invoice Date\s*$/ })
            .filter({ visible: true }).last().locator('xpath=following::input[1]');
        const dueDate = page.locator('dt, label').filter({ hasText: /^\s*Due Date\s*$/ })
            .filter({ visible: true }).last().locator('xpath=following::input[1]');
        const invoiceDateValue = await invoiceDate.inputValue();
        expect(invoiceDateValue).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(await dueDate.inputValue()).toMatch(/^\d{4}-\d{2}-\d{2}$/);

        const withholdingCheckbox = form.locator('input[type="checkbox"]').last();
        const withholdingAvailable = await withholdingCheckbox.count() > 0;
        let invoiceAmount = sourceAmount;
        if (withholdingAvailable) {
            await expect(withholdingCheckbox).not.toBeChecked();
            await withholdingCheckbox.check();
            await expect(withholdingCheckbox).toBeChecked();
            invoiceAmount *= 0.9;
            expect(await form.innerText()).toContain(`£${invoiceAmount.toFixed(2)}`);
        }
        const invoiceAmountText = `£${invoiceAmount.toFixed(2)}`;
        const xeroConnected = await poDrawer.locator('[title="Connected to Xero"], img[alt="Connected to Xero"]').count() > 0;

        await form.getByRole('button', { name: /^Raise Invoice$/i }).click();
        const payments = invoicePaymentDialog(page);
        await expect(payments).toBeVisible({ timeout: 15000 });
        await expect(payments.getByText('Invoice Value', { exact: true })).toBeVisible();
        await expect(payments.getByText('Total Payments', { exact: true })).toBeVisible();
        await expect(payments.getByText(invoiceAmountText, { exact: true })).toBeVisible();
        await expect(payments.getByText('£0.00', { exact: true })).toBeVisible();
        await payments.getByRole('button', { name: /New payment date/i }).click();
        const paymentRow = payments.locator('table.payment-dates-table tbody tr').last();
        const paymentDate = paymentRow.locator('input[type="hidden"]');
        const paymentAmount = paymentRow.locator('input[type="number"]');
        const bankAccount = paymentRow.locator('select');
        const paid = paymentRow.getByRole('checkbox');
        expect(await paymentDate.inputValue()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        await expect(paymentAmount).toHaveValue(invoiceAmount.toFixed(2));
        const bankAccounts = await bankAccount.locator('option').evaluateAll(options =>
            options
                .filter(option => option.value && !option.disabled)
                .map(option => ({ value: option.value, label: option.label })),
        );
        if (bankAccounts.length > 0) {
            await bankAccount.selectOption(bankAccounts[0].value);
            await expect(bankAccount).toHaveValue(bankAccounts[0].value);
            await expect(paymentRow.locator('select option:checked')).toHaveText(bankAccounts[0].label);
        }
        await paymentAmount.fill('100.00');
        await paid.check();
        await expect(paid).toBeChecked();
        await expect(payments.locator('dl').filter({ hasText: 'Total Payments' })).toContainText('£100.00');
        await payments.getByRole('button', { name: /Save Changes/i }).click();
        await expect(page.getByText('Your invoice has been created successfully')).toBeVisible();
        if (xeroConnected) {
            await expect(page.getByText(/Xero Invoice Generated/i)).toBeVisible();
            await expect(page.getByText(/successfully pushed to Xero/i)).toBeVisible();
        }

        await budgetingPage.openTabInPO('Invoices');
        const invoiceRow = poDrawer.locator('tr').filter({ hasText: invoiceNumber }).first();
        await expect(invoiceRow).toBeVisible();
        const [year, month, day] = invoiceDateValue.split('-');
        await expect(invoiceRow).toContainText(`${day}/${month}/${year}`);
        await expect(invoiceRow.locator('td').nth(2)).toContainText(invoiceAmountText);
        await expect(invoiceRow.locator('td').nth(3)).toContainText('£0.00');
        await expect(invoiceRow.locator('td').nth(4)).toContainText(invoiceAmountText);
        await expect(invoiceRow.locator('td').nth(5)).toContainText(invoiceAmountText);
        await expect(invoiceRow.locator('button')).toHaveCount(1);
        await expect(invoiceRow.locator('i.mdi-eye')).toBeVisible();
        const { heading: invoiceViewHeading, view: invoiceView } = await openInvoiceView(page, poDrawer, invoiceNumber);
        await expect(invoiceView.getByRole('heading', { name: entryTitle, exact: true })).toBeVisible();
        await expect(invoiceView.getByRole('heading', { name: invoiceNumber, exact: true })).toBeVisible();
        await expect(invoiceView.getByText(supplier, { exact: true })).toBeVisible();
        if (xeroConnected) {
            // Coloured Xero indicator: the supplier is linked to a Xero contact.
            await expect(invoiceView.locator('img[alt="Connected to Xero"]')).toBeVisible();
        }
        if (withholdingAvailable) {
            await expect(invoiceView.getByRole('row', { name: /Withholding Tax/ }))
                .toContainText(`-£${(sourceAmount - invoiceAmount).toFixed(2)}`);
        }
        await expect(invoiceView.getByRole('row', { name: /^Subtotal/ })).toContainText(invoiceAmountText);
        await expect(invoiceView.getByRole('row', { name: /^Total/ })).toContainText(invoiceAmountText);

        for (const tabName of ['Details', 'Payments/Credits', 'Activity', 'Purchase Orders', 'Attachments']) {
            await expect(invoiceView.getByRole('button', { name: new RegExp(`^${tabName}`) })).toBeVisible();
        }

        await invoiceView.getByRole('button', { name: /^Activity/ }).click();
        await expect(invoiceView.getByText(new RegExp(`Supplier invoice ${invoiceNumber} created`))).toBeVisible();
        await invoiceView.getByRole('button', { name: /^Purchase Orders/ }).click();
        await expect(invoiceView.getByRole('row').filter({ hasText: entryTitle })).toBeVisible();
        await invoiceView.getByRole('button', { name: /^Attachments/ }).click();

        await test.step('Manage payment dates: edit date / amount, add a new date, totals and currency', async () => {
            await page.getByRole('link', { name: 'Manage payment dates', exact: true }).click();
            const managedPayments = invoicePaymentDialog(page);
            await expect(managedPayments).toBeVisible();
            const total = managedPayments.locator('dl').filter({ hasText: 'Total Payments' });
            // Currency: invoice value and payments are shown in pounds.
            await expect(managedPayments.locator('dl').filter({ hasText: 'Invoice Value' })).toContainText(invoiceAmountText);
            await expect(total).toContainText('£100.00');

            const paymentRows = managedPayments.locator('table.payment-dates-table tbody tr');
            await expect(paymentRows).toHaveCount(1);
            const existingPayment = paymentRows.first();
            const existingAmount = existingPayment.locator('input[type="number"]');
            await expect(existingAmount).toHaveValue('100.00');
            if (bankAccounts.length > 0) {
                await expect(existingPayment.locator('select')).toHaveValue(bankAccounts[0].value);
            }
            await expect(existingPayment.getByRole('checkbox')).toBeChecked();
            await expect(existingPayment.locator('input[type="hidden"]')).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);

            // Edit the existing payment's date and amount …
            const editedDate = await setPaymentDate(page, existingPayment);
            await existingAmount.fill('110.00');
            // … and add a new payment date.
            await managedPayments.getByRole('button', { name: /New payment date/i }).click();
            const addedPayment = paymentRows.last();
            await expect(paymentRows).toHaveCount(2);
            const addedDate = await addedPayment.locator('input[type="hidden"]').inputValue();
            await addedPayment.locator('input[type="number"]').fill('25.00');
            await expect(total).toContainText('£135.00');
            await expect(addedPayment.getByRole('checkbox')).not.toBeChecked();
            await managedPayments.getByRole('button', { name: /Save Changes/i }).click();
            await expect(managedPayments).toBeHidden({ timeout: 15000 });

            // The changes persisted.
            await page.getByRole('link', { name: 'Manage payment dates', exact: true }).click();
            await expect(managedPayments).toBeVisible();
            await expect(paymentRows).toHaveCount(2);
            const saved = await paymentRows.evaluateAll(rows => rows.map(row => ({
                date: row.querySelector('input[type="hidden"]')?.value,
                amount: row.querySelector('input[type="number"]')?.value,
                paid: row.querySelector('input[type="checkbox"]')?.checked,
            })));
            expect(saved).toEqual(expect.arrayContaining([
                { date: editedDate, amount: '110.00', paid: true },
                { date: addedDate, amount: '25.00', paid: false },
            ]));
            await expect(total).toContainText('£135.00');
            await managedPayments.getByRole('button', { name: 'Cancel', exact: true }).click();
        });
        await invoiceViewHeading.locator('xpath=..').getByRole('button').click();
    });

    test('taxed invoice: description, unit price and tax rate are calculated and shown correctly across the PO and invoice tabs', async ({ page }) => {
        const { entryTitle, poDrawer, supplier } = await createApprovedPO(page, { supplier: NON_XERO_SUPPLIER });
        const invoiceNumber = `INV-${Date.now()}`;
        const form = await openRaiseInvoiceForm(page, poDrawer, invoiceNumber);
        const poNumber = await poDrawer.getByText(/^(?:PO|EW)\d+$/).innerText();
        const description = `Travel costs ${Math.floor(1000 + Math.random() * 9000)}`;
        const fileName = `auto-test-attachment-${Date.now()}.txt`;
        const quantity = 2;
        const unitPrice = 300;
        const net = quantity * unitPrice;
        const tax = net * 0.2;
        const total = net + tax;
        const line = form.getByRole('row').filter({ hasText: poNumber });

        await test.step('Edit the invoice line: description, quantity, unit price and tax rate', async () => {
            await expect(line.locator('textarea')).toHaveValue(entryTitle);     // description defaults to the entry title
            await line.locator('textarea').fill(description);
            const quantityCell = line.locator('td').nth(2).locator('[contenteditable="true"]');
            await quantityCell.click({ clickCount: 3 });
            await page.keyboard.type(String(quantity));
            const unitPriceCell = line.locator('td').nth(3).locator('[contenteditable="true"]');
            await unitPriceCell.click({ clickCount: 3 });
            await page.keyboard.type(String(unitPrice));
            await line.locator('td').nth(4).locator('button').click();
            await page.locator('.v-popper__popper--shown').last().getByText(/^20%/).first().click();

            await expectAmount(line.locator('td').nth(5), net, 'Line subtotal = quantity × unit price');
            await expectAmount(line.locator('td').nth(6), total, 'Line total = subtotal + 20% tax');
            await expect(line.locator('input[type="number"]')).toHaveValue(String(total));
            await expect(form).toContainText('British Pound (GBP)');
        });

        await test.step('Attach a document', async () => {
            await form.locator('input[type="file"]').setInputFiles({ name: fileName, mimeType: 'text/plain', buffer: Buffer.from('automation attachment') });
            await expect(form.getByText(fileName).first()).toBeVisible();   // listed twice: name + badge
        });

        await form.getByRole('button', { name: /^Raise Invoice$/i }).click();
        const payments = invoicePaymentDialog(page);
        await expect(payments).toBeVisible({ timeout: 15000 });
        await expect(payments.locator('dl').filter({ hasText: 'Invoice Value' })).toContainText(moneyPattern(total));
        await payments.getByRole('button', { name: /Save Changes/i }).click();
        await expect(page.getByText('Your invoice has been created successfully')).toBeVisible();

        await test.step("The PO's Invoices tab shows the edited amounts", async () => {
            await budgetingPage.openTabInPO('Invoices');
            const invoiceRow = poDrawer.locator('tr').filter({ hasText: invoiceNumber }).first();
            await expect(invoiceRow).toBeVisible();
            await expectAmount(invoiceRow.locator('td').nth(2), net, 'Subtotal');
            await expectAmount(invoiceRow.locator('td').nth(3), tax, 'Tax');
            await expectAmount(invoiceRow.locator('td').nth(4), total, 'Total');
            await expectAmount(invoiceRow.locator('td').nth(5), total, 'Outstanding');
        });

        const { view } = await openInvoiceView(page, poDrawer, invoiceNumber);
        await test.step('Details tab: description, unit price, tax rate and totals', async () => {
            await expect(view.getByRole('heading', { name: entryTitle, exact: true })).toBeVisible();
            await expect(view.getByRole('heading', { name: invoiceNumber, exact: true })).toBeVisible();
            await expect(view.getByText(supplier, { exact: true })).toBeVisible();
            const detailLine = view.getByRole('row').filter({ hasText: description });
            await expect(detailLine).toContainText(moneyPattern(unitPrice));
            await expect(detailLine).toContainText('20%');
            await expect(detailLine).toContainText(moneyPattern(net));
            await expect(view.getByRole('row', { name: /^Subtotal/ })).toContainText(moneyPattern(net));
            await expect(view.getByRole('row', { name: /^Tax/ })).toContainText(moneyPattern(tax));
            await expect(view.getByRole('row', { name: /^Total/ })).toContainText(moneyPattern(total));
            await expect(view.getByRole('row', { name: /^Outstanding/ })).toContainText(moneyPattern(total));
        });

        await test.step('Xero indicator is grey for a supplier that is not linked to a Xero contact', async () => {
            await expect(view.locator('img[alt="Not connected to Xero"]')).toBeVisible();
            await expect(view.locator('img[alt="Connected to Xero"]')).toHaveCount(0);
        });

        await test.step('Activity, Purchase Orders and Attachments tabs', async () => {
            await view.getByRole('button', { name: /^Activity/ }).click();
            await expect(view.getByText(`Supplier invoice ${invoiceNumber} created`)).toBeVisible();
            await expect(view.getByText('Added an attachment')).toBeVisible();
            await expect(view.getByText(fileName).first()).toBeVisible();
            await view.getByRole('button', { name: /^Purchase Orders/ }).click();
            const poLine = view.getByRole('row').filter({ hasText: entryTitle });
            await expect(poLine).toContainText(poNumber);
            await expect(poLine).toContainText(moneyPattern(ENTRY_AMOUNT));
            await view.getByRole('button', { name: /^Attachments/ }).click();
            // The file list entry (an activity note naming the file is rendered as well).
            await expect(view.locator('span').filter({ hasText: fileName }).first()).toBeVisible();
        });
    });

    test('creates a credit note and verifies it against the invoice', async ({ page }) => {
        // Non-Xero supplier: for a Xero-linked supplier the credit note is dropped again once the
        // Xero push completes (see the "kept after the Xero sync" test below).
        const { entryTitle, poDrawer, supplier } = await createApprovedPO(page, { supplier: NON_XERO_SUPPLIER });
        const invoiceNumber = `INV-${Date.now()}`;
        const form = await openRaiseInvoiceForm(page, poDrawer, invoiceNumber);
        const poNumber = await poDrawer.getByText(/^(?:PO|EW)\d+$/).innerText();
        const poAmount = await poDrawer.getByText(/£[\d,]+\.\d{2}/).first().innerText();
        const creditAmount = amountOf(poAmount);

        const sourceLine = form.getByRole('row').filter({ hasText: poNumber });
        await expect(sourceLine.locator('td').nth(1).getByRole('textbox')).toHaveValue(entryTitle);
        await expectAmount(sourceLine.locator('td').nth(3), creditAmount, 'Unit price copied from the PO');
        await form.getByRole('button', { name: /^Raise Invoice$/i }).click();

        const payments = invoicePaymentDialog(page);
        await expect(payments).toBeVisible({ timeout: 15000 });
        await payments.getByRole('button', { name: /Save Changes/i }).click();
        await expect(page.getByText('Your invoice has been created successfully')).toBeVisible();

        await budgetingPage.openTabInPO('Invoices');
        const { heading: invoiceViewHeading, view: invoiceView } = await openInvoiceView(page, poDrawer, invoiceNumber);
        await expect(invoiceView.getByRole('heading', { name: entryTitle, exact: true })).toBeVisible();
        await expect(invoiceView.getByRole('heading', { name: invoiceNumber, exact: true })).toBeVisible();
        await expect(invoiceView.getByText(supplier, { exact: true })).toBeVisible();

        await page.getByRole('link', { name: 'Raise a credit note', exact: true }).click();
        const creditNoteForm = page.locator('.m-wrapper').filter({ hasText: 'Raise Credit Note' }).last();
        await expect(creditNoteForm).toBeVisible();
        await expect(creditNoteForm.locator('textarea[name="description"]')).toHaveValue(
            new RegExp(`Credit note for supplier invoice #${invoiceNumber}`),
        );
        await expect(creditNoteForm.locator('select').first()).toHaveValue('GBP');
        const creditNoteLine = creditNoteForm.getByRole('row').filter({ hasText: entryTitle });
        await expect(creditNoteLine).toContainText(moneyPattern(creditAmount));
        await creditNoteForm.getByRole('button', { name: /^Raise Credit Note$/i }).click();
        await expect(creditNoteForm).toBeHidden({ timeout: 15000 });
        await expect(page.locator('div.toast-success').filter({ hasText: /credit note/i }).first()).toBeVisible();

        await invoiceView.getByRole('button', { name: /^Payments\/Credits/ }).click();
        const creditRow = invoiceView.getByRole('row').filter({ hasText: 'Credit Note' });
        await expect(creditRow.first()).toBeVisible();
        await expect(creditRow.first()).toContainText(moneyPattern(creditAmount));
        await invoiceView.getByRole('button', { name: /^Details/ }).click();
        await expect(invoiceView.getByRole('row', { name: /^Less Payments\/Credits/ }))
            .toContainText(moneyPattern(creditAmount));
        await expect(invoiceView.getByRole('row', { name: /^Outstanding/ })).toContainText('£0.00');

        await invoiceViewHeading.locator('xpath=..').getByRole('button').click();

        await test.step("The PO's Invoices tab shows the credit note (\"CR\") next to the total", async () => {
            // The list behind the modal doesn't refresh by itself — note it, then revisit the tab.
            const liveRow = poDrawer.locator('tr').filter({ hasText: invoiceNumber }).first();
            if (!/CR/.test(await liveRow.innerText())) {
                test.info().annotations.push({
                    type: 'known-issue',
                    description: "PO > Invoices tab doesn't show the credit note until the page is reloaded",
                });
            }
            const revisited = await budgetingPage.openPOInvoicesForEntry(entryTitle);
            const revisitedRow = revisited.locator('tr').filter({ hasText: invoiceNumber }).first();
            await expect(revisitedRow).toBeVisible();
            await expect(revisitedRow.locator('td').nth(4)).toContainText(new RegExp(`CR\\s*${moneyPattern(creditAmount).source}`));
            await expectAmount(revisitedRow.locator('td').nth(5), 0, 'Outstanding is nil once credited');
        });
    });

    // KNOWN ISSUE (reported to the developers): for a supplier linked to Xero, a credit note raised
    // right after the invoice is created — while the Xero push is still running — is applied at first,
    // then lost about 10-25 s later: the invoice goes back to its full outstanding amount and its
    // Payments/Credits tab disappears. The first test below fails until that is fixed. A credit note
    // raised once the push has finished (second test) is kept.
    test('credit note on a Xero-linked supplier invoice is kept after the Xero sync', async ({ page }) => {
        test.fail(true, 'Known bug: Xero sync drops a credit note raised while the sync is running - ClickUp: TODO');
        await creditNoteOnXeroInvoice(page, { raiseAfterSync: false });
    });

    test('credit note raised after the invoice has synced to Xero is kept', async ({ page }) => {
        await creditNoteOnXeroInvoice(page, { raiseAfterSync: true });
    });

    test('publishes a supplier invoice to Xero for a linked supplier', async ({ page }) => {
        test.skip(
            !process.env.BUDGET_XERO_SUPPLIER,
            'Set BUDGET_XERO_SUPPLIER to a supplier linked to Xero in the regression account.',
        );
        const { poDrawer, supplier } = await createApprovedPO(page, {
            supplier: process.env.BUDGET_XERO_SUPPLIER,
        });
        const xeroIndicator = poDrawer.locator('[title="Connected to Xero"], img[alt="Connected to Xero"]');
        await expect(xeroIndicator).toBeVisible();

        const invoiceNumber = `INV-${Date.now()}`;
        const form = await openRaiseInvoiceForm(page, poDrawer, invoiceNumber);
        await expect(form.getByText(supplier, { exact: true })).toBeVisible();
        await form.getByRole('button', { name: /^Raise Invoice$/i }).click();
        const payments = invoicePaymentDialog(page);
        await expect(payments).toBeVisible({ timeout: 15000 });
        await payments.getByRole('button', { name: /Save Changes/i }).click();

        await expect(page.getByText('Your invoice has been created successfully')).toBeVisible();
        await expect(page.getByText(/Xero Invoice Generated/i)).toBeVisible();
        await expect(page.getByText(/successfully pushed to Xero/i)).toBeVisible();
        await budgetingPage.openTabInPO('Invoices');
        const { view: invoiceView } = await openInvoiceView(page, poDrawer, invoiceNumber);
        await expect(invoiceView.locator('img[alt="Connected to Xero"]')).toBeVisible();
        await expect(invoiceView.getByRole('link', { name: 'View in Xero', exact: true }))
            .toHaveAttribute('href', /go\.xero\.com\/.*InvoiceID=/);
    });

    test('deletes an unpaid supplier invoice', async ({ page }) => {
        const { entryTitle, poDrawer } = await createApprovedPO(page);
        const invoiceNumber = `INV-${Date.now()}`;
        const form = await openRaiseInvoiceForm(page, poDrawer, invoiceNumber);
        await form.getByRole('button', { name: /^Raise Invoice$/i }).click();

        const payments = invoicePaymentDialog(page);
        await expect(payments).toBeVisible({ timeout: 15000 });
        await payments.getByRole('button', { name: /Save Changes/i }).click();
        await expect(page.getByText('Your invoice has been created successfully')).toBeVisible();

        await budgetingPage.openTabInPO('Invoices');
        const { invoiceRow } = await openInvoiceView(page, poDrawer, invoiceNumber);

        expect(await budgetingPage.deleteOpenSupplierInvoice(), 'Invoice deleted').toBe(204);

        await test.step("The PO's Invoices tab no longer lists the invoice", async () => {
            // The list behind the modal doesn't refresh by itself; check its current state, then revisit the tab.
            if (await invoiceRow.isVisible()) {
                test.info().annotations.push({
                    type: 'known-issue',
                    description: "PO > Invoices tab still lists a deleted invoice until the page is reloaded",
                });
            }
            const revisited = await budgetingPage.openPOInvoicesForEntry(entryTitle);
            await expect(revisited.locator('tr').filter({ hasText: invoiceNumber })).toHaveCount(0);
            await expect(revisited).toContainText('No data available');
        });
    });
});
