// ensureTickets.spec.js
// Test-data setup, not a test of the app: makes sure the regression event has tickets before the suites that need them
// (ticketing, revenue tickets, price per head, Budget v Actuals) run. If the event already has tickets nothing is
// changed; if it has none, the "set your tickets up" window on the Tickets page is used to add the same three ticket
// types the event-creation regression sets up (Earlybird, Main, VIP, with a Direct Sales seller).
// Runs against ENSURE_TICKETS_EVENT_URL (falls back to TICKETING_TEST_EVENT_URL / PURCHASING_EVENT_URL).
import { test, expect } from '../../fixtures/baseTest.js';

const EVENT_URL = (process.env.ENSURE_TICKETS_EVENT_URL || process.env.TICKETING_TEST_EVENT_URL || process.env.PURCHASING_EVENT_URL || '').replace(/\/$/, '');

// The ticketing tests import sales dated 12/06/2026 (fixtures/ticket-import-template.csv); the Monthly view starts at the
// event's Project Start, so that has to be on or before the 1st of that month.
test('The Project Start is early enough for the imported sales', async ({ page, eventSettingsPage: settings }) => {
    test.setTimeout(120000);
    if (!EVENT_URL) throw new Error('ENSURE_TICKETS_EVENT_URL / TICKETING_TEST_EVENT_URL / PURCHASING_EVENT_URL is not set');
    await settings.gotoGeneralSettings(EVENT_URL);
    const start = new Date(`${(await settings.projectStartInput.inputValue()).trim()} 12:00`);
    const needed = new Date(2026, 5, 1, 12);
    if (start <= needed) {
        console.log(`📅 Project Start (${start.toDateString()}) is early enough`);
        return;
    }
    await settings.setProjectStart(new Date(2026, 4, 1));
    await settings.gotoGeneralSettings(EVENT_URL);
    await expect(settings.projectStartInput).toHaveValue('May 1, 2026');
    console.log('📅 Project Start set to May 1, 2026');
});

test('The event has tickets (they are added when there are none)', async ({ page, newEventCreationPage }) => {
    test.setTimeout(240000);
    if (!EVENT_URL) throw new Error('ENSURE_TICKETS_EVENT_URL / TICKETING_TEST_EVENT_URL / PURCHASING_EVENT_URL is not set');

    await page.goto(`${EVENT_URL}/tickets/bulk`, { waitUntil: 'domcontentloaded' });
    const noTickets = page.getByText("You haven't created any tickets just yet");
    const hasTickets = page.getByRole('button', { name: /expand all/i }).first();
    await expect(noTickets.or(hasTickets)).toBeVisible({ timeout: 30000 });

    // This is the normal no-op path when the event already has ticket data.
    if (await hasTickets.isVisible()) {
        console.log('🎟️ The event already has tickets — nothing to add');
        return;
    }

    console.log('🎟️ No tickets yet — setting them up');
    const eventName = (await page.locator('body').innerText()).split('\n')[1].trim();
    await page.getByText('click here', { exact: true }).click();

    const newEventPage = newEventCreationPage;
    await newEventPage.waitForTicketSetupModal();
    await expect(page.getByText(`Let's setup your tickets for ${eventName}`, { exact: false })).toBeVisible({ timeout: 10000 });

    await newEventPage.fillTicketRow(0, { name: 'Earlybird', revenueStream: 'Tickets', category: 'General', price: 60, headcount: 200, fixed: 200 });
    await newEventPage.addSeller('Direct Sales');
    await newEventPage.fillAllocated(0, 200);

    await newEventPage.addAnotherTicket();
    await newEventPage.fillTicketRow(1, { name: 'Main', revenueStream: 'Tickets', category: 'General', price: 100, headcount: 200, fixed: 200 });
    await newEventPage.fillAllocated(1, 200);

    await newEventPage.addAnotherTicket();
    await newEventPage.fillTicketRow(2, { name: 'VIP', revenueStream: 'Tickets', category: 'VIP', price: 200, headcount: 0, fixed: 0 });
    await newEventPage.fillAllocated(2, 150);

    await newEventPage.setTaxRate(process.env.REGRESSION_TAX_RATE ?? '20% income');
    await newEventPage.createTickets();
    await expect(page.getByRole('heading', { name: 'Tickets Created' })).toBeVisible({ timeout: 15000 });
    console.log('✅ Tickets created');

    await newEventPage.visitBulkEditor();
    await expect(page.getByRole('button', { name: /expand all/i }).first()).toBeVisible({ timeout: 30000 });
    const names = await page.locator('div.tw-group').allInnerTexts();
    for (const name of ['Earlybird', 'Main', 'VIP']) {
        expect(names.join(' '), `${name} listed on the Tickets page`).toContain(name);
    }
});
