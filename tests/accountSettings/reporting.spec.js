// reporting.spec.js
// Account > Reporting (read-only): Sales & Costs, Outstanding, Accruals, Historical and Event Ticket reports.
// Uses one existing event on account 14 and creates / changes nothing:
//   196 = AutoCopyEvent_713148 (has budgets, POs, invoices, tickets).
// The selected events live in the page state, so each test selects its event(s) on /reporting and opens the
// report from the tabs (loading a report URL directly shows no event).
// Only that one event (and, for Group Tags, the one tag) is ever selected.
import { test, expect } from '../../fixtures/baseTest.js';
import { BASE_URL } from '../../pages/env.js';

const ACCOUNT_URL = `${BASE_URL}/account/${process.env.REPORTING_ACCOUNT_ID ?? '14'}`;
const REPORTING_URL = `${ACCOUNT_URL}/reporting`;
const TAG = process.env.REPORTING_TAG_NAME ?? 'Techno';
const EVENT_A = { id: 196, name: process.env.REPORTING_EVENT_A_NAME ?? 'AutoCopyEvent_713148' };

const money = text => {
    const m = String(text).replace(/,/g, '').match(/(-)?£(-)?([\d.]+)/);
    return m ? (m[1] || m[2] ? -1 : 1) * parseFloat(m[3]) : NaN;
};
const moneyList = text => (String(text).match(/-?£-?[\d,]+(\.\d+)?/g) ?? []).map(money);
const count = text => parseInt(String(text).replace(/,/g, '').match(/\d+/)[0], 10);
const round = n => Math.round(n * 100) / 100;

async function settle(page) {
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
}

