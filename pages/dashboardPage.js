import { expect } from '@playwright/test';
import { newEventCreation } from './newEventCreation.js';
import { regressionAccountName } from './accountConfig.js';
import { BASE_URL } from './env.js';

export class DashboardPage {

    constructor(page) {
        this.page = page;
        this.sectionHeading = page.locator('h4:text-is("Revenue Streams")');
        this.revenueSection = page.locator('section', { has: this.sectionHeading });
        this.currentEventUrl = null;
        this.eventCreation = new newEventCreation(page);
    }

    async dashboardPageVerify() {
        await this.waitForOverlayHidden(5000);
        await this.page.locator('i.mdi.mdi-view-dashboard').click();
        await this.page.locator('span').filter({ hasText: 'Summary' }).first().waitFor({ state: 'visible', timeout: 3000 });
        await this.page.locator('span').filter({ hasText: 'Revenue' }).first().waitFor({ state: 'visible', timeout: 3000 });
        await this.page.getByText('Cost', { exact: true }).first().waitFor({ state: 'visible', timeout: 3000 });
        await this.page.locator('h4').filter({ hasText: 'Budget Approvals' }).first().waitFor({ state: 'visible', timeout: 3000 });
        await this.page.locator('h4').filter({ hasText: 'Purchasing Approvals' }).first().waitFor({ state: 'visible', timeout: 3000 });
    }

    // ── NAVIGATION ────────────────────────────────────────────────────────────────

    async navigateToEvent(searchTerm) {
        await this.page.goto(`${BASE_URL}/onboarding`);

        const accountBtn = this.page.getByRole('button', { name: regressionAccountName });
        await accountBtn.waitFor({ state: 'visible', timeout: 15000 });
        await accountBtn.click();
        const searchBox = this.page.getByRole('textbox', { name: 'Search for an event...' });
        await searchBox.waitFor({ state: 'visible', timeout: 10000 });
        await searchBox.fill(searchTerm);
        await this.page.getByRole('button', { name: 'Event Image' }).first().waitFor({ state: 'visible', timeout: 15000 });
        await this.page.getByRole('button', { name: 'Event Image' }).first().click();
        await this.page.waitForURL(/\/event\/\d+/, { timeout: 30000 });
        this.currentEventUrl = this.page.url().replace(/\/$/, '');
        console.log(`Navigated to event "${searchTerm}": ${this.currentEventUrl}`);
    }

    async goBackToEvent() {
        if (this.currentEventUrl) {
            await this.page.goto(this.currentEventUrl);
            await this.waitForOverlayHidden(15000);
            await expect(this.sectionHeading).toBeVisible({ timeout: 15000 });
        }
    }

    async waitForOverlayHidden(timeout = 5000) {
        const overlay = this.page.locator('.m-backdrop, .v-overlay, .modal-backdrop, [data-backdrop], div[class*="backdrop"]');
        await expect(overlay).toBeHidden({ timeout });
    }

    async dismissAutoModal() {
        const backdrop = this.page.locator('.m-backdrop').first();
        if (!await backdrop.isVisible()) return;

        console.log('Auto-appearing modal detected — dismissing...');

        // Try Escape (works for most dismissible Vuetify dialogs)
        await this.page.keyboard.press('Escape');
        const hiddenAfterEscape = await backdrop.waitFor({ state: 'hidden', timeout: 1000 })
            .then(() => true, error => {
                if (error.name === 'TimeoutError') return false;
                throw error;
            });
        if (hiddenAfterEscape) {
            console.log('Modal dismissed via Escape');
            return;
        }

        // Try clicking any close-icon button (force to bypass backdrop)
        const closeBtn = this.page.locator('button').filter({
            has: this.page.locator('i.mdi-close, i[class*="mdi-close"]'),
        }).first();
        if (await closeBtn.isVisible()) {
            await closeBtn.click({ force: true });
            const hiddenAfterClose = await backdrop.waitFor({ state: 'hidden', timeout: 1000 })
                .then(() => true, error => {
                    if (error.name === 'TimeoutError') return false;
                    throw error;
                });
            if (hiddenAfterClose) {
                console.log('Modal dismissed via close button');
                return;
            }
        }

        // Last resort: disable pointer-events on the backdrop via JS so UI is unblocked
        await this.page.evaluate(() => {
            document.querySelectorAll('.m-backdrop').forEach(el => {
                el.style.pointerEvents = 'none';
            });
        });
        console.log('Backdrop pointer-events disabled via JS fallback');
    }

