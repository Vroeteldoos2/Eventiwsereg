import { chromium } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { BASE_URL } from './pages/env.js';
import { regressionAccountName } from './pages/accountConfig.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '.env') });

export default async function globalSetup() {
    const email = process.env.USER_EMAIL;
    const password = process.env.USER_PASSWORD;
    if (!email || !password) {
        throw new Error('Global setup requires USER_EMAIL and USER_PASSWORD to be set.');
    }

    const browser = await chromium.launch({ headless: true });
    try {
        const context = await browser.newContext();
        const page = await context.newPage();

        await page.goto(`${BASE_URL}/auth/login`);
        await page.getByRole('textbox', { name: 'Email Address' }).waitFor({ state: 'visible', timeout: 30000 });
        await page.getByRole('textbox', { name: 'Email Address' }).fill(email);
        await page.getByRole('textbox', { name: 'Password' }).fill(password);
        await page.getByRole('button', { name: 'Login' }).click();

        await page.waitForURL(url => !url.pathname.includes('/auth/login'), { timeout: 30000 });
        await page.getByRole('button', { name: regressionAccountName }).waitFor({ state: 'visible', timeout: 30000 });

        await context.storageState({ path: 'auth.json' });
    } finally {
        await browser.close();
    }

    console.log('Global setup: session saved to auth.json');
}
