import { test, expect } from '@playwright/test';
import { setupBudgetingTest } from '../utils/setup';

let loginPage, budgetingPage;

async function createDraftCostEntry(page, budgetingPage, title) {
    await budgetingPage.openDepartmentBudgetEntries(0);

    const createRow = page.getByRole('row', { name: '󱩨 Create a new budget entry', exact: true });
    await createRow.waitFor({ state: 'visible', timeout: 15000 });
    const table = createRow.locator('xpath=ancestor::table').last();
    const existingRow = table.locator('tbody tr.tw-cursor-pointer').first();
    await existingRow.waitFor({ state: 'visible', timeout: 15000 });
    const cells = existingRow.locator('td');
    const valueAt = async index => (await cells.nth(index).innerText()).trim();
    const currencyValue = text => Number(text.replace(/[^\d.-]/g, ''));

    await budgetingPage.createBudgetEntry({
        title,
        subcategory: process.env.BUDGET_SUBCATEGORY || await valueAt(3),
        supplier: process.env.BUDGET_SUPPLIER || await valueAt(4),
        fixedCost: process.env.BUDGET_FIXED_COST || currencyValue(await valueAt(5)),
        budgetedCost: process.env.BUDGET_BUDGETED_COST || currencyValue(await valueAt(6)),
    });
    await budgetingPage.verifyEntryInList(title, 'Draft');

    return {
        table,
        rowFor: () => table.locator('tbody tr.tw-cursor-pointer').filter({ hasText: title }).first(),
    };
}

