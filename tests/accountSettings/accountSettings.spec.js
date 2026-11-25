// accountSettings.spec.js
// Account > Settings > General Settings (the regression account):
//   organisation name, logo control, postal address and country list, base currency list, banking details,
//   general preferences, and the 2FA security preference.
// Settings are saved as they are changed (a PUT to /api/account/<id>), and every test puts back what it changes.
// The logo is not changed (there is none today): only its upload control is checked.
import { test, expect } from '../../fixtures/baseTest.js';
import { regressionAccountName, regressionAccountUrl } from '../../pages/accountConfig.js';
import { cleanupWithWarning } from '../utils/test-helpers.js';

const BANK = {
    accountName: 'Automation Regression Account',
    sortCode: '600920',
    accountNumber: '67037135',
    bankName: 'NatWest',
    iban: 'GB25NWBK60080600724890',
};

const field = (page, id) => page.locator(`[id="${id}"], [name="${id}"]`).first();
const isSave = r => r.request().method() === 'PUT' && /\/api\/account\/\d+$/.test(r.url());

// Fills a field and waits for the save it triggers.
async function setField(page, locator, value) {
    if ((await locator.inputValue()) === String(value)) return;
    const saved = page.waitForResponse(isSave, { timeout: 15000 });
    await locator.fill(String(value));
    await locator.blur();
    expect((await saved).ok(), `Saved ${value}`).toBe(true);
}

async function reload(page) {
    await page.goto(`${regressionAccountUrl}/settings`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Your Organisation')).toBeVisible({ timeout: 20000 });
    await expect(field(page, 'accountName')).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('Loading Information', { exact: true })).toBeHidden({ timeout: 20000 });
}