    // ── SHORTCUT MENU ─────────────────────────────────────────────────────────────

    async openShortcutMenu() {
        const addBtn = this.page.locator('button')
            .filter({ has: this.page.locator('i.mdi-plus, i[class*="plus"]') })
            .first();

        // If a modal/backdrop is present it may intercept pointer events — wait for it to hide.
        const backdrop = this.page.locator('.m-backdrop, .v-overlay, [data-backdrop], div[class*="backdrop"]');
        // A still-visible backdrop is handled by the click fallbacks below; other failures surface.
        await backdrop.first().waitFor({ state: 'hidden', timeout: 5000 }).then(() => true, error => {
            if (error.name === 'TimeoutError') return false;
            throw error;
        });

        try {
            await addBtn.click();
        } catch (err) {
            // If normal click is blocked (backdrop intercepts), try JS click on the element
            await this.waitForOverlayHidden(2000);
            try {
                await this.page.evaluate(() => {
                    const ic = document.querySelector('button i.mdi-plus, button i[class*=\"plus\"]');
                    if (ic && ic.parentElement) ic.parentElement.click();
                });
            } catch (e) {
                // final fallback: force click
                await addBtn.click({ force: true });
            }
        }

        await this.waitForOverlayHidden(2000);
        await this.page.getByText('Quick Create', { exact: true }).waitFor({ state: 'visible', timeout: 8000 });
        console.log('Shortcut menu opened');
    }

    // 2. Create Budget Entry
    async shortcutCreateBudgetEntry() {
        await this.openShortcutMenu();
        await this.page.getByText('Budget Entry', { exact: true }).click();
        await this.page.getByText('New Budget Entry', { exact: true })
            .waitFor({ state: 'visible', timeout: 10000 });
        await this.page.keyboard.press('Escape');
        await expect(this.page.getByText('Quick Create', { exact: true }))
            .toBeHidden({ timeout: 5000 });

        // Title
        const titleInput = this.page.getByPlaceholder('Title');
        await titleInput.waitFor({ state: 'visible', timeout: 5000 });
        await titleInput.fill(`AutoTest-BE-${Date.now()}`);

        // Department — Tab from Title into the multiselect, type to search
        await titleInput.press('Tab');
        await this.page.keyboard.type('Artists', { delay: 50 });
        await this.page.locator('.selector-dropdown a').first().waitFor({ state: 'visible', timeout: 10000 });
        await this.page.keyboard.press('ArrowDown');
        await this.page.keyboard.press('Enter');

        // Subcategory — appears after Department; Tab into it and pick first option
        await this.page.keyboard.press('Tab');
        await this.page.locator('.selector-dropdown a').first().waitFor({ state: 'visible', timeout: 10000 });
        await this.page.keyboard.press('ArrowDown');
        await this.page.keyboard.press('Enter');

        // Supplier — Tab into the search field, type and pick first result
        await this.page.keyboard.press('Tab');
        await this.page.keyboard.type('Muddles', { delay: 50 });
        await this.page.locator('.selector-dropdown a').first().waitFor({ state: 'visible', timeout: 10000 });
        await this.page.keyboard.press('ArrowDown');
        await this.page.keyboard.press('Enter');

        // Fixed Cost — click the number input and enter a value
        const fixedCostInput = this.page.locator('input[type="number"]').first();
        await fixedCostInput.click({ clickCount: 3 });
        await fixedCostInput.fill('100');

        await this.page.getByRole('button', { name: /create budget entry/i }).click();

        // After creation the drawer transitions to the Budget Entry detail view
        await this.page.getByRole('button', { name: /request approval/i })
            .waitFor({ state: 'visible', timeout: 15000 });

        console.log('Budget entry created via shortcut ✓');
    }

