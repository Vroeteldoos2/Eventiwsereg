import { test, expect } from '../fixtures/baseTest.js';
import { regressionAccountName } from '../pages/accountConfig.js';
import { LoginPage } from '../pages/loginPage.js';
import { BASE_URL } from '../pages/env.js';

test('Login with configured credentials @smoke', async ({ browser }) => {
    const context = await browser.newContext();
    try {
        const page = await context.newPage();
        const loginPage = new LoginPage(page);
        await page.goto(`${BASE_URL}/auth/login`);
        await loginPage.login();
        await expect(page.getByRole('button', { name: regressionAccountName })).toBeVisible();
    } finally {
        await context.close();
    }
});
