// kpi.spec.js
// Event > KPI Dashboard (the event's KPI report):
//   - the KPI Dashboard link is on the event sidebar once KPI reports are enabled for the account
//   - Show Info (Day / Date / Show / Venue from the event; Event Running Time typed in) is kept after saving
//   - Budgeted and Actual are editable and the Variance follows
//   - sections can be hidden and shown again without losing their figures, and the list is saved with the report
//   - PDF and Email work on the saved report, and a hidden section is left out of the PDF
//   - there is one report per event: saving again updates it
//   - the KPI report is available on a closed event
// Runs on KPI_EVENT_URL (falls back to PURCHASING_EVENT_URL / INVOICE_EVENT_URL); every test puts back what it changes.
// Not covered: enabling KPI reports on the admin page for an account, and the very first population of a brand-new
// report (event 206 already has a saved report).
import { test, expect } from '../../fixtures/baseTest.js';
import { EventSettingsPage } from '../../pages/eventSettingsPage.js';
import { readPdfText } from '../utils/pdf.js';
import { cleanupWithWarning } from '../utils/test-helpers.js';

const EVENT_URL = (process.env.KPI_EVENT_URL || process.env.PURCHASING_EVENT_URL || process.env.INVOICE_EVENT_URL || '').replace(/\/$/, '');
// A closed event (writes are refused there, so it is only looked at).
const CLOSED_EVENT_URL = (process.env.KPI_CLOSED_EVENT_URL || '').replace(/\/$/, '');
const QA_EMAIL = process.env.QA_EMAIL?.trim() || '';
const ROW = 'TOTAL GA TICKETS SOLD';

const isReportSave = r => r.request().method() === 'PUT' && /\/kpi-report\/\d+$/.test(r.url());

