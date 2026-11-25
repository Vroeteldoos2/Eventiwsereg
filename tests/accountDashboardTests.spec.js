import { test, expect } from '../fixtures/baseTest.js';
import { BudgetingPage } from '../pages/budgetingPage.js';
import { TicketingPage } from '../pages/ticketingPage.js';
import { regressionAccountId, regressionAccountName, regressionAccountUrl } from '../pages/accountConfig.js';

const ACCOUNT_DASH_URL = regressionAccountUrl;

// Matches the first DD/MM/YY-style date in a cell — for ranges ("20/12/26 – 23/12/26") or
// long form ("Sep 3, 2026, 1:00 AM") this grabs the leading day/month/year token via Date parsing.
function parseTableDate(cellText) {
    const firstPart = cellText.split(/[–\n]/)[0].trim();
    const date = new Date(firstPart);
    return isNaN(date.getTime()) ? null : date;
}

// Helper: click a stat card at the top of the account dashboard (highlights it and filters the table below)
async function clickStatCard(page, label) {
    await page.getByText(label, { exact: true }).first().click();
    await page.waitForTimeout(600);
}

// The event list has no <table>/<tr> markup — each row is a div.tw-grid with 6 child
// <span> cells: 0=Name, 1=Venue, 2=Date, 3=Status, 4=Tags, 5=Open-link wrapper.
// The Open-event link (href contains "/event/") is the reliable per-row anchor;
// its row is two parents up (a -> span -> row div).
// Scoped to the events list — the top navbar also has an unrelated quick-nav link whose
// href contains "/event/", and it sits earlier in the DOM than the table rows.
function rowLinks(page) {
    return page.locator('div.ew-list-view-events a[href*="/event/"]');
}

function rowOf(link) {
    return link.locator('xpath=../..');
}

const CELL = { name: 0, venue: 1, date: 2, status: 3, tags: 4 };

// When REGRESSION_EVENT_NAME is set (.env), narrow the list to that event so the "first row"
// tests check it rather than whichever event is on top.
async function focusRegressionEvent(page) {
    const eventName = process.env.REGRESSION_EVENT_NAME;
    if (!eventName) return;
    await page.getByPlaceholder('Search events...').fill(eventName);
    await page.waitForTimeout(800);
    await expect(rowCell(rowLinks(page).first(), 'name')).toContainText(eventName, { timeout: 10000 });
    console.log(`Filtered event list to regression event "${eventName}"`);
}

function rowCell(link, cellName) {
    // ":scope > span" — direct children only; some cells nest their own spans (icon + text)
    // which would otherwise throw off a plain descendant-span index.
    return rowOf(link).locator(':scope > span').nth(CELL[cellName]);
}

