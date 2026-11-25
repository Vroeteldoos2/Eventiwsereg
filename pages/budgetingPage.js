import { expect } from '@playwright/test';

import { TestHelpers } from '../tests/utils/test-helpers';

export class BudgetingPage {

    constructor(page) {
        this.page = page;

        // Sidebar & Navigation

        // In your constructor — replace the budgetingMenu locator
        this.budgetingMenu = page.locator('.v-list-item, a, li')
            .filter({ hasText: /^Budgeting$/ })
            .first();

        this.BudgetingSummaryPage = page.locator('nav, .v-navigation-drawer')
            .getByRole('link', { name: 'Summary' })
            .or(page.locator('nav').getByText('Summary'));

        // Use specific text anchors to find the sections
        this.profitSection = page.locator('section').filter({ hasText: 'Event Profit Overview' });
        this.costDeptSection = page.locator('div').filter({ has: page.locator('text=/^Cost Departments$/') }).first();

        // This line creates the bridge to your utility functions
        this.helpers = new TestHelpers(page);
    }

    async gotoBudgetSummaryPage() {

        if (!this.eventBaseUrl) {
            throw new Error('eventBaseUrl is not set');
        }
        await this.page.goto(`${this.eventBaseUrl}/budget/summary`, {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });

        // Wait for any loading spinner variants to disappear
        await Promise.all([
            this.page.locator('text=Loading Information').waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {}),
            this.page.locator('text=Loading...').waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {}),
        ]);

        // Wait for all data API calls to complete
        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        // Confirm the page shell is ready (h4 heading always renders even with no data).
        // The "page-title" class was dropped from these headings in a UI redesign — match on the h4 tag alone.
        await expect(this.page.locator('h4').filter({ hasText: 'Budget Summary' }))
            .toBeVisible({ timeout: 30000 });
    }


    //**********************************Totals methods Start *****************************************************/

    async getOverviewRow(rowName) {
        const card = this.page.locator('div.card-custom')
            .filter({ hasText: 'Event Profit Overview' })
            .first();

        await card.waitFor({ state: 'visible', timeout: 60000 }); // slow on big events (33s seen on first load)
        // The card shows zeros until the figures have been calculated: wait for its 'Last updated' note.
        await expect(card).toContainText(/Last updated/, { timeout: 90000 });

        // All spans are in one flat grid — get them all in order
        const allSpans = card.locator('span.profit-overview-accounting');
        const allTexts = await allSpans.allInnerTexts();

        // Grid is 4 cols: [label][fixed][budgeted][variance]
        // But label is a div.heading-y not a span, so spans are:
        // index 0,1,2 = Revenue fixed, budgeted, variance
        // index 3,4,5 = Costs fixed, budgeted, variance
        // index 6,7,8 = Profit fixed, budgeted, variance
        const rowIndex = { revenue: 0, costs: 3, profit: 6 };
        const i = rowIndex[rowName.toLowerCase()];

        console.log(`📊 [${rowName}] fixed=${allTexts[i]} budgeted=${allTexts[i + 1]} variance=${allTexts[i + 2]}`);

        return {
            fixed: this.helpers.parseCurrency(allTexts[i] || '0'),
            budgeted: this.helpers.parseCurrency(allTexts[i + 1] || '0'),
            variance: this.helpers.parseCurrency(allTexts[i + 2] || '0'),
        };
    }



    // Reads a single labeled figure (e.g. "Available Tickets") off a named row in the
    // Revenue Streams table — the same div.ew-figure boxes used by the Fixed/Budgeted/
    // Actual/Variance columns, just addressed by label instead of a fixed CSS class.
    async getRevenueStreamFigure(streamName, figureLabel) {
        const section = this.page.locator('div.ew-data-table')
            .filter({ hasText: 'Revenue Streams' })
            .first();
        // hasText is a substring match — filtering by 'Tickets' alone would also match a
        // "Second Tickets" stream row, so anchor on the row's exact heading instead.
        const row = section.locator('tr.tw-cursor-pointer')
            .filter({ has: this.page.getByRole('heading', { name: streamName, exact: true }) })
            .first();
        await row.waitFor({ state: 'visible', timeout: 10000 });

        const figure = row.locator('div.ew-figure').filter({ hasText: figureLabel }).first();
        const valueText = await figure.locator('div span').last().innerText();
        return this.helpers.parseCurrency(valueText);
    }

    async getDetailedTotal(sectionName) {
        const section = this.page.locator('div.ew-data-table')
            .filter({ hasText: sectionName })
            .first();

        await section.waitFor({ state: 'visible', timeout: 10000 });

        const rows = section.locator('tbody tr');
        const count = await rows.count();
        console.log(`📊 [${sectionName}] row count: ${count}`);

        let sumFixed = 0, sumBudgeted = 0;

        for (let i = 0; i < count; i++) {
            const row = rows.nth(i);

            const fixedText = await row.locator('div.ew-figure.fixed span').last()
                .innerText().catch(() => '');
            const budgetedText = await row.locator('div.ew-figure.budgeted span').last()
                .innerText().catch(() => '');

            // Log each row so we can see exactly what's being summed
            console.log(`  row[${i}] fixed="${fixedText.trim()}" budgeted="${budgetedText.trim()}"`);

            if (fixedText.includes('£')) sumFixed += this.helpers.parseCurrency(fixedText);
            if (budgetedText.includes('£')) sumBudgeted += this.helpers.parseCurrency(budgetedText);
        }

        console.log(`📊 [${sectionName}] sumFixed=${sumFixed} sumBudgeted=${sumBudgeted}`);

        return {
            fixed: Number(sumFixed.toFixed(2)),
            budgeted: Number(sumBudgeted.toFixed(2)),
        };
    }


    // Reads a "Revenue Streams" / "Cost Departments" table by figure LABEL, so it works on
    // both Budget Summary and Budget v Actuals (the CSS classes on the figure boxes differ
    // between the two — on Budget v Actuals the "fixed" class sits on Variance).
    // Labels are normalised: "Actual Test" → "actual", "Per Head Budgeted" → "budgeted".
    // Rows sharing a name (e.g. the Tickets stream and its ticket-budget row) are summed.
    // Returns { header: { budgeted: 871466.67, ... }, rows: { Bar: { budgeted: ..., ... }, ... } }
    async getSectionFigures(sectionName) {
        const section = this.page.locator('div.ew-data-table').filter({ hasText: sectionName }).first();
        await section.waitFor({ state: 'visible', timeout: 10000 });

        const read = container => container.locator('div.ew-figure').evaluateAll(figures => figures.map(figure => ({
            label: figure.querySelector('span')?.innerText ?? '',
            value: [...figure.querySelectorAll('div span')].pop()?.innerText ?? '',
        })));
        const toObject = (figures, into = {}) => {
            for (const { label, value } of figures) {
                const key = label.replace(/\bTest\b/i, '').replace(/^Per Head\s+/i, '').trim().toLowerCase();
                if (key) into[key] = Number(((into[key] ?? 0) + this.helpers.parseCurrency(value)).toFixed(2));
            }
            return into;
        };

        const header = toObject(await read(section.locator('thead tr').first()));
        const rows = {};
        const rowLocators = section.locator('tbody tr.tw-cursor-pointer');
        for (let i = 0; i < await rowLocators.count(); i++) {
            const row = rowLocators.nth(i);
            const name = (await row.getByRole('heading').first().innerText()).trim();
            rows[name] = toObject(await read(row), rows[name]);
        }
        return { header, rows };
    }

    //**********************************Totals methods end **********************************/

    // "Customise columns" (Budget Summary and Budget v Actuals): ticks/unticks the named
    // columns, e.g. { Actual: true, 'Markup Amount': true }. Columns not named are left
    // alone. Returns the full previous state so callers can restore it.
    async setCustomColumns(columns) {
        await this.page.getByText('Customise columns', { exact: true }).first().click();
        const modal = this.page.locator('div.m-wrapper').filter({ hasText: 'Customise columns shown' });
        await modal.waitFor({ state: 'visible', timeout: 10000 });

        const labels = modal.locator('label').filter({ has: this.page.locator('input[type="checkbox"]') });
        const previous = {};
        for (let i = 0; i < await labels.count(); i++) {
            const label = labels.nth(i);
            previous[(await label.innerText()).trim()] = await label.locator('input').isChecked();
        }
        for (const [name, checked] of Object.entries(columns)) {
            if (!(name in previous)) throw new Error(`Column "${name}" not offered (have: ${Object.keys(previous).join(', ')})`);
            await labels.filter({ hasText: new RegExp(`^\\s*${name}\\s*$`) }).locator('input').setChecked(checked);
            await this.page.waitForTimeout(300);
        }

        await modal.locator('button.m-close').click();
        await modal.waitFor({ state: 'hidden', timeout: 10000 });
        await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        await this.page.waitForTimeout(800);
        return previous;
    }

    async gotoBudgetVActualsPage() {
        if (!this.eventBaseUrl) throw new Error('eventBaseUrl is not set');
        await this.page.goto(`${this.eventBaseUrl}/budget-v-actuals`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await this.page.locator('text=Loading Information').waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        await this.page.locator('div.ew-data-table').filter({ hasText: 'Cost Departments' }).first()
            .waitFor({ state: 'visible', timeout: 30000 });
    }


    async budgetEntryCreation() {
        // Click on the first cell in the "Artists" row to open the budget entries
        await this.page.getByRole('cell', { name: 'Artists' }).locator('div').first().click();
    }


    async selectBudgetVersion(versionLabel = 'A') {
        // 1. Locate all badges, then filter for the EXACT text (e.g., "A" not "AA")
        const versionBadges = this.page.locator('div.badge').filter({
            hasText: new RegExp(`^${versionLabel}$`)
        });

        const count = await versionBadges.count();

        for (let i = 0; i < count; i++) {
            const badge = versionBadges.nth(i);

            // 2. Check if it's already selected
            const isSelected = await badge.evaluate(el => el.classList.contains('selected'));

            if (!isSelected) {
                await badge.click();
                // Wait for numbers to update
                await this.page.waitForTimeout(500);
            }
        }
    }

    async expandAllSections() {
        // Look for the specific 'Expand all' text, ensuring it's not a row name
        const expandButtons = this.page.locator('span, a, button').filter({ hasText: /^Expand all$/i });

        const count = await expandButtons.count();
        for (let i = 0; i < count; i++) {
            // Use force to ensure we don't accidentally click a row behind an overlay
            await expandButtons.nth(i).click({ force: true });
            await this.page.waitForTimeout(500);
        }
        return count;
    }

    async openFirstDepartmentBudgetEntries() {
        return this.openDepartmentBudgetEntries(0);
    }


    // Index of the Cost Departments row whose heading is exactly `name`.
    async findCostDepartmentIndex(name) {
        const rows = this.page.locator('div.ew-data-table')
            .filter({ hasText: 'Cost Departments' })
            .first()
            .locator('tr.tw-cursor-pointer');
        await rows.first().waitFor({ state: 'visible', timeout: 15000 });

        const count = await rows.count();
        for (let i = 0; i < count; i++) {
            const heading = await rows.nth(i).locator('h6, h5, h4, td, span').first().innerText().catch(() => '');
            if (heading.split('\n')[0].trim() === name) return i;
        }
        throw new Error(`Cost department "${name}" not found in the Cost Departments table`);
    }

    async openDepartmentBudgetEntries(index = 0) {
        this.currentDeptIndex = index;

        const section = this.page.locator('div.ew-data-table')
            .filter({ hasText: 'Cost Departments' })
            .first();

        await section.waitFor({ state: 'visible', timeout: 15000 });

        const rows = section.locator('tr.tw-cursor-pointer');
        const count = await rows.count();
        if (count === 0) throw new Error('No cost department rows found in the Cost Departments table');

        const safeIndex = index < count ? index : count - 1;
        if (safeIndex !== index) {
            console.log(`⚠️ Requested department index ${index} but only ${count} exist — using index ${safeIndex}`);
        }

        const row = rows.nth(safeIndex);
        const deptName = await row.locator('h6, h5, h4, td, span').first().innerText({ timeout: 5000 })
            .then(t => t.trim())
            .catch(() => `Department ${safeIndex}`);
        console.log(`📂 Opening department [${index}]: ${deptName}`);
        await row.click();

        const budgetEntriesTab = this.page.locator('ul.tw-flex button')
            .filter({ hasText: /^Budget Entries$/ })
            .first();
        await budgetEntriesTab.waitFor({ state: 'visible', timeout: 10000 });
        await budgetEntriesTab.click();

        await this.page.getByRole('row', { name: '󱩨 Create a new budget entry', exact: true })
            .waitFor({ state: 'visible', timeout: 10000 });

        return deptName;
    }


    // ── Add these methods inside your BudgetingPage class ────────────────────────


    // ── NAVIGATION ────────────────────────────────────────────────────────────────
    async openFirstDepartmentBudgetEntries() {
        const section = this.page.locator('div.ew-data-table')
            .filter({ hasText: 'Cost Departments' })
            .first();

        const firstRow = section.locator('tr.tw-cursor-pointer').first();
        const deptName = await firstRow.locator('h6, h5, h4, td, span').first().innerText({ timeout: 5000 })
            .then(t => t.trim())
            .catch(() => 'Department 0');
        console.log(`📂 Opening department: ${deptName}`);
        await firstRow.click();

        const budgetEntriesTab = this.page.locator('ul.tw-flex button')
            .filter({ hasText: /^Budget Entries$/ })
            .first();

        await budgetEntriesTab.waitFor({ state: 'visible', timeout: 10000 });
        await budgetEntriesTab.click();

        // Use the exact role selector Playwright identified
        await this.page.getByRole('row', { name: '󱩨 Create a new budget entry', exact: true })
            .waitFor({ state: 'visible', timeout: 10000 });

        return deptName;
    }

    // ── BUDGET ENTRY CREATION ─────────────────────────────────────────────────────

    async createBudgetEntry({ title, subcategory, supplier, fixedCost, budgetedCost, deptIndex = this.currentDeptIndex ?? 0 }) {
        const createRow = this.page.getByRole('row', { name: '󱩨 Create a new budget entry', exact: true });
        await createRow.waitFor({ state: 'visible', timeout: 10000 });
        await createRow.click();
        await this.page.getByPlaceholder('Title').waitFor({ state: 'visible', timeout: 10000 });

        // Title
        const titleInput = this.page.getByPlaceholder('Title');
        await titleInput.fill(title);
        await this.page.waitForTimeout(300);

        if (!subcategory) {
            throw new Error(`BUDGET subcategory is required to create budget entry "${title}"`);
        }

        // Subcategory — Tab from Title into multiselect
        await titleInput.press('Tab');
        await this.page.waitForTimeout(300);
        await this.page.keyboard.type(subcategory, { delay: 40 });
        await this.page.waitForTimeout(600);
        await this.page.keyboard.press('ArrowDown');
        await this.page.keyboard.press('Enter');
        await this.page.waitForTimeout(500);

        // Supplier — Tab from Subcategory
        await this.page.keyboard.press('Tab');
        await this.page.waitForTimeout(300);
        await this.page.keyboard.type(supplier, { delay: 40 });
        await this.page.waitForTimeout(700);
        await this.page.keyboard.press('ArrowDown');
        await this.page.keyboard.press('Enter');
        await this.page.waitForTimeout(500);

        // Fixed Cost — Tab from Supplier, fill value
        await this.page.keyboard.press('Tab');
        await this.page.waitForTimeout(200);
        await this.page.keyboard.press('Control+a');
        await this.page.keyboard.type(fixedCost.toString());
        await this.page.waitForTimeout(200);

        // Budgeted Cost — Tab from Fixed Cost
        await this.page.keyboard.press('Tab');
        await this.page.waitForTimeout(200);
        await this.page.keyboard.press('Control+a');
        await this.page.keyboard.type(budgetedCost.toString());
        await this.page.waitForTimeout(300);
        await this.page.keyboard.press('Tab');
        await this.page.waitForTimeout(300);

        // Click Create via JavaScript to avoid dropdown/focus issues
        await this.page.evaluate(() => {
            const buttons = document.querySelectorAll('button');
            for (const btn of buttons) {
                if (btn.innerText?.trim().toLowerCase() === 'create' && !btn.disabled) {
                    btn.click();
                    return true;
                }
            }
            return false;
        });

        await this.page.waitForTimeout(1000);
        await this.page.screenshot({ path: 'debug-after-create.png' });

        await this.page.waitForTimeout(500);

        const successToast = this.page.locator('div.toast-success')
            .filter({ hasText: /created successfully/i })
            .first();

        let created = false;
        try {
            await successToast.waitFor({ state: 'visible', timeout: 10000 });
            created = true;
            console.log('✅ Budget entry created successfully (toast confirmed)');
        } catch (error) {
            console.log('⚠️ Success toast not found, falling back to form close / row check');
            await this.page.screenshot({ path: 'debug-create-no-toast.png' });
            const formClosed = await this.page.getByPlaceholder('Title')
                .waitFor({ state: 'hidden', timeout: 10000 })
                .then(() => true)
                .catch(() => false);
            if (formClosed) {
                created = true;
                console.log('✅ Budget entry created successfully (form closed)');
            }
        }

        if (!created) {
            const titleRow = this.page.locator('tr').filter({ hasText: title }).first();
            if (await titleRow.isVisible({ timeout: 10000 }).catch(() => false)) {
                created = true;
                console.log('✅ Budget entry created successfully (entry visible in list)');
            }
        }

        if (!created) {
            throw new Error('Budget entry creation failed: no success toast, form did not close, and entry row was not visible');
        }

        // Reload page
        await this.page.reload({ waitUntil: 'domcontentloaded' });
        await this.page.locator('text=Loading Information')
            .waitFor({ state: 'hidden', timeout: 20000 });

        // Dismiss notifications popup if visible
        const notifClose = this.page.locator('button').filter({ hasText: /close/i })
            .or(this.page.locator('.notification button, [class*="toast"] button'))
            .first();
        if (await notifClose.isVisible()) await notifClose.click();

        // Re-expand sections first
        await this.expandAllSections();

        // Re-open the same department that was active before reload
        const deptRow = this.page.locator('div.ew-data-table')
            .filter({ hasText: 'Cost Departments' })
            .locator('tr.tw-cursor-pointer')
            .nth(deptIndex);
        await deptRow.waitFor({ state: 'visible', timeout: 10000 });
        await deptRow.click();

        // Click Budget Entries tab
        const budgetEntriesTab = this.page.locator('ul.tw-flex button')
            .filter({ hasText: /^Budget Entries$/ })
            .first();
        await budgetEntriesTab.waitFor({ state: 'visible', timeout: 10000 });
        await budgetEntriesTab.click();
        // Wait for Loading... to disappear in the budget entries table

        const entriesContainer = createRow.locator(
            'xpath=ancestor::div[contains(@class, "ew-data-table")][1]',
        );
        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        await entriesContainer.getByText('Loading...', { exact: true })
            .waitFor({ state: 'hidden', timeout: 30000 });

        // Set items per page to 50 to avoid pagination issues
        const perPageSelect = this.page.locator('select')
            .filter({ has: this.page.locator('option[value="50"]') })
            .first();
        if (await perPageSelect.isVisible().catch(() => false)) {
            await perPageSelect.selectOption('50');
            await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
            await entriesContainer.getByText('Loading...', { exact: true })
                .waitFor({ state: 'hidden', timeout: 30000 });
        }

        const titleRow = this.page.locator('tr').filter({ hasText: title }).first();
        const pageButtons = entriesContainer.getByRole('button', { name: /^\d+$/ });
        const pageCount = await pageButtons.count();
        let found = false;

        for (let index = 0; index < Math.max(pageCount, 1); index += 1) {
            if (index > 0) {
                await pageButtons.nth(index).click();
                await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
                await entriesContainer.getByText('Loading...', { exact: true })
                    .waitFor({ state: 'hidden', timeout: 15000 });
            }

            if (await titleRow.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false)) {
                found = true;
                break;
            }
        }

        if (!found) {
            throw new Error(`Budget entry "${title}" was created but not found on any entries page`);
        }

        await titleRow.scrollIntoViewIfNeeded();

    }

    // ── BUDGET ENTRY LIST INTERACTIONS ───────────────────────────────────────────

    async verifyEntryInList(entryTitle, expectedStatus) {
        const row = this.page.locator('tr.tw-cursor-pointer')
            .filter({ hasText: entryTitle })
            .filter({ hasText: expectedStatus });

        // Use expect with retry — polls until visible or timeout
        await expect(row.first()).toBeVisible({ timeout: 15000 });
        console.log(`✅ Entry "${entryTitle}" has status: ${expectedStatus}`);
    }

    async selectEntryInList(entryTitle) {
        const row = this.page.locator('tr.tw-cursor-pointer')
            .filter({ hasText: entryTitle })
            .first();

        await row.waitFor({ state: 'visible', timeout: 10000 });
        await row.scrollIntoViewIfNeeded();

        const checkbox = row.locator('input[type="checkbox"]');
        await checkbox.waitFor({ state: 'visible', timeout: 5000 });
        await checkbox.check({ force: true });

        // Wait for ANY action button to appear (Request Approval, Approve, Reject etc)
        await this.page.locator('button')
            .filter({ hasText: /Request Approval|Approve|Reject|Reset To Draft/i })
            .first()
            .waitFor({ state: 'visible', timeout: 5000 });
    }

    async clickActionButton(buttonName) {
        const btn = this.page.getByRole('button', {
            name: new RegExp(`^${buttonName}$`, 'i')
        });
        await btn.waitFor({ state: 'visible', timeout: 5000 });
        await btn.scrollIntoViewIfNeeded();
        await btn.click();

        // Wait for success toast to confirm action was processed
        await this.page.locator('div.toast-success')
            .waitFor({ state: 'visible', timeout: 10000 })
            .catch(() => { }); // don't fail if toast doesn't appear

        await this.page.waitForLoadState('domcontentloaded');

        // Small wait for list to re-render
        await this.page.waitForTimeout(1000);
    }


    // ── BUDGET ENTRY POPUP ────────────────────────────────────────────────────────

    async openEntryPopup(entryTitle) {
        const row = this.page.locator('tr.tw-cursor-pointer')
            .filter({ hasText: entryTitle })
            .first();

        // Click the eye icon directly via JS — bypasses overflow-clip visibility issues
        const clicked = await row.evaluate(el => {
            el.scrollIntoView({ block: 'center', behavior: 'instant' });
            const buttons = el.querySelectorAll('button');
            if (buttons.length === 0) return false;
            buttons[buttons.length - 1].click();
            return true;
        });
        if (!clicked) throw new Error(`No button found in row for entry: ${entryTitle}`);

        // Wait for drawer to open
        await this.page.locator('div.drawer.is-large')
            .waitFor({ state: 'visible', timeout: 10000 });

        console.log(`✅ Drawer opened for entry: ${entryTitle}`);
    }

    async openTabInPopup(tabName) {
        const dialog = this.page.locator('.v-dialog, .modal, [role="dialog"]').last();
        await dialog.getByRole('tab', { name: tabName }).click();
        await this.page.waitForLoadState('domcontentloaded');
    }

    async verifyActivityLog(keyword) {
        const dialog = this.page.locator('.v-dialog, .modal, [role="dialog"]').last();
        await dialog.getByRole('tab', { name: 'Activity' }).click();

        // Verify the activity message contains the keyword e.g. 'created'
        const activityItem = dialog.locator('li, .activity-item, p')
            .filter({ hasText: new RegExp(keyword, 'i') })
            .first();
        await expect(activityItem).toBeVisible({ timeout: 10000 });
        console.log(`✅ Activity log contains: "${keyword}"`);
    }

    async getFirstDraftEntryTitle() {
        const draftRow = this.page.locator('tr.tw-cursor-pointer')
            .filter({ hasText: /Draft/i })
            .first();
        await draftRow.waitFor({ state: 'visible', timeout: 10000 });

        // Title is the text content of the row excluding the status badge
        // It's the second td (index 1) — first td is checkbox, second is status badge
        // third td (index 2) is the actual title
        const title = await draftRow.locator('td').nth(2).innerText();
        console.log(`📋 Raw title from td[2]: "${title.trim()}"`);
        return title.trim();
    }

    // Helper to scope to the open drawer
    getDrawer() {
        return this.page.locator('div.drawer.is-large');
    }

    async openTabInPopup(tabName) {
        await this.getDrawer().getByRole('tab', { name: tabName })
            .or(this.getDrawer().locator('button').filter({ hasText: tabName }))
            .click();
        await this.page.waitForLoadState('domcontentloaded');
    }

    async verifyActivityLog(keyword) {
        const drawer = this.getDrawer();
        await drawer.locator('button, a').filter({ hasText: /^Activity$/i }).click();
        const activityItem = drawer.locator('li, .activity-item, p')
            .filter({ hasText: new RegExp(keyword, 'i') })
            .first();
        await expect(activityItem).toBeVisible({ timeout: 10000 });
        console.log(`✅ Activity log contains: "${keyword}"`);
    }

    async verifyPOInPopup(poTitle, expectedStatus) {
        const drawer = this.getDrawer();
        const poRow = drawer.locator('tr').filter({ hasText: poTitle });
        await poRow.waitFor({ state: 'visible', timeout: 10000 });
        const statusBadge = poRow.locator('.badge, td')
            .filter({ hasText: expectedStatus });
        await expect(statusBadge.first()).toBeVisible({ timeout: 5000 });
        console.log(`✅ PO "${poTitle}" has status: ${expectedStatus}`);
    }

    async openPOFromPopup(poTitle) {
        // Scope to the current open drawer
        const drawer = this.page.locator('div.drawer.is-large').first();

        const poRow = drawer.locator('tr').filter({ hasText: poTitle });
        await poRow.waitFor({ state: 'visible', timeout: 10000 });

        // Take screenshot to see the PO row buttons
        await this.page.screenshot({ path: 'debug-po-row.png' });

        // Try the last button in the row (eye icon is usually last)
        const viewBtn = poRow.locator('button').last();
        await viewBtn.waitFor({ state: 'visible', timeout: 5000 });
        await viewBtn.click();

        // Wait for second drawer to open on top
        await this.page.locator('div.drawer.is-large')
            .nth(1)
            .waitFor({ state: 'visible', timeout: 10000 });

        console.log('✅ PO drawer opened');
    }

    async approvePurchaseOrderFromEntry(entryTitle, expectedStatus = 'Approved') {
        await this.openEntryPopup(entryTitle);
        const drawer = this.getDrawer();

        // The entry itself must be approved first — that's what generates the draft PO
        await drawer.getByRole('button', { name: /Request Approval/i }).click();
        await this.page.waitForLoadState('domcontentloaded');
        await drawer.getByRole('button', { name: /^Approve$/i }).click();
        await this.page.waitForLoadState('domcontentloaded');
        await expect(drawer.locator('span')
            .filter({ hasText: /^Approved$/i })
            .first()
        ).toBeVisible({ timeout: 10000 });

        await this.openTabInPopup('Purchase Orders');

        const draftPO = drawer.locator('tr').filter({ hasText: /Draft/i }).first();
        await draftPO.waitFor({ state: 'visible', timeout: 10000 });
        const poTitle = (await draftPO.locator('td').nth(1).innerText()).trim();

        await this.openPOFromPopup(poTitle);
        await this.approvePO();
        await this.verifyPOStatus(expectedStatus);
        console.log(`✅ Purchase order "${poTitle}" for entry "${entryTitle}" approved as ${expectedStatus}`);
    }

    // ── PURCHASE ORDER INTERACTIONS ───────────────────────────────────────────────

    async verifyPOInPopup(poTitle, expectedStatus) {
        const dialog = this.page.locator('.v-dialog, .modal, [role="dialog"]').last();
        const poRow = dialog.locator('tr').filter({ hasText: poTitle });
        await poRow.waitFor({ state: 'visible', timeout: 10000 });

        const statusBadge = poRow.locator('.badge, td').filter({ hasText: expectedStatus });
        await expect(statusBadge.first()).toBeVisible({ timeout: 5000 });
        console.log(`✅ PO "${poTitle}" has status: ${expectedStatus}`);
    }

    async openPOFromPopup(poTitle) {
        const drawer = this.page.locator('div.drawer.is-large').first();

        const poRow = drawer.locator('tr').filter({ hasText: poTitle });
        await poRow.waitFor({ state: 'visible', timeout: 10000 });

        // Only one button in the PO row — the view icon button
        const viewBtn = poRow.locator('button').first();
        await viewBtn.waitFor({ state: 'visible', timeout: 5000 });
        await viewBtn.click();

        // The PO now opens in its own modal (class "modal-shell"), replacing the Budget Entry
        // drawer entirely, rather than stacking as a second div.drawer.is-large on top of it.
        await this.page.locator('.modal-shell').first().waitFor({ state: 'visible', timeout: 10000 });

        console.log('✅ PO panel opened');
    }

    async approvePO() {
        const poDrawer = this.page.locator('.modal-shell').first();

        // Wait for loading overlay inside drawer to disappear
        await poDrawer.locator('.tw-cursor-wait')
            .waitFor({ state: 'hidden', timeout: 15000 })
            .catch(() => { });

        await this.page.waitForTimeout(1000);

        // Check if Request Approval button exists
        const requestApprovalBtn = poDrawer.getByRole('button', { name: /Request Approval/i });
        const hasRequestApproval = await requestApprovalBtn.isVisible().catch(() => false);

        if (hasRequestApproval) {
            await expect(requestApprovalBtn).toBeEnabled({ timeout: 10000 });
            await requestApprovalBtn.click();

            // Wait for overlay to clear after click
            await poDrawer.locator('.tw-cursor-wait')
                .waitFor({ state: 'hidden', timeout: 15000 })
                .catch(() => { });

            await this.page.waitForTimeout(500);
            console.log('✅ PO approval requested');
        }

        // Approve button — a plain click; force:true silently no-ops in the new modal panel
        // (bypasses actionability checks in a way that stops the click reaching the framework handler)
        const approveBtn = poDrawer.getByRole('button', { name: /^Approve$/i });
        await expect(approveBtn).toBeEnabled({ timeout: 15000 });
        await approveBtn.click();

        await poDrawer.locator('.tw-cursor-wait')
            .waitFor({ state: 'hidden', timeout: 15000 })
            .catch(() => { });

        await this.page.waitForLoadState('domcontentloaded');
    }


    async verifyPOStatus(expectedStatus) {
        const poDrawer = this.page.locator('.modal-shell').first();
        const statusBadge = poDrawer.locator('span')
            .filter({ hasText: new RegExp(`^${expectedStatus}$`, 'i') })
            .first();
        await expect(statusBadge).toBeVisible({ timeout: 10000 });
        console.log(`✅ PO status is: ${expectedStatus}`);
    }

    // ── INVOICE INTERACTIONS ──────────────────────────────────────────────────────

    async openTabInPO(tabName) {
        const poDrawer = this.page.locator('.modal-shell').first();
        const tab = poDrawer.locator('a, button').filter({ hasText: new RegExp(`^${tabName}$`, 'i') }).first();
        await tab.waitFor({ state: 'visible', timeout: 10000 });
        await tab.click();
        await this.page.waitForLoadState('domcontentloaded');
        await this.page.waitForTimeout(500);
    }

    async raiseInvoice({ title, invoiceNumber }) {
        const poDrawer = this.page.locator('.modal-shell').first();

        // Click "Raise an invoice" link on the Invoices tab
        const raiseBtn = poDrawer.getByRole('button', { name: /raise.+invoice/i })
            .or(poDrawer.locator('a, button').filter({ hasText: /raise.+invoice/i }))
            .first();
        await raiseBtn.waitFor({ state: 'attached', timeout: 10000 });
        await raiseBtn.scrollIntoViewIfNeeded();
        await raiseBtn.click();

        // Wait for the Raise Invoice modal to open (try dialog role, then any visible container with the title)
        const invoiceModal = this.page.locator('[role="dialog"], .v-dialog, .modal-card, .modal-content, .card')
            .filter({ hasText: 'Raise Purchase Invoice' })
            .last()
            .or(
                this.page.locator('div').filter({ hasText: /^Raise Purchase Invoice/ }).last()
            );
        await invoiceModal.waitFor({ state: 'visible', timeout: 10000 });
        const invNum = invoiceNumber || (title ? title.slice(-5) : String(Date.now()).slice(-5));
        const invoiceNumLabel = this.page.locator('dt, label')
            .filter({ hasText: /^\s*Invoice Number\s*$/ })
            .filter({ visible: true })
            .last();
        await invoiceNumLabel.waitFor({ state: 'visible', timeout: 5000 });
        const invoiceNumInput = invoiceNumLabel.locator('xpath=following::input[1]');
        await invoiceNumInput.waitFor({ state: 'visible', timeout: 5000 });
        await invoiceNumInput.click();
        await invoiceNumInput.fill(invNum);

        // Click Raise Invoice to confirm
        await this.page.getByRole('button', { name: /^raise invoice$/i }).last().click();
        await this.page.waitForTimeout(1000);

        // Dismiss validation error dialog if invoice number was missing
        const errorOk = this.page.getByRole('button', { name: /^ok$/i });
        if (await errorOk.isVisible().catch(() => false)) {
            await errorOk.click();
            throw new Error('Raise Invoice failed: invoice number field was required but empty');
        }

        // Save the "Invoice Payments" dialog that opens automatically after raising
        const invoicePaymentsSave = this.page.getByRole('button', { name: /save changes/i });
        if (await invoicePaymentsSave.isVisible().catch(() => false)) {
            await invoicePaymentsSave.click();
            await this.page.waitForLoadState('domcontentloaded');
        }

        await this.page.waitForLoadState('domcontentloaded');
    }

    async verifyInvoiceRaised(invoiceTitle) {
        const invoiceRow = this.page.locator('tr').filter({ hasText: invoiceTitle }).first();
        await expect(invoiceRow).toBeVisible({ timeout: 15000 });
        console.log(`✅ Invoice raised and visible: ${invoiceTitle}`);
    }

    // Opens a cost budget entry's drawer from the Budget Summary page (a fresh page load,
    // which also refreshes any stale PO / invoice figures). Returns false if the entry
    // isn't listed in department `deptIndex`.
    async openCostEntryByTitle(entryTitle, { deptIndex = 0 } = {}) {
        await this.gotoBudgetSummaryPage();
        await this.selectBudgetVersion('A');
        await this.expandAllSections();
        await this.openDepartmentBudgetEntries(deptIndex);
        const row = this.page.locator('tr.tw-cursor-pointer').filter({ hasText: entryTitle }).first();
        // (isVisible() ignores its timeout option, so wait for the row explicitly.)
        if (!await row.waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false)) return false;
        await this.openEntryPopup(entryTitle);
        return true;
    }

    // Entry > Purchase Orders tab > the entry's PO > Invoices tab, from a fresh page load.
    async openPOInvoicesForEntry(entryTitle, options) {
        if (!await this.openCostEntryByTitle(entryTitle, options)) throw new Error(`Budget entry not found: ${entryTitle}`);
        await this.openTabInPopup('Purchase Orders');
        await this.openPOFromPopup(entryTitle);
        await this.openTabInPO('Invoices');
        return this.page.locator('.modal-shell').first();
    }

    // From an open "View Supplier Invoice" modal: Delete invoice. Invoices pushed to Xero go
    // through "Check Invoice" then "Void in Xero & Delete". Returns the HTTP status of the
    // delete request (204 = deleted).
    async deleteOpenSupplierInvoice() {
        await this.page.getByRole('heading', { name: 'View Supplier Invoice', exact: true }).waitFor({ state: 'visible', timeout: 10000 });
        await this.page.getByRole('link', { name: 'Delete invoice', exact: true }).click();
        const dialog = this.page.locator('.m-wrapper').filter({ hasText: 'Delete Invoice' }).last();
        await dialog.waitFor({ state: 'visible', timeout: 10000 });
        const confirm = dialog.getByRole('button', { name: /^(Delete|Void in Xero & Delete)$/ });
        const check = dialog.getByRole('button', { name: 'Check Invoice', exact: true });
        if (await check.isVisible().catch(() => false)) {
            await check.click();
            await expect(confirm, `Invoice could not be deleted: ${(await dialog.innerText()).replace(/\s+/g, ' ')}`)
                .toBeVisible({ timeout: 15000 });
        }
        const response = this.page.waitForResponse(
            r => r.request().method() === 'DELETE' && /\/invoices\/\d+/.test(r.url()), { timeout: 20000 });
        await confirm.click();
        return (await response).status();
    }

    // Removes a cost budget entry created by a test and everything hanging off it: its PO's
    // invoices, the PO itself (Reset To Draft, then Delete — no confirmation) and the entry.
    // The app reloads stale lists only on a fresh page load, so each step starts from one.
    // Returns false when the entry was already gone.
    async deleteEntryWithPurchaseOrder(entryTitle, { deptIndex = 0 } = {}) {
        let lastError;
        for (let pass = 0; pass < 10; pass++) {
            try {
                if (!await this.openCostEntryByTitle(entryTitle, { deptIndex })) return pass > 0;
                const drawer = this.getDrawer();
                await this.openTabInPopup('Purchase Orders');
                await this.page.waitForTimeout(1000);

                if (await drawer.locator('tr').filter({ hasText: entryTitle }).count()) {
                    await this.openPOFromPopup(entryTitle);
                    const po = this.page.locator('.modal-shell').first();
                    await this.openTabInPO('Invoices');

                    const invoiceEye = po.locator('tr').locator('button').filter({ has: this.page.locator('i.mdi-eye') }).first();
                    if (await invoiceEye.waitFor({ state: 'visible', timeout: 3000 }).then(() => true, () => false)) {
                        await invoiceEye.click();
                        await this.deleteOpenSupplierInvoice();
                        continue;
                    }

                    const reset = po.getByRole('button', { name: /Reset To Draft/i });
                    if (await reset.isVisible().catch(() => false)) {
                        await reset.click();
                        const resetDialog = this.page.getByText('Add Reset Comments', { exact: true })
                            .locator('xpath=ancestor::div[.//button[normalize-space(.)="Submit"]][1]');
                        await resetDialog.waitFor({ state: 'visible', timeout: 10000 });
                        await resetDialog.getByRole('textbox').fill('Removed by automated test clean-up');
                        await resetDialog.getByRole('button', { name: /^Submit$/i }).click();
                        await expect(po.getByRole('button', { name: /Request Approval/i })).toBeVisible({ timeout: 15000 });
                    }
                    const deleted = this.page.waitForResponse(
                        r => r.request().method() === 'DELETE' && /\/purchaseorders\/\d+\/delete/.test(r.url()), { timeout: 20000 });
                    await po.getByRole('button', { name: /Delete/i }).first().click();
                    await deleted;
                    continue;
                }

                await drawer.getByRole('button', { name: /Delete/i }).first().click();
                await this.page.getByText('Are you sure?', { exact: true }).waitFor({ state: 'visible', timeout: 10000 });
                await this.page.getByRole('button', { name: /Delete/i }).last().click();
                await expect(drawer).toBeHidden({ timeout: 15000 });
                console.log(`🗑️ Budget entry deleted: ${entryTitle}`);
            } catch (error) {
                // Progress made so far is saved server-side, so the next pass resumes from a fresh load.
                lastError = error;
                console.log(`⚠️ Clean-up pass ${pass + 1} for ${entryTitle} hit: ${error.message.split('\n')[0]}`);
            }
        }
        throw lastError || new Error(`Could not fully remove budget entry ${entryTitle}`);
    }


    // ── REVENUE BUDGET ────────────────────────────────────────────────────────────

    async gotoRevenueBudgetPage() {
        if (!this.eventBaseUrl) throw new Error('eventBaseUrl is not set');

        await this.page.goto(`${this.eventBaseUrl}/budget/revenue`, {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });

        await Promise.all([
            this.page.locator('text=Loading Information').waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {}),
            this.page.locator('text=Loading...').waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {}),
        ]);

        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        // "page-title" class dropped from headings — match on the h4 tag alone (see gotoBudgetSummaryPage)
        await expect(this.page.locator('h4').filter({ hasText: /Revenue Budget/i }))
            .toBeVisible({ timeout: 30000 });
    }

    async findAvailableRevenueStream(streams = ['Sponsorship', 'Merchandise']) {
        for (const stream of streams) {
            const row = this.page.locator('tr.tw-cursor-pointer').filter({ hasText: stream }).first();
            if (await row.isVisible().catch(() => false)) {
                console.log(`📊 Found revenue stream: ${stream}`);
                return stream;
            }
        }
        return null;
    }

    async openRevenueStreamBudgetEntries(streamName) {
        const row = this.page.locator('tr.tw-cursor-pointer')
            .filter({ hasText: streamName })
            .first();

        await row.waitFor({ state: 'visible', timeout: 10000 });
        await row.click();

        const budgetEntriesTab = this.page.locator('ul.tw-flex button')
            .filter({ hasText: /^Budget Entries$/ })
            .first();
        await budgetEntriesTab.waitFor({ state: 'visible', timeout: 10000 });
        await budgetEntriesTab.click();

        await this.page.getByRole('row', { name: '󱩨 Create a new budget entry', exact: true })
            .waitFor({ state: 'visible', timeout: 10000 });

        console.log(`📂 Opened revenue stream: ${streamName}`);
    }

    async createRevenueBudgetEntry({ title, subcategory, supplier, fixedCost, budgetedCost, streamName = null }) {
        const createRow = this.page.getByRole('row', { name: '󱩨 Create a new budget entry', exact: true });
        await createRow.waitFor({ state: 'visible', timeout: 10000 });
        await createRow.click();
        await this.page.getByPlaceholder('Title').waitFor({ state: 'visible', timeout: 10000 });

        const titleInput = this.page.getByPlaceholder('Title');
        await titleInput.fill(title);
        await this.page.waitForTimeout(300);

        if (!subcategory) {
            throw new Error(`Revenue subcategory is required to create budget entry "${title}"`);
        }

        await titleInput.press('Tab');
        await this.page.waitForTimeout(300);
        await this.page.keyboard.type(subcategory, { delay: 40 });
        await this.page.waitForTimeout(600);
        await this.page.keyboard.press('ArrowDown');
        await this.page.keyboard.press('Enter');
        await this.page.waitForTimeout(500);

        await this.page.keyboard.press('Tab');
        await this.page.waitForTimeout(300);
        await this.page.keyboard.type(supplier, { delay: 40 });
        await this.page.waitForTimeout(700);
        await this.page.keyboard.press('ArrowDown');
        await this.page.keyboard.press('Enter');
        await this.page.waitForTimeout(500);

        await this.page.keyboard.press('Tab');
        await this.page.waitForTimeout(200);
        await this.page.keyboard.press('Control+a');
        await this.page.keyboard.type(fixedCost.toString());
        await this.page.waitForTimeout(200);

        await this.page.keyboard.press('Tab');
        await this.page.waitForTimeout(200);
        await this.page.keyboard.press('Control+a');
        await this.page.keyboard.type(budgetedCost.toString());
        await this.page.waitForTimeout(300);
        await this.page.keyboard.press('Tab');
        await this.page.waitForTimeout(300);

        await this.page.evaluate(() => {
            const buttons = document.querySelectorAll('button');
            for (const btn of buttons) {
                if (btn.innerText?.trim().toLowerCase() === 'create' && !btn.disabled) {
                    btn.click();
                    return true;
                }
            }
            return false;
        });

        await this.page.waitForTimeout(1000);

        const successToast = this.page.locator('div.toast-success')
            .filter({ hasText: /created successfully/i })
            .first();

        try {
            await successToast.waitFor({ state: 'visible', timeout: 10000 });
            console.log(`✅ Revenue budget entry created: ${title}`);
        } catch {
            const formClosed = await this.page.getByPlaceholder('Title')
                .waitFor({ state: 'hidden', timeout: 10000 })
                .then(() => true)
                .catch(() => false);
            if (!formClosed) {
                throw new Error(`Revenue budget entry creation failed — no toast and form did not close: ${title}`);
            }
            console.log(`✅ Revenue budget entry created (form closed): ${title}`);
        }

        // Reload and re-open the stream so the entry row is visible
        await this.page.reload({ waitUntil: 'domcontentloaded' });
        await this.page.locator('text=Loading Information').waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});
        await this.expandAllSections();
        if (streamName) await this.openRevenueStreamBudgetEntries(streamName);
    }

    // ── PRICE PER HEAD CONFIGURATION ─────────────────────────────────────────────
    // Per-head streams (e.g. Bar) budget revenue as: heads × net amount per head, where
    // heads = sum of the selected ticket types' quantities × (1 − attrition rate).
    // Fixed uses each ticket type's Fixed quantity, Budgeted uses its Available quantity.
    // No ticket types selected = all ticket types are included.

    // From the Revenue Budget page, expands a stream row and opens its
    // "Price Per Head Configuration" tab (formerly "Revenue Per Head Configuration").
    async openPricePerHeadConfiguration(streamName) {
        const section = this.page.locator('div.ew-data-table').filter({ hasText: 'Revenue Streams' }).first();
        const row = section.locator('tr.tw-cursor-pointer')
            .filter({ has: this.page.getByRole('heading', { name: streamName, exact: true }) })
            .first();
        await row.waitFor({ state: 'visible', timeout: 10000 });
        await row.click();

        const tab = this.page.locator('button').filter({ hasText: /^(Revenue|Price) Per Head Configuration$/ }).first();
        await tab.waitFor({ state: 'visible', timeout: 10000 });
        await tab.click();
        await this.pricePerHeadTable().locator('tbody tr').first().waitFor({ state: 'visible', timeout: 10000 });
        console.log(`📂 Opened Price Per Head Configuration: ${streamName}`);
    }

    pricePerHeadTable() {
        return this.page.locator('table').filter({ has: this.page.locator('th', { hasText: 'Net Amount' }) }).last();
    }

    // Net Amount of every price-per-head entry in the open configuration tab.
    async getPricePerHeadNetAmounts() {
        const rows = this.pricePerHeadTable().locator('tbody tr');
        const amounts = [];
        for (let i = 0; i < await rows.count(); i++) {
            amounts.push(this.helpers.parseCurrency(await rows.nth(i).locator('td').nth(3).innerText()));
        }
        return amounts;
    }

    // An entry row by name, or by position when given a number.
    pricePerHeadEntryRow(entry) {
        const rows = this.pricePerHeadTable().locator('tbody tr');
        return typeof entry === 'number'
            ? rows.nth(entry)
            : rows.filter({ has: this.page.locator('td').first().getByText(entry, { exact: true }) }).first();
    }

    // Fills the "Create New Entry" row at the bottom of the configuration table
    // and creates the entry. Tax rate is picked from the rate list (e.g. "20% Income").
    async createPricePerHeadEntry({ name, category, customer, taxRate, grossAmount }) {
        await this.page.getByRole('button', { name: /Create New Entry/ }).click();
        const newRow = this.page.locator('tr').filter({ has: this.page.getByPlaceholder('Name', { exact: true }) }).last();
        await newRow.waitFor({ state: 'visible', timeout: 10000 });

        await newRow.getByPlaceholder('Name', { exact: true }).fill(name);

        await newRow.locator('td').nth(1).locator('[contenteditable="true"]').click();
        await this.page.locator('.v-popper__popper--shown').last().getByText(category, { exact: true }).click();
        await this.page.waitForTimeout(500);

        await newRow.locator('td').nth(2).locator('[contenteditable="true"]').click();
        await this.page.keyboard.type(customer, { delay: 40 });
        await this.page.waitForTimeout(1000);
        await this.page.locator('.v-popper__popper--shown').last().getByText(customer, { exact: true }).first().click();
        await this.page.waitForTimeout(500);

        await newRow.locator('td').nth(4).locator('button').click();
        await this.page.locator('.v-popper__popper--shown').last().getByText(taxRate, { exact: true }).click();
        await this.page.waitForTimeout(500);

        const grossInput = newRow.locator('input[type="number"]');
        await grossInput.fill(String(grossAmount));
        await grossInput.press('Tab');

        const createBtn = newRow.getByRole('button', { name: 'Create', exact: true });
        await expect(createBtn).toBeEnabled({ timeout: 5000 });
        await createBtn.click();
        await this.pricePerHeadEntryRow(name).waitFor({ state: 'visible', timeout: 10000 });
        await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        console.log(`✅ Price per head entry created: ${name}`);
    }

    // Deletes every entry with this name (also clears leftovers from failed runs).
    async deletePricePerHeadEntries(name) {
        const rows = () => this.pricePerHeadTable().locator('tbody tr')
            .filter({ has: this.page.locator('td').first().getByText(name, { exact: true }) });
        while (await rows().count()) {
            const before = await rows().count();
            await rows().first().locator('button').filter({ has: this.page.locator('i[class*="mdi-delete"], i[class*="mdi-trash"]') }).first().click();
            const confirm = this.page.getByRole('button', { name: /^(Yes, I'm sure|Yes|Delete|Confirm|OK)$/i }).last();
            if (await confirm.isVisible({ timeout: 3000 }).catch(() => false)) await confirm.click();
            await expect(rows()).toHaveCount(before - 1, { timeout: 10000 });
            console.log(`🗑️ Price per head entry deleted: ${name}`);
        }
    }

    // Clicking an entry puts its row into edit mode; the cog button then opens
    // the "Price Per Head Settings" modal (ticket types + attrition rate).
    // `entry` is the entry's name or its row index.
    async openPricePerHeadSettings(entry = 0) {
        // Edit mode turns the name cell into an input, so a name-based locator stops
        // matching once clicked — pin the row by its position first.
        let index = entry;
        if (typeof entry !== 'number') {
            const names = (await this.pricePerHeadTable().locator('tbody tr').evaluateAll(
                rows => rows.map(r => r.querySelector('td')?.innerText.trim() ?? '')));
            index = names.indexOf(entry);
            if (index < 0) throw new Error(`Price per head entry "${entry}" not found (have: ${names.join(', ')})`);
        }
        const row = this.pricePerHeadTable().locator('tbody tr').nth(index);
        await row.locator('td').first().click();
        const cog = row.locator('button').filter({ has: this.page.locator('i.mdi-cog') });
        await cog.waitFor({ state: 'visible', timeout: 10000 });
        await cog.click();
        await this.pricePerHeadSettingsModal().waitFor({ state: 'visible', timeout: 10000 });
        return row;
    }

    pricePerHeadSettingsModal() {
        return this.page.getByText('Price Per Head Settings', { exact: true })
            .locator('xpath=ancestor::div[.//button[normalize-space()="Save"]][1]');
    }

    // Reads the open modal: { ticketTypes: { VIP: false, Main: true, ... }, attritionRate: 10 }
    async getPricePerHeadSettings() {
        const modal = this.pricePerHeadSettingsModal();
        const labels = modal.locator('label').filter({ has: this.page.locator('input[type="checkbox"]') })
            .filter({ hasNotText: 'Allow margin' });
        const ticketTypes = {};
        for (let i = 0; i < await labels.count(); i++) {
            const label = labels.nth(i);
            ticketTypes[(await label.innerText()).trim()] = await label.locator('input').isChecked();
        }
        const attritionRate = Number(await modal.locator('dl').filter({ hasText: 'Attrition Rate' }).locator('input[type="number"]').inputValue()) || 0;
        return { ticketTypes, attritionRate };
    }

    // Opens the settings for an entry, ticks exactly `ticketTypes` (unticking the
    // rest), sets the attrition rate, saves the modal and then saves the entry row.
    // New entries come with "Allow margin" ticked, which makes Department/Subcategory
    // required and keeps Save disabled — `allowMargin: false` (default) unticks it.
    async configurePricePerHead({ ticketTypes, attritionRate, entry = 0, allowMargin = false }) {
        const row = await this.openPricePerHeadSettings(entry);
        const modal = this.pricePerHeadSettingsModal();
        const { ticketTypes: available } = await this.getPricePerHeadSettings();

        for (const name of ticketTypes) {
            if (!(name in available)) {
                throw new Error(`Ticket type "${name}" not offered in Price Per Head Settings (have: ${Object.keys(available).join(', ')})`);
            }
        }
        for (const name of Object.keys(available)) {
            await modal.locator('label').filter({ hasText: new RegExp(`^\\s*${name}\\s*$`) })
                .locator('input').setChecked(ticketTypes.includes(name));
        }

        await modal.locator('label').filter({ hasText: 'Allow margin' }).locator('input').setChecked(allowMargin);

        const attritionInput = modal.locator('dl').filter({ hasText: 'Attrition Rate' }).locator('input[type="number"]');
        await attritionInput.fill(String(attritionRate));

        await modal.getByRole('button', { name: 'Save', exact: true }).click();
        const forbidden = this.page.getByText('You are unable to perform this action as the event is closed');
        await Promise.race([
            modal.waitFor({ state: 'hidden', timeout: 10000 }),
            forbidden.waitFor({ state: 'visible', timeout: 10000 }),
        ]);
        if (await forbidden.isVisible().catch(() => false)) {
            throw new Error('Price per head settings not saved — the event is closed (Forbidden). Point BUDGET_EVENT_URL at an open event.');
        }

        const saveRow = row.locator('button').filter({ has: this.page.locator('i.mdi-check') });
        if (await saveRow.isVisible().catch(() => false)) await saveRow.click();
        await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        await this.page.waitForTimeout(1000);
        console.log(`✅ Price per head set — tickets: [${ticketTypes.join(', ') || 'all'}], attrition: ${attritionRate}%`);
    }

    // Opens the Tickets stream page and returns every ticket type's quantities:
    // { Main: { fixed: 500, price: 500, available: 5000 }, ... }
    async getTicketTypeQuantities(ticketsStreamName = 'Tickets') {
        const section = this.page.locator('div.ew-data-table').filter({ hasText: 'Revenue Streams' }).first();
        const row = section.locator('tr.tw-cursor-pointer')
            .filter({ has: this.page.getByRole('heading', { name: ticketsStreamName, exact: true }) })
            .first();
        await row.waitFor({ state: 'visible', timeout: 10000 });
        await row.locator('button').filter({ has: this.page.locator('i.mdi-arrow-right') }).first().click();
        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        // "Expand all" can be clicked before the subcategory rows have rendered,
        // in which case nothing expands — retry until the ticket tables show.
        const tables = this.page.locator('table').filter({ has: this.page.locator('th', { hasText: 'Ticket Name' }) });
        await this.page.getByText('Available Tickets').first().waitFor({ state: 'visible', timeout: 15000 });
        await expect(async () => {
            if (!await tables.first().isVisible()) {
                await this.page.getByRole('button', { name: /^\s*(Expand|Collapse) all\s*$/ }).first().click();
            }
            await expect(tables.first()).toBeVisible({ timeout: 3000 });
        }).toPass({ timeout: 20000 });
        await this.page.waitForTimeout(1500);

        // Columns: [spacer, Ticket Name, Fixed, Price, Available, then Net/Gross × 3].
        // The outer subcategory tables also match the filter (they contain these
        // tables), so only rows with the full 11 ticket columns are read.
        const cellValue = async cell => {
            const input = cell.locator('input');
            return (await input.count()) ? input.first().inputValue() : cell.innerText();
        };
        const result = {};
        for (let t = 0; t < await tables.count(); t++) {
            if (!await tables.nth(t).isVisible()) continue;
            const rows = tables.nth(t).locator('tbody tr');
            for (let r = 0; r < await rows.count(); r++) {
                const cells = rows.nth(r).locator('> td');
                if (await cells.count() < 11) continue;
                const name = (await cellValue(cells.nth(1))).trim();
                if (!name) continue;
                result[name] = {
                    fixed: this.helpers.parseCurrency(await cellValue(cells.nth(2))),
                    price: this.helpers.parseCurrency(await cellValue(cells.nth(3))),
                    available: this.helpers.parseCurrency(await cellValue(cells.nth(4))),
                };
            }
        }
        return result;
    }


} // <--- This is the final brace for the whole Class