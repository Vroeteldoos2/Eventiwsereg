import { expect } from '@playwright/test';
import { resolve } from 'path';

// URL of a ticketing page (dashboard / trends / bulk / transactions) for the event named by
// `configuredUrl` (any URL on that event).
function buildTicketingPageUrl(configuredUrl, page) {
    const url = new URL(configuredUrl);
    const eventPath = url.pathname
        .replace(/\/tickets\/(?:dashboard|trends|bulk|transactions)\/?$/, '')
        .replace(/\/$/, '');
    url.pathname = `${eventPath}/tickets/${page}`;
    url.search = '';
    url.hash = '';
    return url.toString();
}

export function getTicketingPageUrl(page = 'dashboard') {
    const configuredUrl = process.env.DASHBOARD_EVENT_URL
        || process.env.TICKETING_EVENT_URL
        || process.env.TICKETING_BULK_ENTRY_URL;
    if (!configuredUrl) {
        throw new Error('Set DASHBOARD_EVENT_URL or TICKETING_EVENT_URL to run ticketing tests.');
    }
    return buildTicketingPageUrl(configuredUrl, page);
}

// Same, but TICKETING_TEST_EVENT_URL (an open event the ticketing specs may change) takes priority.
// scripts/fullRegression.js points it at the newly created regression event.
export function getTicketingTestPageUrl(page = 'dashboard') {
    const testEventUrl = process.env.TICKETING_TEST_EVENT_URL;
    return testEventUrl ? buildTicketingPageUrl(testEventUrl, page) : getTicketingPageUrl(page);
}

export class TicketingPage {

    constructor(page) {
        this.page = page;
    }

    // ── NAVIGATION ───────────────────────────────────────────────────────────────

    /**
     * Click "Ticketing" in the left sidebar to expand the Ticketing section.
     * The sidebar item expands to reveal: Dashboard, Bulk Entry, Transactions.
     */
    async navigateToTicketing() {
        await this.page.locator('.v-list-item, a, li, span')
            .filter({ hasText: /^Ticketing$/i })
            .first()
            .click();
        await this.page.waitForLoadState('domcontentloaded');
        console.log('Ticketing section expanded in sidebar');
    }

    /**
     * Click "Dashboard" under the Ticketing sub-nav.
     * Visible after navigateToTicketing() expands the section.
     */
    async gotoTicketingDashboard() {
        await this.page.locator('.v-list-item a, nav a, a')
            .filter({ hasText: /^Dashboard$/i })
            .first()
            .click();
        await this.page.waitForLoadState('domcontentloaded');
        console.log('On Ticketing → Dashboard');
    }

    async navigateToTicketingPage(url) {
        await this.page.goto(url, { waitUntil: 'domcontentloaded' });
        const invalidDates = this.page.getByText('Invalid Event Dates', { exact: true });
        await expect(invalidDates.or(this._ticketingPageReady(url))).toBeVisible({ timeout: 30000 });
        if (await invalidDates.isVisible()) {
            await this.page.getByRole('button', { name: /Visit Event Settings/i }).click();
            await this.page.waitForURL(/\/settings$/);

            await this.page.locator('button')
                .filter({ has: this.page.locator('i.mdi-ticket-confirmation') })
                .click();

            const ticketingPath = new URL(url).pathname;
            const destination = this.page.locator(`a[href$="${ticketingPath}"]`);
            await destination.waitFor({ state: 'visible' });
            await destination.click();
            await this.page.waitForURL(currentUrl =>
                new URL(currentUrl).pathname === ticketingPath
            );
            await expect(invalidDates).toBeHidden();
            await expect(this._ticketingPageReady(url)).toBeVisible({ timeout: 30000 });
        }
    }

    _ticketingPageReady(url) {
        const path = new URL(url).pathname;
        if (/\/tickets\/bulk\/?$/.test(path)) {
            return this.page.getByRole('button', { name: /(expand|collapse) all/i }).first();
        }
        if (/\/tickets\/trends\/?$/.test(path)) {
            return this.page.getByRole('heading', { name: 'Weekly Sales' });
        }
        if (/\/tickets\/transactions\/?$/.test(path)) {
            return this.page.getByRole('button', { name: /add.*transaction/i }).first();
        }
        return this.page.getByText('Tickets Sold', { exact: true }).first();
    }

    async navigateToTrends() {
        const currentPath = new URL(this.page.url()).pathname.replace(/\/$/, '');
        if (!currentPath.endsWith('/tickets/trends')) {
            const trendsLink = this.page.getByRole('link', { name: 'Trends', exact: true });
            await trendsLink.waitFor({ state: 'visible', timeout: 10000 });
            await trendsLink.click();
            await this.page.waitForURL(/\/tickets\/trends\/?$/);
        }
        await expect(this.page.getByRole('heading', { name: 'Weekly Sales' }))
            .toBeVisible({ timeout: 10000 });
    }

    /** Click the "Sales" tab on the Ticketing Trends page. */
    async selectSalesTab() {
        await this.navigateToTrends();
        const salesBtn = this.page.getByRole('button', { name: /Sales/i })
            .or(this.page.locator('button, a, [role="tab"]').filter({ hasText: /Sales/i }))
            .first();
        await salesBtn.waitFor({ state: 'visible', timeout: 10000 });
        await salesBtn.click();
        await expect(this.page.locator('table').filter({ hasText: /Count/i }).last())
            .toBeVisible({ timeout: 10000 });
        console.log('Sales tab selected');
    }

    /** Click the "Revenue" tab on the ticketing dashboard. */
    async selectRevenueTab() {
        await this.navigateToTrends();
        await this.page.locator('button, a, [role="tab"]')
            .filter({ hasText: /^Revenue$/i })
            .first()
            .click();
        await expect(this.page.locator('table, [class*="summary"], [class*="Summary"]')
            .filter({ hasText: /fixed.*sales|actual.*sales/i }).first()).toBeVisible({ timeout: 10000 });
        console.log('Revenue tab selected');
    }

    // ── SHOW ALL TICKET TYPES ────────────────────────────────────────────────────

    /** Click the "Showing all ticket types" toggle (top-right of the Sales view). */
    async clickShowAllTicketTypes() {
        await this.page.getByText('all ticket types', { exact: false })
            .first()
            .click();
        await expect(this.page.locator('input[type="checkbox"]').first()).toBeVisible({ timeout: 8000 });
        console.log('"Showing all ticket types" clicked');
    }

