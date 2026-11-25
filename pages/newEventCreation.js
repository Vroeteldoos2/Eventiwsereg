import { expect } from '@playwright/test';
import { regressionAccountName } from './accountConfig.js';
import { BASE_URL } from './env.js';


export class newEventCreation {
    constructor(page) {
        this.page = page;
        this.emailAddress = page.getByRole('textbox', { name: 'Email Address' });
        this.password = page.getByRole('textbox', { name: 'Password' });
        this.loginButton = page.getByRole('button', { name: 'Login' });
        this.eventwiseLogo = page.getByRole('button', { name: regressionAccountName })
    }

    async gotoLoginPage() {
        await this.page.context().clearCookies();
        await this.page.goto(`${BASE_URL}/auth/login`);
        await this.page.waitForLoadState('domcontentloaded');
    }


    async login(email, password) {
        await this.emailAddress.fill(email);
        await this.password.fill(password);
        await this.loginButton.click();
        await this.page.waitForURL(url => !url.pathname.includes('/auth/login'), { timeout: 30000 });
    }

    async gotoOnboardingPage() {
        await this.page.goto(`${BASE_URL}/onboarding`);
        const accountButton = this.page.getByRole('button', { name: regressionAccountName });
        await expect(accountButton).toBeVisible({ timeout: 30000 });
        await accountButton.click();
        await this.page.waitForLoadState('domcontentloaded');
    }

    //The Dynamic Month/Day Selector - reusable function to select any month and day in the date picker
    async selectDate(inputSelector, targetMonth, targetDay) {
        await inputSelector.click();

        const activeCalendar = this.page.locator('.flatpickr-calendar.open');
        await activeCalendar.waitFor({ state: 'visible', timeout: 5000 });

        await activeCalendar
            .locator('.flatpickr-day:not(.prevMonthDay):not(.nextMonthDay)')
            .filter({ hasText: targetDay })
            .first()
            .click({ force: true });
    }


    async selectDateRange(inputSelector, targetMonth, startDay, endDay, targetYear = null) {
        await inputSelector.click();

        const activeCalendar = this.page.locator('.flatpickr-calendar.open');

        // 1. Month Navigation
        const yearInput = activeCalendar.locator('input.cur-year').first();
        const nextButton = activeCalendar.locator('.flatpickr-next-month').first();
        const monthSelect = activeCalendar.locator('select.flatpickr-monthDropdown-months').first();

        for (let i = 0; i < 36; i++) {
            const currentMonth = await monthSelect.evaluate(el => el.options[el.selectedIndex].text);
            const currentYear = targetYear ? await yearInput.inputValue() : null;
            const monthMatch = currentMonth.includes(targetMonth);
            const yearMatch = !targetYear || currentYear === targetYear.toString();
            if (monthMatch && yearMatch) break;
            await nextButton.click();
        }

        // 2. Select Range
        const calendar = this.page.locator('.flatpickr-calendar.open');

        // Helper to find the correct day
        const getDay = (day) => activeCalendar.locator('.flatpickr-day:not(.prevMonthDay):not(.nextMonthDay)')
            .filter({ hasText: day }).first();

        await getDay(startDay).click();
        await getDay(endDay).click();

        // 3. Assertion: Ensure calendar closes (Standard Flatpickr behavior for ranges)
        // If your app keeps it open, change this to .toBeVisible()
        await expect(calendar).not.toBeVisible({ timeout: 2000 });
    }

    async addRevenueStream(name, description, streamType) {
        await this.page.getByText('Add another', { exact: true }).click();
        await this.page.getByText('Create New', { exact: true }).click();
        await this.page.getByRole('heading', { name: 'Add Revenue Stream' }).waitFor({ state: 'visible', timeout: 5000 });

        await this.page.getByPlaceholder('Give your new Revenue Stream a name', { exact: true }).fill(name);
        await this.page.keyboard.press('Tab');
        const descriptionField = this.page.locator('dl').filter({ hasText: 'Description' }).getByRole('textbox');
        await descriptionField.waitFor({ state: 'visible' });
        await expect(descriptionField).toBeEnabled({ timeout: 10000 });
        await descriptionField.fill(description);

        const typeButton = this.page.getByRole('button', { name: new RegExp(`${streamType}$`) });
        await typeButton.click();
        await expect(typeButton).toHaveClass(/tw-bg-eventwise-blue/);
        await this.page.getByText('Create Revenue Stream', { exact: true }).click()

        console.log('Revenue stream added')

    }

