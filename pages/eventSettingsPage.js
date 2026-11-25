import { expect } from '@playwright/test';
import { resolve } from 'path';

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

export class EventSettingsPage {
    constructor(page) {
        this.page = page;

        // Event Details
        this.nameInput = page.locator('#eventName');
        this.statusSelect = page.locator('select[name="status"]');
        this.eventDateInput = page.locator('xpath=//label[normalize-space(text())="Event Date(s)"]/following-sibling::input[@type="text"][1]');
        this.projectStartInput = page.locator('xpath=//label[normalize-space(text())="Project Start"]/following-sibling::input[@type="text"][1]');
        this.projectEndInput = page.locator('xpath=//label[normalize-space(text())="Project End"]/following-sibling::input[@type="text"][1]');

        // Location
        this.addressLine1Input = page.getByPlaceholder('Address Line 1');
        this.addressLine2Input = page.getByPlaceholder('Address Line 2');
        this.cityInput = page.getByPlaceholder('City');
        this.postcodeInput = page.getByPlaceholder('Postal Code');

        // Tags
        this.addTagsButton = page.locator('button').filter({ hasText: 'Add tags' });

        // Monetary Settings
        this.baseCurrencySelect = page.locator('select').filter({ has: page.locator('option[value="GBP"]') }).first(); // the first is Base Currency; the second is Accounting Currency
        this.defaultMarkupInput = page.getByPlaceholder('0.00');

        // Contingency Budget
        this.contingencyAmountInput = page.locator('xpath=//label[normalize-space(text())="Amount"]/following::input[1]');
        this.contingencyAmountSymbol = page.locator('xpath=//label[normalize-space(text())="Amount"]/following::span[1]');

        // Delete Event
        this.deleteAckCheckbox = page.locator('label')
            .filter({ hasText: 'I acknowledge and understand the risks associated with deleting this event' })
            .locator('input[type="checkbox"]');
        this.deleteEventButton = page.getByRole('button', { name: 'Delete Event', exact: true });

        this.allChangesSavedIndicator = page.getByText('All changes saved', { exact: true });
    }

    async gotoGeneralSettings(eventBaseUrl) {
        await this.page.goto(`${eventBaseUrl}/settings`, { waitUntil: 'domcontentloaded' });
        // "page-title" class was dropped from headings in a UI redesign — match on the h4 tag alone
        await expect(this.page.locator('h4').filter({ hasText: 'Event Settings' })).toBeVisible({ timeout: 15000 });
        await expect(this.page.getByText('Event Details', { exact: true })).toBeVisible({ timeout: 10000 });
    }

    async importTemplateIntoExistingEvent(eventBaseUrl, templatePath) {
        await this.gotoGeneralSettings(eventBaseUrl);
        const importTemplate = this.page.getByText('Import Template', { exact: true }).first();
        await expect(importTemplate).toBeVisible({ timeout: 15000 });
        await importTemplate.click();
        const eventTemplate = this.page.getByText(/^TemplateEventAutoRegression/i).first();
        await eventTemplate
            .waitFor({ state: 'visible', timeout: 10000 });
        await eventTemplate.click();

        const upload = this.page.locator('input[type="file"]').first();
        await upload.setInputFiles(resolve(templatePath));
        const validateButton = this.page.getByRole('button', { name: /validate/i }).first();
        await expect(validateButton).toBeVisible({ timeout: 15000 });
        await validateButton.click();

        const importChecks = this.page.getByText('Data Import Check', { exact: true });
        await expect(importChecks).toHaveCount(3, { timeout: 30000 });
        const submitImport = this.page.getByText('Import Template', { exact: true }).last();
        await expect(submitImport).toBeVisible({ timeout: 15000 });
        await submitImport.click();
    }

    async waitForChangesSaved() {
        await this.allChangesSavedIndicator.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    }

    async setName(name) {
        await this.nameInput.fill(name);
        await this.nameInput.blur();
        await this.waitForChangesSaved();
        console.log(`Event name set to: ${name}`);
    }

    async setStatus(status) {
        await this.statusSelect.selectOption(status);
        await this.waitForChangesSaved();
        console.log(`Event status set to: ${status}`);
    }

