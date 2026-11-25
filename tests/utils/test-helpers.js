// tests/utils/test-helpers.js
import { expect } from '@playwright/test';

export async function cleanupWithWarning(description, cleanup) {
    try {
        await cleanup();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Cleanup failed (${description}): ${message}`);
    }
}

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
        await expect(this.page.getByText('Loading Information', { exact: true })).toBeHidden({ timeout: 10000 });
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