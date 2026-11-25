// eventSettings.spec.js
// Event > Settings: General Settings, Subcategories and Reporting.
//   - General: event details (name, location) and status, base currency, default markup, contingency, Xero tracking
//     option, tags, and the Delete Event option (checked, never clicked)
//   - Subcategories: unticking a subcategory takes it off the event's pages
//   - Reporting: Send Now, the daily report schedule, and the Xero comparison report (generate, notification,
//     mark as checked, latest 5, download)
// Every test puts back what it changes. Runs against EVENT_SETTINGS_TEST_EVENT_URL (an open event; falls back to
// PURCHASING_EVENT_URL / INVOICE_EVENT_URL). Event 122 is closed, so saves are refused there.
// Not covered: the status "Closed" (a closed event refuses saves, so it couldn't be put back), deleting the event, and
// reading the emails the reports send — only the confirmation messages and notifications are checked.
import { test, expect } from '../../fixtures/baseTest.js';
import { EventSettingsPage } from '../../pages/eventSettingsPage.js';
import { cleanupWithWarning } from '../utils/test-helpers.js';

const EVENT_URL = (process.env.EVENT_SETTINGS_TEST_EVENT_URL || process.env.PURCHASING_EVENT_URL || process.env.INVOICE_EVENT_URL || '').replace(/\/$/, '');

let settings;

// Settings are saved as they are changed; a reload shows what was really kept.
async function reload(page) {
    await settings.gotoGeneralSettings(EVENT_URL);
    await expect(page.getByText('Loading Information', { exact: true })).toBeHidden({ timeout: 20000 });
}

