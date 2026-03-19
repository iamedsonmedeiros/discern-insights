import { test, expect } from '@playwright/test';

test.describe('Authentication Flow', () => {
    test('should redirect unauthenticated users to login', async ({ page }) => {
        await page.goto('/dashboard');
        await page.waitForURL(/\/login/);
        // It's a div, use getByText and be specific or use first()
        await expect(page.getByText('Sign in', { exact: true }).first()).toBeVisible();
    });

    test('should show error with invalid credentials', async ({ page }) => {
        await page.goto('/login');
        await page.getByTestId('login-email').fill('wrong@example.com');
        await page.getByTestId('login-password').fill('wrongpassword');
        await page.getByTestId('login-submit').click();

        // Check for error message
        await expect(page.getByText('Invalid login credentials').first()).toBeVisible();
    });

    test('should navigate to signup page', async ({ page }) => {
        await page.goto('/login');
        // Be more specific with the link
        await page.getByRole('link', { name: 'Sign up for free' }).click();
        await page.waitForURL(/\/signup/);
        await expect(page.getByText('Create an account').first()).toBeVisible();
    });
});
