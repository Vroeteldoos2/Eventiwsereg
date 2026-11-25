import { expect } from '@playwright/test';
import { TestHelpers } from '../tests/utils/test-helpers.js';

// Approvals: what is waiting for approval, one page per kind of item. Built on an event URL it is the event's
// Approvals menu; built on an account URL it is the account-wide version (which adds an Event column).
export const APPROVAL_SECTIONS = {
    'budget-entries': ['Status', 'Title', 'Subcategory', 'Supplier', 'Budgeted', 'Committed'],
    'purchase-orders': ['Status', 'Reference', 'Title', 'Subcategory', 'Supplier'],
    'supplier-invoices': ['Invoice #', 'Title', 'Date', 'Due Date', 'Subtotal', 'Total', 'Paid', 'Credit', 'Outstanding'],
    'payruns': ['Title', 'Run Value', 'Payment Date', 'Created', 'Status'],
    'departments': ['Title', 'Subcategories', 'Budget Entries', 'Fixed', 'Budgeted'],
};

export class ApprovalsPage {

    constructor(page, baseUrl) {
        this.page = page;
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.helpers = new TestHelpers(page);
    }

    // section: a key of APPROVAL_SECTIONS. Waits for the list (or its "No data available" message).
    async goto(section) {
        await this.page.goto(`${this.baseUrl}/approvals/${section}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        const emptyState = this.page.getByText('No data available', { exact: true });
        const header = this.page.locator('thead').first();
        await expect(emptyState.or(header)).toBeVisible({ timeout: 30000 });
        if (!await emptyState.isVisible()) {
            await expect(this.page.locator('tbody tr').first()).toBeVisible({ timeout: 30000 });
        }
    }

    // The page's sidebar links under Approvals: { 'Budget Entries': '/approvals', ... }
    async readMenu() {
        return this.page.evaluate(() => Object.fromEntries([...document.querySelectorAll('a[href*="/approvals"]')]
            .map(a => [(a.innerText || a.textContent).trim().replace(/\s+/g, ' '), new URL(a.href).pathname.replace(/^\/account\/\d+/, '')])
            .filter(([name]) => name)));
    }

    async headers() {
        return (await this.page.locator('thead').first().locator('th').allInnerTexts()).map(text => text.trim().replace(/\s+/g, ' ')).filter(Boolean);
    }

    // "[58 items in total]" under the list; 0 when the list is empty.
    async total() {
        const totalLabel = this.page.getByText(/items? in total/).first();
        if (!(await totalLabel.count())) return 0;
        const text = await totalLabel.innerText();
        return Number(text.match(/(\d+) items? in total/)?.[1] ?? 0);
    }

    // Biggest page size offered, so every row is on one page.
    async showAllRows() {
        const perPage = this.page.locator('select').filter({ has: this.page.locator('option', { hasText: /^25$/ }) }).first();
        if (await perPage.count()) {
            const options = await perPage.locator('option').allInnerTexts();
            await perPage.selectOption({ label: options[options.length - 1] });
            await expect(this.page.getByText('Loading Information', { exact: true })).toBeHidden({ timeout: 15000 });
        }
    }

    isEmpty() {
        return this.page.getByText('No data available', { exact: true }).isVisible();
    }

    // Rows as [{ Header: 'cell text' }] — empty when the page says "No data available".
    async readRows() {
        if (await this.isEmpty()) return [];
        await this.showAllRows();
        return this.page.locator('table').first().evaluate(table => {
            const headers = [...table.querySelectorAll(':scope > thead th')].map(th => th.innerText.trim().replace(/\s+/g, ' '));
            return [...table.querySelectorAll(':scope > tbody > tr')].map(tr => {
                const cells = [...tr.children].map(cell => cell.innerText.trim().replace(/\s+/g, ' '));
                return Object.fromEntries(headers.map((header, i) => [header, cells[i] ?? '']).filter(([header]) => header));
            }).filter(row => Object.values(row).some(Boolean));
        });
    }

    money(text) {
        return this.helpers.parseCurrency(text);
    }
}