    // Navigates an open flatpickr calendar to the given month/year using the month
    // dropdown + year input as ground truth, stepping prev/next as needed in either direction.
    async navigateFlatpickrTo(calendar, targetMonthIndex, targetYear) {
        const monthSelect = calendar.locator('select.flatpickr-monthDropdown-months');
        const yearInput = calendar.locator('input.cur-year');
        const nextButton = calendar.locator('.flatpickr-next-month');
        const prevButton = calendar.locator('.flatpickr-prev-month');

        for (let i = 0; i < 60; i++) {
            const currentMonthIndex = await monthSelect.evaluate(el => el.selectedIndex);
            const currentYear = Number(await yearInput.inputValue());
            if (currentMonthIndex === targetMonthIndex && currentYear === targetYear) return;

            const currentAbs = currentYear * 12 + currentMonthIndex;
            const targetAbs = targetYear * 12 + targetMonthIndex;
            await (targetAbs > currentAbs ? nextButton : prevButton).click();
        }
        throw new Error(`Could not navigate flatpickr calendar to ${MONTH_NAMES[targetMonthIndex]} ${targetYear}`);
    }

    // Selects a date in a flatpickr calendar opened from inputLocator.
    // range: true clicks the target day twice (start + end) for a range-mode picker,
    // producing a single-day range.
    async selectFlatpickrDate(inputLocator, date, { range = false } = {}) {
        await inputLocator.click();
        const calendar = this.page.locator('.flatpickr-calendar.open');
        await calendar.waitFor({ state: 'visible', timeout: 5000 });

        const targetMonthIndex = date.getMonth();
        const targetYear = date.getFullYear();
        await this.navigateFlatpickrTo(calendar, targetMonthIndex, targetYear);

        const ariaLabel = `${MONTH_NAMES[targetMonthIndex]} ${date.getDate()}, ${targetYear}`;
        const day = calendar.locator(`.flatpickr-day[aria-label="${ariaLabel}"]`).first();
        await day.click();
        if (range) {
            await day.click();
        }
        await this.waitForChangesSaved();
    }

    async setEventDate(date) {
        await this.selectFlatpickrDate(this.eventDateInput, date, { range: true });
        console.log(`Event date set to: ${date.toDateString()}`);
    }

    async setProjectStart(date) {
        await this.selectFlatpickrDate(this.projectStartInput, date);
        console.log(`Project start set to: ${date.toDateString()}`);
    }

    async setProjectEnd(date) {
        await this.selectFlatpickrDate(this.projectEndInput, date);
        console.log(`Project end set to: ${date.toDateString()}`);
    }

    async fillLocation({ addressLine1, addressLine2, city, postcode }) {
        if (addressLine1 !== undefined) await this.addressLine1Input.fill(addressLine1);
        if (addressLine2 !== undefined) await this.addressLine2Input.fill(addressLine2);
        if (city !== undefined) await this.cityInput.fill(city);
        if (postcode !== undefined) await this.postcodeInput.fill(postcode);
        await this.addressLine1Input.blur();
        await this.waitForChangesSaved();
        console.log(`Location updated: ${[addressLine1, city, postcode].filter(Boolean).join(', ')}`);
    }

    async openAddTags() {
        await this.addTagsButton.click();
    }

    tagOption(tagName) {
        return this.page.locator('label').filter({ hasText: new RegExp(`^${tagName}$`) });
    }

    async selectTag(tagName) {
        await this.tagOption(tagName).locator('input[type="checkbox"]').check();
        console.log(`Tag selected: ${tagName}`);
    }

    async setBaseCurrency(currencyCode) {
        await this.baseCurrencySelect.selectOption(currencyCode);
        await this.waitForChangesSaved();
        console.log(`Base currency set to: ${currencyCode}`);
    }

    async setDefaultMarkup(value) {
        await this.defaultMarkupInput.fill(value.toString());
        await this.defaultMarkupInput.blur();
        await this.waitForChangesSaved();
        console.log(`Default markup set to: ${value}`);
    }

    async selectContingencyType(type) {
        await this.page.getByRole('button', { name: type, exact: true }).click();
        await this.waitForChangesSaved();
        console.log(`Contingency type set to: ${type}`);
    }

    async setContingencyAmount(value) {
        await this.contingencyAmountInput.fill(value.toString());
        await this.contingencyAmountInput.blur();
        await this.waitForChangesSaved();
        console.log(`Contingency amount set to: ${value}`);
    }

    async tickDeleteAcknowledgement() {
        await this.deleteAckCheckbox.check();
    }

    async untickDeleteAcknowledgement() {
        await this.deleteAckCheckbox.uncheck();
    }
}