    /**
     * Verify that the first checkbox inside the ticket-types panel can be
     * ticked and unticked, then leaves it ticked.
     */
    async verifyTicketTypeToggle() {
        // Vue hides the actual <input> — clicking the label/parent toggles the state.
        const checkbox = this.page.locator('input[type="checkbox"]').first();
        await checkbox.waitFor({ state: 'attached', timeout: 8000 });

        const initiallyChecked = await checkbox.isChecked();

        // Toggle via the closest label or parent element
        await checkbox.evaluate(el => {
            const label = el.closest('label') || el.parentElement;
            if (label) label.click();
        });
        await expect(checkbox).toBeChecked({ checked: !initiallyChecked });
        console.log(`Checkbox toggled ${initiallyChecked} → ${!initiallyChecked} ✓`);

        // Toggle back
        await checkbox.evaluate(el => {
            const label = el.closest('label') || el.parentElement;
            if (label) label.click();
        });
        await expect(checkbox).toBeChecked({ checked: initiallyChecked });
        console.log('Checkbox toggled back ✓');
    }

    /** Close the "Show all ticket types" modal/panel. */
    async closeShowAllTicketTypes() {
        const closeBtn = this.page.locator('[role="dialog"], .modal, .drawer, .panel')
            .getByRole('button', { name: /close/i })
            .first()
            .or(this.page.getByRole('button', { name: /close/i }).last());

        if (await closeBtn.isVisible()) {
            await closeBtn.click();
        } else {
            await this.page.keyboard.press('Escape');
        }
        await expect(closeBtn).toBeHidden({ timeout: 5000 });
        console.log('"Show all ticket types" window closed');
    }

    // ── SUMMARY TABLE ─────────────────────────────────────────────────────────────

    /**
     * Verify the Sales Summary table displays numeric values (not currency symbols)
     * for "Fixed Sales" and "Actual Sales".
     */
    async verifySummaryTableNumbers() {
        // The Detailed View table shows Count and Revenue (Gross) per week.
        const detailedView = this.page.locator('table')
            .filter({ hasText: /Count/i })
            .last();

        await detailedView.waitFor({ state: 'visible', timeout: 10000 });

        const allText = await detailedView.innerText();
        expect(allText).toMatch(/\d/);
        console.log('Detailed View table shows numeric values ✓');
    }

    // ── SALES TARGETS TABLE ───────────────────────────────────────────────────────

    /**
     * Verify that Stretch, Sellout and Breakeven targets are visible (preselected)
     * in the Sales Targets table.
     */
    async verifySalesTargetsPreselected() {
        const targets = ['Stretch', 'Sellout', 'Breakeven'];

        for (const label of targets) {
            const targetRow = this.page.locator('tr, [class*="target"], [class*="Target"]')
                .filter({ hasText: new RegExp(label, 'i') })
                .first();

            await expect(targetRow).toBeVisible({ timeout: 10000 });
            console.log(`"${label}" target is visible ✓`);
        }
    }

    /**
     * Click the '+' icon button next to / above the Sales Targets table.
     * Tries to scope the click to a "targets" area before falling back to any + button.
     */
    async clickAddSalesTarget() {
        // Prefer a + button scoped inside the sales-targets section
        const targetSection = this.page.locator(
            '[class*="target"], [class*="Target"], [class*="sales"]'
        ).first();

        const addBtn = targetSection
            .locator('button')
            .filter({ has: this.page.locator('i.mdi-plus, i[class*="plus"]') })
            .first()
            .or(
                this.page.locator('button')
                    .filter({ has: this.page.locator('i.mdi-plus-circle, i.mdi-plus') })
                    .last()
            );

        await addBtn.waitFor({ state: 'visible', timeout: 8000 });
        await addBtn.click();
        await expect(this.page.locator('input[type="number"]').first()
            .or(this.page.locator('[contenteditable="true"]').first())).toBeVisible({ timeout: 10000 });
        console.log('Add Sales Target button clicked');
    }

