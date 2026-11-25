// approvals.spec.js
// Event > Approvals (the event's own Approvals menu): Budget Entries, Purchase Orders, Supplier Invoices, Payruns and Departments.
//   - every section opens with its columns, and lists as many rows as its total says
//   - a budget entry shows up under Departments (draft), Budget Entries (awaiting approval) and then, once the entry
//     is approved, its purchase order shows up under Purchase Orders (awaiting approval) — with the right details
//   - Payruns awaiting approval match the payruns on their event; Supplier Invoices figures add up
// The entry / PO test creates an AutoTest-APR-<n> budget entry on APPROVALS_EVENT_URL (falls back to
// PURCHASING_EVENT_URL / INVOICE_EVENT_URL / BUDGET_EVENT_URL) and removes it afterwards. Nothing is approved or
// rejected other than that entry.
import { test, expect } from '../../fixtures/baseTest.js';
import { ApprovalsPage, APPROVAL_SECTIONS } from '../../pages/approvalsPage.js';

const EVENT_URL = (process.env.APPROVALS_EVENT_URL || process.env.PURCHASING_EVENT_URL || process.env.INVOICE_EVENT_URL || process.env.BUDGET_EVENT_URL || '').replace(/\/$/, '');
const ACCOUNT_URL = EVENT_URL.replace(/\/event\/\d+$/, '');
const SUBCATEGORY = process.env.APPROVALS_SUBCATEGORY || 'Travel';
const SUPPLIER = process.env.APPROVALS_SUPPLIER || 'Muddles LTd';
const ENTRY_AMOUNT = 120;
const CLEANUP = process.env.APPROVALS_CLEANUP !== '0';

let budgetingPage;
let approvals;
const createdEntries = [];

const near = (actual, expected, message) => expect(actual, message).toBeCloseTo(expected, 2);