// Opens /reporting, ticks the events (the list is paged, so it is set to show 50 first), returns the page.
async function selectEvents(page, ...events) {
    await page.goto(REPORTING_URL, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Select a single event in order to access')).toBeVisible({ timeout: 20000 });
    await settle(page);
    for (const event of events) {
        const row = page.getByRole('row', { name: new RegExp(event.name) });
        if (!(await row.count())) {
            await showFifty(page);
        }
        await row.locator('input[type=checkbox]').check({ force: true });
    }
}

async function showFifty(page) {
    await page.locator('select:has(option[value="50"])').selectOption('50');
    await settle(page);
}

async function settleTags(page) {
    await page.getByText('Loading Information').waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
    await settle(page);
}

// Switches to the Group Tags list and ticks the tag (the list loads after a spinner).
async function selectTag(page, tag = TAG) {
    await page.goto(REPORTING_URL, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Select a single event in order to access')).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: 'Group Tags', exact: true }).click();
    await expect(page.getByText('Select a single group Tag in order to access the Group Report.')).toBeVisible();
    await settleTags(page);
    const row = page.getByRole('row', { name: new RegExp(tag) });
    await expect(row, `${tag} tag is listed`).toBeVisible({ timeout: 20000 });
    await row.locator('input[type=checkbox]').check({ force: true });
    return row;
}

async function openReport(page, tabName) {
    await page.getByRole('button', { name: tabName, exact: true }).click();
    await settle(page);
}

// Outstanding and Accruals list every event, so show 50 per page and return the cells of one event's row.
async function eventRow(page, event) {
    const row = page.getByRole('row', { name: new RegExp(event.name) });
    if (!(await row.count())) {
        await showFifty(page);
    }
    await expect(row, `${event.name} is listed`).toBeVisible();
    return row;
}

const rowTexts = (page, selector = 'table tbody tr') =>
    page.$$eval(selector, rows => rows.map(r => [...r.querySelectorAll('td,th')].map(c => c.innerText.trim().replace(/\n/g, ' '))));

test.describe('Account Reporting', () => {
    test.beforeEach(async () => { test.setTimeout(120000); });

    test('Reporting page lists the events and offers the report tabs once an event is selected', async ({ page }) => {
        await page.goto(REPORTING_URL, { waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('heading', { name: 'Reporting' })).toBeVisible();
        await expect(page.getByText('Select a single event in order to access the Sales & Costs and History Reports.')).toBeVisible();
        await expect(page.locator('thead')).toContainText('Event');
        await expect(page.locator('thead')).toContainText('Starts At');
        // With nothing selected only the all-event reports are offered
        await expect(page.getByRole('button', { name: 'Outstanding', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Accruals', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Sales & Costs', exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Historical Report', exact: true })).toHaveCount(0);

        await selectEvents(page, EVENT_A);
        for (const tab of ['Sales & Costs', 'Outstanding', 'Accruals', 'Historical Report', 'Event Ticket Report']) {
            await expect(page.getByRole('button', { name: tab, exact: true }), tab).toBeVisible();
        }
    });

    test.describe('Sales & Costs Report', () => {
        test('shows the total sales and costs of the selected event', async ({ page }) => {
            await selectEvents(page, EVENT_A);
            await openReport(page, 'Sales & Costs');
            await expect(page.getByText('This report displays your total sales or costs for the selected events.')).toBeVisible();
            await expect(page.locator('thead')).toContainText(EVENT_A.name);

            const figures = Object.fromEntries((await rowTexts(page)).map(([label, value]) => [label, money(value)]));
            for (const label of ['Subtotal', 'Tax Amount', 'Total', 'Total Paid', 'Total Pending']) {
                expect(figures[label], label).not.toBeNaN();
            }
            expect(round(figures['Subtotal'] + figures['Tax Amount']), 'Subtotal + Tax = Total').toBe(figures['Total']);
            expect(figures['Total Paid'] + figures['Total Pending']).toBeLessThanOrEqual(figures['Total']);
        });

        test('Summary, Costs and Revenue views list departments for the event', async ({ page }) => {
            await selectEvents(page, EVENT_A);
            await openReport(page, 'Sales & Costs');

            // Costs and Revenue are sub-views of the Departments view
            await page.getByRole('button', { name: 'Departments', exact: true }).click();
            await page.getByRole('button', { name: 'Costs', exact: true }).click();
            await settle(page);
            const costRows = await rowTexts(page);
            expect(costRows.length, 'Cost departments listed').toBeGreaterThan(0);
            expect(costRows.map(r => r[0])).toContain('Marketing');

            await page.getByRole('button', { name: 'Revenue', exact: true }).click();
            await settle(page);
            const revenueRows = await rowTexts(page);
            expect(revenueRows.length, 'Revenue departments listed').toBeGreaterThan(0);
            expect(revenueRows.map(r => r[0])).toContain('Tickets');

            await page.getByRole('button', { name: 'Summary', exact: true }).click();
            await settle(page);
            expect((await rowTexts(page)).map(r => r[0])).toContain('Subtotal');
        });
    });

    test.describe('Outstanding Report', () => {
        test('lists the events with costs, sales and ticketing figures', async ({ page }) => {
            await selectEvents(page, EVENT_A);
            await openReport(page, 'Outstanding');
            await expect(page.getByText('The outstanding report displays a list of all of your events')).toBeVisible();
            for (const heading of ['Event', 'Total costs', 'Total sales', 'Tickets', 'Paid', 'Pending', 'Outstanding', 'Sold', 'Available']) {
                await expect(page.locator('thead'), heading).toContainText(heading);
            }
            const row = await eventRow(page, EVENT_A);
            await expect(row.locator('td').first()).toContainText(EVENT_A.name);
            expect(moneyList(await row.innerText()).length, 'Cost and sales figures').toBeGreaterThanOrEqual(6);
        });

        test('ticket numbers match the Event Ticket Report', async ({ page }) => {
            await selectEvents(page, EVENT_A);
            await openReport(page, 'Event Ticket Report');
            const [, , , available, sold] = (await rowTexts(page))[0];

            await openReport(page, 'Outstanding');
            const cells = await (await eventRow(page, EVENT_A)).locator('td').allInnerTexts();
            const text = cells.join(' ');
            expect(text).toContain(count(sold).toLocaleString('en-GB'));
            expect(text).toContain(count(available).toLocaleString('en-GB'));
        });
    });

    test.describe('Accruals Report', () => {
        test('shows budget, purchase order and total columns', async ({ page }) => {
            await selectEvents(page, EVENT_A);
            await openReport(page, 'Accruals');
            for (const heading of ['Event', 'Budgets', 'Approved', 'Uncommitted', 'Purchase Orders', 'POs Approved', 'Invoices Paid', 'POs Not Invoiced', 'Total']) {
                await expect(page.locator('thead'), heading).toContainText(heading);
            }
            await expect(page.getByRole('button', { name: /^\W*Filters/ })).toBeVisible();
        });

        test('Total is Uncommitted budgets plus POs not invoiced', async ({ page }) => {
            await selectEvents(page, EVENT_A);
            await openReport(page, 'Accruals');
            const row = await eventRow(page, EVENT_A);
            const [approved, uncommitted, posApproved, invoicesPaid, notInvoiced, total] = moneyList(await row.innerText());

            expect(uncommitted, 'Uncommitted never exceeds the approved budgets').toBeLessThanOrEqual(approved);
            expect(notInvoiced, 'POs not invoiced never exceeds POs approved').toBeLessThanOrEqual(posApproved);
            expect(round(uncommitted + notInvoiced), 'Total = Budgets Not Committed + POs Not Invoiced').toBe(total);
            expect(invoicesPaid).toBeGreaterThanOrEqual(0);
        });

        test('invoices paid agree with the Total Paid of the Sales & Costs report', async ({ page }) => {
            await selectEvents(page, EVENT_A);
            await openReport(page, 'Sales & Costs');
            const totalPaid = money((await rowTexts(page)).find(r => r[0] === 'Total Paid')[1]);

            await openReport(page, 'Accruals');
            const invoicesPaid = moneyList(await (await eventRow(page, EVENT_A)).innerText())[3];
            expect(invoicesPaid).toBe(totalPaid);
        });

        test('Filters panel offers event and date filters', async ({ page }) => {
            await selectEvents(page, EVENT_A);
            await openReport(page, 'Accruals');
            await page.getByRole('button', { name: /^\W*Filters/ }).click();
            await expect(page.getByText('All Events')).toBeVisible();
            for (const label of ['Event start', 'Event End', 'Invoice start', 'Invoice end']) {
                await expect(page.getByText(label, { exact: true }), label).toBeVisible();
            }
            await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible();
            await expect(page.getByRole('button', { name: 'Clear Filters' })).toBeVisible();
        });
    });

    test.describe('Historical Report', () => {
        const parse = rows => rows.map(([label, ...cells]) => ({ label, cells }));

        async function sections(page) {
            return parse(await rowTexts(page));
        }

        test('explains the report and shows the total, fixed total and monthly columns', async ({ page }) => {
            await selectEvents(page, EVENT_A);
            await openReport(page, 'Historical Report');
            await expect(page.getByText('This report displays the history of approved budgeted amounts within a single event.')).toBeVisible();
            await expect(page.getByText('The overall total is displayed on the left alongside the fixed total')).toBeVisible();
            const header = (await rowTexts(page))[0];
            expect(header.slice(0, 3)).toEqual(['Revenue', 'Total', 'Fixed']);
            expect(header.slice(3).length, 'Month columns').toBeGreaterThan(0);
            expect(header[3]).toMatch(/^[A-Z][a-z]{2} \d{4}$/);
            const labels = (await sections(page)).map(r => r.label);
            expect(labels).toEqual(expect.arrayContaining(['Total Sales', 'Costs', 'Total Expenses']));
        });

        test('each month total is the sum of that month across the departments', async ({ page }) => {
            await selectEvents(page, EVENT_A);
            await openReport(page, 'Historical Report');
            const rows = await sections(page);
            const costsAt = rows.findIndex(r => r.label === 'Costs');
            const salesAt = rows.findIndex(r => r.label === 'Total Sales');
            const expensesAt = rows.findIndex(r => r.label === 'Total Expenses');

            for (const [from, to, totalAt] of [[1, salesAt, salesAt], [costsAt + 1, expensesAt, expensesAt]]) {
                const lines = rows.slice(from, to);
                for (let col = 2; col < rows[totalAt].cells.length; col++) {
                    const sum = lines.reduce((acc, r) => acc + money(r.cells[col]), 0);
                    expect(round(sum), `${rows[totalAt].label} ${col - 1}th month`).toBe(money(rows[totalAt].cells[col]));
                }
            }
        });

        test('Cumulative accumulates each month onto the previous one', async ({ page }) => {
            await selectEvents(page, EVENT_A);
            await openReport(page, 'Historical Report');
            const monthly = await sections(page);

            await page.locator('label', { hasText: 'Cumulative' }).click();
            await settle(page);
            const cumulative = await sections(page);

            expect(cumulative.map(r => r.label)).toEqual(monthly.map(r => r.label));
            for (let i = 0; i < monthly.length; i++) {
                // The Tickets department is ignored
                if (monthly[i].label === 'Tickets' || monthly[i].cells.length < 3 || Number.isNaN(money(monthly[i].cells[0]))) continue;
                // The overall Total and Fixed columns are unchanged
                expect(cumulative[i].cells.slice(0, 2), `${monthly[i].label} total and fixed`).toEqual(monthly[i].cells.slice(0, 2));
                let running = 0;
                for (let col = 2; col < monthly[i].cells.length; col++) {
                    running = round(running + money(monthly[i].cells[col]));
                    expect(money(cumulative[i].cells[col]), `${monthly[i].label} month ${col - 1}`).toBe(running);
                }
            }
        });

        test('All, Revenue and Costs views and the Departments / Tickets switch change the rows shown', async ({ page }) => {
            await selectEvents(page, EVENT_A);
            await openReport(page, 'Historical Report');
            const first = async () => (await rowTexts(page)).map(r => r[0]);

            const all = await first();
            expect(all).toEqual(expect.arrayContaining(['Total Sales', 'Total Expenses']));

            await page.getByRole('button', { name: 'Revenue', exact: true }).click();
            await settle(page);
            const revenue = await first();
            expect(revenue).toContain('Total Sales');
            expect(revenue).not.toContain('Total Expenses');

            await page.getByRole('button', { name: 'Costs', exact: true }).click();
            await settle(page);
            const costs = await first();
            expect(costs).toContain('Total Expenses');
            expect(costs).not.toContain('Total Sales');

            await page.getByRole('button', { name: 'All', exact: true }).click();
            await page.getByRole('button', { name: 'Tickets', exact: true }).click();
            await settle(page);
            const tickets = await first();
            expect(tickets).toEqual(expect.arrayContaining(['Tickets', 'Total Sales']));
            expect(tickets, 'Ticket types replace the departments').not.toContain('Marketing');
        });
    });

    test.describe('Event Ticket Report', () => {
        test('shows the ticket figures of the selected event', async ({ page }) => {
            await selectEvents(page, EVENT_A);
            await openReport(page, 'Event Ticket Report');
            await expect(page.getByText('This report displays the Ticket comparisons for events and or groups.')).toBeVisible();
            for (const heading of ['Event', 'Starts At', 'Ends At', 'Tickets Available', 'Tickets Sold', 'Tickets left', 'Avg Price']) {
                await expect(page.locator('thead'), heading).toContainText(heading);
            }
            const rows = await rowTexts(page);
            expect(rows).toHaveLength(1);
            expect(rows[0][0]).toBe(EVENT_A.name);
        });

        test('tickets left and the sold percentage follow from the available and sold numbers', async ({ page }) => {
            await selectEvents(page, EVENT_A);
            await openReport(page, 'Event Ticket Report');
            const rows = await rowTexts(page);
            expect(rows.map(r => r[0])).toEqual([EVENT_A.name]);

            for (const [name, , , available, sold, left, avgPrice] of rows) {
                const totalAvailable = count(available);
                const totalSold = count(sold);
                expect(count(left), `${name} tickets left`).toBe(totalAvailable - totalSold);
                const percent = parseFloat(sold.match(/\(([\d.]+)%\)/)[1]);
                expect(percent, `${name} sold %`).toBeCloseTo((totalSold / totalAvailable) * 100, 1);
                expect(money(avgPrice), `${name} average price`).toBeGreaterThanOrEqual(0);
            }
        });
    });

    test.describe('Group Tags', () => {
        test('lists the group tags with their event counts and offers the tag reports once a tag is selected', async ({ page }) => {
            const row = await selectTag(page);
            await expect(page.getByText('You can select multiple (up to 2) tags to view the Multi Group Analysis report.')).toBeVisible();
            for (const heading of ['Tag', 'Events', 'Budgeted Costs', 'Budgeted Revenue', 'Actual Costs', 'Actual Revenue', 'Budgeted P/L', 'Actual P/L', 'Tickets Available', 'Tickets Sold']) {
                await expect(page.locator('thead'), heading).toContainText(heading);
            }
            await expect(row).toContainText(TAG);
            expect(count(await row.locator('td').nth(2).innerText()), `${TAG} has events`).toBeGreaterThan(0);
            await expect(page.getByRole('button', { name: 'Tag Analysis', exact: true })).toBeVisible();
            await expect(page.getByRole('button', { name: 'Tag Tickets', exact: true })).toBeVisible();
        });

        test('clicking the number of events opens the Tag Editor (viewed only, nothing is changed)', async ({ page }) => {
            const row = await selectTag(page);
            await row.locator('td').nth(2).getByRole('link').click();

            await expect(page.getByText('Tag Editor').locator('visible=true')).toBeVisible();
            await expect(page.getByText('Start typing to add a new tag, or click an existing one to edit').locator('visible=true')).toBeVisible();
            await expect(page.getByText('Existing Tags').locator('visible=true')).toBeVisible();
            await expect(page.getByPlaceholder('Name', { exact: true })).toBeVisible();
            await expect(page.getByRole('button', { name: /Add$/ })).toBeVisible();
            await expect(page.getByRole('button', { name: /Reset$/ })).toBeVisible();

            // The Events tab is where tags are assigned to events: it has a search and the event count
            await page.getByRole('button', { name: 'Events', exact: true }).last().click();
            await expect(page.getByPlaceholder('Search for a name...')).toBeVisible();
            await expect(page.getByText('Number of Events:')).toBeVisible();
        });

        test('Tag Analysis shows the profit and loss figures of the tag', async ({ page }) => {
            await selectTag(page);
            await openReport(page, 'Tag Analysis');
            await settleTags(page);
            await expect(page.getByText('Profit & Loss Comparison')).toBeVisible();
            await expect(page.locator('thead')).toContainText(TAG);

            const lines = Object.fromEntries((await rowTexts(page)).map(([label, ...cells]) => [label, cells.map(money)]));
            for (const label of ['Revenue Budgeted', 'Revenue Fixed', 'Revenue Variance', 'Costs Budgeted', 'Costs Fixed', 'Costs Variance', 'Profit Budgeted', 'Profit Fixed', 'Profit Variance']) {
                expect(lines[label], label).toBeDefined();
                expect(lines[label][0], label).not.toBeNaN();
            }
            // The tag column and the Total column both follow the same arithmetic
            for (const col of [0, 1]) {
                const v = label => lines[label][col];
                expect(round(v('Revenue Budgeted') - v('Revenue Fixed')), 'Revenue Variance').toBe(v('Revenue Variance'));
                expect(round(v('Costs Budgeted') - v('Costs Fixed')), 'Costs Variance').toBe(v('Costs Variance'));
                expect(round(v('Revenue Budgeted') - v('Costs Budgeted')), 'Profit Budgeted').toBe(v('Profit Budgeted'));
                expect(round(v('Revenue Fixed') - v('Costs Fixed')), 'Profit Fixed').toBe(v('Profit Fixed'));
                expect(round(v('Profit Budgeted') - v('Profit Fixed')), 'Profit Variance').toBe(v('Profit Variance'));
            }
            for (const [label, cells] of Object.entries(lines)) {
                expect(cells[1], `${label}: with one tag selected the Total is the tag's figure`).toBe(cells[0]);
            }
        });

        test('Tag Analysis can be switched between Table and Chart', async ({ page }) => {
            await selectTag(page);
            await openReport(page, 'Tag Analysis');
            await settleTags(page);
            await page.getByRole('button', { name: 'Chart', exact: true }).click();
            await expect(page.locator('canvas, .apexcharts-canvas, svg.apexcharts-svg').first()).toBeVisible();
            await expect(page.getByText('Revenue Budgeted', { exact: true })).toHaveCount(0);
            await page.getByRole('button', { name: 'Table', exact: true }).click();
            await expect(page.getByText('Revenue Budgeted', { exact: true })).toBeVisible();
        });

        test('Tag Tickets shows the ticket figures of the tag', async ({ page }) => {
            const row = await selectTag(page);
            const eventCount = count(await row.locator('td').nth(2).innerText());
            await openReport(page, 'Tag Tickets');
            await settleTags(page);
            await expect(page.getByText('ticket comparisons across multiple group Tags')).toBeVisible();
            for (const heading of ['Group', 'Event Count', 'Tickets Available', 'Tickets Sold', 'Tickets left', 'Avg Price']) {
                await expect(page.locator('thead'), heading).toContainText(heading);
            }
            const rows = await rowTexts(page);
            expect(rows).toHaveLength(1);
            const [name, events, available, sold, left, avgPrice] = rows[0];
            expect(name).toBe(TAG);
            expect(count(events), 'Event count agrees with the Group Tags list').toBe(eventCount);
            expect(count(left), 'Tickets left').toBe(count(available) - count(sold));
            expect(parseFloat(sold.match(/\(([\d.]+)%\)/)[1]), 'Sold %').toBeCloseTo((count(sold) / count(available)) * 100, 1);
            expect(parseFloat(avgPrice.replace(/[^\d.]/g, ''))).toBeGreaterThanOrEqual(0);
        });

        // Known app bug (raised): the Group Tags list shows different Tickets Available / Sold from Tag Tickets
        // (Techno: 29,216 / 0 against 28,036 / 17,140). This is expected to fail until it is fixed: once it passes,
        // Playwright reports the test as an unexpected pass, so remove the test.fail() line.
        test('Group Tags list ticket numbers agree with Tag Tickets', async ({ page }) => {
            test.fail(true, 'Known bug: Group Tags list ticket figures differ from Tag Tickets');
            const row = await selectTag(page);
            const cells = await row.locator('td').allInnerTexts();
            const [listAvailable, listSold] = [count(cells.at(-2)), count(cells.at(-1))];

            await openReport(page, 'Tag Tickets');
            await settleTags(page);
            const [, , available, sold] = (await rowTexts(page))[0];
            expect(listAvailable, 'Tickets Available').toBe(count(available));
            expect(listSold, 'Tickets Sold').toBe(count(sold));
        });
    });
});
