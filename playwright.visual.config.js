import { defineConfig } from '@playwright/test';
import config from './playwright.config.js';

const chromiumProject = config.projects.find(project => project.name === 'chromium');

export default defineConfig({
    ...config,
    projects: [{
        ...chromiumProject,
        name: 'visual',
        testDir: './tests/visual',
        testMatch: '**/*.spec.js',
        testIgnore: [],
    }],
});