test.describe('Approvals', () => {
    test.beforeEach(async ({ page, budgetingPage: budgeting }) => {
        if (!EVENT_URL) throw new Error('APPROVALS_EVENT_URL / PURCHASING_EVENT_URL / INVOICE_EVENT_URL / BUDGET_EVENT_URL is not set');
        test.setTimeout(420000);
        budgetingPage = budgeting;
        budgetingPage.eventBaseUrl = EVENT_URL;
        approvals = new ApprovalsPage(page, EVENT_URL);
    });

    test.afterEach(async () => {
        const titles = createdEntries.splice(0);
        if (!CLEANUP) return;
        for (const title of titles) {
            await budgetingPage.deleteEntryWithPurchaseOrder(title);
        }
    });

    test('Approvals menu lists the five sections, and each opens with its columns and all of its rows', async ({ page }) => {
        await approvals.goto('budget-entries');
        const menu = await approvals.readMenu();
        for (const name of ['Budget Entries', 'Purchase Orders', 'Supplier Invoices', 'Payruns', 'Departments']) {
            expect(Object.keys(menu), `Approvals menu has ${name}`).toContain(name);
        }

        for (const [section, columns] of Object.entries(APPROVAL_SECTIONS)) {
            await test.step(section, async () => {
                await approvals.goto(section);
                const headers = await approvals.headers();
                for (const column of columns) expect(headers, `${section}: column ${column}`).toContain(column);
                const rows = await approvals.readRows();
                const total = await approvals.total();
                if (total) expect(rows.length, `${section}: rows listed = items in total`).toBe(total);
                for (const row of rows) {
                    expect(Object.values(row).filter(Boolean).length, `${section}: row has data`).toBeGreaterThan(2);
                }
                console.log(`📋 ${section}: ${rows.length} row(s)`);
            });
        }
    });

    test('A budget entry shows under Budget Entries, Departments and then Purchase Orders as it goes through approval', async ({ page }) => {
        await budgetingPage.gotoBudgetSummaryPage();
        const eventName = (await page.locator('body').innerText()).split('\n')[1].trim();
        await budgetingPage.selectBudgetVersion('A');
        await budgetingPage.expandAllSections();

        await approvals.goto('departments');
        const departmentsBefore = await approvals.readRows();
        await approvals.goto('budget-entries');
        const entriesBefore = await approvals.total();
        await approvals.goto('purchase-orders');
        const ordersBefore = await approvals.total();

        await budgetingPage.gotoBudgetSummaryPage();
        await budgetingPage.selectBudgetVersion('A');
        await budgetingPage.expandAllSections();
        const department = await budgetingPage.openDepartmentBudgetEntries(0);
        const entryTitle = `AutoTest-APR-${Date.now()}`;
        await budgetingPage.createBudgetEntry({
            title: entryTitle, subcategory: SUBCATEGORY, supplier: SUPPLIER,
            fixedCost: ENTRY_AMOUNT, budgetedCost: ENTRY_AMOUNT, deptIndex: 0,
        });
        createdEntries.push(entryTitle);
        console.log(`📂 ${department}: ${entryTitle}`);

        await test.step('Budget Entries: once approval is requested the entry is listed as awaiting approval', async () => {
            await budgetingPage.openEntryPopup(entryTitle);
            const drawer = budgetingPage.getDrawer();
            await drawer.getByRole('button', { name: /Request Approval/i }).click();
            await expect(drawer.getByRole('button', { name: /^Approve$/i })).toBeVisible({ timeout: 15000 });

            await approvals.goto('budget-entries');
            expect(await approvals.total(), 'Items in total').toBe(entriesBefore + 1);
            const row = (await approvals.readRows()).find(r => r.Title === entryTitle);
            expect(row, `${entryTitle} listed`).toBeTruthy();
            expect(row.Status).toBe('Awaiting Approval');
            expect(row.Subcategory).toContain(SUBCATEGORY);
            expect(row.Supplier).toContain(SUPPLIER);
            near(approvals.money(row.Budgeted), ENTRY_AMOUNT, 'Budgeted');
            near(approvals.money(row.Committed), 0, 'Committed');
        });

        await test.step('Departments: the department of the entry lists one more entry awaiting approval, with its fixed and budgeted amounts', async () => {
            await approvals.goto('departments');
            const before = departmentsBefore.find(row => row.Title.startsWith(department));
            const after = (await approvals.readRows()).find(row => row.Title.startsWith(department));
            expect(after, `${department} listed under Departments`).toBeTruthy();
            expect(Number(after['Budget Entries']), 'Budget Entries').toBe(Number(before?.['Budget Entries'] ?? 0) + 1);
            near(approvals.money(after.Fixed), approvals.money(before?.Fixed ?? '') + ENTRY_AMOUNT, 'Fixed');
            near(approvals.money(after.Budgeted), approvals.money(before?.Budgeted ?? '') + ENTRY_AMOUNT, 'Budgeted');
        });

        await test.step('Approving the entry takes it off Budget Entries', async () => {
            expect(await budgetingPage.openCostEntryByTitle(entryTitle, { deptIndex: 0 })).toBeTruthy();
            const drawer = budgetingPage.getDrawer();
            await drawer.getByRole('button', { name: /^Approve$/i }).click();
            await expect(drawer.locator('span').filter({ hasText: /^Approved$/i }).first()).toBeVisible({ timeout: 15000 });

            await approvals.goto('budget-entries');
            expect(await approvals.total(), 'Items in total').toBe(entriesBefore);
            expect((await approvals.readRows()).map(r => r.Title), 'Approved entry no longer listed').not.toContain(entryTitle);
        });

        await test.step('Purchase Orders: the entry\'s PO is listed once its approval is requested', async () => {
            expect(await budgetingPage.openCostEntryByTitle(entryTitle, { deptIndex: 0 })).toBeTruthy();
            await budgetingPage.openTabInPopup('Purchase Orders');
            await budgetingPage.openPOFromPopup(entryTitle);
            const po = page.locator('.modal-shell').first();
            await po.getByRole('button', { name: /Request Approval/i }).click();
            await expect(po.getByRole('button', { name: /^Approve$/i })).toBeVisible({ timeout: 15000 });

            await approvals.goto('purchase-orders');
            expect(await approvals.total(), 'Items in total').toBe(ordersBefore + 1);
            const row = (await approvals.readRows()).find(r => r.Title === entryTitle);
            expect(row, `${entryTitle} listed`).toBeTruthy();
            expect(row.Status).toBe('Awaiting Approval');
            expect(row.Subcategory).toContain(SUBCATEGORY);
            expect(row.Supplier).toContain(SUPPLIER);
        });

        await test.step('Reset To Draft takes the PO off Purchase Orders; the Draft PO is then deleted', async () => {
            expect(await budgetingPage.openCostEntryByTitle(entryTitle, { deptIndex: 0 })).toBeTruthy();
            await budgetingPage.openTabInPopup('Purchase Orders');
            await budgetingPage.openPOFromPopup(entryTitle);
            const po = page.locator('.modal-shell').first();
            await po.getByRole('button', { name: /Reset To Draft/i }).click();
            const dialog = page.getByText('Add Reset Comments', { exact: true })
                .locator('xpath=ancestor::div[.//button[normalize-space(.)="Submit"]][1]');
            await dialog.waitFor({ state: 'visible', timeout: 10000 });
            await dialog.locator('textarea, [contenteditable="true"], input[type="text"]').first().fill('Reset by automated test');
            await dialog.getByRole('button', { name: /^Submit$/ }).click();
            await expect(po.getByRole('button', { name: /Request Approval/i })).toBeVisible({ timeout: 15000 });

            await approvals.goto('purchase-orders');
            expect(await approvals.total(), 'Items in total').toBe(ordersBefore);
            expect((await approvals.readRows()).map(r => r.Title), 'Reset PO no longer listed').not.toContain(entryTitle);

            expect(await budgetingPage.openCostEntryByTitle(entryTitle, { deptIndex: 0 })).toBeTruthy();
            await budgetingPage.openTabInPopup('Purchase Orders');
            await budgetingPage.openPOFromPopup(entryTitle);
            const deleted = page.waitForResponse(r => r.request().method() === 'DELETE' && /\/purchaseorders\/\d+\/delete/.test(r.url()), { timeout: 20000 });
            await page.locator('.modal-shell').first().getByRole('button', { name: /Delete/i }).first().click();
            expect((await deleted).ok(), 'Draft PO deleted').toBe(true);
        });
    });

    test('Payruns: the Approvals list shows the event payruns awaiting approval, as the account-wide list does', async ({ page, purchasingPage }) => {
        await approvals.goto('payruns');
        const rows = await approvals.readRows();
        for (const row of rows) {
            expect(row.Title, 'Payrun has a title').toBeTruthy();
            expect(row.Status, `${row.Title}: status`).toMatch(/Awaiting (Re)?[Aa]pproval/);
            expect(row['Payment Date'], `${row.Title}: payment date`).toMatch(/^\d{2}\/\d{2}\/\d{4}/);
            expect(approvals.money(row['Run Value']), `${row.Title}: run value`).toBeGreaterThan(0);
        }

        // The account-wide Approvals list has an Event column: this event's rows must be the same payruns.
        purchasingPage.eventBaseUrl = EVENT_URL;
        await purchasingPage.gotoPurchasingSummary();
        const eventName = (await page.locator('body').innerText()).split('\n')[1].trim();
        const accountApprovals = new ApprovalsPage(page, ACCOUNT_URL);
        await accountApprovals.goto('payruns');
        const mine = (await accountApprovals.readRows()).filter(row => row.Event === eventName);
        expect(rows.map(r => r.Title).sort(), `Payruns awaiting approval on ${eventName}: event list = account list`).toEqual(mine.map(r => r.Title).sort());
        for (const row of mine) {
            const same = rows.find(r => r.Title === row.Title);
            if (same) near(approvals.money(same['Run Value']), accountApprovals.money(row['Run Value']), `${row.Title}: run value`);
        }
    });

    test('Supplier Invoices: each invoice adds up (Outstanding = Total − Paid − Credit)', async () => {
        await approvals.goto('supplier-invoices');
        const rows = await approvals.readRows();
        test.skip(rows.length === 0, 'No supplier invoices are waiting for approval');

        for (const row of rows) {
            near(approvals.money(row.Outstanding), approvals.money(row.Total) - approvals.money(row.Paid) - approvals.money(row.Credit),
                `${row['Invoice #']}: Outstanding = Total − Paid − Credit`);
            expect(approvals.money(row.Total), `${row['Invoice #']}: Total is at least the Subtotal`).toBeGreaterThanOrEqual(approvals.money(row.Subtotal) - 0.005);
        }
    });
});
