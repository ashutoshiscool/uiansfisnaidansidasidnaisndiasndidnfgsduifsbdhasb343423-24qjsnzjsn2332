const { chromium } = require('playwright');
const fs = require('fs');
const { getRandomFingerprint, applyAntiFingerprint } = require('./fingerprint');
const { sendAlert } = require('./email_service');

const TIMEOUT = 30000;

async function humanDelay(page, min = 1000, max = 2000) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await page.waitForTimeout(delay);
}

async function safeClick(page, locator) {
    await locator.waitFor({ state: 'visible', timeout: TIMEOUT });
    await locator.scrollIntoViewIfNeeded();
    await humanDelay(page, 500, 1000);
    await locator.click();
}

async function clearOverlay(page) {
    const acceptBtn = page.getByRole('button', { name: /ACCEPT/i });
    if (await acceptBtn.count() > 0) {
        console.log('[INFO] Clearing notification overlay...');
        await acceptBtn.click({ force: true }).catch(() => {});
        await humanDelay(page, 1000, 2000);
    }
}

async function safeFill(page, locator, text) {
    await locator.waitFor({ state: 'visible', timeout: TIMEOUT });
    await locator.scrollIntoViewIfNeeded();
    await locator.click();
    await humanDelay(page, 200, 500);
    for (const char of text) {
        await locator.press(char, { delay: Math.floor(Math.random() * 100) + 50 });
    }
}

async function checkAccount(email, password) {
    console.log(`\n[INFO] Verifying Account: ${email}`);

    let launchOptions = { headless: true };
    const browser = await chromium.launch(launchOptions);
    const fp = getRandomFingerprint();
    const context = await browser.newContext({
        viewport: fp.viewport,
        userAgent: fp.userAgent,
        locale: fp.locale,
        timezoneId: fp.timezoneId
    });

    await applyAntiFingerprint(context, fp);
    const page = await context.newPage();

    try {
        console.log('[INFO] Navigating to home page...');
        await page.goto('https://ltcminer.com', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
        await page.waitForLoadState('networkidle').catch(() => {});
        await humanDelay(page, 2000, 4000);
        await clearOverlay(page);

        console.log('[INFO] Opening Login modal...');
        const loginBtn = page.getByText('Log In').first();
        await loginBtn.click({ force: true });
        await humanDelay(page, 2000, 4000);

        // Fallback: If still on home page, try direct navigation
        if (await page.locator('input[type="text"]').count() === 0) {
            console.log('[INFO] Modal didn\'t open, trying direct /login...');
            await page.goto('https://ltcminer.com/login', { waitUntil: 'domcontentloaded' }).catch(() => {});
            await clearOverlay(page);
        }

        // Standard login page selectors
        const emailInput = page.locator('input[type="text"], input[placeholder*="Email" i]').first();
        const passInput = page.locator('input[type="password"]').first();

        await safeFill(page, emailInput, email);
        await safeFill(page, passInput, password);

        const submitBtn = page.locator('button').filter({ hasText: /^Log In$/i }).last();
        await safeClick(page, submitBtn);

        await page.waitForLoadState('networkidle');
        await humanDelay(page, 3000, 5000);

        if (page.url().includes('login') || (await page.locator('button').filter({ hasText: /^Log In$/i }).count() > 1)) {
             return { status: 'FAILED', message: 'Login failed (check credentials)' };
        }

        console.log('[INFO] Navigating to Dashboard...');
        await page.goto('https://ltcminer.com/dashboard', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
        await page.waitForLoadState('networkidle').catch(() => {});
        await humanDelay(page, 3000, 5000);
        await clearOverlay(page);

        const restriction = await page.locator('text=RESTRICTIONS DETECTED, .bg-red-50, .text-red-700').filter({ hasText: /RESTRICTIONS|VERIFY/i }).count();
        
        if (restriction > 0) {
            return { status: 'RESTRICTED', message: 'Account has been restricted/banned' };
        }

        return { status: 'OK', message: 'Account is clean' };

    } catch (e) {
        return { status: 'ERROR', message: e.message };
    } finally {
        await browser.close();
    }
}

(async () => {
    if (!fs.existsSync('account.txt')) {
        process.exit(0);
    }

    const lines = fs.readFileSync('account.txt', 'utf-8').split('\n').filter(l => l.trim());
    let restrictedAccounts = [];
    let errorAccounts = [];

    for (const line of lines) {
        const parts = line.split(':');
        const email = parts[0];
        const password = parts[1];

        if (email && password) {
            const result = await checkAccount(email.trim(), password.trim());
            console.log(`[RESULT] ${email}: ${result.status} - ${result.message}`);
            
            if (result.status === 'RESTRICTED') {
                restrictedAccounts.push(`${email}: ${result.message}`);
            } else if (result.status === 'FAILED' || result.status === 'ERROR') {
                errorAccounts.push(`${email}: ${result.message}`);
            }
        }
    }

    if (restrictedAccounts.length > 0 || errorAccounts.length > 0) {
        const subject = `⚠️ LTC Miner Alert: ${restrictedAccounts.length} Restricted Accounts`;
        const message = `The following accounts need attention:\n\nRESTRICTED:\n${restrictedAccounts.join('\n')}\n\nERRORS/FAILED:\n${errorAccounts.join('\n')}`;
        await sendAlert(subject, message);
    }

    process.exit(0);
})();
