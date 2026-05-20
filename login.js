const { firefox } = require('playwright');
const path = require('path');
const fs = require('fs');
const { getRandomFingerprint, applyAntiFingerprint } = require('./fingerprint');

const TIMEOUT = 30000; // Increased to 30s for slower proxies
const RETRIES = 3;

async function humanDelay(page, min = 1000, max = 2000) {
    const delay = Math.floor(Math.random() * (max - min + 1) + min);
    await page.waitForTimeout(delay);
}

async function safeFill(page, locator, text) {
    await locator.waitFor({ state: 'visible', timeout: TIMEOUT });
    await locator.focus();
    await locator.clear();
    await humanDelay(page, 200, 500);
    for (const char of text) {
        await locator.pressSequentially(char, { delay: Math.floor(Math.random() * 50) + 10 });
    }
}

async function safeClick(page, locator) {
    await locator.waitFor({ state: 'visible', timeout: TIMEOUT });
    await locator.click({ force: true });
}

async function clearOverlay(page) {
    const acceptBtn = page.getByRole('button', { name: /ACCEPT/i });
    if (await acceptBtn.count() > 0) {
        console.log('[INFO] Clearing notification overlay...');
        await acceptBtn.click({ force: true }).catch(() => {});
        await humanDelay(page, 1000, 2000);
    }
}

function cleanupScreenshots(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const now = Date.now();
    const files = fs.readdirSync(dir);
    for (const file of files) {
        if (file.endsWith('.png')) {
            const filePath = path.join(dir, file);
            const stats = fs.statSync(filePath);
            if (now - stats.mtimeMs > 20 * 60 * 1000) {
                fs.unlinkSync(filePath);
                console.log(`[INFO] Deleted old screenshot: ${file}`);
            }
        }
    }
}

(async () => {
    console.log('[INFO] Starting login script with improved timeout and retries...');
    cleanupScreenshots('screenshots/login');

    if (!fs.existsSync('account.txt')) {
        console.error('[ERROR] account.txt not found!');
        process.exit(1);
    }

    const accounts = fs.readFileSync('account.txt', 'utf-8').split('\n').filter(l => l.trim() !== '');
    if (accounts.length === 0) {
        console.error('[ERROR] No accounts found in account.txt.');
        process.exit(1);
    }

    console.log(`[INFO] Found ${accounts.length} accounts to process.`);

    for (let i = 0; i < accounts.length; i++) {
        const accountStr = accounts[i];
        const parts = accountStr.split(':');
        if (parts.length < 2) continue;

        const email = parts[0];
        const password = parts[1];
        const proxy = parts.slice(2).join(':').trim();
        
        console.log(`\n[INFO] ==========================================`);
        console.log(`[INFO] 🚀 LOGGING INTO: ${email}`);
        console.log(`[INFO] Account ${i+1} of ${accounts.length}`);
        console.log(`[INFO] ==========================================`);

        let success = false;
        for (let attempt = 1; attempt <= RETRIES && !success; attempt++) {
            if (attempt > 1) console.log(`[INFO] Retry attempt ${attempt}/${RETRIES} for ${email}...`);
            
            let launchOptions = { headless: true };
            if (proxy && proxy !== 'DIRECT') {
                console.log(`[INFO] Using proxy: ${proxy}`);
                launchOptions.proxy = { server: proxy };
            }

            const browser = await firefox.launch(launchOptions);
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
                const initialDelay = Math.floor(Math.random() * 5000) + 2000;
                await new Promise(r => setTimeout(r, initialDelay));

                console.log('[INFO] Navigating to home page...');
                await page.goto('https://ltcminer.com', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
                await page.waitForLoadState('networkidle').catch(() => {});
                await humanDelay(page, 2000, 4000);
                await clearOverlay(page);

                console.log('[INFO] Opening Login modal...');
                const logInBtn = page.getByText('Log In').first();
                await logInBtn.click({ force: true });
                await humanDelay(page, 2000, 4000);

                // Fallback: If still on home page, try direct navigation
                if (await page.locator('input[type="text"]').count() === 0) {
                    console.log('[INFO] Modal didn\'t open, trying direct /login...');
                    await page.goto('https://ltcminer.com/login', { waitUntil: 'domcontentloaded' }).catch(() => {});
                    await clearOverlay(page);
                }

                console.log('[INFO] Filling email...');
                const emailInput = page.locator('input[type="text"], input[placeholder*="Email" i]').first();
                await safeFill(page, emailInput, email);
                
                console.log('[INFO] Filling password...');
                const passwordInput = page.locator('input[type="password"]').first();
                await safeFill(page, passwordInput, password);

                console.log('[INFO] Submitting login...');
                const submitBtn = page.locator('button').filter({ hasText: /^Log In$/i }).last();
                await safeClick(page, submitBtn);

                await page.waitForLoadState('networkidle').catch(() => {});
                await humanDelay(page, 3000, 5000);

                console.log('[INFO] Navigating to dashboard...');
                if (!page.url().includes('dashboard')) {
                    await page.goto('https://ltcminer.com/dashboard', { waitUntil: 'domcontentloaded', timeout: TIMEOUT }).catch(() => {});
                    await page.waitForLoadState('networkidle').catch(() => {});
                }
                await humanDelay(page, 3000, 5000);
                await clearOverlay(page);

                const screenshotPath = `screenshots/login/login_dash_${email.split('@')[0]}.png`;
                await page.screenshot({ path: screenshotPath, fullPage: true });
                console.log(`[INFO] Saved screenshot to ${screenshotPath}`);
                
                const restrictionText = await page.locator('text=ACCOUNT RESTRICTIONS DETECTED').count();
                if (restrictionText > 0) {
                    console.log(`[WARNING] ⚠️ ${email}: RESTRICTIONS DETECTED`);
                } else {
                    console.log(`[SUCCESS] ✅ ${email}: CLEAN ACCOUNT`);
                }
                success = true;

            } catch (e) {
                console.error(`[ERROR] Attempt ${attempt} failed for ${email}: ${e.message}`);
                await page.screenshot({ path: `screenshots/login/error_login_${email.split('@')[0]}.png` }).catch(() => {});
                if (attempt === RETRIES) {
                    console.error(`[ERROR] All attempts failed for ${email}.`);
                }
            } finally {
                await browser.close();
            }
        }
    }
    console.log('\n[INFO] All accounts processed.');
})();
