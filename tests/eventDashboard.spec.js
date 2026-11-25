import { test, expect } from '../fixtures/baseTest.js';

test.describe('Event Dashboard Tests', () => {

    test.beforeEach(async ({ page, dashboardPage }) => {
        await page.goto(process.env.DASHBOARD_EVENT_URL);
        await page.waitForLoadState('networkidle');
        await dashboardPage.dismissAutoModal();
    });

    // ── Dashboard Verification ────────────────────────────────────────────────────

    test.skip('Dashboard Verification', async ({ dashboardPage }) => {
        await dashboardPage.dashboardPageVerify();
    });

    // ── Shortcut Menu ─────────────────────────────────────────────────────────────

    test('Create Budget Entry', async ({ dashboardPage }) => {
        await dashboardPage.shortcutCreateBudgetEntry();
    });

    test('Create Purchase Order', async ({ dashboardPage }) => {
        await dashboardPage.shortcutCreatePurchaseOrder({
            title: `PO-${Date.now().toString().slice(-3)}`,
        });
    });

    test.skip('Create Department', async ({ dashboardPage }) => {
        await dashboardPage.shortcutCreateDepartment({
            name: `ShortcutDept-${Date.now().toString().slice(-3)}`,
        });
    });

    test.skip('Create Subcategory', async ({ dashboardPage }) => {
        await dashboardPage.shortcutCreateSubcategory({
            name: `ShortcutSub-${Date.now().toString().slice(-3)}`,
        });
    });

    // Unique names so the event's existing Earlybird / Main / VIP tickets (used by the ticketing suites) are untouched.
    test('Create Ticket Type', async ({ dashboardPage }) => {
        await dashboardPage.shortcutCreateTicketType({ namePrefix: `AutoShortcut-${Date.now().toString().slice(-3)} ` });
        console.log('Ticket created via shortcut ✓');
    });

    test.skip('Create Contact', async ({ dashboardPage }) => {
        await dashboardPage.shortcutCreateContact({
            name: `TestContact-${Date.now().toString().slice(-3)}`,
        });
    });

    test('Raise Supplier Invoice', async ({ dashboardPage }) => {
        await dashboardPage.shortcutRaiseSupplierInvoice('Regression-Cost');
    });

    // ── Toolbar Icons ─────────────────────────────────────────────────────────────

    test('Search Function', async ({ page, dashboardPage }) => {
        await dashboardPage.clickSearchIcon();
        await dashboardPage.verifySearchResults('sg');
    });

    test.skip('Currency Converter', async ({ page, dashboardPage }) => {
        await dashboardPage.openCurrencyConverter();
        await expect(
            page.getByText('Currency Converter', { exact: true })
        ).toBeVisible({ timeout: 5000 });
        console.log('Currency converter loaded ✓');
    });

    test.skip('Notifications', async ({ page, dashboardPage }) => {
        await dashboardPage.openNotifications();
        await expect(
            page.locator('[class*="notification"], [class*="notif"], #notification-content').first()
        ).toBeVisible({ timeout: 5000 });
        console.log('Notificatiodns panel loaded ✓');
        await dashboardPage.markFirstNotificationAsRead();
    });

});