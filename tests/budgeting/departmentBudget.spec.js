import { test, expect } from '../../fixtures/baseTest.js';
import { setupBudgetingTest } from '../utils/setup.js';

test.describe('Department Budget', () => {
    test('Set department budget persists after revisiting the department', async ({ page }) => {
        test.setTimeout(120000);

        const { budgetingPage } = await setupBudgetingTest(page);

        const openDepartmentSummary = async () => {
            await budgetingPage.gotoBudgetSummaryPage();
            const costDepartments = page.locator('div.ew-data-table')
                .filter({ hasText: 'Cost Departments' })
                .first();
            await costDepartments.locator('tr.tw-cursor-pointer')
                .filter({ hasText: /^Production/ })
                .first()
                .click();
            await page.getByRole('button', { name: 'Department Summary', exact: true }).click();

            const expandedRow = page.locator('tr.expanded-row').filter({ hasText: 'Department Budget' }).first();
            await expandedRow.waitFor({ state: 'visible', timeout: 15000 });
            return expandedRow.locator('.eventwise-inline-edit').filter({ hasText: 'Department Budget' });
        };

        const setDepartmentBudget = async (field, amount) => {
            await field.locator('button').click();
            const amountInput = field.locator('input[type="number"]');
            await amountInput.waitFor({ state: 'visible', timeout: 5000 });
            await amountInput.fill(String(amount));
            await amountInput.press('Enter');
            const expectedText = amount === 0
                ? 'Add'
                : amount.toLocaleString('en-GB', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                });
            await expect(field).toContainText(expectedText, { timeout: 15000 });
        };

        const originalField = await openDepartmentSummary();
        const originalText = (await originalField.innerText())
            .replace('Department Budget', '')
            .trim();
        const originalBudget = originalText === 'Add'
            ? null
            : Number(originalText.replace(/[^\d.-]/g, ''));
        const testBudget = 9876;

        try {
            await setDepartmentBudget(originalField, testBudget);

            const revisitedField = await openDepartmentSummary();
            await expect(revisitedField).toContainText('9,876.00', { timeout: 15000 });
        } finally {
            const fieldToRestore = await openDepartmentSummary();
            await setDepartmentBudget(fieldToRestore, originalBudget ?? 0);

            if (originalBudget === null) {
                await expect(fieldToRestore).toContainText('Add', { timeout: 15000 });
            }
        }
    });
});