    // 3. Create Purchase Order — Title, Subcategory, Supplier required (Department field removed from this form;
    // subcategories are now grouped by department inside the Subcategory dropdown instead).
    async shortcutCreatePurchaseOrder({ title }) {
        await this.openShortcutMenu();
        await this.page.getByText('Purchase Order', { exact: true }).click();

        await this.page.getByText('New Purchase Order', { exact: true })
            .waitFor({ state: 'visible', timeout: 10000 });

        // Title — a contenteditable div inside the panel's <h2>, not a plain <input>.
        // Not scoped by its placeholder text since that text disappears once focused.
        const titleField = this.page.locator('h2 [contenteditable="true"]').first();
        await titleField.waitFor({ state: 'visible', timeout: 5000 });
        await titleField.click();
        await titleField.pressSequentially(title, { delay: 30 });

        // Subcategory — type to search, pick the matching option from the dropdown
        const subcatField = this.page.locator('dt', { hasText: 'Subcategory' })
            .locator('xpath=following-sibling::dd[1]')
            .locator('[contenteditable="true"]');
        await subcatField.click();
        await this.page.keyboard.type('Communication', { delay: 50 });
        const subcategoryOption = this.page.locator('.selector-dropdown a').filter({ hasText: 'Communication' }).first();
        await subcategoryOption.waitFor({ state: 'visible', timeout: 10000 });
        await subcategoryOption.click();

        // Supplier — same eventwise-selector pattern as Subcategory
        const supplierField = this.page.locator('dt', { hasText: 'Supplier' })
            .locator('xpath=following-sibling::dd[1]')
            .locator('[contenteditable="true"]');
        await supplierField.click();
        await this.page.keyboard.type('Muddles Ltd', { delay: 50 });
        const supplierOption = this.page.locator('.selector-dropdown a').first();
        await supplierOption.waitFor({ state: 'visible', timeout: 10000 });
        await supplierOption.click();

        // Line items table is now always visible (no separate "Default Tax Rate" step first) —
        // Description, Qty (defaults to 1) and Unit Price live in the first row.
        const lineRow = this.page.locator('table.table tbody tr[data-draggable="true"]').first();
        await lineRow.getByPlaceholder('Enter a description').fill(title);

        const priceField = lineRow.locator('td').nth(3).locator('[contenteditable="true"]');
        await priceField.click({ clickCount: 3 });
        await priceField.pressSequentially('500', { delay: 30 });

        // Tax — the row's own "None" button opens the rate dropdown (used to be a page-level field)
        await lineRow.getByRole('button', { name: 'None', exact: true }).click();
        const taxOption = this.page.getByText('20%').first();
        await taxOption.waitFor({ state: 'visible', timeout: 10000 });
        await taxOption.click();

        // Footer now splits into "Create" (save + close) and "Create & View" (save + open detail).
        // The old single "Create Purchase Order" button opened the detail view, so use "Create & View".
        await this.page.getByRole('button', { name: 'Create & View', exact: true }).click();

        // After creation the drawer transitions to PO detail view (no toast)
        await this.page.getByRole('button', { name: /request approval/i })
            .waitFor({ state: 'visible', timeout: 15000 });

        console.log('Purchase order created via shortcut ✓');
    }

