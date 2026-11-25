import { chromium } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '.env') });

export default async function globalSetup() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto('https://eventwise.synergi.dev/auth/login');
    await page.waitForLoadState('networkidle');

    await page.getByRole('textbox', { name: 'Email Address' }).fill(process.env.USER_EMAIL);
    await page.getByRole('textbox', { name: 'Password' }).fill(process.env.USER_PASSWORD);
    await page.getByRole('button', { name: 'Login' }).click();

    // Wait until redirected away from the login page
    await page.waitForURL(url => !url.pathname.includes('/auth/login'), { timeout: 30000 });
    await page.waitForLoadState('networkidle');

    await context.storageState({ path: 'auth.json' });
    await browser.close();

    console.log('Global setup: session saved to auth.json');
}