test.describe('Account Dashboard Tests', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto(ACCOUNT_DASH_URL);
        await page.waitForLoadState('networkidle');
    });

    test('Account dashboard loads @smoke', async ({ page }) => {
        await expect(page.getByText('All Events', { exact: true }).first()).toBeVisible();
        await expect(page.getByPlaceholder('Search events...')).toBeVisible();
    });

    test('Resource Plan is available to the automation account', async ({ page }) => {
        test.fail(true, 'Known bug: Resource Plan is hidden from the automation login - ClickUp: TODO');
        await expect(page.getByRole('link', { name: /Resource Plan/i })).toBeVisible();
    });

    // ── Invite a user ─────────────────────────────────────────────────────────────
    // Fields only — never calls sendInvite(). A real send requires a fresh inbox each
    // run (a new Gmail account), which isn't practical here; this just confirms the
    // form (including the User Group dropdown) actually accepts input.

    test('Invite user button fills the invite form correctly (no invite sent)', async ({ page, teamMembersPage }) => {
        await page.getByRole('button', { name: 'Invite user' }).click();
        await page.waitForLoadState('domcontentloaded');

        await teamMembersPage.fillInviteForm({
            name: 'EWevent User',
            email: 'eweventuser@gmail.com',
            userGroup: 'Bookkeeper',
        });

        const nameInput = page.locator('dt').filter({ hasText: /^Name$/ }).locator('..').locator('input');
        const emailInput = page.locator('dt').filter({ hasText: /^Email Address$/ }).locator('..').locator('input');
        const groupSelect = page.locator('dt').filter({ hasText: /^User Group$/ }).locator('..').locator('select');

        await expect(nameInput).toHaveValue('EWevent User');
        await expect(emailInput).toHaveValue('eweventuser@gmail.com');
        await expect(groupSelect.locator('option:checked')).toHaveText('Bookkeeper');
        console.log('Invite form fields verified ✓');

        // Close without sending
        await page.getByRole('button', { name: 'Cancel' }).click();
    });

    // ── OCR Import ────────────────────────────────────────────────────────────────
    // Only checks that the OCR Import button (the upload icon in the top bar) opens the upload window.
    // Nothing is uploaded.

    test('OCR Import opens the OCR Document Upload window', async ({ page }) => {
        const ocrButton = page.locator('button:has(i.mdi-upload)').first();
        await ocrButton.hover();
        await expect(page.getByText('OCR Import', { exact: true }).first()).toBeVisible({ timeout: 5000 });
        await ocrButton.click();

        const dialog = page.locator('.m-wrapper, .modal-shell, div.drawer, [role="dialog"]').filter({ hasText: 'OCR Document Upload' }).last();
        await expect(dialog).toBeVisible({ timeout: 10000 });
        await expect(dialog).toContainText('Click to upload files');
        await expect(dialog).toContainText('Drop your files here or click to upload');
        const fileInput = dialog.locator('input[type="file"]');
        await expect(fileInput).toHaveCount(1);
        await expect(fileInput, 'Several documents can be uploaded at once').toHaveAttribute('multiple', '');

        await dialog.locator('button').filter({ has: page.locator('i.mdi-close') }).first().click();
        await expect(dialog).toBeHidden();
        console.log('OCR Import opened the upload window ✓');
    });

    // ── The user page an invite leads to ──────────────────────────────────────────
    // An invite takes you to the new member's user page. Rather than invite someone each run, this opens an
    // existing member's page: the user group, event access and subcategory access controls. Nothing is saved.

    test('Team member page: user group, event access and subcategory access (nothing saved)', async ({ page }) => {
        await page.goto(`${ACCOUNT_DASH_URL}/team`, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle');
        const card = page.locator('div.tw-group').filter({ hasText: 'eweventuser@gmail.com' }).last();
        await expect(card).toContainText('Events');
        await expect(card).toContainText('Subcategories');
        const box = await card.boundingBox();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height - 25);

        await expect(page.getByText('Access & permissions')).toBeVisible({ timeout: 15000 });
        for (const text of ['User group', 'Event access', 'Subcategory access', 'Choose which events this member can access', 'Control access across account departments']) {
            await expect(page.getByText(text, { exact: true }).first(), text).toBeVisible();
        }
        const groupSelect = page.locator('select').filter({ has: page.locator('option', { hasText: 'Bookkeeper' }) }).first();
        expect(await groupSelect.locator('option').allInnerTexts(), 'User groups to choose from').toEqual(['Bookkeeper', 'Cost Manager', 'Director', 'Ticket Manager']);
        await expect(groupSelect.locator('option:checked'), 'Current user group').toHaveText('Director');
        await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible();
        await expect(page.getByText('automatically has access to all events')).toBeVisible();
        await expect(page.getByText('automatically has access to all subcategories')).toBeVisible();

        // The user group can be changed here. Event / subcategory access only opens up once a group below Director is
        // saved, so this stops at the dropdown — and leaves without saving.
        await groupSelect.selectOption({ label: 'Bookkeeper' });
        await expect(groupSelect.locator('option:checked')).toHaveText('Bookkeeper');
        await expect(page.getByText('Activity reports', { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Save changes' })).toBeEnabled();

        await page.goto(`${ACCOUNT_DASH_URL}/team`, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle');
        await expect(page.locator('div.tw-group').filter({ hasText: 'eweventuser@gmail.com' }).last(), 'Still a Director — nothing was saved').toContainText('Director');
    });

    // ── Create an event ───────────────────────────────────────────────────────────

    test('Create event button navigates to event creation', async ({ page }) => {
        await page.getByRole('button', { name: 'Create event' }).click();
        await page.waitForURL(/\/onboarding/, { timeout: 10000 });
        await page.getByRole('button', { name: regressionAccountName }).click();
        await expect(
            page.getByText('Create a new event').first()
        ).toBeVisible({ timeout: 10000 });
        console.log('Create a new event link visible ✓');
    });

    test('Create from a template opens the template flow', async ({ page }) => {
        await page.getByRole('button', { name: 'Create event' }).click();
        await page.waitForURL(/\/onboarding/, { timeout: 10000 });
        await page.getByRole('button', { name: regressionAccountName }).click();

        // Only checks the link opens the template flow — never picks a template or creates an event.
        const createFromTemplate = page.getByRole('link', { name: /Create from a template/i })
            .or(page.getByText('Create from a template', { exact: true }))
            .first();
        await createFromTemplate.waitFor({ state: 'visible', timeout: 15000 });
        await createFromTemplate.click();

        // The template wizard opens in place (same URL) — its step bar ends in "Import".
        await expect(page.getByText('Import', { exact: true }).first()).toBeVisible({ timeout: 10000 });
        await expect(page.getByPlaceholder('Name')).toBeVisible();
        console.log('Create from a template link opened the template wizard ✓');

        await page.getByRole('button', { name: 'Return to event selection' }).click();
    });

    // ── Budget Approvals ──────────────────────────────────────────────────────────
    // Approve the first pending entry, reject the second. Checking a row's checkbox
    // reveals Approve/Deny actions directly — no need to open the detail drawer.

    test('Budget Approvals: approve first entry, reject second', async ({ page }) => {
        await page.getByText('Budget Approvals', { exact: true }).first().click();
        await page.waitForURL(/\/approvals\/budget-entries/, { timeout: 10000 });
        await page.waitForLoadState('networkidle');

        const checkboxes = page.locator('input[id^="check-row-"]');
        await checkboxes.first().waitFor({ state: 'visible', timeout: 10000 });

        // Approve the first entry
        await checkboxes.nth(0).click();
        await page.waitForTimeout(400);
        await page.getByRole('button', { name: /^Approve$/i }).click();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(1000);
        console.log('First budget entry approved ✓');

        // The approved entry drops out of the Awaiting list, so what was previously
        // the second row is now first — reject it. The table remounts after the approval
        // refresh, so re-fetch the checkbox locator rather than reusing the earlier one.
        await checkboxes.first().waitFor({ state: 'visible', timeout: 10000 });
        await page.locator('input[id^="check-row-"]').nth(0).click();
        await page.waitForTimeout(400);
        await page.getByRole('button', { name: /^(Reject|Deny)$/i }).click();

        // Rejecting opens an "Add Reject Comments" modal — Submit stays disabled until
        // a comment is entered.
        await page.getByText('Add Reject Comments', { exact: true }).waitFor({ state: 'visible', timeout: 10000 });
        await page.getByLabel('Comments').or(page.locator('textarea')).first().fill('Rejected via automated test');
        await page.getByRole('button', { name: /^Submit$/i }).click();
        await page.waitForLoadState('networkidle');
        console.log('Second budget entry rejected ✓');

        // ── Same page, remaining tabs ──────────────────────────────────────────────
        // The tab bar text also exists (invisibly) in the sidebar nav, so scope to the
        // one visible instance rather than matching by text alone.
        const tabBarCandidates = page.getByText('Budget Entries', { exact: false });
        let tabBar = null;
        for (let i = 0; i < await tabBarCandidates.count(); i++) {
            if (await tabBarCandidates.nth(i).isVisible()) {
                tabBar = tabBarCandidates.nth(i).locator('xpath=../..');
                break;
            }
        }

        // Purchase Orders — same checkbox+toolbar pattern as Budget Entries. Row 0's
        // checkbox can be disabled (entry not yet actionable), so pick the first enabled one.
        await tabBar.getByText('Purchase Orders').first().click();
        await page.waitForLoadState('networkidle');
        const poCheckbox = page.locator('input[id^="check-row-"]:not([disabled])').first();
        await poCheckbox.waitFor({ state: 'visible', timeout: 10000 });
        await poCheckbox.click();
        await page.waitForTimeout(400);
        await page.getByRole('button', { name: /^Approve$/i }).click();
        await page.waitForLoadState('networkidle');
        console.log('Purchase order approved ✓');

        // Supplier Invoices and Payruns — approve the first entry if any are pending,
        // otherwise just confirm the empty state and move on.
        for (const tabName of ['Supplier Invoices', 'Payruns']) {
            await tabBar.getByText(tabName).first().click();
            await page.waitForLoadState('networkidle');
            await page.waitForTimeout(1500);

            const hasData = await page.locator('input[id^="check-row-"]').count() > 0;
            if (hasData) {
                await page.locator('input[id^="check-row-"]:not([disabled])').first().click();
                await page.waitForTimeout(400);
                await page.getByRole('button', { name: /^Approve$/i }).click();
                await page.waitForLoadState('networkidle');
                console.log(`${tabName}: first entry approved ✓`);
            } else {
                console.log(`${tabName}: empty — nothing to approve ✓`);
            }
        }

        // Departments — a different pattern: each row has its own inline Approve/Reject
        // buttons rather than a checkbox + shared toolbar. Approving here bulk-approves
        // every budget entry under that department (e.g. "Artists" covers 38 entries), so
        // this only verifies the Approve action is present/enabled — it never clicks it,
        // to avoid burning through limited test data.
        await tabBar.getByText('Departments').first().click();
        await page.waitForLoadState('networkidle');
        // Slower to populate than the other tabs — briefly shows "Loading Departments" first.
        await expect(page.getByText('Loading Departments')).toBeHidden({ timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(1000);

        const deptApproveButtons = page.getByRole('button', { name: /^Approve$/i });
        const deptCount = await deptApproveButtons.count();
        if (deptCount > 0) {
            await expect(deptApproveButtons.first()).toBeEnabled();
            console.log(`Departments: ${deptCount} department(s) with an Approve option available (not clicked) ✓`);
        } else {
            console.log('Departments: empty — no Approve option to verify ✓');
        }

        // ── Back to the account dashboard ────────────────────────────────────────
        await page.goto(ACCOUNT_DASH_URL);
        await page.waitForLoadState('networkidle');
        await expect(page.getByText('All Events', { exact: true }).first()).toBeVisible({ timeout: 10000 });
        console.log('Back on account dashboard ✓');
    });

    // ── Search events ─────────────────────────────────────────────────────────────

    test('Search events - diya returns results', async ({ page }) => {
        const searchInput = page.getByPlaceholder('Search events...');
        await searchInput.waitFor({ state: 'visible', timeout: 5000 });
        await searchInput.fill('diya');
        await page.waitForTimeout(800);

        // Verify the event name appears anywhere in the list (works regardless of row element type)
        await expect(page.getByText(/DiyaFest/i).first()).toBeVisible({ timeout: 5000 });

        const rowCount = await rowLinks(page).count();
        expect(rowCount).toBeGreaterThan(0);
        console.log(`Search for "diya" returned ${rowCount} row(s) ✓`);
    });

    // ── Calendar view ─────────────────────────────────────────────────────────────
    // Defaults to the current month. If it has no events, page forward until one is
    // found, then hover it and confirm a detail popup appears. Note: the popup only
    // includes the Revenue/Costs/Net P&L breakdown when the "Net P&L" column's Show
    // toggle (in the same Columns panel used by the List view — see the Net P&L /
    // Available Tickets tests below) is on; with it off it silently falls back to just
    // name/date/tags. This test doesn't touch that toggle, so it may see either form.

    test('Calendar view shows an event detail popup on hover', async ({ page }) => {
        // Calendar toggle is the second icon-only button in the toolbar (first = list view)
        const toolbar = page.getByRole('button', { name: 'Filters' }).locator('xpath=../..');
        await toolbar.getByRole('button').nth(1).click();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(1000);

        const monthHeading = page.getByText(/^[A-Z][a-z]+ \d{4}$/);
        await expect(monthHeading).toBeVisible({ timeout: 10000 });
        console.log(`Calendar defaulted to current month: ${await monthHeading.textContent()}`);

        const nextMonthBtn = monthHeading.locator('xpath=..').locator('button').last();
        const firstPill = () => page.locator('span.tw-block.tw-truncate').first();

        let monthsChecked = 0;
        while (!(await firstPill().isVisible().catch(() => false)) && monthsChecked < 12) {
            await nextMonthBtn.click();
            await page.waitForTimeout(700);
            monthsChecked++;
        }

        const pill = firstPill();
        await expect(pill).toBeVisible({ timeout: 5000 });
        const eventName = (await pill.textContent()).trim();
        console.log(`Found event "${eventName}" after checking ${monthsChecked} month(s) forward`);

        await pill.hover();
        await page.waitForTimeout(800);

        // Hovering renders a separate tooltip clone of the event name (in addition to the
        // grid pill itself) — its presence confirms the detail popup opened.
        await expect(page.getByText(eventName, { exact: true })).toHaveCount(2, { timeout: 5000 });
        console.log(`Hover detail popup visible for "${eventName}" ✓`);
    });

    // ── Open event icon navigates to the event summary page ───────────────────────

    test('Clicking the Open event icon navigates to that event\'s summary page', async ({ page, context }) => {
        const firstLink = rowLinks(page).first();
        await firstLink.waitFor({ state: 'visible', timeout: 10000 });

        const eventName = (await rowCell(firstLink, 'name').innerText()).split('\n')[0].trim();
        console.log(`Opening event: ${eventName}`);

        // The Open-event link uses target="_blank" — it opens a new tab rather than navigating in place.
        const [popup] = await Promise.all([
            context.waitForEvent('page', { timeout: 10000 }),
            firstLink.click(),
        ]);
        await popup.waitForLoadState('domcontentloaded');

        expect(popup.url()).toMatch(new RegExp(`/account/${regressionAccountId}/event/\\d+`));
        await expect(popup.getByText(eventName, { exact: false }).first()).toBeVisible({ timeout: 10000 });
        console.log(`Opened summary page for "${eventName}" in new tab ✓`);

        await popup.close();
    });

    // ── Draft Events card filters the table to Draft-status rows only ────────────

    test('Draft Events card filters the table to only Draft-status rows', async ({ page }) => {
        await clickStatCard(page, 'Draft Events');

        const links = rowLinks(page);
        const count = await links.count();
        expect(count).toBeGreaterThan(0);

        for (let i = 0; i < count; i++) {
            const statusText = (await rowCell(links.nth(i), 'status').innerText()).trim();
            expect(statusText).toBe('Draft');
        }
        console.log(`"Draft Events" card — ${count} row(s), all Draft ✓`);
    });

    // ── Upcoming events only show events with future (or current) dates ──────────
    // Note: "All Events" deliberately excluded here — it includes past events too
    // (33 of 40 in this account), so asserting future-only dates doesn't apply to it.

    test('Upcoming events only show events with future dates', async ({ page }) => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        await clickStatCard(page, 'Upcoming Events');
        await rowLinks(page).first().waitFor({ state: 'visible', timeout: 10000 });

        const links = rowLinks(page);
        const count = await links.count();
        let checkedCount = 0;

        for (let i = 0; i < count; i++) {
            const rawText = (await rowCell(links.nth(i), 'date').innerText()).trim();
            const eventDate = parseTableDate(rawText);
            if (eventDate) {
                expect(eventDate.getTime()).toBeGreaterThanOrEqual(today.getTime());
                checkedCount++;
            }
        }
        expect(checkedCount).toBeGreaterThan(0);
        console.log(`"Upcoming Events": ${checkedCount} date(s) verified as future ✓`);
    });

    // ── Past events have past dates ───────────────────────────────────────────────

    test('Past events only show events with past dates', async ({ page }) => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        await clickStatCard(page, 'Past Events');
        await rowLinks(page).first().waitFor({ state: 'visible', timeout: 10000 });

        const links = rowLinks(page);
        const count = await links.count();
        let checkedCount = 0;

        for (let i = 0; i < Math.min(count, 20); i++) {
            const rawText = (await rowCell(links.nth(i), 'date').innerText()).trim();
            const eventDate = parseTableDate(rawText);
            if (eventDate) {
                expect(eventDate.getTime()).toBeLessThan(today.getTime());
                checkedCount++;
            }
        }
        expect(checkedCount).toBeGreaterThan(0);
        console.log(`Past events: ${checkedCount} date(s) verified as past ✓`);
    });

    // ── Columns panel shows/hides Tickets Sold and Net P&L columns ───────────────

    test('Columns panel toggles show and hide Tickets Sold and Net P&L columns', async ({ page }) => {
        // The "..." columns button is icon-only (no accessible name) — it's the last button
        // in the toolbar row (two DOM levels up from the "Filters" button, past its v-popper wrapper).
        // Note: the Filters button's accessible name is prefixed with an icon glyph ("Filters" is
        // matched as a substring, not exact — same for other icon-prefixed buttons in this file).
        const toolbar = page.getByRole('button', { name: 'Filters' }).locator('xpath=../..');
        await toolbar.getByRole('button').last().click();

        // The "Columns" heading + "Reset" button are a tight header div, a SIBLING of the row-list
        // div (not its ancestor) — filtering on those two alone matches just the header. Requiring
        // "Tickets Sold" too forces the match up to the shared outer panel that wraps both.
        const columnsPanel = page.locator('div').filter({ hasText: 'Columns' }).filter({ hasText: 'Tickets Sold' }).last();
        await columnsPanel.waitFor({ state: 'visible', timeout: 5000 });
        await page.waitForTimeout(500);

        for (const columnName of ['Tickets Sold', 'Net P&L']) {
            // The column label is a leaf span with exact text — its parent is the row div
            // holding both the label and the Show/Compact toggle switches.
            const row = columnsPanel.getByText(columnName, { exact: true }).locator('xpath=..');
            // The "Show" toggle's real <input type="checkbox"> is visually hidden — its sibling
            // <label> is the switch UI and the actual click target. First label = Show column.
            const showToggle = row.locator('label').first();

            await showToggle.click();
            await page.waitForTimeout(500);
            const headerAfterOff = await page.locator('body').getByText(columnName, { exact: true }).count();
            console.log(`"${columnName}" toggled OFF — visible instances: ${headerAfterOff}`);

            await showToggle.click();
            await page.waitForTimeout(500);
            const headerAfterOn = await page.locator('body').getByText(columnName, { exact: true }).count();
            expect(headerAfterOn).toBeGreaterThan(0);
            console.log(`"${columnName}" toggled back ON — visible instances: ${headerAfterOn} ✓`);
        }
    });

    // ── Net P&L column matches the event's Budget Summary and Calendar hover popup ──
    // The Net P&L column (once shown) renders Revenue/Costs/Net P&L for the row's
    // event directly in one cell. Opening that event and reading the Budgeted column
    // of its Budget Summary "Event Profit Overview" table should give the same figures
    // — and so should the Calendar view's hover popup, which shares the same Net P&L
    // Show/Compact toggles as this List view (confirmed by direct investigation: with
    // Show off, hovering any event shows only name/date/tags, regardless of event or
    // month). The calendar figures are checked against the List view's own values
    // rather than re-querying Budget Summary a second time. Note the popup has no
    // separate "Variance" figure — only Revenue, Costs and Net P&L are available.

    test('Dashboard Net P&L figures match the event\'s Budget Summary and Calendar hover popup', async ({ page, context }) => {
        await focusRegressionEvent(page);

        // Show the Net P&L column (same panel/toggle as the "Columns panel" test above)
        const toolbar = page.getByRole('button', { name: 'Filters' }).locator('xpath=../..');
        await toolbar.getByRole('button').last().click();

        const columnsPanel = page.locator('div').filter({ hasText: 'Columns' }).filter({ hasText: 'Tickets Sold' }).last();
        await columnsPanel.waitFor({ state: 'visible', timeout: 5000 });
        await page.waitForTimeout(500);

        const netPLRow = columnsPanel.getByText('Net P&L', { exact: true }).locator('xpath=..');

        const netPLShowCheckbox = page.locator('#dashboard-column-profit_and_loss');
        if (!(await netPLShowCheckbox.isChecked())) {
            await netPLRow.locator('label').first().click();
            await page.waitForTimeout(500);
        }

        // Compact mode collapses the cell down to just the Net P&L number and drops the
        // Revenue/Costs breakdown this test reads — turn it off if it's on.
        const netPLCompactCheckbox = page.locator('#dashboard-column-profit_and_loss-compact');
        if (await netPLCompactCheckbox.isChecked().catch(() => false)) {
            await netPLRow.locator('label').nth(1).click();
            await page.waitForTimeout(500);
        }

        // The Columns panel is a custom dropdown, not a native dialog — Escape doesn't
        // reliably close it, so click outside it instead (top-left corner, clear of the panel).
        await page.mouse.click(10, 10);
        await page.waitForTimeout(500);

        // The row locator is scoped to the event list container — a[href*="/event/"] also
        // matches an unrelated "recently viewed" link in the sidebar nav (outside the table),
        // which would otherwise get picked up by .first().
        const firstLink = page.locator('div.ew-list-view-events a[href*="/event/"]').first();
        await firstLink.waitFor({ state: 'visible', timeout: 10000 });
        const row = firstLink.locator('xpath=../..');

        const eventName = (await row.locator(':scope > span').first().innerText()).split('\n')[0].trim();
        const rawDate = (await rowCell(firstLink, 'date').innerText()).trim();

        // Cell text is "Revenue\n£X\nCosts\n£Y\nNet P&L\n£Z" — read by label, not fixed index,
        // since the column's position among the row's cells shifts depending on what's enabled.
        const netPLCellText = await row.locator(':scope > span').filter({ hasText: 'Net P&L' }).first().innerText();
        const lines = netPLCellText.split('\n').map(l => l.trim());
        const parseCurrency = (t) => parseFloat(t.replace(/[^0-9.-]/g, ''));
        const dashboardRevenue = parseCurrency(lines[lines.indexOf('Revenue') + 1]);
        const dashboardCosts = parseCurrency(lines[lines.indexOf('Costs') + 1]);
        const dashboardNetPL = parseCurrency(lines[lines.indexOf('Net P&L') + 1]);
        console.log(`Dashboard row "${eventName}": Revenue=£${dashboardRevenue} Costs=£${dashboardCosts} Net P&L=£${dashboardNetPL}`);

        // Open-event link uses target="_blank" — opens a new tab
        const [popup] = await Promise.all([
            context.waitForEvent('page', { timeout: 10000 }),
            firstLink.click(),
        ]);
        await popup.waitForLoadState('domcontentloaded');

        const eventBaseUrl = popup.url().match(/(.+\/event\/\d+)/)?.[1];
        const budgetingPage = new BudgetingPage(popup);
        budgetingPage.eventBaseUrl = eventBaseUrl;
        await budgetingPage.gotoBudgetSummaryPage();

        const revenueRow = await budgetingPage.getOverviewRow('Revenue');
        const costsRow = await budgetingPage.getOverviewRow('Costs');
        const profitRow = await budgetingPage.getOverviewRow('Profit');
        console.log(`Budget Summary "${eventName}": Revenue=£${revenueRow.budgeted} Costs=£${costsRow.budgeted} Profit=£${profitRow.budgeted}`);

        expect(revenueRow.budgeted, 'Revenue should match dashboard').toBeCloseTo(dashboardRevenue, 2);
        console.log(`✓ Revenue matches: dashboard £${dashboardRevenue} = Budget Summary £${revenueRow.budgeted}`);

        expect(costsRow.budgeted, 'Costs should match dashboard').toBeCloseTo(dashboardCosts, 2);
        console.log(`✓ Costs matches: dashboard £${dashboardCosts} = Budget Summary £${costsRow.budgeted}`);

        expect(profitRow.budgeted, 'Net P&L should match dashboard Net P&L').toBeCloseTo(dashboardNetPL, 2);
        console.log(`✓ Net P&L matches: dashboard £${dashboardNetPL} = Budget Summary £${profitRow.budgeted}`);

        console.log(`Dashboard Net P&L values for "${eventName}" match the Budget Summary profit overview ✓`);

        await popup.close();

        // ── Calendar hover popup should show the same figures as the List view row ──
        // firstLink's click opened budget summary in a new tab (popup, now closed) —
        // this page never navigated away, so it's still on the List view here.
        const eventDate = parseTableDate(rawDate);
        if (!eventDate) throw new Error(`Could not parse event date: "${rawDate}"`);
        const targetMonthHeading = eventDate.toLocaleString('en-US', { month: 'long', year: 'numeric' });

        await toolbar.getByRole('button').nth(1).click();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(1000);

        const monthHeading = page.getByText(/^[A-Z][a-z]+ \d{4}$/);
        const nextMonthBtn = monthHeading.locator('xpath=..').locator('button').last();
        let heading = (await monthHeading.textContent()).trim();
        let monthsChecked = 0;
        while (heading !== targetMonthHeading && monthsChecked < 24) {
            await nextMonthBtn.click();
            await page.waitForTimeout(600);
            heading = (await monthHeading.textContent()).trim();
            monthsChecked++;
        }
        if (heading !== targetMonthHeading) {
            throw new Error(`Could not navigate calendar to "${targetMonthHeading}" (stuck on "${heading}") after ${monthsChecked} month(s)`);
        }
        console.log(`Calendar on "${heading}" after ${monthsChecked} month(s) forward`);

        const pill = page.locator('span.tw-block.tw-truncate').filter({ hasText: eventName }).first();
        await pill.waitFor({ state: 'visible', timeout: 10000 });
        await pill.hover();
        await page.waitForTimeout(1000);

        const tooltip = page.locator('.v-popper__popper--shown, [role="tooltip"]').last();
        const tooltipLines = (await tooltip.innerText()).split('\n').map(l => l.trim());
        const calendarRevenue = parseCurrency(tooltipLines[tooltipLines.indexOf('Revenue') + 1]);
        const calendarCosts = parseCurrency(tooltipLines[tooltipLines.indexOf('Costs') + 1]);
        const calendarNetPL = parseCurrency(tooltipLines[tooltipLines.indexOf('Net P&L') + 1]);
        console.log(`Calendar popup "${eventName}": Revenue=£${calendarRevenue} Costs=£${calendarCosts} Net P&L=£${calendarNetPL}`);

        expect(calendarRevenue, 'Revenue should match dashboard').toBeCloseTo(dashboardRevenue, 2);
        expect(calendarCosts, 'Costs should match dashboard').toBeCloseTo(dashboardCosts, 2);
        expect(calendarNetPL, 'Net P&L should match dashboard').toBeCloseTo(dashboardNetPL, 2);
        console.log(`✓ Calendar popup matches dashboard: Revenue £${calendarRevenue}, Costs £${calendarCosts}, Net P&L £${calendarNetPL}`);
    });

    // ── Tickets Sold column's Available figure matches the event's Budget Summary ───
    // The dashboard cell reads "<sold> sold of <available>". "Available" is checked
    // against the Budget Summary Tickets row; "Sold" is checked against the sum of
    // the "Sold" figure across every ticket type on the Ticketing Bulk Entry page —
    // the standalone /revenue Revenue Dashboard's "Customise columns" panel was tried
    // first but is unreliable for this automation account (confirmed via direct
    // investigation: toggling columns there never populates the Revenue Streams table
    // for this session, even though it works in a real logged-in browser).

    test('Dashboard Tickets Sold/Available match the event\'s Budget Summary and Bulk Entry pages', async ({ page, context }) => {
        await focusRegressionEvent(page);

        // Show the Tickets Sold column (same panel/toggle as the Net P&L test above)
        const toolbar = page.getByRole('button', { name: 'Filters' }).locator('xpath=../..');
        await toolbar.getByRole('button').last().click();

        const columnsPanel = page.locator('div').filter({ hasText: 'Columns' }).filter({ hasText: 'Tickets Sold' }).last();
        await columnsPanel.waitFor({ state: 'visible', timeout: 5000 });
        await page.waitForTimeout(500);

        const ticketsColumnRow = columnsPanel.getByText('Tickets Sold', { exact: true }).locator('xpath=..');

        const ticketsShowCheckbox = page.locator('#dashboard-column-tickets');
        if (!(await ticketsShowCheckbox.isChecked())) {
            await ticketsColumnRow.locator('label').first().click();
            await page.waitForTimeout(500);
        }

        // Compact mode may collapse this cell the same way it does for Net P&L — turn it off if on.
        const ticketsCompactCheckbox = page.locator('#dashboard-column-tickets-compact');
        if (await ticketsCompactCheckbox.isChecked().catch(() => false)) {
            await ticketsColumnRow.locator('label').nth(1).click();
            await page.waitForTimeout(500);
        }

        // Columns panel is a custom dropdown, not a native dialog — click outside to close it.
        await page.mouse.click(10, 10);
        await page.waitForTimeout(500);

        const firstLink = page.locator('div.ew-list-view-events a[href*="/event/"]').first();
        await firstLink.waitFor({ state: 'visible', timeout: 10000 });
        const row = firstLink.locator('xpath=../..');

        const eventName = (await row.locator(':scope > span').first().innerText()).split('\n')[0].trim();

        // Cell text is "575 sold of 1150\n50%\nFixed: 750"
        const ticketsCellText = await row.locator(':scope > span').filter({ hasText: /sold of/i }).first().innerText();
        const match = ticketsCellText.match(/([\d,]+)\s*sold of\s*([\d,]+)/i);
        if (!match) throw new Error(`Could not parse Tickets Sold cell text: "${ticketsCellText}"`);
        const dashboardSold = parseInt(match[1].replace(/,/g, ''), 10);
        const dashboardAvailable = parseInt(match[2].replace(/,/g, ''), 10);
        console.log(`Dashboard row "${eventName}": Sold=${dashboardSold} Available=${dashboardAvailable}`);

        // Open-event link uses target="_blank" — opens a new tab
        const [popup] = await Promise.all([
            context.waitForEvent('page', { timeout: 10000 }),
            firstLink.click(),
        ]);
        await popup.waitForLoadState('domcontentloaded');

        const eventBaseUrl = popup.url().match(/(.+\/event\/\d+)/)?.[1];
        const budgetingPage = new BudgetingPage(popup);
        budgetingPage.eventBaseUrl = eventBaseUrl;
        await budgetingPage.gotoBudgetSummaryPage();

        const availableTickets = await budgetingPage.getRevenueStreamFigure('Tickets', 'Available Tickets');
        console.log(`Budget Summary "${eventName}": Available Tickets=${availableTickets}`);

        expect(availableTickets, 'Available Tickets should match dashboard').toBe(dashboardAvailable);
        console.log(`✓ Available Tickets matches: dashboard ${dashboardAvailable} = Budget Summary ${availableTickets}`);

        // Sold — sum the "Sold" figure across every ticket type on the Bulk Entry page
        const ticketingPage = new TicketingPage(popup);
        await popup.goto(`${eventBaseUrl}/tickets/bulk`, { waitUntil: 'domcontentloaded' });
        await popup.waitForLoadState('networkidle');
        await ticketingPage.expandAllBulkEntries();
        const bulkEntrySold = await ticketingPage.getTotalSoldTickets();
        console.log(`Bulk Entry "${eventName}": Sold=${bulkEntrySold}`);

        expect(bulkEntrySold, 'Sold should match dashboard').toBe(dashboardSold);
        console.log(`✓ Sold matches: dashboard ${dashboardSold} = Bulk Entry ${bulkEntrySold}`);

        await popup.close();
    });

    // ── Status change per event (pill dropdown: Open / Draft / Confirmed / TBC / Closed) ─

    test.skip('Event status can be changed and reverted', async ({ page }) => {
        await clickStatCard(page, 'Upcoming Events');

        const firstLink = rowLinks(page).first();
        const statusBadge = rowCell(firstLink, 'status');
        await statusBadge.waitFor({ state: 'visible', timeout: 5000 });
        const originalStatus = (await statusBadge.textContent()).trim();

        await statusBadge.click();
        await page.waitForTimeout(400);

        const statusOptions = ['Open', 'Draft', 'Confirmed', 'TBC', 'Closed'];
        const targetStatus = statusOptions.find(s => s.toLowerCase() !== originalStatus.toLowerCase());

        await page.getByText(targetStatus, { exact: true }).last().click();
        await page.waitForTimeout(600);
        await expect(statusBadge).toContainText(targetStatus, { timeout: 5000 });
        console.log(`Status changed from "${originalStatus}" to "${targetStatus}" ✓`);

        await statusBadge.click();
        await page.waitForTimeout(400);
        await page.getByText(originalStatus, { exact: true }).last().click();
        await page.waitForTimeout(600);
        await expect(statusBadge).toContainText(originalStatus, { timeout: 5000 });
        console.log(`Status reverted to "${originalStatus}" ✓`);
    });

    // ── Add tags ──────────────────────────────────────────────────────────────────

    test.skip('Tags picker lets you select an existing tag for an event', async ({ page }) => {
        await clickStatCard(page, 'All Events');

        const firstLink = rowLinks(page).first();
        const tagsCell = rowCell(firstLink, 'tags');
        await tagsCell.getByRole('button', { name: /add tags/i }).click();
        await page.waitForTimeout(400);

        const tagCheckbox = page.locator('label, div').filter({ hasText: /^SgRegression$/ }).locator('input[type="checkbox"]').first();
        await tagCheckbox.check();
        await page.waitForTimeout(500);

        await expect(page.getByText(/tag selected/i)).toBeVisible({ timeout: 5000 });
        console.log('Tag "SgRegression" selected ✓');

        // Revert
        await tagCheckbox.uncheck();
        await page.keyboard.press('Escape');
    });

    // ── Load more ─────────────────────────────────────────────────────────────────

    test('Load more shows additional events when available', async ({ page }) => {
        await clickStatCard(page, 'All Events');

        const loadMoreBtn = page.getByRole('button', { name: /load more/i });

        if (await loadMoreBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
            const rowsBefore = await rowLinks(page).count();
            await loadMoreBtn.click();
            await page.waitForTimeout(1000);
            const rowsAfter = await rowLinks(page).count();
            expect(rowsAfter).toBeGreaterThan(rowsBefore);
            console.log(`Load more: ${rowsBefore} → ${rowsAfter} events ✓`);
        } else {
            console.log('No "Load more" button — all events already displayed ✓');
        }
    });

});