    // 4. Create Department — fills name, clicks Create
    async shortcutCreateDepartment({ name }) {
        await this.openShortcutMenu();
        await this.page.getByText('Department', { exact: true }).click();

        await this.page.getByText('Create Cost Department', { exact: true })
            .waitFor({ state: 'visible', timeout: 10000 });

        const nameInput = this.page.locator('input[type="text"], input:not([type])').first();
        await nameInput.waitFor({ state: 'visible', timeout: 5000 });
        await nameInput.fill(name);

        await this.page.evaluate(() => {
            for (const btn of document.querySelectorAll('button')) {
                if (btn.innerText?.trim() === 'Create' && !btn.disabled) { btn.click(); return; }
            }
        });

        await this.page.locator('div.toast-success')
            .first()
            .waitFor({ state: 'visible', timeout: 10000 });

        console.log('Department created via shortcut ✓');
    }

    // 5. Create Subcategory — fills name, selects department, creates
    async shortcutCreateSubcategory({ name }) {
        await this.openShortcutMenu();
        await this.page.getByText('Subcategory', { exact: true }).click();

        // Wait for Name input (avoids strict mode violation on the heading text)
        await this.page.getByPlaceholder('Please insert a name here')
            .waitFor({ state: 'visible', timeout: 10000 });
        await this.page.getByPlaceholder('Please insert a name here').fill(name);

        // Department select — select "Artists" (a Cost Department, not a Revenue Stream)
        const deptSelect = this.page.locator('select').first();
        await deptSelect.waitFor({ state: 'visible', timeout: 5000 });
        await this.page.waitForFunction(
            () => document.querySelectorAll('select')[0]?.options.length > 1,
            { timeout: 10000 }
        );
        await deptSelect.selectOption({ label: 'Artists' });

        await expect(this.page.getByText('Loading Information', { exact: true })).toBeHidden({ timeout: 15000 });

        await this.page.getByRole('button', { name: /create subcategory/i }).click();

        await this.page.locator('div.toast-success')
            .first()
            .waitFor({ state: 'visible', timeout: 10000 });

        console.log('Subcategory created via shortcut ✓');
    }

    // 6. Create Ticket Type — opens the ticket setup modal via shortcut and fills 3 tickets (the same Earlybird / Main / VIP
    // set the old event-creation regression set up). `namePrefix` keeps the new tickets apart from the event's existing ones.
    async shortcutCreateTicketType({ namePrefix = '' } = {}) {
        const ticketName = name => `${namePrefix}${name}`;
        await this.openShortcutMenu();
        await this.waitForOverlayHidden(2000);

        const ticketTypeBtn = this.page.getByText('Ticket Type', { exact: true }).first();
        await ticketTypeBtn.waitFor({ state: 'visible', timeout: 10000 });
        try {
            await ticketTypeBtn.click();
        } catch (err) {
            await this.waitForOverlayHidden(2000);
            await ticketTypeBtn.click({ force: true });
        }

        // ── Ticket setup modal ─────────────────────────────────────────
        await this.eventCreation.waitForTicketSetupModal();

        // ── Ticket 1: Earlybird ────────────────────────────────────────
        await this.eventCreation.fillTicketRow(0, {
            name:          ticketName('Earlybird'),
            revenueStream: 'Tickets',
            category:      'Earlybird',
            price:         60,
            headcount:     200,
            fixed:         200,
        });

        await this.eventCreation.addSeller('Direct Sales');
        await this.eventCreation.fillAllocated(0, 200);
        console.log('Ticket 1 (Earlybird) complete');

        // ── Ticket 2: Main ─────────────────────────────────────────────
        await this.eventCreation.addAnotherTicket();
        await this.eventCreation.fillTicketRow(1, {
            name:          ticketName('Main'),
            revenueStream: 'Tickets',
            category:      'Main',
            price:         100,
            headcount:     300,
            fixed:         300,
        });
        await this.eventCreation.fillAllocated(1, 300);
        console.log('Ticket 2 (Main) complete');

        // ── Ticket 3: VIP ──────────────────────────────────────────────
        await this.eventCreation.addAnotherTicket();
        await this.eventCreation.fillTicketRow(2, {
            name:          ticketName('VIP'),
            revenueStream: 'Tickets',
            category:      'VIP',
            price:         200,
            headcount:     50,
            fixed:         50,
        });
        await this.eventCreation.fillAllocated(2, 50);
        console.log('Ticket 3 (VIP) complete');

        // ── Tax rate ───────────────────────────────────────────────────
        await this.eventCreation.setTaxRate('Standard 20% (Income)');
        console.log('Tax rate set to 20% income');

        // ── Create tickets ─────────────────────────────────────────────
        await this.eventCreation.createTickets();

        await expect(
            this.page.getByRole('heading', { name: 'Tickets Created' })
        ).toBeVisible({ timeout: 10000 });
        console.log('Tickets Created dialog visible ✓');
    }

