// revenueTickets.spec.js
// Revenue module > Revenue Streams > Tickets:
//   - Mode selection (Combined / Face Value Only / Rebate Only) — only on this stream
//   - Ticket Sellers tab — seller ticket details match the Tickets tab, no duplicates
//   - Add new ticket — the shortcut menu and the "New Ticket" button open the same window
//   - New Ticket — creates a ticket with no console errors; it shows under the
//     Tickets and Ticket Sellers tabs (the ticket is deleted again afterwards)
// Runs against REVENUE_TICKETS_EVENT_URL (an open event).
import { test, expect } from '../../fixtures/baseTest.js';
import { cleanupWithWarning } from '../utils/test-helpers.js';

const EVENT_URL = (process.env.REVENUE_TICKETS_EVENT_URL || process.env.BUDGET_EVENT_URL || '').replace(/\/$/, '');
const TICKET_PREFIX = 'AutoTicket_';
const MODES = ['Combined', 'Face Value Only', 'Rebate Only'];

async function openRevenueTickets(revenuePage) {
    revenuePage.eventBaseUrl = EVENT_URL;
    await revenuePage.gotoRevenueDashboard();
    await revenuePage.expandTicketsStream();
}

// The "New Ticket" button sits on the Tickets stream of the Budgeting > Revenue Budget page.
async function openNewTicketWindowFromBudget(page, budgetingPage) {
    budgetingPage.eventBaseUrl = EVENT_URL;
    await budgetingPage.gotoRevenueBudgetPage();
    const section = page.locator('div.ew-data-table').filter({ hasText: 'Revenue Streams' }).first();
    await section.locator('tr.tw-cursor-pointer')
        .filter({ has: page.getByRole('heading', { name: 'Tickets', exact: true }) })
        .first()
        .click();
    const newTicket = page.getByRole('button', { name: /New Ticket/ }).first();
    await expect(newTicket, 'New Ticket button should be available').toBeVisible({ timeout: 10000 });
    await newTicket.click();
}

async function openAddTicketsFromShortcut(page, dashboardPage) {
    await dashboardPage.openShortcutMenu();
    await page.getByText('Ticket Type', { exact: true }).first().click();
    // The Quick Create menu stays open over the window until the mouse leaves it.
    await page.mouse.move(400, 900);
}

const byName = rows => Object.fromEntries(rows.map(row => [row['Ticket Name'], row]));

