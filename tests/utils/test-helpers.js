// tests/utils/test-helpers.js
import { expect } from '@playwright/test';

export class TestHelpers {
    constructor(page) {
        this.page = page;
    }

    // 1. Common Currency Parser
    
    parseCurrency(text) {
    if (!text || typeof text !== 'string') return 0;
    
    // 1. Strip everything except numbers, dots, and minus signs
    const cleaned = text.replace(/[^0-9.-]/g, "");
    
    // 2. Parse and handle NaN
    const value = parseFloat(cleaned);
    return isNaN(value) ? 0 : value;
}

    // 2. The Sidebar / Mouse Reset Logic
    async clearUIOverlays() {
        // Move mouse to neutral zone
        await this.page.mouse.move(1000, 0);
        // Explicitly wait for the loader to go away
    const loader = this.page.locator('text=Loading Information');
    if (await loader.isVisible()) {
        await loader.waitFor({ state: 'hidden', timeout: 10000 });
    }
    
    // Optional: Wait for the specific currency symbol to appear anywhere in the section
    await this.page.waitForSelector('text=£', { timeout: 10000 }).catch(() => {
        console.log("Currency symbols didn't appear in time.");
    });
    }

    // 3. The Comparison & Screenshot Logic
    async verifyMatch(actual, expected, label) {
        try {
            expect(actual, `${label} mismatch`).toBe(expected);
        } catch (error) {
            const path = `test-results/mismatch-${label}.png`;
            await this.page.screenshot({ path, fullPage: true });
            console.error(`❌ ${label} failed! Expected ${expected} but got ${actual}. Screenshot: ${path}`);
            throw error;
        }
    }

    
}