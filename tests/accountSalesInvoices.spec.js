import { test, expect } from '../fixtures/baseTest.js';
import { regressionAccountUrl } from '../pages/accountConfig.js';

const SALES_INVOICES_URL = `${regressionAccountUrl}/entries/sales-invoices`;

function invoiceRows(page) {
    return page.locator('table tbody tr');
}

function invoiceNumber(row) {
    return row.locator('td').first().getByRole('button');
}

test.describe('Account Sales Invoices', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(SALES_INVOICES_URL);
        await page.waitForLoadState('networkidle');
        await expect(page.getByRole('heading', { name: 'Sales Invoices', exact: true }))
            .toBeVisible();
    });

    test('shows invoice totals, status tabs, and the invoice table', async ({ page }) => {
        await expect(page.getByText('Total Outstanding', { exact: true })).toBeVisible();
        await expect(page.getByText('Overdue', { exact: true }).first()).toBeVisible();
        await expect(page.getByText('Invoiced This Month', { exact: true })).toBeVisible();
        await expect(page.getByText('Paid This Month', { exact: true })).toBeVisible();
        await expect(page.locator('table thead')).toContainText('Invoice #');
        await expect(page.locator('table thead')).toContainText('Outstanding');
        await expect(invoiceRows(page).first()).toBeVisible();
    });

    test('Outstanding tab excludes paid invoices', async ({ page }) => {
        await page.getByRole('button', { name: /^Outstanding\b/ }).click();

        const rows = invoiceRows(page);
        await expect(rows.first()).toBeVisible();
        for (let i = 0; i < await rows.count(); i++) {
            await expect(rows.nth(i).locator('td').nth(11)).not.toHaveText('Paid');
        }
    });

    test('Paid tab shows only paid invoices', async ({ page }) => {
        await page.getByRole('button', { name: /^Paid\b/ }).click();

        const rows = invoiceRows(page);
        await expect(rows.first()).toBeVisible();
        for (let i = 0; i < await rows.count(); i++) {
            await expect(rows.nth(i).locator('td').nth(11)).toHaveText('Paid');
        }
    });

    test('search finds an invoice by its invoice number', async ({ page }) => {
        const targetInvoice = (await invoiceNumber(invoiceRows(page).first()).innerText()).trim();
        await page.getByPlaceholder('Search invoices, clients, events...').fill(targetInvoice);

        const rows = invoiceRows(page);
        await expect(rows).toHaveCount(1);
        await expect(invoiceNumber(rows.first())).toHaveText(targetInvoice);
    });

    test('status filter shows only overdue invoices', async ({ page }) => {
        await page.getByRole('button', { name: /Filters/ }).click();
        await page.getByLabel('Overdue', { exact: true }).check();

        const rows = invoiceRows(page);
        await expect(rows.first()).toBeVisible();
        for (let i = 0; i < await rows.count(); i++) {
            await expect(rows.nth(i).locator('td').nth(11)).toHaveText('Overdue');
        }
    });

    test('sorts invoices by highest value first', async ({ page }) => {
        await page.getByRole('button', { name: /Filters/ }).click();
        await page.locator('select').first().selectOption({ label: 'Value (highest first)' });

        const rows = invoiceRows(page);
        await expect(rows.first()).toBeVisible();
        const values = [];
        for (let i = 0; i < await rows.count(); i++) {
            const text = await rows.nth(i).locator('td').nth(7).innerText();
            values.push(Number(text.replace(/[^\d.-]/g, '')));
        }

        expect(values.length).toBeGreaterThan(1);
        for (let i = 1; i < values.length; i++) {
            expect(values[i - 1]).toBeGreaterThanOrEqual(values[i]);
        }
    });

    test('can increase the invoice page size', async ({ page }) => {
        const pageSizeSelect = page.locator('select').filter({
            has: page.locator('option[value="25"]'),
        });
        await pageSizeSelect.selectOption('25');

        await expect(invoiceRows(page)).toHaveCount(25);
    });

    test('opens invoice details for the selected invoice', async ({ page }) => {
        const selectedInvoice = (await invoiceNumber(invoiceRows(page).first()).innerText()).trim();
        await invoiceNumber(invoiceRows(page).first()).click();

        await expect(page.getByText('View Customer Invoice', { exact: true })).toBeVisible();
        await expect(page.getByText(selectedInvoice, { exact: true }).last()).toBeVisible();
        await expect(page.getByText('Actions', { exact: true })).toBeVisible();
    });

    test('downloads the PDF after viewing an invoice', async ({ page }) => {
        await invoiceNumber(invoiceRows(page).first()).click();
        await expect(page.getByText('View Customer Invoice', { exact: true })).toBeVisible();

        await page.getByText('Actions', { exact: true }).click();
        const downloadAction = page.getByText('Download invoice (PDF)', { exact: true });
        await expect(downloadAction).toBeVisible();

        const [download] = await Promise.all([
            page.waitForEvent('download'),
            downloadAction.click(),
        ]);

        expect(download.suggestedFilename()).toMatch(/^sales_invoice_.*\.pdf$/i);
        expect(await download.path()).toBeTruthy();
    });
});
