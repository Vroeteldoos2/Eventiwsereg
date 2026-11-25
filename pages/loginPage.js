export class LoginPage {
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

    async login() {
        const email = process.env.USER_EMAIL;
        const pass = process.env.USER_PASSWORD;

        if (!email || !pass) {
            throw new Error('Environment variables USER_EMAIL and USER_PASSWORD must be set.');
        }
        await this.emailAddress.fill(email);
        await this.password.fill(pass);
        await this.loginButton.click();
    }
}