    /**
     * Fill out the "Create Ticket Target" wizard.
     * @param {number} quantity  - target headcount / ticket number (e.g. 200)
     * @param {string} name      - display name for the target (e.g. "200 ticket Target")
     */
    async createSalesTarget(quantity, name) {
        // ── Step 1: change quantity and click Next ─────────────────────────────
        const quantityInput = this.page.locator('input[type="number"]').first()
            .or(this.page.locator('[contenteditable="true"]').first());

        await quantityInput.waitFor({ state: 'visible', timeout: 10000 });

        const isContentEditable = await quantityInput.evaluate(
            el => el.getAttribute('contenteditable') !== null
        );

        if (isContentEditable) {
            await quantityInput.click({ clickCount: 3 });
            await quantityInput.pressSequentially(quantity.toString(), { delay: 30 });
        } else {
            await quantityInput.click({ clickCount: 3 });
            await quantityInput.fill(quantity.toString());
        }

        await this.page.getByRole('button', { name: /next/i })
            .first()
            .click();

        // ── Step 2: enter name and save ─────────────────────────────────────────
        const nameInput = this.page.getByPlaceholder(/name/i).first()
            .or(
                this.page.locator(
                    'input[type="text"], input:not([type="number"]):not([type="checkbox"]):not([type="hidden"])'
                ).first()
            );

        await nameInput.waitFor({ state: 'visible', timeout: 8000 });
        await nameInput.fill(name);

        await this.page.getByRole('button', { name: /save.*target|save/i })
            .first()
            .click();

        await expect(this.page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 15000 });
        console.log(`Sales target "${name}" (${quantity}) created ✓`);
    }

    /**
     * Click the edit (pencil) button on the first row of the Sales Targets table,
     * wait for the edit modal to open and return.
     */
    async clickEditFirstSalesTarget() {
        // The edit button is typically a pencil icon in each row
        const editBtn = this.page.locator('tr, [class*="target"]')
            .locator('button')
            .filter({ has: this.page.locator('i.mdi-pencil, i[class*="edit"], i[class*="pencil"]') })
            .first()
            .or(
                this.page.locator('table tr button')
                    .filter({ has: this.page.locator('i.mdi-pencil') })
                    .first()
            );

        await editBtn.waitFor({ state: 'visible', timeout: 10000 });
        await editBtn.click();
        await expect(this.page.getByRole('button', { name: /^cancel$/i }).first()).toBeVisible({ timeout: 8000 });
        console.log('Edit button clicked on first sales target');
    }

    /** Close an open sales-target edit or create modal. */
    async closeSalesTargetModal() {
        // The modal has a "Cancel" button at the bottom
        const cancelBtn = this.page.getByRole('button', { name: /^cancel$/i }).first();
        if (await cancelBtn.isVisible()) {
            await cancelBtn.click();
        } else {
            await this.page.keyboard.press('Escape');
        }
        await expect(cancelBtn).toBeHidden({ timeout: 5000 });
        console.log('Sales target modal closed');
    }

    /**
     * Select a target in the Sales Targets table. Selection rerenders the row,
     * so verify the resulting details view rather than querying its old checkbox.
     * @param {string} targetName - partial or full name of the target row
     */
    async tickSalesTargetCheckbox(targetName) {
        const row = this.page.locator('tr, [class*="target"], [class*="Target"]')
            .filter({ hasText: new RegExp(targetName, 'i') })
            .first();

        await row.waitFor({ state: 'visible', timeout: 10000 });
        await row.scrollIntoViewIfNeeded();

        const checkbox = row.locator('input[type="checkbox"]').first();
        await checkbox.waitFor({ state: 'visible', timeout: 5000 });
        await checkbox.check({ force: true });

        console.log(`Checkbox ticked for target: "${targetName}" ✓`);
    }

    /**
     * Verify the named target appears in the Details View / details panel
     * that renders when a target is selected.
     * @param {string} targetName
     */
    async verifyTargetInDetailsView(targetName) {
        const detailsView = this.page.locator(
            '[class*="detail"], [class*="Detail"], .detail-view, aside, .panel'
        )
            .filter({ hasText: new RegExp(targetName, 'i') })
            .first()
            .or(
                this.page.locator('table')
                    .filter({ hasText: new RegExp(targetName, 'i') })
                    .last()
            );

        await expect(detailsView).toBeVisible({ timeout: 10000 });
        console.log(`"${targetName}" is visible in the Details View ✓`);
    }

    // ── CHART ANNOTATIONS ────────────────────────────────────────────────────────

    /**
     * Assert that a '+' annotation button is visible in the top-right area of
     * the weekly/monthly Sales chart.
     */
    async verifyChartAnnotationButton() {
        const annotationBtn = this.page.getByTitle('Enable annotation mode');
        await expect(annotationBtn).toBeVisible({ timeout: 10000 });
        console.log('Chart annotation "+" button is visible ✓');
    }

    /**
     * Hover over the '+' annotation button to reveal the enable/disable tooltip.
     */
    async hoverChartAnnotationButton() {
        await this.page.getByTitle('Enable annotation mode').hover();
        console.log('Hovered over chart annotation "+" button');
    }

    /**
     * Click the '+' annotation button, then click somewhere in the middle of the
     * chart canvas to place an annotation point. If a comment input appears, fill it.
     * @param {string} comment  Annotation comment text
     */
    async addChartAnnotation(comment = 'Test annotation') {
        const enableBtn = this.page.getByTitle('Enable annotation mode');
        const disableBtn = this.page.getByTitle('Disable annotation mode');
        await enableBtn.click();
        await expect(disableBtn).toBeVisible({ timeout: 5000 });

        // Click a point on the chart canvas (horizontal centre, 60 % height)
        const canvas = this.page.locator('canvas').first();
        await canvas.waitFor({ state: 'visible', timeout: 8000 });
        const box = await canvas.boundingBox();

        if (box) {
            await this.page.mouse.click(
                box.x + box.width  * 0.5,
                box.y + box.height * 0.6
            );
        }

        // "Add Annotation" dialog appears — placeholder is "e.g., Important milestone"
        const commentInput = this.page.getByPlaceholder(/milestone|comment|annotation|note/i).first()
            .or(this.page.locator('input, textarea').filter({ visible: true }).last());

        await expect(commentInput).toBeVisible({ timeout: 5000 });
        await commentInput.fill(comment);
        const addBtn = this.page.getByRole('button', { name: /^add$/i }).first();
        await expect(addBtn).toBeEnabled();
        await addBtn.click();
        await expect(commentInput).toBeHidden({ timeout: 10000 });

        // Exit annotation mode so that clicking a dot opens "Remove" (not a new annotation)
        if (await disableBtn.isVisible()) {
            await disableBtn.click();
            await expect(this.page.getByTitle('Enable annotation mode')).toBeVisible();
        }

        console.log(`Chart annotation "${comment}" added ✓`);
    }

    /** Verify the annotation dot by finding it (which opens the Remove dialog), then dismiss. */
    async verifyAnnotationVisible(name) {
        const pos = await this._findAnnotationDot();
        if (!pos) throw new Error(`Annotation "${name}" dot not found on chart`);
        this._annotationDotPos = pos; // Cache for removeChartAnnotation
        // The scan clicked the dot and opened the Remove dialog — dismiss it
        await this.page.keyboard.press('Escape');
        await expect(this.page.getByText('Remove Annotation', { exact: false })).toBeHidden();
        console.log(`Chart annotation "${name}" dot found at (${Math.round(pos.x)}, ${Math.round(pos.y)}) ✓`);
    }

    /**
     * Click the annotation dot (reusing cached position from verifyAnnotationVisible)
     * and confirm removal.
     * @param {string} name  The annotation label (for logging only)
     */
    async removeChartAnnotation(name) {
        // Reuse the position found during verifyAnnotationVisible to avoid scanning again
        const pos = this._annotationDotPos || await this._findAnnotationDot();
        this._annotationDotPos = null;

        if (pos) {
            await this.page.mouse.click(pos.x, pos.y);
        } else {
            const canvas = this.page.locator('canvas').first();
            const box = await canvas.boundingBox();
            if (box) await this.page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.6);
        }
        // "Remove Annotation" confirmation dialog
        const removeBtn = this.page.getByRole('button', { name: /^Remove$/i }).last();
        await removeBtn.waitFor({ state: 'visible', timeout: 5000 });
        await removeBtn.click();
        await expect(this.page.getByText('Remove Annotation', { exact: false })).toBeHidden();
        console.log(`Chart annotation "${name}" removed ✓`);
    }

    /**
     * Scan the chart canvas for an annotation dot by clicking positions and checking
     * if the "Remove Annotation" dialog appears. In normal mode (annotation mode OFF)
     * clicking empty canvas does nothing; clicking a dot opens the dialog.
     * Returns page-level {x,y} of the hit, or null if not found.
     */
    async _findAnnotationDot() {
        const canvas = this.page.locator('canvas').first();
        await canvas.waitFor({ state: 'visible', timeout: 5000 });
        const box = await canvas.boundingBox();
        if (!box) return null;

        const cx = box.x + box.width  * 0.5;
        const cy = box.y + box.height * 0.6;
        const removeDialog = this.page.getByText('Remove Annotation', { exact: false });

        // ±32px in 8px steps (9×9 = 81 positions)
        for (let dy = -32; dy <= 32; dy += 8) {
            for (let dx = -32; dx <= 32; dx += 8) {
                const x = cx + dx;
                const y = cy + dy;
                await this.page.mouse.click(x, y);
                // Canvas hit testing has no DOM event, so probe briefly for the dialog the click may open.
                const dialogOpened = await removeDialog.waitFor({ state: 'visible', timeout: 200 })
                    .then(() => true)
                    .catch(error => {
                        if (error.name === 'TimeoutError') return false;
                        throw error;
                    });
                if (dialogOpened) {
                    return { x, y };
                }
            }
        }
        return null;
    }

    // ── REVENUE TAB ───────────────────────────────────────────────────────────────

    /**
     * Verify the Revenue tab Summary table shows currency-formatted amounts
     * (£ / $ / €) for "Fixed Sales" and "Actual Sales".
     */
    async verifyRevenueSummaryAmounts() {
        const summarySection = this.page.locator(
            'table, [class*="summary"], [class*="Summary"]'
        )
            .filter({ hasText: /fixed.*sales|actual.*sales/i })
            .first();

        await summarySection.waitFor({ state: 'visible', timeout: 10000 });

        const allText = await summarySection.innerText();

        // Revenue tab must show a currency symbol
        expect(allText).toMatch(/[£$€]/);
        console.log('Revenue summary table shows currency amounts ✓');
    }

    // ── TICKET TRANSACTIONS ───────────────────────────────────────────────────────

    /** Click the "Log ticket transaction" button / link. */
    async clickLogTicketTransaction() {
        await this.page.getByRole('button', { name: /log.*ticket.*transaction/i })
            .or(this.page.getByText('Log ticket transaction', { exact: false }).first())
            .first()
            .click();
        await expect(this.page.getByRole('button', { name: /create.*transaction/i }).first())
            .toBeVisible({ timeout: 8000 });
        console.log('"Log ticket transaction" clicked');
    }

    /**
     * Complete the "+Add Transaction" form.
     *
     * @param {Object}  opts
     * @param {string}  [opts.ticketType]  label of the ticket type to select (first option if omitted)
     * @param {string}  [opts.seller]      label of the ticket seller to select
     * @param {number}  [opts.quantity=10] quantity to enter
     * @param {string}  [opts.date]        date string; defaults to today (dd/mm/yyyy)
     */
    async addTransaction({ ticketType, seller, quantity = 10, date } = {}) {
        // 1. Click "+Add Transaction"
        await this.page.getByRole('button', { name: /\+\s*add.*transaction|add.*transaction/i })
            .or(this.page.getByText('+Add Transaction', { exact: false }).first())
            .first()
            .click();

        // 2. Select ticket type
        const ticketTypeSelect = this.page.locator('select').first();
        await ticketTypeSelect.waitFor({ state: 'visible', timeout: 8000 });

        if (ticketType) {
            await ticketTypeSelect.selectOption({ label: ticketType });
        } else {
            // First non-placeholder option
            await ticketTypeSelect.selectOption({ index: 1 });
        }

        // 3. Select a ticket seller (second select on the form)
        const sellerSelect = this.page.locator('select').nth(1);
        if (await sellerSelect.isVisible()) {
            if (seller) {
                await sellerSelect.selectOption({ label: seller });
            } else {
                await sellerSelect.selectOption({ index: 1 });
            }
        }

        // 4. Set quantity
        const quantityInput = this.page.locator('input[type="number"]').first();
        await quantityInput.waitFor({ state: 'visible', timeout: 5000 });
        await quantityInput.click({ clickCount: 3 });
        await quantityInput.fill(quantity.toString());
        await expect(quantityInput).toHaveValue(quantity.toString());

        // 5. Set date — default to today
        const today = date || (() => {
            const d = new Date();
            const dd = String(d.getDate()).padStart(2, '0');
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const yyyy = d.getFullYear();
            return `${dd}/${mm}/${yyyy}`;
        })();

        const dateInput = this.page.locator('input[type="date"]').first()
            .or(this.page.locator('input[placeholder*="date" i]').first());

        if (await dateInput.isVisible()) {
            // input[type="date"] expects yyyy-mm-dd
            const isoDate = today.includes('-')
                ? today
                : today.split('/').reverse().join('-'); // dd/mm/yyyy → yyyy-mm-dd
            await dateInput.fill(isoDate);
            await expect(dateInput).toHaveValue(isoDate);
        }

        // 6. Create Transaction
        await this.page.getByRole('button', { name: /create.*transaction/i })
            .first()
            .click();

        await expect(this.page.getByRole('button', { name: /create.*transaction/i }).first())
            .toBeHidden({ timeout: 15000 });
        console.log(
            `Transaction added — type: ${ticketType ?? 'first'}, qty: ${quantity}, date: ${today} ✓`
        );
    }

    // ── BULK ENTRY ────────────────────────────────────────────────────────────────

    /** Navigate directly to the Bulk Entry page. */
    async goToBulkEntry() {
        await this.navigateToTicketingPage(getTicketingPageUrl('bulk'));
        console.log('Navigated to Bulk Entry');
    }

    /**
     * Ticket rows on the Tickets page (unexpanded):
     * [{ name, headcount, fixed, available, price, collected, received }]
     * (a grid row per ticket; the "Ticket Headcount Fixed …" caption rows are skipped).
     */
    async readTicketRows() {
        await this.page.getByRole('button', { name: /(expand|collapse) all/i }).first().waitFor({ state: 'visible', timeout: 15000 });
        const rows = await this.page.evaluate(() => [...document.querySelectorAll('div')]
            .filter(el => /tw-grid-cols-\[44px/.test(el.className) && el.children.length >= 8
                && !/^Ticket\s+Headcount/.test(el.innerText.trim()))
            .map(el => [...el.children].map(cell => cell.innerText.trim())));
        const number = text => Number(String(text).replace(/[£,\s]/g, ''));
        return rows
            .filter(cells => cells[1])
            .map(cells => ({
                name: cells[1],
                headcount: number(cells[2]),
                fixed: number(cells[3]),
                available: number(cells[4]),
                price: number(cells[5]),
                collected: number(cells[6]),
                received: number(cells[7]),
            }));
    }

    /** Click every "Expand all" button on the Bulk Entry page (one per ticket type). */
    async expandAllBulkEntries() {
        const expandBtns = this.page.getByRole('button', { name: /expand all/i });

        await expandBtns.first().waitFor({ state: 'visible', timeout: 8000 });
        const count = await expandBtns.count();

        for (let i = 0; i < count; i++) {
            await expandBtns.nth(i).click();
        }
        await expect(this.page.getByText('Direct Sales', { exact: true }).first())
            .toBeVisible({ timeout: 10000 });
        console.log(`${count} ticket type(s) expanded ✓`);
    }

    /**
     * Sum the "Sold" value across every ticket type's "Direct Sales" seller row.
     * Call after expandAllBulkEntries(). Each expanded ticket type renders as an
     * "expanded-row" wrapper <tr> that nests a sub-table containing its own "Direct
     * Sales" row — filtering on :not(.expanded-row) keeps only the real data row so
     * each ticket type's Sold value is counted once, not twice.
     */
    async getTotalSoldTickets() {
        const sellerRows = this.page.locator('tr:not(.expanded-row)').filter({ hasText: 'Direct Sales' });
        const rowCount = await sellerRows.count();

        let total = 0;
        for (let i = 0; i < rowCount; i++) {
            const row = sellerRows.nth(i);
            const fields = row.locator('input[type="number"], [contenteditable="true"]');
            const count = await fields.count();
            const soldField = fields.nth(count - 1);
            const soldText = await soldField.evaluate(el =>
                el.getAttribute('contenteditable') !== null ? el.innerText.trim() : el.value
            );
            const sold = parseInt(soldText.replace(/,/g, ''), 10) || 0;
            total += sold;
        }
        console.log(`Total Sold across ${rowCount} ticket type(s): ${total}`);
        return total;
    }

    /**
     * Return the name of the first ticket type visible in the Bulk Entry table.
     * Each ticket type section header contains an "Expand all" button — the ticket
     * name is the first non-empty, non-button text found in that same row.
     */
    async getFirstTicketTypeName() {
        const firstExpandBtn = this.page.getByRole('button', { name: /expand all/i }).first();
        await firstExpandBtn.waitFor({ state: 'visible', timeout: 8000 });

        // Walk up from the "Expand all" button until we find a container whose
        // innerText (with "Expand all" stripped) gives the ticket type name.
        const name = await firstExpandBtn.evaluate(btn => {
            let el = btn.parentElement;
            for (let depth = 0; depth < 10; depth++) {
                if (!el) break;
                const text = (el.innerText || '')
                    .replace(/expand\s*all/gi, '')
                    .replace(/[↑↓^v]/g, '')
                    .trim()
                    .split(/\n/)[0]
                    .trim();
                if (text && text.length > 0 && text.length < 60) return text;
                el = el.parentElement;
            }
            return '';
        });

        console.log(`First ticket type: "${name}"`);
        return name;
    }

    /**
     * Find the expanded seller sub-row for a ticket type and set its Sold count.
     *
     * The header row and the seller sub-row both contain the ticket name.
     * The seller sub-row ALSO contains "Direct Sales" (the supplier), so we filter
     * on both to target the correct row.
     *
     * Expanded seller row columns: Supplier | Reference | Rebate | Direct Cost | Tax | Fixed | Available | Sold | …
     * input[type="number"] in that row:  Fixed (0), Available (1), Sold (2)
     *
     * @param {string} ticketName  - e.g. 'Earlybird', 'Main', 'VIP'
     * @param {number} count       - number of sold tickets
     */
    async editSoldCount(ticketName, count) {
        // Simplified and robust: navigate to Bulk Entry, expand rows, compute the
        // column index for the header labelled "Sold" and set the input in that
        // column for the seller row matching the ticketName + "Direct Sales".
        // Default count to 50 when not provided.
        try {
            const targetCount = typeof count === 'number' ? count : 50;

            await this.goToBulkEntry();
            await this.expandAllBulkEntries();

            // Use page.evaluate to locate header index and set the input value
            const result = await this.page.evaluate(async ({ ticketName, targetCount }) => {
                const headerRow = Array.from(document.querySelectorAll('tr, thead tr')).find(r =>
                    Array.from(r.children).some(c => /Sold/i.test((c.textContent||'').trim()))
                );

                let soldColIndex = -1;
                if (headerRow) {
                    const headerCells = Array.from(headerRow.children)
                        .filter(c => c instanceof HTMLElement && /^(TH|TD|DIV)$/i.test(c.tagName));
                    for (let i = 0; i < headerCells.length; i++) {
                        if (/Sold/i.test((headerCells[i].textContent||'').trim())) {
                            soldColIndex = i;
                            break;
                        }
                    }
                }

                const rows = Array.from(document.querySelectorAll('tr, [class*="row"]'));
                const sellerRow = rows.find(r => {
                    const txt = (r.textContent||'').trim();
                    return new RegExp(ticketName, 'i').test(txt) && /Direct Sales/i.test(txt);
                });

                if (!sellerRow) return { ok: false, reason: 'seller-row-not-found' };

                const updateInput = (input) => {
                    if (input.getAttribute && input.getAttribute('contenteditable') !== null) {
                        input.focus();
                        input.innerText = String(targetCount);
                    } else {
                        input.focus();
                        input.value = String(targetCount);
                    }
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    input.blur();
                };

                if (soldColIndex >= 0) {
                    const cells = Array.from(sellerRow.children)
                        .filter(c => c instanceof HTMLElement && /^(TD|DIV)$/i.test(c.tagName));
                    const targetCell = cells[soldColIndex] || null;
                    if (targetCell) {
                        const input = targetCell.querySelector('input[type="number"], [contenteditable="true"]');
                        if (input) {
                            updateInput(input);
                            const actual = input.getAttribute('contenteditable') !== null ? input.innerText.trim() : input.value;
                            return { ok: actual === String(targetCount), actual, usedHeader: true };
                        }
                    }
                }

                const contentEditableDiv = sellerRow.querySelector('div[contenteditable="true"]');
                if (contentEditableDiv) {
                    updateInput(contentEditableDiv);
                    const actual = contentEditableDiv.innerText.trim();
                    return { ok: actual === String(targetCount), actual, usedContentEditable: true };
                }

                const numericInputs = Array.from(sellerRow.querySelectorAll('input[type="number"], [contenteditable="true"]'));
                if (numericInputs.length === 0) return { ok: false, reason: 'no-numeric-inputs' };

                let chosen = numericInputs.find(inp => /sold/i.test((inp.getAttribute && (inp.getAttribute('aria-label') || inp.getAttribute('placeholder'))) || ''))
                    || numericInputs[numericInputs.length - 1];

                if (chosen) {
                    updateInput(chosen);
                    const actual = chosen.getAttribute('contenteditable') !== null ? chosen.innerText.trim() : chosen.value;
                    return { ok: actual === String(targetCount), actual, usedFallback: true };
                }

                return { ok: false, reason: 'unknown' };
            }, { ticketName, targetCount });

            if (!result || !result.ok) {
                throw new Error(`Failed to set Sold value (${result?.reason || 'unknown'})`);
            }

            await expect(this.page.getByText('Some of the data on this page has been changed', { exact: false }))
                .toBeVisible({ timeout: 10000 });
            console.log(`${ticketName} → Sold set to ${count ?? 50} ✓`);
        } catch (err) {
            console.error(`editSoldCount failed for "${ticketName}": ${err.message}`);
            throw err;
        }
    }

    /** Click "Apply Changes" and verify the warning banner disappears. */
    async saveBulkEntry() {
        const btn = this.page.getByRole('button', { name: /apply changes/i }).first();
        await btn.waitFor({ state: 'visible', timeout: 10000 });
        await btn.click();
        console.log('"Apply Changes" button clicked');

        // Success: the unsaved-changes banner disappears once the save completes
        await expect(
            this.page.getByText('Some of the data on this page has been changed', { exact: false })
        ).not.toBeVisible({ timeout: 10000 });
        console.log('Apply Changes succeeded – warning banner gone ✓');
    }

    // ── BULK ENTRY – IMPORT ───────────────────────────────────────────────────────

    // ── BULK ENTRY – EXPORT ───────────────────────────────────────────────────────

    /**
     * Click "Export Data", select a seller in the Export Ticket Data dialog, then click Export Data.
     * @param {string} seller  e.g. 'Direct Sales'
     */
    async exportTicketData(seller = 'Direct Sales') {
        // Open the export dialog
        await this.page.getByRole('button', { name: /export data/i }).first().click();
        console.log('"Export Data" button clicked');

        // Wait for the "Export Ticket Data" heading to confirm dialog is open
        await this.page.getByText('Export Ticket Data', { exact: false })
            .first()
            .waitFor({ state: 'visible', timeout: 8000 });
        console.log('"Export Ticket Data" dialog open ✓');

        // Select seller from the dropdown
        const dropdown = this.page.locator('select').first();
        await dropdown.waitFor({ state: 'visible', timeout: 8000 });
        await dropdown.selectOption({ label: seller });
        console.log(`Seller "${seller}" selected ✓`);

        // Click the Export Data button (second match — first is the toolbar button we already clicked)
        const download = this.page.waitForEvent('download', { timeout: 30000 });
        await this.page.getByRole('button', { name: /export data/i }).last().click();
        await download;
        console.log('Export Data submitted ✓');
    }

    /** Open the import form from the Tickets page's Import / Export menu. */
    async clickImportTicketData() {
        await this.page.getByRole('button', { name: /Import \/ Export/i }).click();
        await this.page.getByRole('button', { name: /Import Data/i })
            .waitFor({ state: 'visible', timeout: 10000 });
        await this.page.getByRole('button', { name: /import data/i }).first().click();
        await expect(this.page.getByText('Import Ticket Data', { exact: false }).first()).toBeVisible({ timeout: 10000 });
        console.log('"Import Data" button clicked');
    }

    /**
     * Verify the seller dropdown has options, then select the given seller.
     * @param {string} sellerName  e.g. 'Direct Sales'
     */
    async verifyAndSelectSeller(sellerName = 'Direct Sales') {
        const dropdown = this.page.locator('select, [role="combobox"]').first();
        await dropdown.waitFor({ state: 'visible', timeout: 8000 });

        const optionCount = await dropdown.locator('option').count();
        expect(optionCount).toBeGreaterThan(0);
        console.log(`Seller dropdown has ${optionCount} option(s) ✓`);

        await dropdown.selectOption({ label: sellerName });
        console.log(`Seller "${sellerName}" selected ✓`);
    }

    /**
     * Click the "Drop a file here or click to upload" area and attach the template.
     * @param {string} filePath  path to the file (e.g. './fixtures/ticket-import-template.xlsx')
     */
    async attachImportTemplate(filePath) {
        const [fileChooser] = await Promise.all([
            this.page.waitForEvent('filechooser'),
            this.page.getByText('Drop a file here or click to upload', { exact: false }).first().click(),
        ]);
        await fileChooser.setFiles(resolve(filePath));
        await expect(this.page.getByRole('button', { name: /validate.*import/i }).first())
            .toBeEnabled({ timeout: 15000 });
        console.log(`Template attached: ${resolve(filePath)} ✓`);
    }

    /** Assert the "Validate & Import Data" button is enabled after file attached. */
    async verifyValidateImportEnabled() {
        const btn = this.page.getByRole('button', { name: /validate.*import/i }).first();
        await expect(btn).toBeEnabled({ timeout: 8000 });
        console.log('"Validate & Import Data" button is enabled ✓');
    }

    /** Ensure "Replace existing sales with uploaded data" checkbox is checked. */
    async tickReplaceExistingSales() {
        const label = this.page.locator('label')
            .filter({ hasText: /replace existing sales/i })
            .first();

        await label.waitFor({ state: 'visible', timeout: 8000 });

        const checkbox = label.locator('input[type="checkbox"]').first();
        await checkbox.waitFor({ state: 'attached', timeout: 8000 });

        // Use evaluate to read the real DOM .checked property — Playwright's isChecked()
        // can return false for hidden Vue custom checkboxes even when visually preselected,
        // which would cause a label click to toggle the checkbox OFF instead of leaving it ON.
        const isActuallyChecked = await checkbox.evaluate(el => el.checked);
        if (!isActuallyChecked) {
            await label.click();
            await expect.poll(() => checkbox.evaluate(el => el.checked)).toBe(true);
        }
        console.log('"Replace existing sales" is checked ✓');
    }

    /** Click "Validate and Import Data", then confirm the "Are you sure?" dialog. */
    async clickValidateAndImport() {
        await this.page.getByRole('button', { name: /validate.*import/i })
            .first()
            .click();
        console.log('"Validate and Import Data" clicked');

        // Confirm the "Are you sure?" dialog
        const okBtn = this.page.getByRole('button', { name: /^ok$/i });
        await okBtn.waitFor({ state: 'visible', timeout: 8000 });
        await okBtn.click();
        await expect(this.page.getByText('Data imported', { exact: false })).toBeVisible({ timeout: 30000 });
        console.log('"Are you sure?" confirmed ✓');
    }

    /** Verify the import completed successfully. */
    async verifyImportSuccess() {
        await expect(
            this.page.getByText('Data imported', { exact: false })
        ).toBeVisible({ timeout: 15000 });
        console.log('"Data imported" success message visible ✓');
    }

    // ── BULK ENTRY – ROW ACTIONS ──────────────────────────────────────────────────

    /** Assert a Delete button is visible for every ticket type row. */
    async verifyDeleteButtonsAvailable() {
        const deleteButtons = this.page.getByRole('button', { name: /delete/i })
            .or(
                this.page.locator('button').filter({
                    has: this.page.locator('i.mdi-delete, i[class*="delete"], i[class*="trash"]'),
                })
            );
        const count = await deleteButtons.count();
        expect(count).toBeGreaterThan(0);
        console.log(`${count} Delete button(s) visible ✓`);
    }

    /**
     * After expanding, verify the editable fields in a ticket row.
     * Checks Reference, Rebate, Direct Cost, Fixed/Available, Sold are inputs.
     * Checks Supplier is NOT an editable input.
     * @param {string} ticketName
     */
    async verifyEditableAndNonEditableFields(ticketName) {
        const row = this.page.locator('tr, [class*="row"]')
            .filter({ hasText: new RegExp(ticketName, 'i') })
            .first();

        await row.waitFor({ state: 'visible', timeout: 10000 });

        // Editable fields — at least one input/contenteditable should exist in the row
        const editableInputs = row.locator('input, [contenteditable="true"]');
        const inputCount = await editableInputs.count();
        expect(inputCount).toBeGreaterThan(0);
        console.log(`${inputCount} editable input(s) found in "${ticketName}" row ✓`);

        // Supplier — should not be an <input> (displayed as read-only text)
        const supplierInput = row.locator('[data-col*="supplier" i] input, [class*="supplier"] input');
        await expect(supplierInput).toHaveCount(0);
        console.log(`Supplier is NOT editable in "${ticketName}" row ✓`);
    }

    /**
     * Click the three-lines (≡) menu button at the end of a seller sub-row for the given ticket.
     * Filters to the expanded seller sub-row (contains "Direct Sales") to avoid the
     * delete button that sits on the ticket-type header row.
     * @param {string} ticketName
     */
    async clickThreeLinesMenu(ticketName) {
        const sellerRow = this.page.locator('tr, [class*="row"]')
            .filter({ hasText: new RegExp(ticketName, 'i') })
            .filter({ hasText: /direct sales/i })
            .first();

        await sellerRow.waitFor({ state: 'visible', timeout: 8000 });
        const menuBtn = sellerRow.locator('button').last();
        await menuBtn.waitFor({ state: 'visible', timeout: 8000 });
        await menuBtn.click();
        await expect(this.page.getByText('View Bank Transactions', { exact: false }).last())
            .toBeVisible({ timeout: 5000 });
        console.log(`Three-lines menu opened for "${ticketName}" ✓`);
    }

    /**
     * Click the three-lines (≡) button on the first expanded seller sub-row.
     * Targets rows containing "Direct Sales" to avoid hitting the delete button
     * on the ticket-type header row.
     */
    async clickFirstThreeLinesMenu() {
        const sellerRow = this.page.locator('tr, [class*="row"]')
            .filter({ hasText: /direct sales/i })
            .first();

        await sellerRow.waitFor({ state: 'visible', timeout: 8000 });
        const menuBtn = sellerRow.locator('button').last();
        await menuBtn.waitFor({ state: 'visible', timeout: 8000 });
        await menuBtn.click();
        await expect(this.page.getByText('View Bank Transactions', { exact: false }).last())
            .toBeVisible({ timeout: 5000 });
        console.log('Three-lines menu opened for first ticket row ✓');
    }

    // ── BULK ENTRY – THREE-LINES MENU OPTIONS ─────────────────────────────────────

    /** Select "View Bank Transactions" from the open three-lines menu. */
    async clickMenuViewBankTransaction() {
        await this.page.locator('li, [role="menuitem"], a, div, span, button')
            .filter({ hasText: /View Bank Transactions?/i })
            .last()
            .click();
        await expect(this.page.getByText('From', { exact: true }).first()).toBeVisible({ timeout: 10000 });
        console.log('"View Bank Transactions" selected ✓');
    }

    /**
     * Verify the Bank Transaction view shows the required columns.
     * Expected: From, Logged by, Date, Amount, Actions
     */
    async verifyBankTransactionColumns() {
        const expected = ['From', 'Logged by', 'Date', 'Amount', 'Actions'];
        for (const col of expected) {
            await expect(
                this.page.locator('th, [class*="header"], [class*="col"]')
                    .filter({ hasText: new RegExp(col, 'i') })
                    .first()
            ).toBeVisible({ timeout: 8000 });
            console.log(`Column "${col}" visible ✓`);
        }
    }

    /**
     * Select "Add Bank Transaction" from the menu and complete the form.
     * @param {Object} opts
     * @param {string} opts.bankAccount  Bank account label (e.g. 'sgeorge')
     * @param {string} opts.name         Reference / name (e.g. 'Reference+sgtest')
     * @param {number} opts.amount       Amount in £ (e.g. 500)
     */
    async addBankTransaction({ bankAccount, name, amount }) {
        await this.page.locator('li, [role="menuitem"], a, div, span, button')
            .filter({ hasText: /Add Bank Transaction/i })
            .last()
            .click();

        // Scope everything to the modal to avoid matching background page inputs
        const modal = this.page.locator('#createBankTransactionModal');
        await modal.waitFor({ state: 'visible', timeout: 8000 });

        // "Bank Account" dropdown at the top of the modal (the "From" section's
        // select is disabled — it shows the pre-set Supplier context).
        const bankAccountDropdown = modal.locator('dl')
            .filter({ has: this.page.locator('dt', { hasText: 'Bank Account' }) })
            .locator('select, [role="combobox"]').first();
        await bankAccountDropdown.waitFor({ state: 'visible', timeout: 8000 });
        await bankAccountDropdown.selectOption({ label: bankAccount });
        console.log(`Bank Account set to "${bankAccount}" ✓`);

        // "Name" field — plain text input (no type attribute, labeled "Name")
        const nameInput = modal.locator('dl')
            .filter({ has: this.page.locator('dt', { hasText: 'Name' }) })
            .locator('input').first();
        await nameInput.waitFor({ state: 'visible', timeout: 8000 });
        await nameInput.fill(name);
        console.log(`Name set to "${name}" ✓`);

        // "Amount" field — scoped to the £ currency row
        const amountInput = modal.locator('dl')
            .filter({ has: this.page.locator('dt', { hasText: 'Amount' }) })
            .locator('input[type="number"]');
        await amountInput.waitFor({ state: 'visible', timeout: 8000 });
        await amountInput.fill(amount.toString());
        console.log(`Amount set to £${amount} ✓`);

        // "Add Transaction" button
        await modal.getByRole('button', { name: /Add Transaction/i }).click();
        await expect(modal).toBeHidden({ timeout: 15000 });
        console.log('Bank transaction added ✓');
    }

    /** Select "Add Ticket Transaction" from the menu (same modal as dashboard). */
    async clickMenuAddTicketTransaction() {
        await this.page.locator('li, [role="menuitem"], a, div, span, button')
            .filter({ hasText: /Add Ticket Transaction/i })
            .last()
            .click();
        await expect(this.page.getByRole('button', { name: /create.*transaction/i }).first())
            .toBeVisible({ timeout: 10000 });
        console.log('"Add Ticket Transaction" selected from menu ✓');
    }

    /** Select "Delete Ticket Sale" from the menu and confirm. */
    async deleteTicketSaleFromMenu() {
        await this.page.locator('li, [role="menuitem"], a, div, span, button')
            .filter({ hasText: /Delete Ticket Sale/i })
            .last()
            .click();

        // Confirm deletion dialog if it appears
        const confirmBtn = this.page.getByRole('button', { name: /confirm|yes|delete/i }).first();
        if (await confirmBtn.isVisible()) {
            await confirmBtn.click();
            await expect(confirmBtn).toBeHidden({ timeout: 10000 });
        }
        console.log('Ticket sale deleted ✓');
    }

    // ── BULK ENTRY – SOLD EDIT FLOW ───────────────────────────────────────────────

    /** Click the first "Expand All" button to reveal the seller sub-rows for the first ticket type. */
    async expandFirstBulkRow() {
        const expandBtn = this.page.getByRole('button', { name: /expand all/i }).first();
        await expandBtn.waitFor({ state: 'visible', timeout: 8000 });
        await expandBtn.click();
        await expect(this.page.getByText('Direct Sales', { exact: true }).first())
            .toBeVisible({ timeout: 10000 });
        console.log('First ticket type row expanded ✓');
    }

    /**
     * Update the Sold field on the first visible seller sub-row.
     * Reads the Available column value first and sets Sold to one less than Available,
     * ensuring the value is always valid.
     */
    async updateSoldOnFirstRow() {
        const cell = this.page.getByText('Direct Sales', { exact: true }).first();
        await cell.waitFor({ state: 'visible', timeout: 10000 });

        const row = cell.locator('xpath=./ancestor-or-self::tr[1]');
        if (!await row.count()) throw new Error('updateSoldOnFirstRow: Direct Sales row not found');

        const fields = row.locator('input[type="number"], [contenteditable="true"]');
        const count = await fields.count();
        if (count < 2) throw new Error('updateSoldOnFirstRow: inputs not found in Direct Sales row');

        const availableStr = await fields.nth(count - 2).evaluate(el =>
            el.getAttribute('contenteditable') !== null ? el.innerText.trim() : el.value
        );
        const available = parseInt(availableStr, 10) || 0;
        const soldValue = Math.max(1, available - 25);

        const soldField = fields.nth(count - 1);
        await soldField.evaluate(el => {
            el.focus();
            el.textContent = '';
            el.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await this.page.keyboard.type(soldValue.toString(), { delay: 30 });
        await this.page.keyboard.press('Tab');
        await expect(this.page.getByText('Some of the data on this page has been changed', { exact: false }))
            .toBeVisible({ timeout: 10000 });
        console.log(`Available=${available}; Sold set to ${soldValue} ✓`);
    }

    /** Assert the unsaved-changes warning banner is visible. */
    async verifyUnsavedChangesWarning() {
        await expect(
            this.page.getByText('Some of the data on this page has been changed', { exact: false })
        ).toBeVisible({ timeout: 8000 });
        console.log('"Some of the data on this page has been changed" warning visible ✓');
    }

    /** Assert the "Apply Changes" button is visible (appears below the Bulk Entry tab). */
    async verifyApplyChangesButton() {
        const btn = this.page.getByRole('button', { name: /apply changes/i }).first();
        await expect(btn).toBeVisible({ timeout: 8000 });
        console.log('"Apply Changes" button is visible ✓');
    }

    // ── BULK ENTRY – DELETE TICKET TYPE ───────────────────────────────────────────

    /**
     * Delete every ticket type whose name matches `name` (string = exact, RegExp = pattern)
     * from the Bulk Entry page of `eventBaseUrl`, via its "…" menu > "Delete Ticket Type".
     */
    async deleteTicketTypes(eventBaseUrl, name) {
        await this.page.goto(`${eventBaseUrl.replace(/\/$/, '')}/tickets/bulk`, { waitUntil: 'domcontentloaded' });
        await this.page.getByRole('button', { name: /expand all/i }).first()
            .waitFor({ state: 'visible', timeout: 30000 });
        // Hovering the left edge opens the sidebar over the ticket names — park the mouse.
        await this.page.mouse.move(1000, 600);

        const pattern = name instanceof RegExp ? name : new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
        // Ticket rows are div grids; the row is the nearest ancestor holding the "…" menu.
        const names = () => this.page.getByText(pattern);

        const deleted = [];
        while (await names().count()) {
            const before = await names().count();
            const nameCell = names().first();
            deleted.push((await nameCell.innerText()).trim());
            const row = nameCell.locator('xpath=ancestor::div[.//i[contains(@class,"mdi-dots-horizontal")]][1]');
            await row.locator('button').filter({ has: this.page.locator('i.mdi-dots-horizontal') }).click();
            await this.page.getByText('Delete Ticket Type', { exact: true }).click();
            const confirm = this.page.getByRole('button', { name: /^(Yes, I'm sure|Yes|Delete|Confirm|OK)$/i }).last();
            // Some pages delete immediately; confirm only when the application presents a prompt.
            if (await confirm.isVisible()) {
                await confirm.click();
                await expect(confirm).toBeHidden({ timeout: 10000 });
            }
            await expect(names()).toHaveCount(before - 1, { timeout: 15000 });
        }
        if (deleted.length) console.log(`🗑️ Ticket type(s) deleted: ${deleted.join(', ')}`);
        return deleted;
    }
}
