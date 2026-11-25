import { expect } from '@playwright/test';
import { regressionAccountName } from './accountConfig.js';


export class LoginPage {
    constructor(page) {
        //only define locators, do not use .clcik() or .fill() here, only in the functions below
        this.page = page;
        this.emailAddress = page.getByRole('textbox', { name: 'Email Address' });
        this.password = page.getByRole('textbox', { name: 'Password' });
        this.loginButton = page.getByRole('button', { name: 'Login' });
        this.eventwiseLogo = page.getByRole('button', { name: regressionAccountName })
        this.searchEvent = page.getByRole('textbox', { name: 'Search for an event...' })
        this.eventImage = page.getByRole('button', { name: 'Event Image' })
    }

    async gotoLoginPage() {
        //base url is set under config file, so we can directly use this
        // This is safer because it doesn't depend on the page's JS engine
        await this.page.context().clearCookies();
    
    // 2. Navigate
        await this.page.goto('/auth/login');

       }

    async login() {
        const email = process.env.USER_EMAIL;
        const pass = process.env.USER_PASSWORD;

    // Check if variables are actually there
    if (!email || !pass) {
        throw new Error(`Environment variables missing! Email: ${email}, Pass: ${pass}`);
    }
        await this.emailAddress.fill(email);
        await this.password.fill(pass);
        await this.loginButton.click();

    }

    // async PreviouslyVisitedPageClear() {


    //     if (!this.page.url().includes('/onboarding')) {
    //         await this.page.goto('https://eventwise.synergi.dev/onboarding'); // redirect not to go back to the last visted events page after login, but to the onboarding page instead
    //     }
    // }

   async gotoEventDashboardPage() {
    // Step 1: Force onboarding page
    if (!this.page.url().includes('/onboarding')) {
        await this.page.goto('https://eventwise.synergi.dev/onboarding');
    }
    await this.page.waitForLoadState('networkidle');

    // Step 2: Click account button to reveal search
    await this.page.getByRole('button', { name: regressionAccountName }).click();

    // Step 3: Wait for search box to appear then fill it
    const searchBox = this.page.getByRole('textbox', { name: 'Search for an event...' });
    await searchBox.waitFor({ state: 'visible', timeout: 10000 });
    await searchBox.fill(process.env.EVENT_NAME);

    // Step 4: Click the event result
    await this.page.getByRole('button', { name: 'Event Image' }).click();

    // Step 5: Confirm we landed on the event and capture URL
    await expect(this.page).toHaveURL(/\/event\/\d+/, { timeout: 10000 });
    await this.page.waitForLoadState('networkidle');

    this.eventBaseUrl = this.page.url().replace(/\/$/, '');
    console.log('Event base URL captured:', this.eventBaseUrl);
}



}