    // 7. Create Contact — single Name field (no separate first/last name in dashboard flow)
    async shortcutCreateContact({ name }) {
        await this.openShortcutMenu();
        await this.page.getByText('Contact', { exact: true }).click();

        await this.page.getByPlaceholder('Contact Name')
            .waitFor({ state: 'visible', timeout: 10000 });
        await this.page.getByPlaceholder('Contact Name').fill(name);

        await this.page.getByRole('button', { name: /create contact/i }).click();

        await this.page.locator('div.toast-success')
            .filter({ hasText: /created/i })
            .first()
            .waitFor({ state: 'visible', timeout: 10000 });

        console.log('Contact created via shortcut ✓');
    }

    // 8. Raise Supplier Invoice — search for a budget-entry prefix, then continue.
    async shortcutRaiseSupplierInvoice(searchTerm = 'Regression-Cost') {
        await this.openShortcutMenu();
        await this.page.getByText('Supplier Invoice', { exact: true }).click();

        await this.page.getByText(/Raise Purchase Invoice/i)
            .waitFor({ state: 'visible', timeout: 10000 });

        const searchBox = this.page.getByPlaceholder(/search/i).first();
        await searchBox.waitFor({ state: 'visible', timeout: 5000 });
        await searchBox.fill(searchTerm);

        // Regression-created budget entries use an auto-generated Regression-Cost prefix.
        const escapedSearchTerm = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const entry = this.page.getByText(new RegExp(`^${escapedSearchTerm}`, 'i')).first();
        await entry.waitFor({ state: 'visible', timeout: 15000 });
        await entry.click();

        await this.page.getByRole('button', { name: /continue/i }).first().click();

        console.log('Supplier invoice raised via shortcut ✓');
    }

    // ── TOOLBAR ICONS ─────────────────────────────────────────────────────────────

    async clickSearchIcon() {
        await this.page.locator('i.mdi-magnify').first().click();
        console.log('Search icon clicked');
    }

    async verifySearchResults(term) {
        const searchInput = this.page.locator('input[placeholder*="search" i]').first();
        await searchInput.waitFor({ state: 'visible', timeout: 5000 });
        await searchInput.fill(term);
        // Results load under "Budget Entries" header — exclude the hidden nav <a> link
        await expect(
            this.page.locator('div, span, p').filter({ hasText: /^Budget Entries$/ }).first()
        ).toBeVisible({ timeout: 5000 });
        console.log(`Search results visible for "${term}" ✓`);
    }

    async openCurrencyConverter() {
        await this.page.locator('i.mdi-calculator').first().click();
        console.log('Currency converter opened');
    }

    async openNotifications() {
        await this.page.locator('button')
            .filter({ has: this.page.locator('i.mdi-bell, i[class*="bell"]') })
            .first()
            .click();
        console.log('Notifications panel opened');
    }

    async markFirstNotificationAsRead() {
        await this.page.getByRole('button', { name: 'Mark Read' }).first().click();
        console.log('First notification marked as read ✓');
    }

}