async function openReport(page, eventUrl = EVENT_URL) {
    await page.goto(`${eventUrl}/kpi-dashboard`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Loading Information', { exact: true })).toBeHidden({ timeout: 15000 });
}

// A report row: its Budgeted, Actual and (read-only) Variance inputs.
function kpiRow(page, label) {
    const row = page.locator('div.tw-grid').filter({ has: page.locator('div.cell', { hasText: new RegExp(`^${label}$`) }) }).first();
    return { budgeted: row.locator('input').nth(0), actual: row.locator('input').nth(1), variance: row.locator('input').nth(2) };
}

// Section tick box in the list on the right (the last text with that name; the report's own heading comes first).
function sectionBox(page, name) {
    return page.getByText(name, { exact: true }).last().locator('xpath=following::input[@type="checkbox"][1]');
}

async function saveReport(page) {
    const saved = page.waitForResponse(isReportSave, { timeout: 20000 });
    await page.getByRole('button', { name: 'Save' }).click();
    const response = await saved;
    expect(response.ok(), 'Report saved').toBe(true);
    await expect(page.getByText('Report Updated').first()).toBeVisible({ timeout: 10000 });
    return response;
}

test.describe('KPI Dashboard', () => {
    test.beforeEach(async ({ page }) => {
        if (!EVENT_URL) throw new Error('KPI_EVENT_URL / PURCHASING_EVENT_URL / INVOICE_EVENT_URL is not set');
        test.setTimeout(240000);
        await openReport(page);
    });

    test('KPI Dashboard is on the event sidebar and opens the KPI report', async ({ page }) => {
        await expect(page.locator('a[href$="/kpi-dashboard"]').first(), 'KPI Dashboard link on the event sidebar').toBeAttached();
        await expect(page.getByText(/^KPI Report for /)).toBeVisible();
        for (const button of ['Email', 'PDF', 'Save']) await expect(page.getByRole('button', { name: button })).toBeVisible();
        for (const heading of ['SHOW INFO', 'TICKETS & ATTENDANCE', 'BOX OFFICE FINANCIALS', 'OTHER FINANCIALS', 'HOSPITALITY FINANCIALS', 'FOOD', 'COACHES']) {
            await expect(page.getByText(heading, { exact: true }).first(), heading).toBeVisible();
        }
        for (const column of ['Budgeted', 'Actual', 'Variance']) await expect(page.getByText(column, { exact: true }).first(), column).toBeVisible();
    });

    test('Show Info: Day, Date and Venue come from the event, and the Event Running Time is typed in and kept', async ({ page }) => {
        const settings = new EventSettingsPage(page);
        await settings.gotoGeneralSettings(EVENT_URL);
        const eventDate = new Date(`${(await settings.eventDateInput.inputValue()).trim()} 12:00`);
        const addressLine1 = (await settings.addressLine1Input.inputValue()).trim();
        const city = (await settings.cityInput.inputValue()).trim();
        const day = eventDate.getDate();
        const suffix = day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd' : day % 10 === 3 && day !== 13 ? 'rd' : 'th';

        await openReport(page);
        await expect(page.getByPlaceholder('Day')).toHaveValue(eventDate.toLocaleDateString('en-GB', { weekday: 'long' }));
        await expect(page.getByPlaceholder('Date')).toHaveValue(`${day}${suffix} ${eventDate.toLocaleDateString('en-GB', { month: 'long' })} ${eventDate.getFullYear()}`);
        expect(await page.getByPlaceholder('Venue').inputValue(), 'Venue').toContain(addressLine1);
        expect(await page.getByPlaceholder('Venue').inputValue(), 'Venue').toContain(city);
        expect(await page.getByPlaceholder('Show').inputValue(), 'Show').toContain('NewEvent_AutomationTesting_11thMay');

        const running = page.getByPlaceholder('Event Running Time');
        const original = await running.inputValue();
        try {
            await running.fill('Auto 9am - 5pm');
            await saveReport(page);
            await openReport(page);
            await expect(page.getByPlaceholder('Event Running Time'), 'Kept after saving').toHaveValue('Auto 9am - 5pm');
        } finally {
            await cleanupWithWarning('KPI running time', async () => {
                await page.getByPlaceholder('Event Running Time').fill(original);
                await saveReport(page);
                await openReport(page);
                await expect(page.getByPlaceholder('Event Running Time'), 'Running time restored').toHaveValue(original);
            });
        }
    });

    test('Budgeted and Actual are editable, the Variance follows, and the figures are kept once saved', async ({ page }) => {
        const row = kpiRow(page, ROW);
        await expect(row.variance, 'Variance is calculated, not typed').toHaveAttribute('readonly', '');
        const original = { budgeted: await row.budgeted.inputValue(), actual: await row.actual.inputValue() };
        const variance = async () => Number(await kpiRow(page, ROW).variance.inputValue());
        try {
            await row.budgeted.fill('400');
            await row.actual.fill('260');
            await expect.poll(variance, { message: 'Variance = Actual − Budgeted' }).toBe(-140);
            await row.budgeted.fill('100');
            await row.actual.fill('130');
            await expect.poll(variance, { message: 'Variance when Actual is above Budgeted' }).toBe(30);

            await saveReport(page);
            await openReport(page);
            const after = kpiRow(page, ROW);
            await expect(after.budgeted).toHaveValue('100');
            await expect(after.actual).toHaveValue('130');
            await expect(after.variance, 'Variance kept').toHaveValue('30');
        } finally {
            await cleanupWithWarning('KPI budget and actual values', async () => {
                const reset = kpiRow(page, ROW);
                await reset.budgeted.fill(original.budgeted);
                await reset.actual.fill(original.actual);
                await saveReport(page);
                await openReport(page);
                await expect(kpiRow(page, ROW).budgeted, 'Budgeted restored').toHaveValue(original.budgeted);
                await expect(kpiRow(page, ROW).actual, 'Actual restored').toHaveValue(original.actual);
            });
        }
    });

    test('Sections: a hidden section is only hidden (its figures are kept) and the list is saved with the report', async ({ page }) => {
        const section = 'FOOD';
        const box = () => sectionBox(page, section);
        const foodRow = () => kpiRow(page, 'FOOD REVENUE');
        expect(await box().isChecked(), `${section} starts shown`).toBe(true);
        const original = { budgeted: await foodRow().budgeted.inputValue(), actual: await foodRow().actual.inputValue() };
        const marker = '77';
        try {
            await foodRow().budgeted.fill(marker);
            await box().uncheck();
            await expect(page.getByText('FOOD REVENUE', { exact: true }), 'Section rows hidden once de-selected').toBeHidden();

            await saveReport(page);
            await openReport(page);
            expect(await box().isChecked(), 'De-selection saved with the report').toBe(false);
            await expect(page.getByText('FOOD REVENUE', { exact: true })).toBeHidden();

            await box().check();
            await expect(page.getByText('FOOD REVENUE', { exact: true }), 'Section is back').toBeVisible();
            await expect(foodRow().budgeted, 'Figures kept while hidden').toHaveValue(marker);
        } finally {
            await cleanupWithWarning(`${section} KPI section and values`, async () => {
                if (!await box().isChecked()) await box().check();
                await foodRow().budgeted.fill(original.budgeted);
                await foodRow().actual.fill(original.actual);
                await saveReport(page);
                await openReport(page);
                expect(await box().isChecked(), `${section} shown again`).toBe(true);
                await expect(foodRow().budgeted, 'Food figure restored').toHaveValue(original.budgeted);
            });
        }
    });

    test('PDF: the saved report downloads as a PDF, without the sections that were de-selected', async ({ page }) => {
        const section = 'COACHES';
        const box = () => sectionBox(page, section);
        const download = async () => {
            const file = page.waitForEvent('download', { timeout: 30000 });
            await page.getByRole('button', { name: 'PDF' }).click();
            const pdf = await file;
            expect(pdf.suggestedFilename(), 'File name').toMatch(/^KPI Report .*\.pdf$/);
            return readPdfText(await pdf.path());
        };

        const full = await download();
        for (const text of ['TOTAL GA TICKETS SOLD', 'TICKETS & ATTENDANCE', 'BOX OFFICE FINANCIALS', 'COACHES SALES']) expect(full, `PDF contains ${text}`).toContain(text);

        try {
            await box().uncheck();
            await saveReport(page);   // the PDF is made from what is saved
            const trimmed = await download();
            expect(trimmed, 'De-selected section left out').not.toContain('COACHES SALES');
            expect(trimmed, 'The other sections stay').toContain('TOTAL GA TICKETS SOLD');
        } finally {
            await cleanupWithWarning(`${section} KPI section`, async () => {
                if (!await box().isChecked()) await box().check();
                await saveReport(page);
                await openReport(page);
                expect(await box().isChecked(), `${section} shown again`).toBe(true);
            });
        }
        expect(await download(), 'Section back in the PDF once re-selected').toContain('COACHES SALES');
    });

    test('Email: the report can be emailed as a PDF', async ({ page }) => {
        test.skip(!QA_EMAIL, 'Set QA_EMAIL to run the KPI email test');
        await page.getByRole('button', { name: 'Email' }).click();
        const dialog = page.locator('.m-wrapper, .modal-shell, div.drawer, [role="dialog"]').filter({ hasText: 'Send KPI Report by email' }).last();
        await expect(dialog).toBeVisible({ timeout: 10000 });
        await expect(dialog).toContainText('Regarding the KPI Report for this event.');
        const send = dialog.getByRole('button', { name: 'Send Email' });
        await expect(send, 'Send Email waits for an address').toBeDisabled();

        await dialog.getByPlaceholder('Type an email address and press enter to add').fill(QA_EMAIL);
        await page.keyboard.press('Enter');
        await expect(dialog.getByText(QA_EMAIL), 'Address added').toBeVisible();
        await expect(send).toBeEnabled();
        const sent = page.waitForResponse(r => r.request().method() === 'POST' && /\/kpi-report\/\d+\/email$/.test(r.url()), { timeout: 20000 });
        await send.click();
        const response = await sent;
        expect(response.ok(), 'Email request').toBe(true);
        expect(await response.json()).toMatchObject({ success: true });
        await expect(dialog, 'Dialog closes once sent').toBeHidden({ timeout: 10000 });
    });

    test('There is one report per event: saving again updates it', async ({ page }) => {
        const row = kpiRow(page, ROW);
        const original = await row.actual.inputValue();
        const reportIds = [];
        try {
            for (const value of ['111', '222']) {
                await kpiRow(page, ROW).actual.fill(value);
                const response = await saveReport(page);
                reportIds.push(response.url().match(/kpi-report\/(\d+)$/)[1]);
            }
            expect(new Set(reportIds).size, `Both saves updated the same report (${reportIds.join(', ')})`).toBe(1);
            await openReport(page);
            await expect(kpiRow(page, ROW).actual, 'The latest save overwrote the earlier one').toHaveValue('222');
        } finally {
            await cleanupWithWarning('KPI actual value', async () => {
                await kpiRow(page, ROW).actual.fill(original);
                await saveReport(page);
                await openReport(page);
                await expect(kpiRow(page, ROW).actual, 'Actual restored').toHaveValue(original);
            });
        }
    });

    test('Closed events: the KPI report is available', async ({ page }) => {
        test.skip(!CLOSED_EVENT_URL, 'No closed event configured (KPI_CLOSED_EVENT_URL)');
        await openReport(page, CLOSED_EVENT_URL);
        await expect(page.getByText(/^KPI Report for /)).toBeVisible();
        for (const button of ['Email', 'PDF', 'Save']) await expect(page.getByRole('button', { name: button })).toBeVisible();
        await expect(page.getByText('SHOW INFO', { exact: true }).first(), 'Report table').toBeVisible();
        await expect(page.locator('a[href$="/kpi-dashboard"]').first(), 'KPI Dashboard link on the closed event').toBeAttached();
    });
});