    async importExistingRevenueStream(name, { last = false } = {}) {
        await this.page.getByText('Add another', { exact: true }).click();
        await this.page.getByRole('button', { name: /Import Existing/i }).click();
        const dropdown = this.page.getByRole('combobox');
        await dropdown.waitFor({ state: 'visible', timeout: 5000 });
        await this.page.waitForFunction(
            sel => sel.options.length > 1,
            await dropdown.elementHandle(),
            { timeout: 10000 }
        );
        if (last) {
            const value = await dropdown.evaluate((sel, n) => {
                const matches = Array.from(sel.options).filter(o => o.text.trim() === n);
                return matches.length ? matches[matches.length - 1].value : null;
            }, name);
            if (!value) throw new Error(`No dropdown option found with label "${name}"`);
            console.log(`Importing stream by value (last match): ${value}`);
            await dropdown.selectOption({ value });
        } else {
            await dropdown.selectOption({ label: name });
        }
        await this.page.getByRole('button', { name: 'Import Revenue Stream' }).click();
        await this.page.getByRole('button', { name: 'Close' }).waitFor({ state: 'visible', timeout: 5000 });
        await this.page.getByRole('button', { name: 'Close' }).click();
        await this.page.waitForLoadState('domcontentloaded');
        console.log(`Imported existing revenue stream: ${name}`);
    }

    async manageRevenueSubCategories(SubcategoryName, description) {
        const managerHeading = this.page.getByRole('heading', { name: 'Manage Subcategories' });
        await this.page.getByRole('button', { name: 'Create New' }).click();
        await this.page.getByPlaceholder('name').nth(0).fill(SubcategoryName);
        await this.page.getByRole('button', { name: 'Close' }).click();
        await managerHeading.waitFor({ state: 'detached', timeout: 10000 });
        console.log('First  Revenue subcategory added')
    }

    // Opens the subcategory manager for a named revenue stream card and adds multiple subcategories
    async addSubcategoriesToStream(streamName, subcategoryNames = []) {
        const streamCard = this.page.locator('div').filter({ hasText: new RegExp(`^${streamName}`) }).first();
        const editBtn = streamCard.locator('button').filter({ hasText: /selected/i }).first();
        await editBtn.waitFor({ state: 'visible', timeout: 10000 });
        await editBtn.click();
        await this.page.getByRole('heading', { name: 'Manage Subcategories' }).waitFor({ state: 'visible', timeout: 5000 });

        for (const name of subcategoryNames) {
            await this.page.getByRole('button', { name: 'Create New' }).click();
            await this.page.getByPlaceholder('name').nth(0).fill(name);
        }
        await this.page.getByRole('button', { name: 'Close' }).click();
        console.log(`Subcategories added to ${streamName}: ${subcategoryNames.join(', ')}`);
    }

    async addCostDepartment(CostDepartmentName, description) {


        //   /***********Adding a  new cost  department (First time)**********************************************/


        await this.page.getByRole('button', { name: ' Add another' }).click();
        await this.page.getByRole('button', { name: 'Create New' }).click();
        await this.page.getByRole('textbox', { name: 'Give your new Cost Department a name' }).fill(CostDepartmentName);
        await this.page.keyboard.press('Tab');
        const costDescField = this.page.locator('dl').filter({ hasText: 'Description' }).getByRole('textbox');
        await costDescField.waitFor({ state: 'visible' });
        await expect(costDescField).toBeEnabled({ timeout: 10000 });
        await costDescField.fill(description);
        await this.page.getByRole('button', { name: 'Create Cost Department' }).click();

        console.log('Added a new cost department')

    }

