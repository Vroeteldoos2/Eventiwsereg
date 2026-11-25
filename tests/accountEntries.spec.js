// accountEntries.spec.js
// Account > Entries & Data: Budget Entries, Purchase Orders and Payruns (Sales Invoices is in accountSalesInvoices.spec.js).
// Read-only: nothing is created, approved or changed. Event 196 (AutoCopyEvent_713148) is the reference event
// for the event filters.
import { test, expect } from '../fixtures/baseTest.js';

const ACCOUNT_URL = `https://eventwise.synergi.dev/account/${process.env.ENTRIES_ACCOUNT_ID ?? '14'}`;
const ENTRIES_URL = `${ACCOUNT_URL}/entries`;
const EVENT = process.env.ENTRIES_EVENT_NAME ?? 'AutoCopyEvent_713148'; // event 196

const rows = page => page.locator('table tbody tr');
const cell = (row, index) => row.locator('td').nth(index).innerText().then(t => t.trim().replace(/\s+/g, ' '));
const money = text => parseFloat(String(text).replace(/[^\d.-]/g, ''));

async function settle(page) {
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
}

async function open(page, path, tabName) {
    await page.goto(`${ENTRIES_URL}/${path}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: tabName, exact: true })).toBeVisible({ timeout: 20000 });
    await settle(page);
}

async function allValues(page, index) {
    const values = [];
    for (let i = 0; i < await rows(page).count(); i++) values.push(await cell(rows(page).nth(i), index));
    return values;
}

// Picks an option from the Filters panel's custom dropdown (Events, Subcategories, Contacts).
async function filterEvent(page, eventName) {
    await page.getByRole('button', { name: /Filters/ }).click();
    await page.getByText('All Events', { exact: true }).click();
    await page.getByText(eventName, { exact: true }).last().click();
    await settle(page);
}


// Shows only the given status: the Status dropdown has an "All statuses" box plus one box per status.
async function filterStatus(page, status, statusColumn) {
    await page.getByRole('button', { name: /All Statuses/ }).click();
    await page.getByRole('checkbox', { name: 'All statuses' }).uncheck({ force: true });
    await page.getByRole('checkbox', { name: status, exact: true }).check({ force: true });
    await expect.poll(async () => (await allValues(page, statusColumn)).every(v => v === status), { timeout: 15000 }).toBe(true);
    await page.mouse.click(600, 70); // close the dropdown by clicking the page header
}

// Highest page number in the pager next to the page-size select (the top bar's own "99" button is excluded).
async function pagerLastPage(page) {
    const pager = page.locator('select:has(option[value="25"])').first()
        .locator('xpath=ancestor::*[.//button[normalize-space()="1"]][1]').locator('button');
    const numbers = await pager.evaluateAll(list => list.map(b => b.textContent.trim()).filter(t => /^\d+$/.test(t)).map(Number));
    return Math.max(...numbers);
}

test.describe('Account Entries & Data', () => {
    test.beforeEach(async () => { test.setTimeout(120000); });

    test('the Entries & Data tabs switch between the four pages', async ({ page }) => {
        await open(page, 'budget-entries', 'Budget Entries');
        for (const [tab, path] of [['Purchase Orders', 'purchase-orders'], ['Payruns', 'payruns'], ['Sales Invoices', 'sales-invoices'], ['Budget Entries', 'budget-entries']]) {
            await page.getByRole('button', { name: tab, exact: true }).click();
            await expect(page, tab).toHaveURL(new RegExp(`/entries/${path}$`));
            await settle(page);
        }
    });

    test.describe('Budget Entries', () => {
        test.beforeEach(async ({ page }) => {
            await open(page, 'budget-entries', 'Budget Entries');
            await expect(rows(page).first()).toBeVisible({ timeout: 20000 });
        });

        test('lists the budget entries of all events with their amounts and approval details', async ({ page }) => {
            await expect(page.getByPlaceholder('Search budget entries...')).toBeVisible();
            await expect(page.getByRole('button', { name: /All Statuses/ })).toBeVisible();
            await expect(page.getByRole('button', { name: /Filters/ })).toBeVisible();
            for (const heading of ['Event', 'Status', 'Title', 'Subcategory', 'Supplier', 'Fixed', 'Budgeted', 'Approval Date', 'Approved By']) {
                await expect(page.locator('thead'), heading).toContainText(heading);
            }
            const first = rows(page).first();
            expect(money(await cell(first, 6)), 'Fixed amount').not.toBeNaN();
            expect(money(await cell(first, 7)), 'Budgeted amount').not.toBeNaN();
        });

        test('search finds an entry by its title', async ({ page }) => {
            const title = await cell(rows(page).first(), 3);
            await page.getByPlaceholder('Search budget entries...').fill(title);
            await settle(page);
            await expect(rows(page).first()).toBeVisible();
            for (const found of await allValues(page, 3)) expect(found.toLowerCase()).toContain(title.toLowerCase());
        });

        test('the Events filter shows only the entries of the selected event', async ({ page }) => {
            await filterEvent(page, EVENT);
            await expect(rows(page).first()).toBeVisible();
            for (const event of await allValues(page, 1)) expect(event).toBe(EVENT);
        });

        test('the Status filter shows only the selected status and Reset brings every status back', async ({ page }) => {
            await filterStatus(page, 'Approved', 2);
            await expect(rows(page).first()).toBeVisible();
            for (const status of await allValues(page, 2)) expect(status).toBe('Approved');

            await page.getByRole('button', { name: /Status|Approved/ }).first().click();
            await page.getByRole('button', { name: 'Reset', exact: true }).click();
            await page.keyboard.press('Escape');
            await settle(page);
            await expect(page.getByRole('button', { name: /All Statuses/ })).toBeVisible();
        });

        test('the Contacts filter shows only the entries of the selected supplier', async ({ page }) => {
            await page.getByRole('button', { name: /Filters/ }).click();
            await page.getByText('All Contacts', { exact: true }).click();
            await page.getByPlaceholder('Search contacts...').fill('Muddles');
            await page.getByText('Muddles LTd', { exact: true }).last().click();
            await settle(page);
            await expect(rows(page).first()).toBeVisible();
            for (const supplier of await allValues(page, 5)) expect(supplier).toBe('Muddles LTd');
        });

        test('the Subcategories filter narrows the list and Clear All restores it', async ({ page }) => {
            const before = await pagerLastPage(page);
            await page.getByRole('button', { name: /Filters/ }).click();
            await page.getByText('All Categories', { exact: true }).click();
            await expect(page.getByText('Select categories')).toBeVisible();
            // The category boxes are custom elements next to the name (the table has its own select-all checkbox)
            await page.locator('span').filter({ hasText: /^Artists$/ }).first().locator('xpath=..').locator('xpath=./div').first().click();
            await settle(page);
            await expect(rows(page).first()).toBeVisible();
            expect(await pagerLastPage(page), 'Fewer pages once filtered').toBeLessThan(before);
            for (const subcategory of await allValues(page, 4)) expect(subcategory).not.toBe('');

            await page.getByText('Clear All', { exact: true }).click();
            await settle(page);
            expect(await pagerLastPage(page), 'Clear All restores the list').toBe(before);
        });

        test('the eye icon opens the entry with the same title, status and amounts (viewed only)', async ({ page }) => {
            const row = rows(page).first();
            const [status, title, fixed, budgeted] = [await cell(row, 2), await cell(row, 3), await cell(row, 6), await cell(row, 7)];
            await row.locator('button').last().click();

            await expect(page.getByText('Budget Entry', { exact: true })).toBeVisible();
            await expect(page.getByText(title, { exact: true }).last()).toBeVisible();
            await expect(page.getByText(status, { exact: true }).last()).toBeVisible();
            const body = await page.locator('body').innerText();
            expect(body, 'Fixed amount').toContain(fixed.replace('£', '').replace(/\.00$/, ''));
            expect(body, 'Budgeted amount').toContain(budgeted.replace('£', '').replace(/\.00$/, ''));
            for (const tab of ['Activity', 'Files', 'Adjustments']) await expect(page.getByText(tab, { exact: true }), tab).toBeVisible();
            await expect(page.getByText('Created by')).toBeVisible();

            await page.keyboard.press('Escape');
        });

        test('the page size can be increased', async ({ page }) => {
            await page.locator('select').filter({ has: page.locator('option[value="25"]') }).selectOption('25');
            await settle(page);
            await expect(rows(page)).toHaveCount(25);
        });
    });

    test.describe('Purchase Orders', () => {
        test.beforeEach(async ({ page }) => {
            await open(page, 'purchase-orders', 'Purchase Orders');
            await expect(rows(page).first()).toBeVisible({ timeout: 20000 });
        });

        test('lists the purchase orders of all events with status, reference and subtotal', async ({ page }) => {
            await expect(page.getByPlaceholder('Search Purchase Orders...')).toBeVisible();
            await expect(page.getByRole('button', { name: /All Statuses/ })).toBeVisible();
            for (const heading of ['Status', 'Reference', 'Event', 'Title', 'Subcategory', 'Supplier', 'Subtotal', 'Raised']) {
                await expect(page.locator('thead'), heading).toContainText(heading);
            }
            expect(money(await cell(rows(page).first(), 7)), 'Subtotal').not.toBeNaN();
        });

        test('purchase order references are unique', async ({ page }) => {
            await page.locator('select').filter({ has: page.locator('option[value="100"]') }).selectOption('100');
            await settle(page);
            const references = (await allValues(page, 2)).filter(r => r !== '—');
            expect(references.length).toBeGreaterThan(0);
            for (const reference of references) expect(reference).toMatch(/^EW\d+$/);
            expect(new Set(references).size, 'No reference is used twice').toBe(references.length);
        });

        test('search finds a purchase order by its reference', async ({ page }) => {
            const references = await allValues(page, 2);
            const reference = references.find(r => /^EW\d+$/.test(r));
            expect(reference, 'An approved PO is listed').toBeDefined();
            await page.getByPlaceholder('Search Purchase Orders...').fill(reference);
            await settle(page);
            await expect(rows(page).first()).toBeVisible();
            for (const found of await allValues(page, 2)) expect(found).toBe(reference);
        });

        test('the Status filter shows only the selected status', async ({ page }) => {
            await filterStatus(page, 'Approved', 1);
            await expect(rows(page).first()).toBeVisible();
            for (const status of await allValues(page, 1)) expect(status).toBe('Approved');
        });

        test('the eye icon opens the purchase order with the same reference, title, status and subtotal (viewed only)', async ({ page }) => {
            await filterStatus(page, 'Approved', 1);
            const row = rows(page).first();
            const [status, reference, title, subtotal] = [await cell(row, 1), await cell(row, 2), await cell(row, 4), await cell(row, 7)];
            await row.locator('button').last().click();

            const panel = page.locator('div').filter({ hasText: 'Line Items' }).filter({ hasText: reference }).last();
            await expect(panel).toBeVisible();
            await expect(panel, 'Title').toContainText(title);
            await expect(panel, 'Reference').toContainText(reference);
            await expect(panel, 'Status').toContainText(status);
            await expect(panel, 'Subtotal').toContainText(subtotal);
            for (const label of ['Invoiced', 'Paid', 'Outstanding']) { // summary tiles that exist only in the panel
                await expect(page.getByText(new RegExp(`^${label}$`, 'i')).first(), label).toBeVisible();
            }
            for (const tab of ['Line Items', 'Budgeting', 'Invoices', 'Extra Info']) await expect(page.getByText(tab, { exact: true }), tab).toBeVisible();
            await page.keyboard.press('Escape');
        });

        test('the Events filter shows only the purchase orders of the selected event', async ({ page }) => {
            await filterEvent(page, EVENT);
            await expect(rows(page).first()).toBeVisible();
            for (const event of await allValues(page, 3)) expect(event).toBe(EVENT);
        });
    });

    test.describe('Payruns', () => {
        test.beforeEach(async ({ page }) => {
            await open(page, 'payruns', 'Payruns');
            await expect(page.getByText('Outstanding', { exact: true }).first()).toBeVisible({ timeout: 20000 });
        });

        test('shows the payment totals, period selector and payrun list', async ({ page }) => {
            await expect(page.getByText(/\d+ payments/).first()).toBeVisible();
            for (const label of ['Total', 'Outstanding', 'Overdue']) {
                await expect(page.getByText(label, { exact: true }).first(), label).toBeVisible();
            }
            const body = await page.locator('body').innerText();
            expect(body).toMatch(/Total\s+\d+ payments\s+£[\d,]+\.\d{2}/);
            const total = Number(body.match(/Total\s+(\d+) payments/)[1]);
            const outstanding = Number(body.match(/Outstanding\s+(\d+) payments/)[1]);
            expect(outstanding, 'Outstanding payments are part of the total').toBeLessThanOrEqual(total);

            await expect(page.getByRole('button', { name: /New Payrun/ })).toBeVisible();
            await expect(page.getByText('Event Payruns', { exact: true })).toBeVisible();
            for (const heading of ['Event', 'Title', 'Items', 'Payment Date', 'Status', 'Value']) {
                await expect(page.locator('thead'), heading).toContainText(heading);
            }
        });

        test('the period selector offers last week, this week and a custom period', async ({ page }) => {
            const period = page.locator('select:has(option:text-is("Custom period"))');
            await expect(period).toBeAttached();
            const options = await period.locator('option').evaluateAll(list => list.map(o => o.textContent.trim()));
            expect(options.some(o => /^Last Week \(/.test(o)), 'Last Week').toBe(true);
            expect(options.some(o => /^This Week \(/.test(o)), 'This Week').toBe(true);
            expect(options).toContain('Custom period');

            // An empty period says so, naming the dates
            const thisWeek = options.find(o => /^This Week/.test(o));
            await period.selectOption({ label: thisWeek });
            await settle(page);
            const range = thisWeek.match(/\((.*)\)/)[1];
            const body = await page.locator('body').innerText();
            if (!(await rows(page).count())) {
                expect(body).toContain(`There are no payruns to display for the current period (${range})`);
            }
        });

        test('payrun status filters can be switched on and off', async ({ page }) => {
            for (const filter of ['Rejected', 'Paid']) {
                const chip = page.getByText(filter, { exact: true }).first();
                await expect(chip, filter).toBeVisible();
                await chip.click();
                await settle(page);
                await chip.click();
                await settle(page);
            }
            await expect(page.getByText('Event Payruns', { exact: true })).toBeVisible();
        });
    });
});
