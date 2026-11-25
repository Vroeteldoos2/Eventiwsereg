import { expect } from '@playwright/test';
import { regressionAccountName, regressionAccountUrl } from './accountConfig.js';
import { BASE_URL } from './env.js';

export class TeamMembersPage {
    constructor(page) {
        this.page = page;
        this.emailAddress = page.getByRole('textbox', { name: 'Email Address' });
        this.password = page.getByRole('textbox', { name: 'Password' });
        this.loginButton = page.getByRole('button', { name: 'Login' });
    }

    async gotoLoginPage() {
        await this.page.context().clearCookies();
        await this.page.goto('/auth/login');
    }

    async login(email, password) {
        await this.emailAddress.fill(email);
        await this.password.fill(password);
        await this.loginButton.click();
        await expect(this.page.getByRole('button', { name: regressionAccountName })).toBeVisible({ timeout: 30000 });
    }

    async gotoOnboardingPage() {
        if (!this.page.url().includes('/onboarding')) {
            await this.page.goto(`${BASE_URL}/onboarding`);
        }
        const accountButton = this.page.getByRole('button', { name: regressionAccountName });
        await expect(accountButton).toBeVisible({ timeout: 30000 });
        await accountButton.click();
        await this.page.getByRole('textbox', { name: 'Search for an event...' }).waitFor({ state: 'visible', timeout: 10000 });
        await this.page.waitForLoadState('domcontentloaded');
    }

    // ── NAVIGATION ────────────────────────────────────────────────────────────────

    async gotoAccountDash() {
        await this.page.goto(regressionAccountUrl);
        await expect(this.page.getByText('All Events', { exact: true }).first()).toBeVisible({ timeout: 30000 });
        console.log('Account dashboard loaded ✓');
    }

    async clickTeamMenu() {
        const teamMembersLink = this.page.locator('a[href$="/team"]');
        const isVisible = await teamMembersLink.isVisible();
        if (!isVisible) {
            await this.page.locator('a, li').filter({ has: this.page.locator('span', { hasText: /^Team$/ }) }).first().click();
        }
        await expect(teamMembersLink).toBeVisible({ timeout: 10000 });
        console.log('Team menu expanded ✓');
    }

    async selectTeamMembers() {
        await this.page.goto(`${regressionAccountUrl}/team`);
        await expect(this.page.getByRole('textbox', { name: /search/i }).or(this.page.locator('input[placeholder*="Search"], input[placeholder*="search"]')).first())
            .toBeVisible({ timeout: 20000 });
        console.log('Team Members page loaded ✓');
    }

    // ── SEARCH ────────────────────────────────────────────────────────────────────

    async searchTeamMembers(term) {
        const searchInput = this.page.getByRole('textbox', { name: /search/i })
            .or(this.page.locator('input[placeholder*="Search"], input[placeholder*="search"]'))
            .first();
        await searchInput.fill(term);
        console.log(`Searched for "${term}" ✓`);
    }

    async verifySearchResults(term) {
        // Results could be table rows or card-style elements
        const rows = this.page.locator('tbody tr')
            .or(this.page.locator('[class*="member-row"], [class*="team-member"], [class*="user-row"]'));

        await expect(rows.first()).toBeVisible({ timeout: 15000 });
        const count = await rows.count();
        expect(count).toBeGreaterThan(0);

        for (let i = 0; i < count; i++) {
            await expect(rows.nth(i)).toContainText(new RegExp(term, 'i'));
        }
        console.log(`Search results for "${term}" verified — ${count} result(s) ✓`);
    }

    // ── INVITE MEMBER ─────────────────────────────────────────────────────────────

    async clickInviteMember() {
        await this.page.getByRole('button', { name: /invite/i }).click();
        await this.page.waitForLoadState('domcontentloaded');
        console.log('Invite Member form opened ✓');
    }

    async fillInviteForm({ name, email, userGroup }) {
        await this.page.locator('dt').filter({ hasText: /^Name$/ }).locator('..').locator('input').fill(name);
        await this.page.locator('dt').filter({ hasText: /^Email Address$/ }).locator('..').locator('input').fill(email);

        await this.page.locator('dt').filter({ hasText: /^User Group$/ }).locator('..').locator('select').selectOption(userGroup);

        console.log(`Invite form filled — Name: ${name}, Email: ${email}, Group: ${userGroup} ✓`);
    }

    async sendInvite() {
        await this.page.getByRole('button', { name: /send invite/i }).click();
        await expect(this.page.locator('div.toast-success').first()).toBeVisible({ timeout: 15000 });
        console.log('Invite sent ✓');
    }

    // ── USER PERMISSIONS PAGE ─────────────────────────────────────────────────────

    async selectEventsAndSubcategories() {
        // After sending an invite, the app directs to the user permissions page.
        // "Directs" already has access to all events & subcategories — skip it.
        // For every other section, check all available checkboxes.

        const sections = this.page.locator('[class*="category"], [class*="section"], [class*="event-group"]');
        await expect(sections.first()).toBeVisible({ timeout: 20000 });
        const count = await sections.count();

        for (let i = 0; i < count; i++) {
            const section = sections.nth(i);
            const sectionText = await section.textContent();

            if (/directs/i.test(sectionText)) {
                console.log('Directs section — all access already granted, skipping');
                continue;
            }

            const checkboxes = section.getByRole('checkbox');
            const checkCount = await checkboxes.count();
            for (let j = 0; j < checkCount; j++) {
                const cb = checkboxes.nth(j);
                if (!(await cb.isChecked())) {
                    await cb.click();
                }
            }
            console.log(`Selected events/subcategories in section ${i + 1} ✓`);
        }

        const saveBtn = this.page.getByRole('button', { name: /save|confirm|done/i }).first();
        if (await saveBtn.isVisible()) {
            await saveBtn.click();
            await expect(this.page.locator('div.toast-success').first()).toBeVisible({ timeout: 15000 });
            console.log('Permissions saved ✓');
        }
    }
}