    async importExistingCostDepartment(name) {
        await this.page.getByRole('button', { name: ' Add another' }).click();
        await this.page.getByRole('button', { name: /Import Existing/i }).click();
        const dropdown = this.page.getByRole('combobox');
        await dropdown.waitFor({ state: 'visible', timeout: 5000 });
        await dropdown.selectOption({ label: name });
        await this.page.getByRole('button', { name: 'Import Cost Department' }).click();
        await this.page.waitForLoadState('domcontentloaded');
        console.log(`Imported existing cost department: ${name}`);
    }

    async manageCostSubCategories(CostSubcategoryName, description) {
        //await this.page.getByRole('button', { name: '0 selected ' }).click(); // need to test this , initially the value is going to be '0'

        await this.page.getByText('Subcategories', { exact: true })


        // Adding sub categories 

        //subcategory1
        await this.page.getByRole('button', { name: /selected/i }).first().click();
        await this.page.getByRole('button', { name: 'Create New' }).click();
        await this.page.getByPlaceholder('Name').nth(0).fill(CostSubcategoryName);
        await this.page.getByRole('button', { name: 'Close' }).click();

    }

    async inviteTeamMembers() {

        await this.page.getByRole('heading', { name: 'Team Members' })
        const selectAllBox = this.page.getByRole('checkbox', { name: /select all/i });


        //test the SelectAll button functionality by checking and unchecking the box and asserting its state after each action


        // 1. Tick the box
        await selectAllBox.check();
        await expect(selectAllBox).toBeChecked();

        // 2. Untick the box
        await selectAllBox.uncheck();
        await expect(selectAllBox).not.toBeChecked();

        // Select team members manually


        await this.page.locator('div')
            .filter({ hasText: /^Chris Carter$/ }) // Using regex for an exact text match
            .getByRole('checkbox')
            .check();


    }

    // ──────────────────────────────────────────────────────────────────
    // Ticket setup methods
    // ──────────────────────────────────────────────────────────────────

    /**
     * Import the "Tickets" revenue stream.
     * Subcategory management is skipped — the ticket setup modal reads categories
     * from the global Tickets RS which already contains all required options.
     */
    async importTicketsWithSubcategories() {
        await this.importExistingRevenueStream('Tickets');
        console.log('Tickets are imported');
    }

    /** Wait for the "Let's setup your tickets" modal to appear after event creation. */
    // The modal is titled "Let's setup your tickets for <event>" after event creation / on the Tickets page, and "Add Tickets"
    // when opened from the dashboard's Quick Create > Ticket Type shortcut.
    async waitForTicketSetupModal() {
        await this.page.getByText("Let's setup your tickets for", { exact: false })
            .or(this.page.getByText('Add Tickets', { exact: true }))
            .first()
            .waitFor({ state: 'visible', timeout: 15000 });
        console.log('Ticket setup modal visible');
    }

    /**
     * Reads available category options from the first ticket row's Category dropdown
     * (the second <select> on the page).
     * Falls back to ['Earlybird'] if the dropdown has no options.
     */
    async getTicketCategories() {
        const catSelect = this.page.locator('select').nth(1);
        await catSelect.waitFor({ state: 'visible', timeout: 5000 });

        const options = await catSelect.locator('option').evaluateAll(
            opts => opts.map(o => o.textContent.trim()).filter(t => t !== '')
        );

        if (options.length > 0) {
            console.log('Available ticket categories:', options.join(', '));
            return options;
        }

        console.log('No ticket categories found — falling back to Earlybird');
        return ['Earlybird'];
    }

