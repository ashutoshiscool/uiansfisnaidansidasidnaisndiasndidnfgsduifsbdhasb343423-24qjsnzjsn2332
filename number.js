const { chromium } = require('playwright');
const fs = require('fs');
const { getRandomFingerprint, applyAntiFingerprint } = require('./fingerprint');

const TIMEOUT = 30000; // Increased to 30s
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

(async () => {
    console.log('[INFO] Starting number.js with improved timeout and retries...');

    if (!fs.existsSync('account.txt')) {
        console.error('[ERROR] account.txt not found!');
        process.exit(1);
    }

    const accounts = fs.readFileSync('account.txt', 'utf-8').split('\n').filter(l => l.trim() !== '');
    if (accounts.length === 0) {
        console.error('[ERROR] No accounts in account.txt.');
        process.exit(1);
    }

    console.log(`[INFO] Found ${accounts.length} accounts to verify.`);

    for (let i = 0; i < accounts.length; i++) {
        const accountStr = accounts[i];
        const parts = accountStr.split(':');
        if (parts.length < 2) continue;

        const email = parts[0];
        const password = parts[1];

        console.log(`\n[INFO] ==========================================`);
        console.log(`[INFO] 🚀 LOGGING INTO: ${email}`);
        console.log(`[INFO] Account ${i+1} of ${accounts.length}`);
        console.log(`[INFO] ==========================================`);
        
        let success = false;
        for (let attempt = 1; attempt <= RETRIES && !success; attempt++) {
            if (attempt > 1) console.log(`[INFO] Retry attempt ${attempt}/${RETRIES} for ${email}...`);

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
                console.log('[INFO] Navigating to Login page...');
                await page.goto('https://ltcminer.com', { waitUntil: 'load', timeout: TIMEOUT });
                
                console.log('[INFO] Clicking Log In...');
                const logInBtn = page.locator('button').filter({ hasText: /^Log In$/i }).first();
                await safeClick(page, logInBtn);

                console.log('[INFO] Filling credentials...');
                const emailInput = page.locator('input[type="text"][placeholder*="text-slate-400" i], input[type="text"].w-full.h-14').first();
                await safeFill(page, emailInput, email);
                await safeFill(page, page.locator('input[type="password"]').first(), password);

                console.log('[INFO] Submitting login...');
                const submitBtn = page.locator('button').filter({ hasText: /LOG IN/i }).last();
                await safeClick(page, submitBtn);

                await page.waitForLoadState('networkidle');
                console.log('[INFO] Navigating to Dashboard...');
                await page.goto('https://ltcminer.com/dashboard', { waitUntil: 'load', timeout: TIMEOUT }).catch(() => {});
                await humanDelay(page, 3000, 5000);

                console.log('[INFO] Clicking WITHDRAW...');
                const withdrawBtn = page.getByRole('button', { name: /WITHDRAW/i }).first();
                await safeClick(page, withdrawBtn);
                await humanDelay(page, 2000, 3000);

                // Wait for phone_info.txt
                console.log('[INFO] Waiting for phone_info.txt (Run ./number.sh now for this account)...');
                let phoneInfo = null;
                while (!phoneInfo) {
                    if (fs.existsSync('phone_info.txt')) {
                        const content = fs.readFileSync('phone_info.txt', 'utf-8').trim();
                        if (content.includes(':')) {
                            phoneInfo = content.split(':');
                            fs.unlinkSync('phone_info.txt');
                        }
                    }
                    if (!phoneInfo) await new Promise(r => setTimeout(r, 2000));
                }

                const country = phoneInfo[0].trim();
                const number = phoneInfo[1].trim();
                console.log(`[INFO] Selecting country: ${country}, Number: ${number}`);

                try {
                    const select = page.locator('select').first();
                    const trigger = page.locator('button, [role="combobox"]').filter({ hasText: /Choose Your Country/i }).first();
                    
                    if (await select.count() > 0) {
                        console.log('[INFO] Using standard select for country...');
                        await select.selectOption({ label: country });
                    } else if (await trigger.count() > 0) {
                        console.log('[INFO] Using custom dropdown trigger...');
                        await trigger.click({ force: true });
                        await humanDelay(page, 1000, 2000);
                        await page.getByText(country, { exact: true }).first().click();
                    } else {
                        console.log('[INFO] Attempting fallback country selection...');
                        const textElement = page.getByText('Choose Your Country').first();
                        await textElement.click({ force: true });
                        await humanDelay(page, 1000, 2000);
                        await page.getByText(country, { exact: true }).first().click();
                    }
                } catch (e) {
                    console.log(`[WARN] Country selection issue: ${e.message}`);
                }

                console.log('[INFO] Taking debug screenshot after country selection...');
                await page.screenshot({ path: `debug_country_${email.split('@')[0]}.png`, fullPage: true });

                console.log('[INFO] Clicking CONTINUE...');
                const continueBtn = page.getByRole('button', { name: /CONTINUE/i }).first();
                await safeClick(page, continueBtn);
                await humanDelay(page, 2000, 3000);
                
                await page.screenshot({ path: `debug_after_continue_${email.split('@')[0]}.png`, fullPage: true });

                console.log('[INFO] Filling phone number...');
                // More robust selector for phone input based on placeholder
                const numInput = page.locator('input').filter({ has: page.locator('xpath=..').locator('text=+') }).first().or(page.locator('input[placeholder*="000"]')).first().or(page.locator('input').last());
                await safeFill(page, numInput, number);
                
                await page.screenshot({ path: `debug_after_number_${email.split('@')[0]}.png`, fullPage: true });

                console.log('[INFO] Clicking SEND CODE...');
                const sendCodeBtn = page.getByRole('button', { name: /SEND CODE|CONTINUE/i }).last();
                await safeClick(page, sendCodeBtn);
                await humanDelay(page, 3000, 5000);

                const screenshotPath = `verify_otp_${email.split('@')[0]}.png`;
                await page.screenshot({ path: screenshotPath, fullPage: true });
                console.log(`[INFO] Screenshot saved to ${screenshotPath}`);

                console.log('[INFO] Waiting for OTP from ./number.sh...');
                let otp = null;
                while (!otp) {
                    if (fs.existsSync('otp_info.txt')) {
                        otp = fs.readFileSync('otp_info.txt', 'utf-8').trim();
                        fs.unlinkSync('otp_info.txt');
                    }
                    if (!otp) await new Promise(r => setTimeout(r, 2000));
                }

                console.log(`[INFO] Entering OTP: ${otp}`);
                const otpInput = page.locator('input[type="text"]').last();
                await safeFill(page, otpInput, otp);
                
                await safeClick(page, continueBtn);
                await humanDelay(page, 5000, 8000);
                
                await page.screenshot({ path: `verify_final_${email.split('@')[0]}.png`, fullPage: true });
                console.log('[INFO] Verification step complete for this account.');
                success = true;

            } catch (e) {
                console.error(`[ERROR] Attempt ${attempt} failed for ${email}: ${e.message}`);
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