test.describe('Revenue - Tickets stream', () => {

    test.beforeAll(() => {
        if (!EVENT_URL) throw new Error('REVENUE_TICKETS_EVENT_URL is not set');
    });

    test('Mode selection is only available on Revenue > Revenue Streams > Tickets', async ({ page, revenuePage, budgetingPage }) => {
        test.setTimeout(180000);
        await openRevenueTickets(revenuePage);

        const original = await revenuePage.getTicketMode();
        const menu = await revenuePage.openTicketModeMenu();
        for (const mode of MODES) {
            await expect(menu.getByText(mode, { exact: true }), `Mode option "${mode}"`).toBeVisible();
        }
        await page.keyboard.press('Escape');

        // Combined = Face Value + Rebate for every ticket's budgeted amounts.
        const figures = {};
        try {
            for (const mode of MODES) {
                await revenuePage.selectTicketMode(mode);
                figures[mode] = byName(await revenuePage.readTicketsTable());
            }
        } finally {
            await cleanupWithWarning('ticket mode', () => revenuePage.selectTicketMode(original));
        }
        for (const [name, combined] of Object.entries(figures['Combined'])) {
            for (const key of ['Budgeted Net', 'Budgeted Gross']) {
                const faceValue = figures['Face Value Only'][name][key];
                const rebate = figures['Rebate Only'][name][key];
                console.log(`  ${name} ${key}: Combined £${combined[key]} = Face Value £${faceValue} + Rebate £${rebate}`);
                expect(combined[key], `${name} ${key}: Combined = Face Value + Rebate`).toBeCloseTo(faceValue + rebate, 2);
            }
        }

        // Not offered on other revenue streams…
        const section = page.locator('div.ew-data-table').filter({ hasText: 'Revenue Streams' }).first();
        const otherStream = section.locator('tr.tw-cursor-pointer')
            .filter({ hasNot: page.getByRole('heading', { name: 'Tickets', exact: true }) })
            .first();
        const otherName = (await otherStream.getByRole('heading').first().innerText()).trim();
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(section).toBeVisible({ timeout: 30000 });
        await otherStream.click();
        await expect(page.locator('tr.expanded-row').first()).toBeVisible({ timeout: 15000 });
        await expect(page.getByText(/Mode:/), `Mode selector should not show for ${otherName}`).toHaveCount(0);

        // …nor on the Budgeting Tickets stream.
        budgetingPage.eventBaseUrl = EVENT_URL;
        await budgetingPage.gotoRevenueBudgetPage();
        await section.locator('tr.tw-cursor-pointer')
            .filter({ has: page.getByRole('heading', { name: 'Tickets', exact: true }) })
            .first()
            .click();
        await expect(page.locator('tr.expanded-row').first()).toBeVisible({ timeout: 15000 });
        await expect(page.getByText(/Mode:/), 'Mode selector should not show in Budgeting').toHaveCount(0);
    });

    test('Ticket Sellers tab shows correct ticket details with no duplicates', async ({ revenuePage }) => {
        test.setTimeout(180000);
        await openRevenueTickets(revenuePage);
        const tickets = byName(await revenuePage.readTicketsTable());
        expect(Object.keys(tickets).length, 'Tickets tab should list ticket types').toBeGreaterThan(0);

        await revenuePage.selectTicketsTab('Ticket Sellers');
        const sellers = await revenuePage.getTicketSellers();
        expect(sellers.length, 'Ticket Sellers tab should list sellers').toBeGreaterThan(0);
        console.log(`🏪 Sellers: ${sellers.join(', ')}`);

        const totals = {};
        for (const seller of sellers) {
            await revenuePage.selectTicketSeller(seller);
            const rows = await revenuePage.readTicketsTable();
            const names = rows.map(row => row['Ticket Name']);
            console.log(`  ${seller}: ${names.join(', ') || '(no tickets)'}`);

            expect(new Set(names).size, `${seller} should not list duplicate tickets (${names.join(', ')})`).toBe(names.length);
            for (const row of rows) {
                const ticket = tickets[row['Ticket Name']];
                expect(ticket, `${seller}: "${row['Ticket Name']}" should exist on the Tickets tab`).toBeTruthy();
                expect(row['Category'], `${seller}: ${row['Ticket Name']} category`).toBe(ticket['Category']);
                expect(row['Price'], `${seller}: ${row['Ticket Name']} price`).toBeCloseTo(ticket['Price'], 2);
                for (const key of ['Fixed', 'Available', 'Sold']) {
                    totals[row['Ticket Name']] ??= { Fixed: 0, Available: 0, Sold: 0 };
                    totals[row['Ticket Name']][key] += row[key];
                }
            }
        }

        // Each ticket's quantities across all sellers add up to the Tickets tab.
        for (const [name, ticket] of Object.entries(tickets)) {
            for (const key of ['Fixed', 'Available', 'Sold']) {
                expect(totals[name]?.[key] ?? 0, `${name} ${key}: sum across sellers = Tickets tab`).toBe(ticket[key]);
            }
        }
    });

    test('Shortcut menu and New Ticket button open the same Add Tickets window', async ({ page, revenuePage, budgetingPage, dashboardPage }) => {
        test.setTimeout(180000);

        revenuePage.eventBaseUrl = EVENT_URL;
        await revenuePage.gotoRevenueDashboard();
        await openAddTicketsFromShortcut(page, dashboardPage);
        const fromShortcut = await revenuePage.getAddTicketsWindowLayout();
        await revenuePage.closeAddTicketsWindow();

        await openNewTicketWindowFromBudget(page, budgetingPage);
        const fromButton = await revenuePage.getAddTicketsWindowLayout();
        await revenuePage.closeAddTicketsWindow();

        console.log('🪟 Add Tickets window:', fromButton);
        expect(fromButton.columns).toEqual(expect.arrayContaining(['Name', 'Revenue Stream', 'Category', 'Price', 'Fixed']));
        expect(fromButton, 'New Ticket button window should match the shortcut menu window').toEqual(fromShortcut);
    });

    test('New Ticket creates a ticket shown under Tickets and Ticket Sellers with no console errors', async ({ page, revenuePage, budgetingPage, ticketingPage }) => {
        test.setTimeout(300000);
        const ticket = {
            name: `${TICKET_PREFIX}${Date.now().toString().slice(-6)}`,
            category: 'Earlybird',
            price: 50,
            headcount: 10,
            fixed: 100,
            allocated: 100,
            rebate: 2,
        };

        // Clear tickets left behind by an earlier failed run.
        await ticketingPage.deleteTicketTypes(EVENT_URL, new RegExp(`^${TICKET_PREFIX}`));

        const consoleErrors = [];
        page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
        page.on('pageerror', error => consoleErrors.push(error.message));

        try {
            await test.step('Create the ticket from the New Ticket button', async () => {
                await openNewTicketWindowFromBudget(page, budgetingPage);
                await revenuePage.createTicketInAddTicketsWindow(ticket);
                expect(consoleErrors, 'No console errors while creating the ticket').toEqual([]);
            });

            await test.step('Ticket shows on the Tickets tab', async () => {
                await openRevenueTickets(revenuePage);
                const row = byName(await revenuePage.readTicketsTable())[ticket.name];
                expect(row, `${ticket.name} should be on the Tickets tab`).toBeTruthy();
                expect(row['Category']).toBe(ticket.category);
                expect(row['Fixed']).toBe(ticket.fixed);
                expect(row['Price']).toBeCloseTo(ticket.price, 2);
                expect(row['Available']).toBe(ticket.allocated);
                expect(row['Sold']).toBe(0);
            });

            await test.step('Ticket shows under the Direct Sales ticket seller', async () => {
                await revenuePage.selectTicketsTab('Ticket Sellers');
                await revenuePage.selectTicketSeller('Direct Sales');
                const rows = await revenuePage.readTicketsTable();
                const matches = rows.filter(r => r['Ticket Name'] === ticket.name);
                expect(matches, `${ticket.name} should be listed once under Direct Sales`).toHaveLength(1);
                const [row] = matches;
                expect(row['Category']).toBe(ticket.category);
                expect(row['Price']).toBeCloseTo(ticket.price, 2);
                expect(row['Rebate']).toBeCloseTo(ticket.rebate, 2);
                expect(row['Fixed']).toBe(ticket.fixed);
                expect(row['Available']).toBe(ticket.allocated);
                expect(row['Sold']).toBe(0);
            });

            expect(consoleErrors, 'No console errors').toEqual([]);
        } finally {
            await cleanupWithWarning(`ticket ${ticket.name}`, () => ticketingPage.deleteTicketTypes(EVENT_URL, ticket.name));
        }
    });
});
