import { test, expect }       from '@playwright/test';
import { setupBudgetingTest } from '../utils/setup';

const QA_EMAIL = process.env.QA_EMAIL?.trim() || '';

let loginPage, budgetingPage;

test.describe('Purchase Order', () => {

    test.beforeEach(async ({ page }) => {
        test.setTimeout(180000);
        ({ loginPage, budgetingPage } = await setupBudgetingTest(page));
        await budgetingPage.gotoBudgetSummaryPage();
        await budgetingPage.selectBudgetVersion('A');
        await budgetingPage.expandAllSections();
    });

    async function createDraftBudgetEntry(budgetingPage, page) {
        const dept = await budgetingPage.openDepartmentBudgetEntries(0);
        console.log(`📂 Testing against department: ${dept}`);

        const createRow = page.getByRole('row', { name: '󱩨 Create a new budget entry', exact: true });
        const table = createRow.locator('xpath=ancestor::table').last();
        const existingCells = table.locator('tbody tr.tw-cursor-pointer').first().locator('td');
        const cellText = async index => (await existingCells.nth(index).innerText()).trim();
        const amount = text => Number(text.replace(/[^\d.-]/g, ''));

        // Create a fresh draft entry
        const entryTitle = `AutoTest-PO-${Date.now()}`;
        await budgetingPage.createBudgetEntry({
            title: entryTitle,
            subcategory: process.env.BUDGET_SUBCATEGORY || await cellText(3),
            supplier: process.env.BUDGET_SUPPLIER || await cellText(4),
            fixedCost: process.env.BUDGET_FIXED_COST || amount(await cellText(5)),
            budgetedCost: process.env.BUDGET_BUDGETED_COST || amount(await cellText(6)),
            deptIndex: 0,
        });
        console.log(`📋 Created draft entry: ${entryTitle}`);

        await budgetingPage.openEntryPopup(entryTitle);
        return { entryTitle, drawer: budgetingPage.getDrawer() };
    }

    // ── Helper: creates a fresh approved budget entry and opens PO drawer ──
    async function setupApprovedEntryWithPO(budgetingPage, page) {
        const { entryTitle, drawer } = await createDraftBudgetEntry(budgetingPage, page);

        await drawer.getByRole('button', { name: /Request Approval/i }).click();
        await page.waitForLoadState('domcontentloaded');
        await drawer.getByRole('button', { name: /^Approve$/i }).click();
        await page.waitForLoadState('domcontentloaded');

        // Verify approved
        await expect(drawer.locator('span')
            .filter({ hasText: /^Approved$/i })
            .first()
        ).toBeVisible({ timeout: 10000 });
        console.log(`✅ Entry approved: ${entryTitle}`);

        // Open Purchase Orders tab
        await budgetingPage.openTabInPopup('Purchase Orders');

        // Verify Draft PO exists
        const draftPO = drawer.locator('tr').filter({ hasText: /Draft/i }).first();
        await expect(draftPO).toBeVisible({ timeout: 10000 });
        console.log(`✅ Draft PO visible`);

        // Get PO title
        const poTitle = await draftPO.locator('td').nth(1).innerText();
        console.log(`📋 PO title: ${poTitle.trim()}`);

        // Open PO drawer
        await budgetingPage.openPOFromPopup(poTitle.trim());

        return { entryTitle, poTitle: poTitle.trim(), drawer };
    }

    test('Create a PO from a budget entry Purchase Orders tab', async ({ page }) => {
        const { drawer } = await createDraftBudgetEntry(budgetingPage, page);
        await budgetingPage.openTabInPopup('Purchase Orders');

        const createPO = drawer.getByRole('button', { name: /Create a Purchase Order/i });
        await expect(createPO).toBeVisible({ timeout: 10000 });
        await createPO.click();
        await expect(page.locator('.modal-shell').first()).toBeVisible({ timeout: 15000 });
    });

    test('Approve PO via request approval flow', async ({ page }) => {

        const { poTitle } = await setupApprovedEntryWithPO(budgetingPage, page);
        // The PO opens in its own "modal-shell" panel, not a stacked div.drawer.is-large
        const poDrawer = budgetingPage.page.locator('.modal-shell').first();

        // ── Request Approval on PO ────────────────────────────────────────
        await poDrawer.getByRole('button', { name: /Request Approval/i })
            .waitFor({ state: 'visible', timeout: 10000 });
        await poDrawer.getByRole('button', { name: /Request Approval/i }).click();
        await page.waitForLoadState('domcontentloaded');
        console.log(`✅ PO approval requested`);

        // ── Approve PO ────────────────────────────────────────────────────
        await budgetingPage.approvePO();

        // ── Verify PO status is Approved ──────────────────────────────────
        await budgetingPage.verifyPOStatus('Approved');
        console.log(`✅ PO approved successfully`);
    });

    test('Reset an approved PO to draft', async ({ page }) => {

        const { poTitle } = await setupApprovedEntryWithPO(budgetingPage, page);
        const poDrawer = budgetingPage.page.locator('.modal-shell').first();

        await budgetingPage.approvePO();
        await budgetingPage.verifyPOStatus('Approved');

        const resetBtn = poDrawer.getByRole('button', { name: /Reset To Draft/i });
        await expect(resetBtn).toBeVisible({ timeout: 10000 });
        await resetBtn.click();
        const resetDialog = page.getByText('Add Reset Comments', { exact: true })
            .locator('xpath=ancestor::div[.//button[normalize-space(.)="Submit"]][1]');
        await expect(resetDialog).toBeVisible();
        await resetDialog.getByRole('textbox').fill('Reset by automated PO regression test');
        await resetDialog.getByRole('button', { name: /^Submit$/i }).click();
        await page.waitForLoadState('domcontentloaded');

        await budgetingPage.verifyPOStatus('Draft');
        console.log(`✅ PO reset to Draft successfully`);
    });

    test('Download PDF from PO', async ({ page }) => {

        const { poTitle } = await setupApprovedEntryWithPO(budgetingPage, page);
        const poDrawer = budgetingPage.page.locator('.modal-shell').first();

        await budgetingPage.approvePO();

        // ── Click Download PDF and verify download starts ─────────────────
        const downloadPromise = page.waitForEvent('download', { timeout: 10000 }).catch(() => null);
        const popupPromise = page.waitForEvent('popup', { timeout: 10000 }).catch(() => null);
        await poDrawer.getByRole('button', { name: /Download/i }).click();
        const [download, pdfPage] = await Promise.all([downloadPromise, popupPromise]);

        if (download) {
            expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
            console.log(`✅ PDF downloaded: ${download.suggestedFilename()}`);
        } else {
            expect(pdfPage).not.toBeNull();
            await expect(pdfPage).toHaveURL(/\.pdf(?:$|[?#])/i);
            console.log('✅ PO PDF opened in a new tab');
        }
    });

    test('View and edit PO line items, linked budget entry, Extra Info, and Activity', async ({ page }) => {
        const { entryTitle, poTitle } = await setupApprovedEntryWithPO(budgetingPage, page);
        const poDrawer = page.locator('.modal-shell').first();

        const lineItemsTab = poDrawer.getByRole('button', { name: 'Line Items', exact: true });
        await expect(lineItemsTab).toBeVisible();
        await expect(poDrawer.getByRole('button', { name: 'Add line item', exact: true })).toBeVisible();

        const lineDescription = poDrawer.getByRole('textbox', { name: 'Enter a description' });
        await expect(lineDescription).toHaveValue(poTitle);
        const updatedDescription = `${poTitle} edited`;
        await lineDescription.fill(updatedDescription);
        await lineDescription.press('Tab');
        await expect(lineDescription).toHaveValue(updatedDescription);

        const budgetEntryField = poDrawer.locator('dt').filter({ hasText: 'Budget Entry' })
            .locator('xpath=following-sibling::dd');
        await budgetEntryField.getByRole('button').click();
        const linkedEntryDrawer = page.locator('div.drawer.is-large').last();
        await expect(linkedEntryDrawer).toContainText(entryTitle, {
            timeout: 10000,
        });
        await linkedEntryDrawer.locator('button').first().click();

        await poDrawer.getByRole('button', { name: 'Extra Info', exact: true }).click();
        await expect(poDrawer.getByRole('button', { name: 'Extra Info', exact: true })).toBeVisible();
        await expect(poDrawer.locator('input, textarea').last()).toBeVisible();
        await expect(poDrawer.getByText('Created purchase order', { exact: false })).toBeVisible();
    });

    test('Reject a PO after requesting approval', async ({ page }) => {
        const { poTitle } = await setupApprovedEntryWithPO(budgetingPage, page);
        const poDrawer = page.locator('.modal-shell').first();

        await poDrawer.getByRole('button', { name: /Request Approval/i }).click();
        const rejectButton = poDrawer.getByRole('button', { name: /^Reject$/i });
        await expect(rejectButton).toBeVisible({ timeout: 15000 });
        await rejectButton.click();

        const rejectDialog = page.getByText('Add Reject Comments', { exact: true })
            .locator('xpath=ancestor::div[.//button[normalize-space(.)="Submit"]][1]');
        await expect(rejectDialog).toBeVisible();
        await rejectDialog.getByRole('textbox').fill('Rejected by automated PO regression test');
        await rejectDialog.getByRole('button', { name: /^Submit$/i }).click();
        await expect(poDrawer.getByText(/^Rejected$/i).first()).toBeVisible({ timeout: 15000 });
        console.log(`✅ PO rejected: ${poTitle}`);
    });

    test('Mark an approved PO as closed', async ({ page }) => {
        await setupApprovedEntryWithPO(budgetingPage, page);
        const poDrawer = page.locator('.modal-shell').first();

        await budgetingPage.approvePO();
        await poDrawer.getByRole('button', { name: /Close/i }).click();
        await page.getByRole('button', { name: 'Close Purchase Order', exact: true }).click();
        await expect(poDrawer.getByText('This purchase order has been marked as closed', { exact: true }))
            .toBeVisible({ timeout: 15000 });
        await expect(poDrawer.getByRole('button', { name: /Reopen/i })).toBeVisible();
    });

    test('Delete a draft PO', async ({ page }) => {
        await setupApprovedEntryWithPO(budgetingPage, page);
        const poDrawer = page.locator('.modal-shell').first();

        await poDrawer.getByRole('button', { name: /Delete/i }).click();
        await expect(poDrawer).toBeHidden({ timeout: 15000 });
    });

    test('Send the PO PDF by email', async ({ page }) => {
        test.skip(!QA_EMAIL, 'Set QA_EMAIL to run the PO email test');
        await setupApprovedEntryWithPO(budgetingPage, page);
        const poDrawer = page.locator('.modal-shell').first();

        await budgetingPage.approvePO();
        const emailButton = poDrawer.getByRole('button', { name: /Email|Send/i })
            .or(poDrawer.getByRole('link', { name: /Email|Send/i })).first();
        await expect(emailButton).toBeVisible();
        await emailButton.click();
        const recipientInput = page.getByPlaceholder('Type an email address and press enter to add');
        await expect(recipientInput).toBeVisible();
        await recipientInput.fill(QA_EMAIL);
        await recipientInput.press('Enter');
        await expect(page.getByText(QA_EMAIL, { exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Send Email', exact: true }).click();
        await expect(recipientInput).toBeHidden({ timeout: 15000 });
    });

});