test.describe('Event Settings', () => {
    test.beforeEach(async ({ page }) => {
        if (!EVENT_URL) throw new Error('EVENT_SETTINGS_TEST_EVENT_URL / PURCHASING_EVENT_URL / INVOICE_EVENT_URL is not set');
        test.setTimeout(240000);
        settings = new EventSettingsPage(page);
        await settings.gotoGeneralSettings(EVENT_URL);
        await expect(page.getByText('Loading Information', { exact: true })).toBeHidden({ timeout: 20000 });
    });

    // ── GENERAL SETTINGS ─────────────────────────────────────────────────────────

    test('Update event details: name and location are saved', async ({ page }) => {
        const original = { name: await settings.nameInput.inputValue(), city: await settings.cityInput.inputValue(), line2: await settings.addressLine2Input.inputValue() };
        const suffix = Date.now().toString().slice(-5);
        try {
            await settings.setName(`${original.name}_${suffix}`);
            await settings.addressLine2Input.fill(`Auto Line ${suffix}`);
            await settings.addressLine2Input.blur();
            await settings.cityInput.fill(`AutoCity${suffix}`);
            await settings.cityInput.blur();
            await settings.waitForChangesSaved();

            await reload(page);
            await expect(settings.nameInput).toHaveValue(`${original.name}_${suffix}`);
            await expect(settings.addressLine2Input).toHaveValue(`Auto Line ${suffix}`);
            await expect(settings.cityInput).toHaveValue(`AutoCity${suffix}`);
            await expect(page.getByText(`${original.name}_${suffix}`).first(), 'New name shown on the page').toBeVisible();
        } finally {
            await cleanupWithWarning('event details', async () => {
                await settings.setName(original.name);
                await settings.addressLine2Input.fill(original.line2);
                await settings.addressLine2Input.blur();
                await settings.cityInput.fill(original.city);
                await settings.cityInput.blur();
                await settings.waitForChangesSaved();
                await reload(page);
                await expect(settings.nameInput, 'Name restored').toHaveValue(original.name);
            });
        }
    });

    test('Event status can be changed (TBC, Confirmed, Draft) and put back', async ({ page }) => {
        const original = await settings.statusSelect.inputValue();
        try {
            for (const status of ['TBC', 'Confirmed', 'Draft']) {
                await settings.setStatus(status);
                await reload(page);
                await expect(settings.statusSelect).toHaveValue(status);
                await expect(page.getByText('Something went wrong'), 'No error').toHaveCount(0);
            }
        } finally {
            await cleanupWithWarning('event status', async () => {
                await settings.setStatus(original);
                await reload(page);
                await expect(settings.statusSelect, 'Status restored').toHaveValue(original);
            });
        }
    });

    // The currency itself isn't changed (a change doesn't save in the app today) — only that the choices are there.
    test('Monetary settings: the Base Currency dropdown offers the currencies', async () => {
        const options = await settings.baseCurrencySelect.locator('option').evaluateAll(list => list.map(o => ({ value: o.value, label: o.textContent.trim() })));
        expect(options.length, 'Currencies offered').toBeGreaterThan(5);
        for (const code of ['GBP', 'EUR', 'USD', 'AUD', 'CHF', 'JPY']) {
            expect(options.map(o => o.value), `${code} is offered`).toContain(code);
        }
        for (const option of options) expect(option.label, `${option.value} has a name`).toContain(option.value);
        expect(new Set(options.map(o => o.value)).size, 'No duplicate currencies').toBe(options.length);
        expect(options.map(o => o.value), 'The current base currency is one of them').toContain(await settings.baseCurrencySelect.inputValue());
    });

    test('Monetary settings: default markup can be set', async ({ page }) => {
        const original = await settings.defaultMarkupInput.inputValue();
        try {
            await settings.setDefaultMarkup('7.5');
            await reload(page);
            expect(Number(await settings.defaultMarkupInput.inputValue()), 'Default markup after reload').toBeCloseTo(7.5, 2);
        } finally {
            await cleanupWithWarning('default markup', async () => {
                await settings.setDefaultMarkup(original || '0');
                await reload(page);
                expect(Number(await settings.defaultMarkupInput.inputValue()), 'Default markup restored').toBeCloseTo(Number(original || 0), 2);
            });
        }
    });

    test('Contingency budget: the type can be set (Nominal, Percentage) and put back', async ({ page }) => {
        const types = ['None', 'Nominal', 'Percentage'];
        const active = async () => {
            for (const type of types) {
                const classes = await page.getByRole('button', { name: type, exact: true }).getAttribute('class');
                if (/eventwise-blue|tw-bg-blue/.test(classes) && /tw-text-white/.test(classes)) return type;
            }
            return null;
        };
        const original = await active();
        expect(original, 'A contingency type is selected').not.toBeNull();
        try {
            for (const type of ['Nominal', 'Percentage']) {
                await settings.selectContingencyType(type);
                await reload(page);
                expect(await active(), `Contingency type after reload`).toBe(type);
                await expect(page.getByText('Something went wrong'), 'No error').toHaveCount(0);
            }
        } finally {
            await cleanupWithWarning('contingency type', async () => {
                await settings.selectContingencyType(original);
                await reload(page);
                expect(await active(), 'Contingency type restored').toBe(original);
            });
        }
    });

    test('Xero: the tracking option can be selected', async ({ page }) => {
        const box = () => page.getByText('Tracking Option', { exact: true }).locator('xpath=following::div[contains(@class,"eventwise-selector")][1]');
        const current = async () => (await box().locator('.selector-option').innerText()).trim();
        // The list offers the other options (not the one already selected).
        const choose = async wanted => {
            await box().locator('[contenteditable="true"]').click();
            const options = page.locator('.selector-dropdown a');
            const option = wanted ? options.filter({ hasText: wanted }).first() : options.first();
            await option.waitFor({ state: 'visible', timeout: 10000 });
            const chosen = (await option.innerText()).trim();
            await option.click();
            await expect(box().locator('.selector-option')).toHaveText(chosen);
            await settings.waitForChangesSaved();
            return chosen;
        };
        const original = await current();
        expect(original, 'A tracking option is selected to start with').toBeTruthy();
        let changed = false;
        try {
            const chosen = await choose();
            changed = true;
            expect(chosen, 'A different tracking option was offered').not.toBe(original);
            expect(await current(), 'Tracking option shown').toBe(chosen);
            await reload(page);
            expect(await current(), 'Tracking option after reload').toBe(chosen);
        } finally {
            await cleanupWithWarning('Xero tracking option', async () => {
                if (changed) {
                    await choose(original);
                    await reload(page);
                    expect(await current(), 'Tracking option restored').toBe(original);
                }
            });
        }
    });

    test('Tags: a tag assigned to the event is shown, and removed again', async ({ page }) => {
        const tag = 'sgNewTag';
        const tagsCard = page.locator('div').filter({ has: page.getByText('Tags', { exact: true }) }).filter({ has: page.locator('button', { hasText: /Add tags/ }) }).last();
        try {
            await settings.openAddTags();
            await settings.selectTag(tag);
            await page.keyboard.press('Escape');
            await settings.waitForChangesSaved();
            await reload(page);
            await expect(tagsCard.getByText(tag, { exact: true }), 'Assigned tag shown under Tags').toBeVisible();
        } finally {
            await cleanupWithWarning(`event tag ${tag}`, async () => {
                await settings.openAddTags();
                const checkbox = settings.tagOption(tag).locator('input[type="checkbox"]');
                if (await checkbox.isChecked()) await checkbox.uncheck();
                await page.keyboard.press('Escape');
                await settings.waitForChangesSaved();
                await reload(page);
                await expect(tagsCard.getByText(tag, { exact: true }), 'Tag removed again').toHaveCount(0);
            });
        }
    });

    test('Delete Event: the option needs the acknowledgement ticked first (not deleted)', async () => {
        await expect(settings.deleteEventButton, 'Delete Event is off until acknowledged').toBeDisabled();
        await settings.tickDeleteAcknowledgement();
        await expect(settings.deleteEventButton, 'Delete Event is on once acknowledged').toBeEnabled();
        await settings.untickDeleteAcknowledgement();
        await expect(settings.deleteEventButton, 'Delete Event is off again').toBeDisabled();
    });

    // ── SUBCATEGORIES ────────────────────────────────────────────────────────────

    test('Subcategories: an unticked subcategory is not offered on the event pages, a ticked one is', async ({ page, purchasingPage }) => {
        const subcategory = process.env.EVENT_SETTINGS_SUBCATEGORY || 'Hospitality';
        purchasingPage.eventBaseUrl = EVENT_URL;
        const offered = async () => {
            await purchasingPage.gotoPurchasingSummary();
            const [department] = await purchasingPage.readDepartments();
            await purchasingPage.openNewPurchaseOrder(department.name);
            const options = await purchasingPage.listOptions('Subcategory');
            await page.getByRole('button', { name: 'Cancel', exact: true }).click();
            return options;
        };
        const checkbox = () => page.locator('label').filter({ hasText: new RegExp(`^\\s*${subcategory}\\s*$`) }).locator('input[type="checkbox"]').first();
        const openSubcategories = async () => {
            await page.goto(`${EVENT_URL}/settings/subcategories`, { waitUntil: 'domcontentloaded' });
            await checkbox().waitFor({ state: 'visible', timeout: 20000 });
            await expect(page.getByText('Loading Information', { exact: true })).toBeHidden({ timeout: 20000 });
        };

        expect(await offered(), `${subcategory} is offered while ticked`).toContain(subcategory);
        await openSubcategories();
        expect(await checkbox().isChecked(), `${subcategory} starts ticked`).toBe(true);
        try {
            await checkbox().uncheck();
            await settings.waitForChangesSaved();
            await openSubcategories();
            expect(await checkbox().isChecked(), 'Unticked after reload').toBe(false);
            expect(await offered(), `${subcategory} is not offered once unticked`).not.toContain(subcategory);
        } finally {
            await cleanupWithWarning(`subcategory ${subcategory}`, async () => {
                await openSubcategories();
                if (!await checkbox().isChecked()) await checkbox().check();
                await settings.waitForChangesSaved();
                await openSubcategories();
                expect(await checkbox().isChecked(), `${subcategory} ticked again`).toBe(true);
            });
        }
        expect(await offered(), `${subcategory} is offered again once ticked`).toContain(subcategory);
    });

    // ── REPORTING ────────────────────────────────────────────────────────────────

    test('Reporting: Send Now requests the activity report', async ({ page }) => {
        await page.goto(`${EVENT_URL}/settings/reporting`, { waitUntil: 'domcontentloaded' });
        await expect(page.getByText('Activity Report', { exact: true })).toBeVisible({ timeout: 20000 });
        await expect(page.getByText('Loading Information', { exact: true })).toBeHidden({ timeout: 20000 });
        await expect(page.getByText('Send a report covering the past 7 days of activity within your event to your email address.')).toBeVisible();
        // The report is emailed to the signed-in user's own address (there is no recipient field on the page).
        const response = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/export/activities/pdf'), { timeout: 15000 });
        await page.getByRole('button', { name: /Send Now/ }).click();
        const sent = await response;
        expect(sent.ok(), 'Send Now request succeeded').toBe(true);
        expect(await sent.json(), 'Email sent').toMatchObject({ success: true });
        await expect(page.getByText('Report Sent').first(), 'Confirmation title').toBeVisible({ timeout: 10000 });
        await expect(page.getByText('Recent activity report has been sent to your email address').first()).toBeVisible();
    });

    test('Reporting: the daily report can be scheduled for chosen days, and cleared again', async ({ page }) => {
        await page.goto(`${EVENT_URL}/settings/reporting`, { waitUntil: 'domcontentloaded' });
        await expect(page.getByText('Schedule a Daily Report')).toBeVisible({ timeout: 20000 });
        await expect(page.getByText('Loading Information', { exact: true })).toBeHidden({ timeout: 20000 });
        const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        const box = day => page.locator('label').filter({ hasText: new RegExp(`^\\s*${day}\\s*$`) }).locator('input[type="checkbox"]');
        const state = async () => Object.fromEntries(await Promise.all(days.map(async day => [day, await box(day).isChecked()])));
        const original = await state();
        const reopen = async () => {
            await page.goto(`${EVENT_URL}/settings/reporting`, { waitUntil: 'domcontentloaded' });
            await expect(page.getByText('Schedule a Daily Report')).toBeVisible({ timeout: 20000 });
            await expect(page.getByText('Loading Information', { exact: true })).toBeHidden({ timeout: 20000 });
        };
        const chosen = ['Monday', 'Wednesday'];
        try {
            for (const day of days) {
                if (chosen.includes(day) !== original[day]) {
                    await (chosen.includes(day) ? box(day).check() : box(day).uncheck());
                    await settings.waitForChangesSaved();
                }
            }
            await reopen();
            const after = await state();
            for (const day of days) expect(after[day], `${day} after reload`).toBe(chosen.includes(day));
        } finally {
            await cleanupWithWarning('daily report schedule', async () => {
                for (const day of days) {
                    if (await box(day).isChecked() !== original[day]) {
                        await (original[day] ? box(day).check() : box(day).uncheck());
                        await settings.waitForChangesSaved();
                    }
                }
                await reopen();
                expect(await state(), 'Schedule restored').toEqual(original);
            });
        }
    });

    test('Xero Check Report: generate, get notified, mark as checked, see the latest 5, download', async ({ page }) => {
        await page.goto(`${EVENT_URL}/settings/reporting`, { waitUntil: 'domcontentloaded' });
        await expect(page.getByText('Loading Information', { exact: true })).toBeHidden({ timeout: 20000 });
        await page.getByText('Generated Reports', { exact: true }).click();
        await expect(page.getByText('Xero Comparison Report')).toBeVisible({ timeout: 20000 });
        await expect(page.getByText(/compares what Eventwise holds against Xero/)).toBeVisible();
        const eventName = (await page.locator('body').innerText()).split('\n')[1].trim();
        const reportText = async () => page.locator('body').innerText();
        const lastGenerated = async () => ((await reportText()).match(/Last generated:\s*([^\n]+)/)?.[1] ?? '').trim();
        const before = await lastGenerated();

        await test.step('Regenerate: it is queued, a notification says it is ready, and the report is updated', async () => {
            await page.getByRole('button', { name: 'Regenerate Report' }).click();
            await expect(page.getByText('Generated Report Queued').first()).toBeVisible({ timeout: 15000 });
            await expect(page.getByText('Generated report for Xero ready').first(), 'Notification').toBeVisible({ timeout: 90000 });
            await expect(page.getByText(`Your generated report is ready to view in your event settings (${eventName})`).first()).toBeVisible();
            await expect.poll(lastGenerated, { message: 'Last generated moves on', timeout: 30000 }).not.toBe(before);
        });

        await test.step('Mark as Checked records when it was checked', async () => {
            const patch = page.waitForResponse(r => r.request().method() === 'PATCH' && /generated-reports\/\d+\/checked/.test(r.url()), { timeout: 15000 });
            await page.getByRole('button', { name: 'Mark as Checked' }).click();
            expect((await patch).ok(), 'Marked as checked').toBe(true);
            await expect(page.getByText('Marked as Checked').first()).toBeVisible({ timeout: 10000 });
            await expect.poll(async () => ((await reportText()).match(/Last checked:\s*([^\n]+)/)?.[1] ?? '').trim(), { message: 'Last checked is shown' }).not.toBe('');
        });

        await test.step('The latest 5 reports are listed, each completed and downloadable', async () => {
            const section = page.getByText('Last 5 reports');
            await expect(section).toBeVisible();
            const requested = page.getByText(/^Last requested at:/);
            expect(await requested.count(), 'Reports listed').toBe(5);
            const links = page.getByRole('link', { name: 'Download PDF' });
            expect(await links.count(), 'Download links: latest report + the 5 listed').toBe(6);
        });

        await test.step('The reports can be downloaded as PDFs', async () => {
            for (const index of [0, 1]) {
                const download = page.waitForEvent('download', { timeout: 30000 });
                await page.getByRole('link', { name: 'Download PDF' }).nth(index).click();
                const file = await download;
                expect(file.suggestedFilename(), 'PDF file name').toMatch(/\.pdf$/i);
                const path = await file.path();
                const { statSync } = await import('fs');
                expect(statSync(path).size, 'PDF is not empty').toBeGreaterThan(1000);
            }
        });
    });
});