    /**
     * Fill one ticket row (0-based index) using page-level nth indexing.
     *
     * Layout assumptions (no other form inputs exist on the background overview page):
     *   Name   — getByPlaceholder('Required').nth(rowIndex)
     *   RS     — locator('select').nth(rowIndex * 2)
     *   Cat    — locator('select').nth(rowIndex * 2 + 1)
     *   Price  — input[type=number].nth(rowIndex * 5 + 0)
     *   HC     — input[type=number].nth(rowIndex * 5 + 1)
     *   Fixed  — input[type=number].nth(rowIndex * 5 + 2)
     *
     * Row 0 is filled BEFORE addSeller (only 3 number inputs exist), so the base
     * index 0*5=0 still maps correctly to indices 0, 1, 2.
     * Rows 1+ are added AFTER addSeller (5 inputs each) so 1*5=5, 2*5=10, etc.
     */
    /**
     * Fill one ticket row (0-based index).
     *
     * Observed DOM layout (from page inspection):
     *   contenteditable divs — 2 per row: Name (i*2), Price (i*2+1)
     *   input[type=number]   — 4 per row after addSeller: HC (i*4), Fixed (i*4+1),
     *                          Allocated (i*4+2), Rebate (i*4+3)
     *
     * Row 0 is filled BEFORE addSeller (2 contenteditable + 2 number inputs).
     * Price contenteditable contains "0" initially — triple-click to clear before typing.
     */
    async fillTicketRow(rowIndex, { name, revenueStream, category, price, headcount, fixed }) {
        // Scope to the modal using its heading text — the Vuetify modal does NOT carry
        // role="dialog", so we filter by the heading + button combo instead.
        const form = this.page.locator('div')
            .filter({ hasText: /Let's setup your tickets for|Add Tickets/i })
            .filter({ has: this.page.getByRole('button', { name: 'Create Tickets' }) })
            .last();

        // DOM layout (confirmed from page inspection):
        //   Name     — input[placeholder="Required"]  nth(rowIndex)
        //   RS       — select                         nth(rowIndex * 2)
        //   Category — select                         nth(rowIndex * 2 + 1)
        //   Price    — input[type="number"]           nth(rowIndex * 3 + 0)  (£ is a CSS prefix)
        //   HC       — input[type="number"]           nth(rowIndex * 3 + 1)
        //   Fixed    — input[type="number"]           nth(rowIndex * 3 + 2)

        // DOM layout (confirmed from HTML inspection):
        //   Name  — [contenteditable="true"]  nth(rowIndex * 2)
        //   Price — [contenteditable="true"]  nth(rowIndex * 2 + 1)   (£ is a sibling div, not a prefix)
        //   HC    — input[type="number"]      nth(rowIndex * 2)
        //   Fixed — input[type="number"]      nth(rowIndex * 2 + 1)
        // "Required" is a sibling div acting as a fake placeholder — NOT a real placeholder attribute.

        const ce  = form.locator('[contenteditable="true"]');
        const num = form.locator('input[type="number"]');

        // Name
        await ce.nth(rowIndex * 2).waitFor({ state: 'visible', timeout: 10000 });
        await ce.nth(rowIndex * 2).click({ clickCount: 3 });
        await ce.nth(rowIndex * 2).pressSequentially(name, { delay: 30 });

        // Revenue Stream + Category — only present when event has a ticket-type revenue stream
        const selectCount = await form.locator('select').count();
        if (selectCount > 0) {
            await form.locator('select').nth(rowIndex * 2).selectOption({ label: revenueStream });
            const categorySelect = form.locator('select').nth(rowIndex * 2 + 1);
            await this.page.waitForFunction(
                sel => Array.from(sel.options).some(option => option.text.trim()),
                await categorySelect.elementHandle(),
                { timeout: 10000 }
            );
            const catOptions = await categorySelect.evaluate(s =>
                Array.from(s.options, (option, index) => ({ label: option.text.trim(), index }))
                    .filter(option => option.label)
            );
            const matchingCategory = catOptions.find(option => option.label === category);
            if (matchingCategory) {
                await categorySelect.selectOption({ label: category });
            } else {
                await categorySelect.selectOption({ index: catOptions[0].index });
            }
        } else {
            console.log(`⚠️  No Revenue Stream/Category selects found for row ${rowIndex} — event may not have a ticket-type revenue stream`);
        }

        // Price
        await ce.nth(rowIndex * 2 + 1).click({ clickCount: 3 });
        await ce.nth(rowIndex * 2 + 1).pressSequentially(price.toString(), { delay: 30 });

        // Headcount
        await num.nth(rowIndex * 4).click({ clickCount: 3 });
        await num.nth(rowIndex * 4).fill(headcount.toString());

        // Fixed
        await num.nth(rowIndex * 4 + 1).click({ clickCount: 3 });
        await num.nth(rowIndex * 4 + 1).fill(fixed.toString());

        console.log(`Ticket row ${rowIndex} filled: ${name}`);
    }

    /** Click "Add Seller" header button and choose a seller type from the dropdown. */
    async addSeller(sellerType = 'Direct Sales') {
        const inputCount = await this.page.locator('input[type="number"]').count();
        await this.page.getByRole('button', { name: 'Add Seller' }).click();

        await this.page.getByRole('option', { name: sellerType })
            .or(this.page.getByText(sellerType, { exact: true }))
            .first()
            .click();

        await expect.poll(() => this.page.locator('input[type="number"]').count())
            .toBeGreaterThan(inputCount);
        console.log(`Seller type "${sellerType}" added`);
    }

    /**
     * Fill the Allocated input for a given row (0-based). This becomes the "Available"
     * count once the ticket is created, so callers should pass the same amount used for
     * "fixed" in fillTicketRow() to keep Fixed and Available equal for each ticket type.
     * Must be called after addSeller(). After addSeller each row has 3 number inputs
     * (Headcount=+0, Fixed=+1, Allocated=+2), so Allocated = rowIndex * 3 + 2.
     */
    async fillAllocated(rowIndex, amount) {
        const allocInput = this.page.locator('input[type="number"]').nth(rowIndex * 4 + 2);
        await allocInput.click({ clickCount: 3 });
        await allocInput.fill(amount.toString());
        console.log(`Row ${rowIndex} allocated: ${amount}`);
    }

    /** Click "+ Add another ticket" to append a new empty row. */
    async addAnotherTicket() {
        const numberInputs = this.page.locator('input[type="number"]');
        const inputCount = await numberInputs.count();
        await this.page.getByText('Add another ticket', { exact: false }).click();
        await expect.poll(() => numberInputs.count()).toBeGreaterThan(inputCount);
        console.log('New ticket row added');
    }

    /** Click the Tax Rate "None" link and pick a rate from the list that appears. */
    async setTaxRate(label = '20% income') {
        const noneLink = this.page.getByText('None', { exact: true });
        if (await noneLink.isVisible()) {
            await noneLink.click();
            await this.page.getByText(label, { exact: false }).first().click();
            console.log(`Tax rate set to "${label}"`);
        } else {
            console.log('Tax rate already set, skipping');
        }
    }

    /** Click "Create Tickets" to submit the form. */
    async createTickets() {
        await this.page.getByRole('button', { name: 'Create Tickets' }).click();
        console.log('Create Tickets clicked');
    }

    /** Open the Tickets page from the ticket-creation confirmation. */
    async visitBulkEditor() {
        await this.page.getByRole('button', { name: 'Visit Tickets' })
            .click();
        await this.page.waitForURL(/\/tickets\/bulk(?:\/|$)/, { timeout: 30000 });
        console.log('Tickets page opened');
    }

    // ──────────────────────────────────────────────────────────────────

    async reviewPageAssertions(revenueName, revenueSubcategoryName, costDepartmentName, costSubcategoryName, additionalRevenueName) {


        await this.page.getByRole('heading', { name: 'Have we got everything?' }).waitFor({ state: 'visible', timeout: 5000 });







        console.log('Review page assertions');

        await expect(this.page.getByText('Revenue Streams', { exact: true })).toBeVisible();
        await expect(this.page.getByText(revenueName, { exact: true })).toBeVisible();
        await expect(this.page.getByText(additionalRevenueName, { exact: true })).toBeVisible();
        await expect(this.page.getByText('Cost Departments', { exact: true })).toBeVisible();
        await expect(this.page.getByText(costDepartmentName, { exact: true })).toBeVisible();
        await expect(this.page.getByText(costSubcategoryName, { exact: true })).toBeVisible();

    }

}