test.describe('Account Settings', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(180000);
        await reload(page);
    });

    test('Organisation name can be edited, is saved, and shows across Eventwise', async ({ page }) => {
        const name = field(page, 'accountName');
        const original = await name.inputValue();
        const edited = `${original} ${Date.now().toString().slice(-4)}`;
        try {
            await setField(page, name, edited);
            await expect(page.getByText('Saved just now')).toBeVisible({ timeout: 10000 });
            await reload(page);
            await expect(field(page, 'accountName')).toHaveValue(edited);
            await expect(page.getByRole('button', { name: edited }), 'Account switcher in the top bar').toBeVisible();
            await expect(page.getByText(edited).first()).toBeVisible();
        } finally {
            await cleanupWithWarning('account name', async () => {
                await setField(page, field(page, 'accountName'), original);
                await reload(page);
                await expect(field(page, 'accountName'), 'Name restored').toHaveValue(original);
                await expect(page.getByRole('button', { name: regressionAccountName })).toBeVisible();
            });
        }
    });

    test('Logo: the upload control is available (the logo is not changed)', async ({ page }) => {
        const upload = page.getByText('Upload Logo', { exact: true });
        await expect(upload).toBeVisible();
        const fileInputs = page.locator('input[type="file"]');
        expect(await fileInputs.count(), 'A file input behind the logo control').toBeGreaterThan(0);
        // With a logo set the page offers "Change Logo" / "Delete Current Logo" instead; with none it offers Upload Logo.
        const hasLogo = await page.getByText('Delete Current Logo').count();
        console.log(hasLogo ? 'Logo set: Change Logo / Delete Current Logo offered' : 'No logo set: Upload Logo offered');
        if (hasLogo) {
            await expect(page.getByText('Change Logo')).toBeVisible();
            await expect(page.getByText('Delete Current Logo')).toBeVisible();
        }
    });

    test('Postal address: can be entered and saved, with a list of countries to choose from', async ({ page }) => {
        const inputs = ['Address Line 1', 'Address Line 2', 'City', 'Postal Code'].map(placeholder => page.getByPlaceholder(placeholder).first());
        const countrySelect = page.locator('select').filter({ has: page.locator('option', { hasText: 'United Kingdom' }) }).first();
        const originals = [];
        for (const input of inputs) originals.push(await input.inputValue());
        const originalCountry = await countrySelect.inputValue();
        const edited = ['1 Automation Way', 'Test Quarter', 'Auto City', 'AB1 2CD'];
        try {
            const countries = await countrySelect.locator('option').allInnerTexts();
            expect(countries.length, 'Countries to choose from').toBeGreaterThan(150);
            for (const country of ['United Kingdom', 'United States', 'France', 'Germany', 'Australia']) expect(countries, country).toContain(country);

            for (const [i, input] of inputs.entries()) await setField(page, input, edited[i]);
            await reload(page);
            for (const [i, placeholder] of ['Address Line 1', 'Address Line 2', 'City', 'Postal Code'].entries()) {
                await expect(page.getByPlaceholder(placeholder).first(), placeholder).toHaveValue(edited[i]);
            }
        } finally {
            await cleanupWithWarning('postal address', async () => {
                for (const [i, placeholder] of ['Address Line 1', 'Address Line 2', 'City', 'Postal Code'].entries()) {
                    await setField(page, page.getByPlaceholder(placeholder).first(), originals[i]);
                }
                await reload(page);
                for (const [i, placeholder] of ['Address Line 1', 'Address Line 2', 'City', 'Postal Code'].entries()) {
                    await expect(page.getByPlaceholder(placeholder).first(), `${placeholder} restored`).toHaveValue(originals[i]);
                }
                await expect(countrySelect).toHaveValue(originalCountry);
            });
        }
    });

    test('Base currency: a list of currencies can be chosen from (not changed)', async ({ page }) => {
        const currency = page.locator('select').filter({ has: page.locator('option[value="GBP"]') }).first();
        const options = await currency.locator('option').evaluateAll(list => list.map(o => ({ value: o.value, label: o.textContent.trim() })));
        expect(options.length, 'Currencies offered').toBeGreaterThan(5);
        for (const code of ['GBP', 'EUR', 'USD', 'AUD', 'CHF', 'JPY']) expect(options.map(o => o.value), code).toContain(code);
        for (const option of options) expect(option.label, `${option.value} has a name`).toContain(option.value);
        expect(options.map(o => o.value), 'Current base currency is one of them').toContain(await currency.inputValue());
    });

    // Saved by the PUT as the fields are filled in, and shown again after a reload.
    async function bankingDetailsAreSaved(page, ids) {
        const originals = {};
        for (const [key, id] of Object.entries(ids)) originals[key] = await field(page, id).inputValue();
        try {
            for (const [key, id] of Object.entries(ids)) await setField(page, field(page, id), BANK[key]);
            await reload(page);
            for (const [key, id] of Object.entries(ids)) await expect(field(page, id), key).toHaveValue(BANK[key]);
        } finally {
            await cleanupWithWarning('banking details', async () => {
                for (const [key, id] of Object.entries(ids)) await setField(page, field(page, id), originals[key]);
                await reload(page);
                for (const [key, id] of Object.entries(ids)) await expect(field(page, id), `${key} restored`).toHaveValue(originals[key]);
            });
        }
    }

    test('Banking details: account name, sort code and account number are saved', async ({ page }) => {
        await bankingDetailsAreSaved(page, { accountName: 'bankAccountName', sortCode: 'bankSortCode', accountNumber: 'bankAccountNumber' });
    });

    // The save request carries Bank Name, IBAN and Bank Country, but after a reload they are empty again.
    test('Banking details: the international fields (bank name and IBAN) are saved', async ({ page }) => {
        await bankingDetailsAreSaved(page, { bankName: 'bankName', iban: 'bankIban' });
    });

    const QA_EMAIL = process.env.QA_EMAIL?.trim() || '';
    const PREFERENCES = { days_to_sales_invoice_due: '45', hours_in_day: '8', poPrefix: 'POA', siPrefix: 'SIA', replyToEmail: QA_EMAIL };
    const preferenceEntries = Object.entries(PREFERENCES).filter(([id]) => id !== 'replyToEmail' || QA_EMAIL);

    // Puts each preference back one at a time, reloading after each (changing several in a row can lose a value).
    async function restorePreferences(page, originals) {
        for (const [id, value] of Object.entries(originals)) {
            for (let attempt = 0; attempt < 3 && (await field(page, id).inputValue()) !== value; attempt++) {
                await setField(page, field(page, id), value);
                await reload(page);
            }
        }
        for (const [id, value] of Object.entries(originals)) await expect(field(page, id), `${id} restored`).toHaveValue(value);
    }

    test('General preferences: invoice lead days, hours in a day, PO / sales invoice prefixes and the configured reply-to email are saved', async ({ page }) => {
        const originals = {};
        for (const [id] of preferenceEntries) originals[id] = await field(page, id).inputValue();
        try {
            for (const [id, value] of preferenceEntries) {
                await setField(page, field(page, id), value);
                await reload(page);
                await expect(field(page, id), `${id} after reload`).toHaveValue(value);
            }
        } finally {
            await cleanupWithWarning('general preferences', () => restorePreferences(page, originals));
        }
    });

    // Changing several preferences one after another: each save carries the whole account, and the PO prefix is often
    // found back at its old value after a reload (the later saves overwrite it).
    test('General preferences: several preferences changed in a row are all kept', async ({ page }) => {
        const originals = {};
        for (const [id] of preferenceEntries) originals[id] = await field(page, id).inputValue();
        try {
            for (const [id, value] of preferenceEntries) await setField(page, field(page, id), value);
            await reload(page);
            for (const [id, value] of preferenceEntries) await expect(field(page, id), id).toHaveValue(value);
        } finally {
            await cleanupWithWarning('general preferences', () => restorePreferences(page, originals));
        }
    });

    // Turning this on makes every team member sign in with two-factor authentication, which would lock the
    // automation login out — so it is switched straight back, and checked again after a reload.
    test('Security preferences: two-factor authentication for all team members can be enabled and disabled', async ({ page }) => {
        const twoFactor = page.locator('label').filter({ hasText: /Two.Factor Authentication/ }).locator('input[type="checkbox"]').first();
        const original = await twoFactor.isChecked();
        try {
            const saved = page.waitForResponse(isSave, { timeout: 15000 });
            await (original ? twoFactor.uncheck() : twoFactor.check());
            expect((await saved).ok(), 'Saved').toBe(true);
            await reload(page);
            expect(await twoFactor.isChecked(), 'Setting after reload').toBe(!original);
        } finally {
            await cleanupWithWarning('two-factor authentication setting', async () => {
                if ((await twoFactor.isChecked()) !== original) {
                    const saved = page.waitForResponse(isSave, { timeout: 15000 });
                    await (original ? twoFactor.check() : twoFactor.uncheck());
                    await saved;
                }
                await reload(page);
                expect(await twoFactor.isChecked(), '2FA setting restored').toBe(original);
            });
        }
    });
});