async function deleteBudgetEntry(page, budgetingPage, title) {
    const drawer = budgetingPage.getDrawer();
    if (!(await drawer.isVisible().catch(() => false))) {
        await budgetingPage.openEntryPopup(title);
    }

    await drawer.getByRole('button', { name: /Delete/i }).click();
    await page.getByText('Are you sure?', { exact: true }).waitFor({ state: 'visible', timeout: 10000 });
    await page.getByRole('button', { name: /Delete/i }).last().click();
    await expect(drawer).toBeHidden({ timeout: 15000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await budgetingPage.openDepartmentBudgetEntries(0);
    const createRow = page.getByRole('row', { name: '󱩨 Create a new budget entry', exact: true });
    const table = createRow.locator('xpath=ancestor::table').last();
    await expect(table.locator('tbody tr.tw-cursor-pointer').filter({ hasText: title }))
        .toHaveCount(0, { timeout: 15000 });
}

async function openRechargeForm(page, budgetingPage, title) {
    const { rowFor } = await createDraftCostEntry(page, budgetingPage, title);
    await rowFor().locator('button:has(i.mdi-cash-multiple)').click();

    const form = page.locator('.m-wrapper');
    await expect(form.getByRole('heading', { name: 'Recharge Budget Entry' })).toBeVisible();
    await expect(form.locator('dt').filter({ hasText: 'Department' })
        .locator('xpath=following-sibling::dd//button')).toBeEnabled({ timeout: 15000 });
    await expect(form.locator('dt').filter({ hasText: 'Subcategory' })
        .locator('xpath=following-sibling::dd//button')).toBeEnabled({ timeout: 15000 });

    return form;
}

test.describe('Cost Budget Entry', () => {

    test.beforeEach(async ({ page }) => {
        ({ loginPage, budgetingPage } = await setupBudgetingTest(page));
        await budgetingPage.gotoBudgetSummaryPage();
        await budgetingPage.selectBudgetVersion('A');
        await budgetingPage.expandAllSections();
    });

    test.skip('Create and approve budget entry via request approval flow', async () => {
        test.setTimeout(180000);

        // ── 1. Open first available cost department dynamically ───────────────
        const dept = await budgetingPage.openFirstDepartmentBudgetEntries();
        console.log(`📂 Testing against department: ${dept}`);

        // ── 2. Create a new budget entry ──────────────────────────────────────
        const entryTitle = `AutoTest-${Date.now().toString().slice(-3)}`;
        await budgetingPage.createBudgetEntry({
            title: entryTitle,
            subcategory: process.env.BUDGET_SUBCATEGORY,
            supplier: process.env.BUDGET_SUPPLIER,
            fixedCost: process.env.BUDGET_FIXED_COST,
            budgetedCost: process.env.BUDGET_BUDGETED_COST,
        });

        // ── 3. Verify entry appears in list with Draft status ─────────────────
        await budgetingPage.verifyEntryInList(entryTitle, 'Draft');
        console.log(`✅ Entry created with Draft status: ${entryTitle}`);

        // ── 4. Request Approval ───────────────────────────────────────────────
        await budgetingPage.selectEntryInList(entryTitle);
        await budgetingPage.clickActionButton('Request Approval');
        await budgetingPage.verifyEntryInList(entryTitle, 'Awaiting Approval');
        console.log(`✅ Status changed to: Awaiting Approval`);

        // ── 5. Approve ────────────────────────────────────────────────────────
        await budgetingPage.selectEntryInList(entryTitle);
        await budgetingPage.clickActionButton('Approve');
        await budgetingPage.verifyEntryInList(entryTitle, 'Approved');
        console.log(`✅ Status changed to: Approved`);

        // ── 6. Open entry popup and verify activity log ───────────────────────
        await budgetingPage.openEntryPopup(entryTitle);
        await budgetingPage.verifyActivityLog('created');
        console.log(`✅ Activity log verified`);

        console.log(`\n✅ Full approval flow completed: ${entryTitle}`);
    });

    test('View, edit, and delete a budget entry @smoke', async ({ page }) => {
        const title = `AutoTest-EditDelete-${Date.now()}`;
        await createDraftCostEntry(page, budgetingPage, title);

        await budgetingPage.openEntryPopup(title);
        const drawer = budgetingPage.getDrawer();
        await expect(drawer.getByText(title, { exact: true })).toBeVisible();

        const fixedCost = drawer.locator('.eventwise-inline-edit').filter({ hasText: 'Fixed Cost' });
        await fixedCost.locator('i.mdi-pencil').click();
        const costInput = fixedCost.locator('input[type="number"]');
        await costInput.fill('4321');
        await costInput.press('Enter');
        await expect(fixedCost).toContainText('4,321.00', { timeout: 15000 });

        await drawer.locator('button').filter({ has: page.locator('i.mdi-close') }).click();
        await budgetingPage.openEntryPopup(title);
        await expect(budgetingPage.getDrawer()
            .locator('.eventwise-inline-edit')
            .filter({ hasText: 'Fixed Cost' }))
            .toContainText('4,321.00', { timeout: 15000 });

        await deleteBudgetEntry(page, budgetingPage, title);
    });

    test('Lock and unlock a budget entry', async ({ page }) => {
        const title = `AutoTest-Lock-${Date.now()}`;
        await createDraftCostEntry(page, budgetingPage, title);

        try {
            await budgetingPage.openEntryPopup(title);
            const drawer = budgetingPage.getDrawer();
            const unlockButton = drawer.locator('button:has(i.mdi-lock-open-variant)');
            await expect(unlockButton).toBeVisible();
            await unlockButton.click();

            const lockButton = drawer.locator('button:has(i.mdi-lock)');
            await expect(lockButton).toBeVisible({ timeout: 10000 });
            await lockButton.click();
            await expect(drawer.locator('button:has(i.mdi-lock-open-variant)'))
                .toBeVisible({ timeout: 10000 });
        } finally {
            await deleteBudgetEntry(page, budgetingPage, title);
        }
    });

    test('Add a comment and display it externally', async ({ page }) => {
        const title = `AutoTest-ExternalComment-${Date.now()}`;
        const comment = `External budget-entry comment ${Date.now()}`;
        await createDraftCostEntry(page, budgetingPage, title);

        try {
            await budgetingPage.openEntryPopup(title);
            const drawer = budgetingPage.getDrawer();
            const commentInput = drawer.getByPlaceholder('Type a comment and press Ctrl+Enter to send');
            await commentInput.fill(comment);

            const externalCheckbox = drawer.getByLabel('Display this comment externally');
            await externalCheckbox.check();
            await expect(externalCheckbox).toBeChecked();
            await drawer.locator('button:has(i.mdi-send)').click();
            await expect(drawer.getByText(comment, { exact: true })).toBeVisible({ timeout: 15000 });

            await drawer.locator('button').filter({ has: page.locator('i.mdi-close') }).click();
            await budgetingPage.openEntryPopup(title);
            await expect(budgetingPage.getDrawer().getByText(comment, { exact: true }))
                .toBeVisible({ timeout: 15000 });
        } finally {
            await deleteBudgetEntry(page, budgetingPage, title);
        }
    });

    test('Reset an individual budget entry to Draft', async ({ page }) => {
        const title = `AutoTest-ResetDraft-${Date.now()}`;
        const { rowFor } = await createDraftCostEntry(page, budgetingPage, title);

        try {
            const selectEntry = async () => {
                const checkbox = rowFor().locator('input[type="checkbox"]');
                if (!(await checkbox.isChecked())) {
                    await checkbox.locator('xpath=..').click();
                }
                await expect(checkbox).toBeChecked();
            };

            await selectEntry();
            await page.getByRole('button', { name: /^Request Approval$/i }).click();
            await expect(rowFor().locator('td').nth(1)).toHaveText('Awaiting Approval', { timeout: 15000 });

            await selectEntry();
            await page.getByRole('button', { name: /^Reset To Draft$/i }).click();
            await expect(page.getByRole('heading', { name: 'Add Reset Comments' })).toBeVisible();
            await page.getByLabel('Comments').or(page.locator('textarea')).first()
                .fill('Reset to Draft by automated budget-entry test');
            await page.getByRole('button', { name: /^Submit$/i }).click();
            await expect(rowFor().locator('td').nth(1)).toHaveText('Draft', { timeout: 15000 });
        } finally {
            await deleteBudgetEntry(page, budgetingPage, title);
        }
    });

    test('Reject an individual budget entry', async ({ page }) => {
        const title = `AutoTest-Reject-${Date.now()}`;
        const { rowFor } = await createDraftCostEntry(page, budgetingPage, title);

        const selectEntry = async () => {
            const checkbox = rowFor().locator('input[type="checkbox"]');
            if (!(await checkbox.isChecked())) {
                await checkbox.locator('xpath=..').click();
            }
            await expect(checkbox).toBeChecked();
        };

        await selectEntry();
        await page.getByRole('button', { name: /^Request Approval$/i }).click();
        await expect(rowFor().locator('td').nth(1)).toHaveText('Awaiting Approval', { timeout: 15000 });

        await selectEntry();
        await page.getByRole('button', { name: /^Reject$/i }).click();
        await expect(page.getByText('Add Reject Comments', { exact: true })).toBeVisible();
        await page.getByLabel('Comments').or(page.locator('textarea')).first()
            .fill('Rejected by automated individual budget-entry test');
        await page.getByRole('button', { name: /^Submit$/i }).click();
        await expect(rowFor()).toHaveCount(0, { timeout: 15000 });
    });

    test('View the budget entry Activity page', async ({ page }) => {
        const title = `AutoTest-Activity-${Date.now()}`;
        await createDraftCostEntry(page, budgetingPage, title);

        try {
            await budgetingPage.openEntryPopup(title);
            const drawer = budgetingPage.getDrawer();
            await drawer.getByRole('button', { name: 'Activity', exact: true }).click();
            await expect(drawer.getByText('Created draft entry', { exact: true }))
                .toBeVisible({ timeout: 15000 });
        } finally {
            await deleteBudgetEntry(page, budgetingPage, title);
        }
    });

    test('Recharge a budget entry within the same event', async ({ page }) => {
        test.setTimeout(180000);
        const title = `AutoTest-Recharge-SameEvent-${Date.now()}`;
        const form = await openRechargeForm(page, budgetingPage, title);

        const eventSelector = form.locator('dt').filter({ hasText: 'Events' })
            .locator('xpath=following-sibling::dd//button');
        await expect(eventSelector).not.toContainText(/\d+ selected/);

        const amounts = form.locator('input[type="number"]');
        await expect(amounts.nth(0)).toBeDisabled();
        await expect(amounts.nth(1)).toBeDisabled();
        await expect(amounts.nth(0)).toHaveValue(String(Number(process.env.BUDGET_FIXED_COST || 750)));
        await expect(amounts.nth(1)).toHaveValue(String(Number(process.env.BUDGET_BUDGETED_COST || 750)));
        await amounts.nth(2).fill('100');
        await amounts.nth(3).fill('100');
        await form.getByRole('button', { name: 'Create Recharge' }).click();

        await expect(form).toBeHidden({ timeout: 15000 });
        await budgetingPage.openEntryPopup(title);
        const drawer = budgetingPage.getDrawer();
        await drawer.getByRole('button', { name: 'Activity', exact: true }).click();
        await expect(drawer.getByText(new RegExp(`Recharged .* to ${title}`, 'i')))
            .toBeVisible({ timeout: 15000 });
        await expect(drawer.getByText(new RegExp(
            `Recharge from .* via ${title} recharge to`,
            'i',
        ))).toBeVisible({ timeout: 15000 });

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        await budgetingPage.openDepartmentBudgetEntries(0);
        const rechargeApprovalEntry = page.locator('tr.tw-cursor-pointer')
            .filter({ hasText: `${title} Recharge from` }).first();
        await expect(rechargeApprovalEntry.locator('td').nth(1))
            .toHaveText('Awaiting Approval', { timeout: 15000 });
        await budgetingPage.openEntryPopup(`${title} Recharge from`);
        const rechargeDrawer = budgetingPage.getDrawer();
        await rechargeDrawer.getByRole('button', { name: 'Activity', exact: true }).click();
        await expect(rechargeDrawer.getByText(new RegExp(
            `Created as part of recharge from ${title} via ${title} recharge to`,
            'i',
        ))).toBeVisible({ timeout: 15000 });
    });

    test('Recharge a budget entry across events with event splits', async ({ page }) => {
        test.setTimeout(180000);
        const title = `AutoTest-Recharge-CrossEvent-${Date.now()}`;
        const form = await openRechargeForm(page, budgetingPage, title);

        const eventSelector = form.locator('dt').filter({ hasText: 'Events' })
            .locator('xpath=following-sibling::dd//button');
        await eventSelector.click();
        await page.getByText('RegressionTest_938', { exact: true }).click();
        await expect(eventSelector).toHaveText('2 selected', { timeout: 10000 });
        await expect(form.getByText('Event Splits', { exact: true })).toBeVisible();
        await expect(form.getByText('50.00%', { exact: true })).toHaveCount(2);

        const amounts = form.locator('input[type="number"]');
        await expect(amounts.nth(0)).toBeDisabled();
        await expect(amounts.nth(1)).toBeDisabled();
        await expect(amounts.nth(0)).toHaveValue(String(Number(process.env.BUDGET_FIXED_COST || 750)));
        await expect(amounts.nth(1)).toHaveValue(String(Number(process.env.BUDGET_BUDGETED_COST || 750)));
        await amounts.nth(2).fill('100');
        await amounts.nth(3).fill('100');

        const splitAmounts = form.locator('input[type="number"]');
        await expect(splitAmounts.nth(4)).toHaveValue('50');
        await expect(splitAmounts.nth(5)).toHaveValue('50');
        await expect(splitAmounts.nth(6)).toHaveValue('50');
        await expect(splitAmounts.nth(7)).toHaveValue('50');

        await form.getByRole('button', { name: 'Create Recharge' }).click();
        await expect(form).toBeHidden({ timeout: 15000 });
        await budgetingPage.openEntryPopup(title);
        const drawer = budgetingPage.getDrawer();
        await drawer.getByRole('button', { name: 'Activity', exact: true }).click();
        await expect(drawer.getByText(new RegExp(`Recharged .* to ${title}`, 'i')))
            .toBeVisible({ timeout: 15000 });
        await expect(drawer.getByText(new RegExp(
            `Recharge from .* via ${title} recharge to`,
            'i',
        ))).toBeVisible({ timeout: 15000 });

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        await budgetingPage.openDepartmentBudgetEntries(0);
        const rechargeApprovalEntry = page.locator('tr.tw-cursor-pointer')
            .filter({ hasText: `${title} Recharge from` }).first();
        await expect(rechargeApprovalEntry.locator('td').nth(1))
            .toHaveText('Awaiting Approval', { timeout: 15000 });
        await budgetingPage.openEntryPopup(`${title} Recharge from`);
        const rechargeDrawer = budgetingPage.getDrawer();
        await rechargeDrawer.getByRole('button', { name: 'Activity', exact: true }).click();
        await expect(rechargeDrawer.getByText(new RegExp(
            `Created as part of recharge from ${title} via ${title} recharge to`,
            'i',
        ))).toBeVisible({ timeout: 15000 });
    });

    test('Department arrow opens its subcategories and plus row starts budget-entry creation', async ({ page }) => {
        await page.goto(`${budgetingPage.eventBaseUrl}/budget/costs`, {
            waitUntil: 'domcontentloaded',
            timeout: 60000,
        });
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        const departmentRow = page.locator('tr.tw-cursor-pointer').first();
        const departmentName = (await departmentRow.locator('h6, h5, h4, td, span').first().innerText()).trim();
        await departmentRow.locator('button:has(i.mdi-arrow-right)').click();
        await expect(page).toHaveURL(/\/budget\/costs\/\d+$/);
        await expect(page.locator('h4').filter({ hasText: departmentName })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Subcategories' })).toBeVisible();

        const subcategoryRow = page.locator('tr').filter({ has: page.locator('button:has(i.mdi-arrow-right)') }).first();
        await subcategoryRow.locator('button:has(i.mdi-arrow-right)').click();
        await expect(page).toHaveURL(/\/budget\/costs\/\d+\/\d+$/);

        const budgetEntriesHeading = page.getByRole('heading', { name: 'Budget Entries', exact: true });
        const addEntryButton = budgetEntriesHeading.locator('xpath=../..')
            .locator('button:has(i.mdi-plus)');
        await expect(addEntryButton).toBeVisible();
        await expect(addEntryButton).toBeEnabled();
        await addEntryButton.click();
        await expect(page.getByPlaceholder('Title')).toBeVisible({ timeout: 10000 });
    });

    test('Approve budget entry via eye icon popup and verify PO tab', async ({ page }) => {

        // ── 1. Open first department Budget Entries // Artists
       // const dept = await budgetingPage.openFirstDepartmentBudgetEntries();
       // console.log(`📂 Testing against department: ${dept}`);

        // Second department //Event Management
        //const dept = await budgetingPage.openDepartmentBudgetEntries(1);

        // Artists
        const dept = await budgetingPage.openDepartmentBudgetEntries(0);

        console.log(`📂 Testing against department: ${dept}`);

                 // ── 2. Create a new draft entry ───────────────────────────────────────
        const entryTitle = `AutoTest-${Date.now().toString().slice(-3)}`;
        await budgetingPage.createBudgetEntry({
            title: entryTitle,
            subcategory: process.env.BUDGET_SUBCATEGORY,
            supplier: process.env.BUDGET_SUPPLIER,
            fixedCost: process.env.BUDGET_FIXED_COST,
            budgetedCost: process.env.BUDGET_BUDGETED_COST,
        });
        console.log(`📋 Created draft entry: ${entryTitle}`);

        // ── 3. Click eye icon to open drawer ──────────────────────────────────
        await budgetingPage.openEntryPopup(entryTitle);

        // ── 4. Request Approval from drawer ───────────────────────────────────
        const drawer = budgetingPage.getDrawer();
        await drawer.getByRole('button', { name: /Request Approval/i }).click();
        await page.waitForLoadState('domcontentloaded'); // ← page not this.page

        // ── 5. Approve from drawer ────────────────────────────────────────────
        await drawer.getByRole('button', { name: /^Approve$/i }).click();
        await page.waitForLoadState('domcontentloaded');
        await page.screenshot({ path: 'debug-after-approve.png' });


        // ── 6. Verify Approved status in drawer ───────────────────────────────
        await expect(drawer.locator('span')
            .filter({ hasText: /^Approved$/i })
            .first()
        ).toBeVisible({ timeout: 10000 });
        console.log(`✅ Entry approved via drawer`);

        // ── 7. Open Purchase Orders tab ───────────────────────────────────────
        await budgetingPage.openTabInPopup('Purchase Orders');

        // ── 8. Verify Draft PO exists ─────────────────────────────────────────
        const poRow = drawer.locator('tr').filter({ hasText: /Draft/i }).first();
        await expect(poRow).toBeVisible({ timeout: 10000 });
        console.log(`✅ Draft PO visible in Purchase Orders tab`);
    });


    test('Bulk actions apply to two selected budget entries', async ({ page }) => {
        test.setTimeout(240000);

        await budgetingPage.openDepartmentBudgetEntries(0);

        const runId = Date.now();
        const entryTitles = [`AutoTest-Bulk-${runId}-A`, `AutoTest-Bulk-${runId}-B`];
        const table = page.locator('table').filter({ hasText: 'Subcategory' }).last();
        const existingRow = table.locator('tbody tr.tw-cursor-pointer').first();
        await existingRow.waitFor({ state: 'visible', timeout: 15000 });
        const existingCells = existingRow.locator('td');
        const existingValue = async index => (await existingCells.nth(index).innerText()).trim();
        const currencyValue = text => Number(text.replace(/[^\d.-]/g, ''));
        const subcategory = process.env.BUDGET_SUBCATEGORY || await existingValue(3);
        const supplier = process.env.BUDGET_SUPPLIER || await existingValue(4);
        const fixedCost = process.env.BUDGET_FIXED_COST || currencyValue(await existingValue(5));
        const budgetedCost = process.env.BUDGET_BUDGETED_COST || currencyValue(await existingValue(6));

        for (const title of entryTitles) {
            await budgetingPage.createBudgetEntry({
                title,
                subcategory,
                supplier,
                fixedCost,
                budgetedCost,
            });
            await budgetingPage.verifyEntryInList(title, 'Draft');
        }

        const rowFor = title => table.locator('tbody tr.tw-cursor-pointer').filter({ hasText: title }).first();

        const selectEntries = async () => {
            for (const title of entryTitles) {
                const row = rowFor(title);
                await row.waitFor({ state: 'visible', timeout: 15000 });
                const checkbox = row.locator('input[type="checkbox"]');
                if (!(await checkbox.isChecked())) {
                    await checkbox.locator('xpath=..').click();
                }
                await expect(checkbox).toBeChecked();
            }
            await expect(page.getByText(/You have selected 2 entries/)).toBeVisible();
        };
        const runGroupAction = async actionName => {
            await page.getByRole('button', { name: new RegExp(`^${actionName}$`, 'i') }).click();
            if (actionName === 'Reset To Draft') {
                await expect(page.getByRole('heading', { name: 'Add Reset Comments' }))
                    .toBeVisible({ timeout: 10000 });
                await page.getByLabel('Comments').or(page.locator('textarea')).first()
                    .fill('Reset by automated bulk-action test');
                await page.getByRole('button', { name: /^Submit$/i }).click();
            }
        };
        const verifyBothStatuses = async status => {
            for (const title of entryTitles) {
                await expect(rowFor(title).locator('td').nth(1)).toHaveText(status, { timeout: 15000 });
            }
        };

        await selectEntries();
        await expect(page.getByRole('button', { name: /^Request Approval$/i })).toBeVisible();
        await runGroupAction('Request Approval');
        await verifyBothStatuses('Awaiting Approval');

        await selectEntries();
        await expect(page.getByRole('button', { name: /^Reset To Draft$/i })).toBeVisible();
        await runGroupAction('Reset To Draft');
        await verifyBothStatuses('Draft');

        await selectEntries();
        await runGroupAction('Request Approval');
        await verifyBothStatuses('Awaiting Approval');

        await selectEntries();
        await expect(page.getByRole('button', { name: /^Reject$/i })).toBeVisible();
        await runGroupAction('Reject');
        await expect(page.getByText('Add Reject Comments', { exact: true }))
            .toBeVisible({ timeout: 10000 });
        await page.getByLabel('Comments').or(page.locator('textarea')).first()
            .fill('Rejected by automated bulk-action test');
        await page.getByRole('button', { name: /^Submit$/i }).click();
        await page.waitForLoadState('domcontentloaded');
        for (const title of entryTitles) {
            await expect(table.locator('tbody tr.tw-cursor-pointer').filter({ hasText: title }))
                .toHaveCount(0, { timeout: 15000 });
        }
    });

    test('Bulk Approve is unavailable after requesting approval for two budget entries', async ({ page }) => {
        test.setTimeout(180000);

        await budgetingPage.openDepartmentBudgetEntries(0);

        const runId = Date.now();
        const entryTitles = [`AutoTest-Bulk-Approve-${runId}-A`, `AutoTest-Bulk-Approve-${runId}-B`];
        const table = page.locator('table').filter({ hasText: 'Subcategory' }).last();
        const existingRow = table.locator('tbody tr.tw-cursor-pointer').first();
        await existingRow.waitFor({ state: 'visible', timeout: 15000 });
        const existingCells = existingRow.locator('td');
        const existingValue = async index => (await existingCells.nth(index).innerText()).trim();
        const currencyValue = text => Number(text.replace(/[^\d.-]/g, ''));

        for (const title of entryTitles) {
            await budgetingPage.createBudgetEntry({
                title,
                subcategory: process.env.BUDGET_SUBCATEGORY || await existingValue(3),
                supplier: process.env.BUDGET_SUPPLIER || await existingValue(4),
                fixedCost: process.env.BUDGET_FIXED_COST || currencyValue(await existingValue(5)),
                budgetedCost: process.env.BUDGET_BUDGETED_COST || currencyValue(await existingValue(6)),
            });
            await budgetingPage.verifyEntryInList(title, 'Draft');
        }

        const rowFor = title => table.locator('tbody tr.tw-cursor-pointer').filter({ hasText: title }).first();
        const selectEntries = async () => {
            for (const title of entryTitles) {
                const checkbox = rowFor(title).locator('input[type="checkbox"]');
                await checkbox.waitFor({ state: 'visible', timeout: 15000 });
                if (await checkbox.isChecked()) {
                    await checkbox.locator('xpath=..').click();
                    await expect(checkbox).not.toBeChecked();
                }
                await checkbox.locator('xpath=..').click();
                await expect(checkbox).toBeChecked();
            }
            await expect(page.getByText(/You have selected 2 entries/)).toBeVisible();
        };
        const verifyBothStatuses = async status => {
            for (const title of entryTitles) {
                await expect(rowFor(title).locator('td').nth(1)).toHaveText(status, { timeout: 15000 });
            }
        };

        await selectEntries();
        await page.getByRole('button', { name: /^Request Approval$/i }).click();
        await verifyBothStatuses('Awaiting Approval');

        await selectEntries();
        await expect(page.getByRole('button', { name: /^Approve$/i })).toHaveCount(0);
        await expect(page.getByRole('button', { name: /^Reset To Draft$/i })).toBeVisible();
        await page.getByRole('button', { name: /^Reset To Draft$/i }).click();
        await expect(page.getByRole('heading', { name: 'Add Reset Comments' })).toBeVisible();
        await page.getByLabel('Comments').or(page.locator('textarea')).first()
            .fill('Reset by automated bulk-approval availability test');
        await page.getByRole('button', { name: /^Submit$/i }).click();
        await verifyBothStatuses('Draft');
    });

    // test('Direct approve without request approval', async () => {

    //     // ── 1. Open first available cost department dynamically ───────────────
    //     const dept = await budgetingPage.openFirstDepartmentBudgetEntries();
    //     console.log(`📂 Testing against department: ${dept}`);

    //     // ── 2. Create a new budget entry ──────────────────────────────────────
    //     const entryTitle = `AutoTest-Direct-${Date.now()}`;
    //     await budgetingPage.createBudgetEntry({
    //         title:        entryTitle,
    //         subcategory:  process.env.BUDGET_SUBCATEGORY,
    //         supplier:     process.env.BUDGET_SUPPLIER,
    //         fixedCost:    process.env.BUDGET_FIXED_COST,
    //         budgetedCost: process.env.BUDGET_BUDGETED_COST,
    //     });

    //     // ── 3. Verify Draft status ────────────────────────────────────────────
    //     await budgetingPage.verifyEntryInList(entryTitle, 'Draft');
    //     console.log(`✅ Entry created with Draft status: ${entryTitle}`);

    //     // ── 4. Approve directly from Draft (skip Request Approval) ────────────
    //     await budgetingPage.selectEntryInList(entryTitle);
    //     await budgetingPage.clickActionButton('Approve');
    //     await budgetingPage.verifyEntryInList(entryTitle, 'Approved');
    //     console.log(`✅ Status changed directly to: Approved`);

    //     // ── 5. Open entry popup and verify activity log ───────────────────────
    //     await budgetingPage.openEntryPopup(entryTitle);
    //     await budgetingPage.verifyActivityLog('created');
    //     console.log(`✅ Activity log verified`);

    //     console.log(`\n✅ Direct approval flow completed: ${entryTitle}`);
    // });

});


test.describe('Revenue Budget Entry', () => {

    test.beforeEach(async ({ page }) => {
        ({ loginPage, budgetingPage } = await setupBudgetingTest(page));
        await budgetingPage.gotoRevenueBudgetPage();
        await budgetingPage.selectBudgetVersion('A');
        await budgetingPage.expandAllSections();
    });

    test('Create and approve revenue budget entry', async ({ page }) => {
        test.setTimeout(120000);

        // // ── 1. Find an available revenue stream ───────────────────────────────
        // const preferred = process.env.BUDGET_REVENUE_STREAM
        //     ? [process.env.BUDGET_REVENUE_STREAM]
        //     : ['Sponsorship', 'Merchandise'];
        // const stream = await budgetingPage.findAvailableRevenueStream(preferred);
        // if (!stream) {
        //     test.skip();
        //     return;
        // }
        // console.log(`📊 Using revenue stream: ${stream}`);

                const stream = process.env.BUDGET_REVENUE_STREAM;


        // ── 2. Open the stream's Budget Entries tab ───────────────────────────
        console.log(`📊 Using revenue stream: ${stream}`);

        await budgetingPage.openRevenueStreamBudgetEntries(stream);

        // ── 3. Create entry ───────────────────────────────────────────────────
        const entryTitle = `AutoRev-${Date.now().toString().slice(-3)}`;
        await budgetingPage.createRevenueBudgetEntry({
            title: entryTitle,
            subcategory: process.env.BUDGET_REVENUE_SUBCATEGORY,
            supplier: process.env.BUDGET_SUPPLIER,
            fixedCost: 390,
            budgetedCost: 390,
            streamName: stream,
        });
        console.log(`📋 Created revenue entry: ${entryTitle}`);

        // ── 4. Open the entry via eye icon ────────────────────────────────────
        await budgetingPage.openEntryPopup(entryTitle);

        // ── 5. Request Approval from drawer ───────────────────────────────────
        const drawer = budgetingPage.getDrawer();
        await drawer.getByRole('button', { name: /Request Approval/i }).click();
        await page.waitForLoadState('domcontentloaded');
        console.log(`✅ Approval requested`);

        // ── 6. Approve from drawer ────────────────────────────────────────────
        await drawer.getByRole('button', { name: /^Approve$/i }).click();
        await page.waitForLoadState('domcontentloaded');

        // ── 7. Verify Approved status in drawer ───────────────────────────────
        await expect(drawer.locator('span')
            .filter({ hasText: /^Approved$/i })
            .first()
        ).toBeVisible({ timeout: 10000 });

        console.log(`\n✅ Revenue budget entry approved for stream "${stream}": ${entryTitle}`);
    });

});
