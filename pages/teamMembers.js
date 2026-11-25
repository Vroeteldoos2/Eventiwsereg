import { expect } from '@playwright/test';
import { regressionAccountName, regressionAccountUrl } from './accountConfig.js';

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
        await this.page.waitForLoadState('networkidle');
    }

    async gotoOnboardingPage() {
        if (!this.page.url().includes('/onboarding')) {
            await this.page.goto('https://eventwise.synergi.dev/onboarding');
        }
        await this.page.waitForLoadState('networkidle');
        await this.page.getByRole('button', { name: regressionAccountName }).click();
        await this.page.waitForLoadState('domcontentloaded');
    }

    // ── NAVIGATION ────────────────────────────────────────────────────────────────

    async gotoAccountDash() {
        await this.page.goto(regressionAccountUrl);
        await this.page.waitForLoadState('networkidle');
        console.log('Account dashboard loaded ✓');
    }

    async clickTeamMenu() {
        const teamMembersLink = this.page.locator('a[href$="/team"]');
        const isVisible = await teamMembersLink.isVisible().catch(() => false);
        if (!isVisible) {
            await this.page.locator('a, li').filter({ has: this.page.locator('span', { hasText: /^Team$/ }) }).first().click();
            await this.page.waitForTimeout(1000);
        }
        console.log('Team menu expanded ✓');
    }

    async selectTeamMembers() {
        await this.page.goto(`${regressionAccountUrl}/team`);
        await this.page.waitForLoadState('networkidle');
        console.log('Team Members page loaded ✓');
    }

    // ── SEARCH ────────────────────────────────────────────────────────────────────

    async searchTeamMembers(term) {
        const searchInput = this.page.getByRole('textbox', { name: /search/i })
            .or(this.page.locator('input[placeholder*="Search"], input[placeholder*="search"]'))
            .first();
        await searchInput.fill(term);
        await this.page.waitForTimeout(800);
        console.log(`Searched for "${term}" ✓`);
    }

    async verifySearchResults(term) {
        // Wait for results to settle
        await this.page.waitForTimeout(500);

        // Results could be table rows or card-style elements
        const rows = this.page.locator('tbody tr')
            .or(this.page.locator('[class*="member-row"], [class*="team-member"], [class*="user-row"]'));

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
        await this.page.waitForLoadState('networkidle');
        console.log('Invite sent ✓');
    }

    // ── USER PERMISSIONS PAGE ─────────────────────────────────────────────────────

    async selectEventsAndSubcategories() {
        // After sending an invite, the app directs to the user permissions page.
        // "Directs" already has access to all events & subcategories — skip it.
        // For every other section, check all available checkboxes.

        await this.page.waitForLoadState('networkidle');

        const sections = this.page.locator('[class*="category"], [class*="section"], [class*="event-group"]');
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
        if (await saveBtn.isVisible().catch(() => false)) {
            await saveBtn.click();
            await this.page.waitForLoadState('networkidle');
            console.log('Permissions saved ✓');
        }
    }
}
