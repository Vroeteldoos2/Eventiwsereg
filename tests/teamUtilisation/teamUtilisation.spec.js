// teamUtilisation.spec.js
// Team Utilisation module (account 14): Resource Utilisation (by employee / by event, actual charges),
// Time Logs (calendar and table) and Tasks (preset tasks and their hourly rate).
// Read-only: no time is logged and no task is created, edited or deleted (the Add Task dialog is opened and cancelled).
// There are no manual test cases for this module, so the checks are the page's own arithmetic (remaining days,
// capacity, status bands, the summary tiles against the table) and consistency between the pages.
import { test, expect } from '../../fixtures/baseTest.js';
import { BASE_URL } from '../../pages/env.js';

const ACCOUNT_URL = `${BASE_URL}/account/${process.env.UTILISATION_ACCOUNT_ID ?? '14'}`;
const RESOURCE_URL = `${ACCOUNT_URL}/utilisation`;
const TIME_LOGS_URL = `${ACCOUNT_URL}/utilisation/time-logs`;
const TASKS_URL = `${ACCOUNT_URL}/utilisation/tasks`;
const TEAM_MEMBER = process.env.UTILISATION_TEAM_MEMBER?.trim() || '';

const TEST_USER = process.env.UTILISATION_TEST_USER ?? 'EWevent User'; // eweventuser@gmail.com

const days = text => parseFloat(String(text).replace(/,/g, '').replace(/[^\d.-]/g, ''));
const percent = text => parseFloat(String(text).replace(/[^\d.]/g, ''));
const round = (n, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

async function settle(page) {
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
}

async function open(page, url, heading) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(heading).first()).toBeVisible({ timeout: 20000 });
    await settle(page);
}

// Shows 50 rows per page on every table that has a page-size select (the employee table and Actual Charges page separately).
async function showFifty(page) {
    const selects = page.locator('select:has(option[value="50"])');
    for (let i = 0; i < await selects.count(); i++) {
        await selects.nth(i).selectOption('50');
        await settle(page);
    }
}

async function firstTableRows(page) {
    return page.locator('table').first().evaluate(table =>
        [...table.querySelectorAll('tbody tr')].map(r => [...r.querySelectorAll('td')].map(c => c.innerText.trim().replace(/\s+/g, ' '))));
}

