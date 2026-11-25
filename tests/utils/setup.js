import { BudgetingPage } from '../../pages/budgetingPage.js';
import { LoginPage } from '../../pages/loginPage.js';

export async function setupBudgetingTest(page) {
    const loginPage = new LoginPage(page);
    const budgetingPage = new BudgetingPage(page);
    const eventBaseUrl = process.env.BUDGET_EVENT_URL;

    if (!eventBaseUrl) {
        throw new Error('BUDGET_EVENT_URL is not set');
    }

    budgetingPage.eventBaseUrl = eventBaseUrl.replace(/\/$/, '');
    await page.goto(`${budgetingPage.eventBaseUrl}/budget/summary`, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
    });

    return { loginPage, budgetingPage };
}
