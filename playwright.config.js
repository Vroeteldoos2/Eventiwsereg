import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve('.', '.env') });

// @ts-nocheck
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    globalSetup: './global-setup.js',

    testDir: './tests',
    timeout: 60000,
    expect: {
        timeout: 10000,
    },
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: 1,
    reporter: 'html',

    use: {
        baseURL: 'https://eventwise.synergi.dev',
        storageState: 'auth.json',
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
        headless: false,
        navigationTimeout: 30000,
        actionTimeout: 15000,
        viewport: { width: 1920, height: 1080 },
        launchOptions: {
            args: ['--start-maximized'],
        },
    },

    projects: [
        {
            name: 'chromium',
            use: {
                ...devices['Desktop Chrome'],
                viewport: { width: 1920, height: 1080 },  // override devices' default 1280×720
            },
        },
    ],
});