test.describe('Team Utilisation', () => {
    test.beforeEach(async () => { test.setTimeout(120000); });

    test.describe('Resource Utilisation', () => {
        test.beforeEach(async ({ page }) => {
            await open(page, RESOURCE_URL, 'Allocation across assigned events');
        });

        test('shows the summary tiles, period filters and the employee table', async ({ page }) => {
            await expect(page.getByText(/Allocation across assigned events — \d+ team members/)).toBeVisible();
            for (const label of ['team members', 'Total Available', 'Avg Utilisation', 'Overbooked']) {
                await expect(page.getByText(label, { exact: true }).first(), label).toBeVisible();
            }
            for (const period of ['All Time', '2026', '2025', 'Custom']) {
                await expect(page.getByRole('button', { name: period, exact: true }), period).toBeVisible();
            }
            await expect(page.getByRole('button', { name: 'Employee', exact: true })).toBeVisible();
            await expect(page.getByRole('button', { name: 'Event', exact: true })).toBeVisible();
            await expect(page.getByRole('button', { name: /Export PDF/ })).toBeVisible();
            for (const heading of ['Employee', 'Available Days', 'Allocated', 'Remaining', 'Capacity', 'Status']) {
                await expect(page.locator('thead').first(), heading).toContainText(heading);
            }
            await expect(page.getByText('Healthy: under 80%')).toBeVisible();
            await expect(page.getByText('High: 80–100%')).toBeVisible();
            await expect(page.getByText('Overbooked: over 100%')).toBeVisible();
        });

        test('each employee: Remaining = Available - Allocated, and the Status follows the Capacity band', async ({ page }) => {
            await showFifty(page);
            const rows = await firstTableRows(page);
            expect(rows.length, 'Employees listed').toBeGreaterThan(0);

            for (const [name, available, allocated, remaining, capacity, status] of rows) {
                expect(days(remaining), `${name} remaining`).toBe(round(days(available) - days(allocated)));
                const used = percent(capacity);
                const expected = used > 100 || (days(available) === 0 && days(allocated) > 0) ? 'Overbooked' : used >= 80 ? 'High' : 'Healthy';
                expect(status, `${name} status at ${capacity}`).toBe(expected);
                if (days(available) > 0) {
                    expect(used, `${name} capacity`).toBeCloseTo((days(allocated) / days(available)) * 100, 0);
                }
            }
        });

        test('the summary tiles agree with the employee table', async ({ page }) => {
            await showFifty(page);
            const rows = await firstTableRows(page);
            const totalAvailable = rows.reduce((sum, r) => sum + days(r[1]), 0);
            const totalAllocated = rows.reduce((sum, r) => sum + days(r[2]), 0);
            const overbooked = rows.filter(r => r[5] === 'Overbooked').length;

            const body = await page.locator('body').innerText();
            await expect(page.getByText(`Allocation across assigned events — ${rows.length} team members`)).toBeVisible();
            expect(body, 'Total available days').toContain(`${totalAvailable}d`);
            expect(body, 'Total allocated days').toContain(`${totalAllocated}d allocated`);
            expect(body, 'Avg utilisation').toContain(`${((totalAllocated / totalAvailable) * 100).toFixed(2)}%`);
            expect(Number(body.match(/Overbooked\s+people at risk\s+(\d+)/)[1]), 'Overbooked tile').toBe(overbooked);
        });

        test('changing the period updates the figures (2025 cannot allocate more than All Time)', async ({ page }) => {
            await showFifty(page);
            const allocatedFor = async () => (await firstTableRows(page)).reduce((sum, r) => sum + days(r[2]), 0);
            const allTime = await allocatedFor();
            await page.getByRole('button', { name: '2025', exact: true }).click();
            await settle(page);
            await showFifty(page);
            expect(await allocatedFor()).toBeLessThanOrEqual(allTime);
            await page.getByRole('button', { name: 'All Time', exact: true }).click();
            await settle(page);
            await showFifty(page);
            expect(await allocatedFor(), 'All Time restored').toBe(allTime);
        });

        test('the Event view lists events with their people, planned days and status', async ({ page }) => {
            await page.getByRole('button', { name: 'Event', exact: true }).click();
            await settle(page);
            await expect(page.getByText(/People allocation per event — \d+ events with staff/)).toBeVisible();
            for (const label of ['Events with staff', 'Total Person Days', 'Avg Utilisation', 'Overrun']) {
                await expect(page.getByText(label, { exact: true }).first(), label).toBeVisible();
            }
            for (const heading of ['Event', 'Date', 'People', 'Planned Days', 'Actual Days', 'Gross Profit', 'People Cost', 'Net Profit', 'Utilisation', 'Status']) {
                await expect(page.locator('thead').first(), heading).toContainText(heading);
            }
            await showFifty(page);
            const rows = await firstTableRows(page);
            const count = Number((await page.getByText(/People allocation per event — \d+ events/).innerText()).match(/— (\d+)/)[1]);
            expect(rows.length, 'Events in the table agree with the header').toBe(count);
            const planned = rows.reduce((sum, r) => sum + days(r[3]), 0);
            expect(await page.locator('body').innerText(), 'Total person days planned').toContain(`${round(planned)}d`);
            const overrun = rows.filter(r => r.includes('Over Plan')).length;
            const tiles = await page.locator('body').innerText();
            expect(Number(tiles.match(/Overrun\s+events over capacity\s+(\d+)/)[1]), 'Overrun tile').toBe(overrun);
        });

        test('Actual Charges lists the team members and roles with their logged hours', async ({ page }) => {
            await expect(page.getByText('Actual Charges')).toBeVisible();
            await expect(page.getByText('Calculated from submitted time logs and their saved hourly charge rates')).toBeVisible();
            await expect(page.getByRole('button', { name: 'Team Members', exact: true })).toBeVisible();
            for (const heading of ['Team member / role', 'Currency', 'Time logs', 'Logged hours', 'Avg charge rate / hour', 'Chargeable value']) {
                await expect(page.locator('thead').last(), heading).toContainText(heading);
            }
            await page.getByRole('button', { name: 'Roles', exact: true }).click();
            await settle(page);
            const roles = await page.locator('table').last().locator('tbody tr').allInnerTexts();
            for (const role of ['Bookkeeper', 'Cost Manager', 'Director', 'Ticket Manager']) {
                expect(roles.join('\n'), role).toContain(role);
            }
        });

        test('Export PDF requests the utilisation export', async ({ page }) => {
            const link = page.getByRole('link', { name: /Export PDF/ }).or(page.getByRole('button', { name: /Export PDF/ })).first();
            const request = page.waitForRequest(r => /time-logs\/utilisation\/export/.test(r.url()), { timeout: 20000 });
            await link.click();
            expect((await request).url()).toContain('view=employee');
        });
    });

    test.describe('Time Logs', () => {
        test('opens on the current week calendar', async ({ page }) => {
            await open(page, TIME_LOGS_URL, 'This week');
            await expect(page.getByText(/\d{1,2} \w{3} \d{4} - \d{1,2} \w{3} \d{4}/)).toBeVisible();
            await expect(page.getByText(/\d+(\.\d+)?h this week/)).toBeVisible();
            for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
                await expect(page.getByText(day, { exact: true }).first(), day).toBeVisible();
            }
            for (const hour of ['12am', '9am', '12pm', '11pm']) {
                await expect(page.getByText(hour, { exact: true }), hour).toBeVisible();
            }
            await expect(page.getByRole('button', { name: 'Calendar', exact: true })).toBeVisible();
            await expect(page.getByRole('button', { name: 'Table', exact: true })).toBeVisible();
        });

        test('Table view lists the time logs with their duration, charge and status', async ({ page }) => {
            await open(page, TIME_LOGS_URL, 'This week');
            await page.getByRole('button', { name: 'Table', exact: true }).click();
            await settle(page);
            for (const heading of ['Started', 'Team member', 'Event', 'Description', 'Charge to', 'Duration', 'Charge rate / hour', 'Chargeable value', 'Status']) {
                await expect(page.locator('thead').first(), heading).toContainText(heading);
            }
            await showFifty(page);
            const rows = await firstTableRows(page);
            expect(rows.length, 'Time logs listed').toBeGreaterThan(0);
            for (const row of rows) {
                expect(row.join(' '), 'Duration is hours and minutes').toMatch(/\d+h \d{2}m|\d+m/);
                expect(row.at(-1), 'Status').toMatch(/Submitted|Draft|Approved|Rejected/);
            }
            // Newest first
            const starts = rows.map(r => new Date(r[0].replace(/^(\d+) (\w+) (\d+)/, '$1 $2 $3')).getTime());
            expect(starts, 'Newest first').toEqual([...starts].sort((a, b) => b - a));
        });

        test('logged hours in Actual Charges agree with the Time Logs table for a team member', async ({ page }) => {
            test.skip(!TEAM_MEMBER, 'Set UTILISATION_TEAM_MEMBER to run the team member time-log comparison');
            await open(page, TIME_LOGS_URL, 'This week');
            await page.getByRole('button', { name: 'Table', exact: true }).click();
            await settle(page);
            await showFifty(page);
            const mine = (await firstTableRows(page)).filter(r => r.join(' ').includes(TEAM_MEMBER));
            expect(mine.length, `${TEAM_MEMBER} has time logs`).toBeGreaterThan(0);
            const minutes = text => {
                const h = text.match(/(\d+)h/);
                const m = text.match(/(\d+)m/);
                return (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0);
            };
            const logged = mine.reduce((sum, r) => sum + minutes(r.find(c => /^\d+h \d+m$|^\d+m$/.test(c)) ?? ''), 0) / 60;

            await open(page, RESOURCE_URL, 'Allocation across assigned events');
            await showFifty(page);
            const row = page.getByRole('row', { name: new RegExp(TEAM_MEMBER) }).last();
            await expect(row).toContainText(`${mine.length}`);
            const text = await row.innerText();
            expect(parseFloat(text.match(/([\d.]+)h/)[1]), 'Logged hours').toBeCloseTo(logged, 1);
        });
    });

    test.describe('Test user (eweventuser@gmail.com)', () => {
        test('appears in the employee table and in Actual Charges with figures that agree with Time Logs', async ({ page }) => {
            await open(page, RESOURCE_URL, 'Allocation across assigned events');
            await showFifty(page);
            const employee = (await firstTableRows(page)).find(r => r[0].includes(TEST_USER));
            expect(employee, `${TEST_USER} is in the employee table`).toBeDefined();
            const [, available, allocated, remaining, capacity] = employee;
            expect(days(remaining), 'Remaining').toBe(round(days(available) - days(allocated)));
            expect(percent(capacity)).toBeGreaterThanOrEqual(0);

            const charges = page.getByRole('row', { name: new RegExp(`${TEST_USER}`) }).last();
            await expect(charges, `${TEST_USER} in Actual Charges`).toBeVisible();
            const loggedHours = parseFloat((await charges.innerText()).match(/([\d.]+)h/)[1]);

            await open(page, TIME_LOGS_URL, 'This week');
            await page.getByRole('button', { name: 'Table', exact: true }).click();
            await settle(page);
            await showFifty(page);
            const logs = (await firstTableRows(page)).filter(r => r.join(' ').includes(TEST_USER));
            expect(logs.length > 0, 'Has time logs only if Actual Charges shows logged hours').toBe(loggedHours > 0);
        });
    });

    test.describe('Tasks', () => {
        test.beforeEach(async ({ page }) => {
            await open(page, TASKS_URL, 'Manage preset tasks and the hourly chargeable rate');
        });

        test('lists the preset tasks with their hourly chargeable rate', async ({ page }) => {
            await expect(page.getByText('Manage preset tasks and the hourly chargeable rate used when time is logged to them.')).toBeVisible();
            await expect(page.getByRole('button', { name: /Add Task/ })).toBeVisible();
            await expect(page.locator('thead')).toContainText('Task');
            await expect(page.locator('thead')).toContainText('Chargeable rate');

            const rows = await firstTableRows(page);
            expect(rows.length, 'Tasks listed').toBeGreaterThan(0);
            for (const row of rows) {
                expect(row.join(' '), 'Rate per hour').toMatch(/£[\d,]+\.\d{2} \/ hour/);
            }
            await expect(page.getByText('On Site Production Fee')).toBeVisible();
            await expect(page.getByRole('button', { name: 'Edit On Site Production Fee' })).toBeVisible();
            await expect(page.getByRole('button', { name: 'Delete On Site Production Fee' })).toBeVisible();
        });

        test('Add Task opens a form with name, description and rate, and Cancel closes it without creating a task', async ({ page }) => {
            const before = (await firstTableRows(page)).length;
            await page.getByRole('button', { name: /Add Task/ }).click();
            await expect(page.getByPlaceholder('e.g. Event setup')).toBeVisible();
            await expect(page.getByPlaceholder('Add a short description')).toBeVisible();
            await expect(page.getByText('Chargeable rate per hour')).toBeVisible();
            await expect(page.getByRole('button', { name: 'Create Task' })).toBeVisible();

            await page.getByRole('button', { name: 'Cancel' }).click();
            await expect(page.getByPlaceholder('e.g. Event setup')).toBeHidden();
            expect((await firstTableRows(page)).length, 'No task created').toBe(before);
        });
    });
});
