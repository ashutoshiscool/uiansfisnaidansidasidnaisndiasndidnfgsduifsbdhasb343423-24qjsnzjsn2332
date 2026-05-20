const { chromium } = require('playwright');
const fs = require('fs');
const { getRandomFingerprint, applyAntiFingerprint } = require('./fingerprint');

(async () => {
    console.log('[TEST] Registering WITHOUT any proxy to check if restriction is universal...');
    
    const browser = await chromium.launch({ headless: true });
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
        await page.goto('https://ltcminer.com', { waitUntil: 'load', timeout: 20000 });
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(3000);

        // Click Sign Up
        const signUpBtn = page.locator('button').filter({ hasText: /^Sign Up$/i }).first();
        for (let i = 0; i < 10; i++) {
            await signUpBtn.click({ force: true });
            try {
                await page.locator('input[type="text"].w-full.h-14').first().waitFor({ state: 'visible', timeout: 2000 });
                break;
            } catch(e) { await page.waitForTimeout(500); }
        }

        const randStr = Math.random().toString(36).substring(2, 8);
        const email = `directtest_${randStr}@outlook.com`;
        const password = 'TestPass123!@#';

        console.log(`[TEST] Email: ${email}`);
        
        await page.locator('input[type="text"].w-full.h-14').first().fill(email);
        const pwFields = page.locator('input[type="password"]');
        await pwFields.nth(0).fill(password);
        await pwFields.nth(1).fill(password);
        
        const checkbox = page.locator('input[type="checkbox"]').first();
        await checkbox.check({ force: true });
        
        await page.locator('button').filter({ hasText: /Create Account/i }).first().click({ force: true });
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(5000);

        // Go to dashboard
        await page.goto('https://ltcminer.com/dashboard', { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(5000);
        await page.screenshot({ path: 'test_no_proxy_dashboard.png', fullPage: true });
        
        const restriction = await page.locator('text=ACCOUNT RESTRICTIONS DETECTED').count();
        if (restriction > 0) {
            console.log('[RESULT] ⚠️ Restriction STILL shows even WITHOUT proxy — this is a DEFAULT message for ALL free accounts!');
        } else {
            console.log('[RESULT] ✅ No restriction without proxy — the proxy was the problem!');
        }

        fs.appendFileSync('account.txt', `${email}:${password}:DIRECT\n`);
    } catch(e) {
        console.error(`[ERROR] ${e.message}`);
        await page.screenshot({ path: 'test_no_proxy_error.png', fullPage: true }).catch(()=>{});
    } finally {
        await context.close();
        await browser.close();
    }
})();
