const fs = require('fs');

const USED_NUMBERS_FILE = 'used_numbers.json';
const SMS_PAGES = [
    'https://sms24.me/en/countries/nl',
    'https://sms24.me/en/countries/nl/2',
    'https://sms24.me/en/countries/nl/3',
    'https://sms24.me/en/countries/nl/4',
    'https://sms24.me/en/countries/nl/5'
];

function getUsedNumbers() {
    if (!fs.existsSync(USED_NUMBERS_FILE)) return [];
    try {
        return JSON.parse(fs.readFileSync(USED_NUMBERS_FILE, 'utf-8'));
    } catch (e) {
        return [];
    }
}

function markNumberUsed(fullNumber) {
    const used = getUsedNumbers();
    if (!used.includes(fullNumber)) {
        used.push(fullNumber);
        fs.writeFileSync(USED_NUMBERS_FILE, JSON.stringify(used, null, 2));
        console.log(`[INFO] [SMS] Marked number ${fullNumber} as used.`);
    }
}

/**
 * Opens sms24.me, accepts cookies, scrolls down, and picks a fresh Netherlands number.
 * Returns { fullNumber, number (without +31), numberUrl, smsPage }
 */
async function getSms24Number(smsBrowser) {
    const usedNumbers = getUsedNumbers();
    const context = await smsBrowser.newContext();
    const smsPage = await context.newPage();

    for (const smsUrl of SMS_PAGES) {
        const pageNum = SMS_PAGES.indexOf(smsUrl) + 1;
        console.log(`[INFO] [SMS] Checking sms24.me page ${pageNum}...`);

        await smsPage.goto(smsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await smsPage.waitForTimeout(2000);

        // Accept cookies if present
        try {
            const cookieBtn = smsPage.locator('button, a').filter({ hasText: /accept|agree|got it|ok/i }).first();
            if (await cookieBtn.count() > 0) {
                await cookieBtn.click({ force: true }).catch(() => {});
                await smsPage.waitForTimeout(1000);
            }
        } catch(e) {}

        // Scroll down a bit to load numbers
        await smsPage.evaluate(() => window.scrollBy(0, 400));
        await smsPage.waitForTimeout(1000);

        // Find all number links on the page
        const numbers = await smsPage.evaluate(() => {
            const links = document.querySelectorAll('a[href*="/numbers/"]');
            return Array.from(links).map(link => {
                const text = link.innerText.trim();
                const phoneMatch = text.match(/(\+31\d+)/);
                return {
                    href: link.href,
                    text: phoneMatch ? phoneMatch[1] : ''
                };
            }).filter(n => n.text.startsWith('+31'));
        });

        for (const num of numbers) {
            const fullNumber = num.text.replace(/\s/g, '');
            if (usedNumbers.includes(fullNumber)) {
                continue; // Skip already used numbers
            }

            // Found a fresh number!
            console.log(`[INFO] [SMS] Found fresh, unused Number: ${fullNumber} on page ${pageNum}`);

            // Navigate to the number's SMS page
            await smsPage.goto(num.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await smsPage.waitForTimeout(2000);

            // Format: remove +31 prefix
            const formattedNumber = fullNumber.replace('+31', '');

            return {
                fullNumber: fullNumber,
                number: formattedNumber,
                numberUrl: num.href,
                smsPage: smsPage
            };
        }
    }

    throw new Error('No fresh Netherlands numbers available on any sms24.me page!');
}

/**
 * Waits for an OTP to arrive on the sms24.me SMS page.
 * Refreshes the page multiple times and looks for a 4-6 digit code in the latest message.
 */
async function waitForOtp(smsPage, numberUrl) {
    console.log('[INFO] [SMS] Waiting 20 seconds for LTCMiner SMS to arrive...');
    await smsPage.waitForTimeout(20000);

    for (let attempt = 1; attempt <= 4; attempt++) {
        console.log(`[INFO] [SMS] Refreshing SMS page (Attempt ${attempt}/4)...`);

        try {
            await smsPage.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
        } catch(e) {
            await smsPage.goto(numberUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
        }
        await smsPage.waitForTimeout(2000);

        // Look for OTP in the latest SMS messages
        const otp = await smsPage.evaluate(() => {
            const messages = document.querySelectorAll('.mess_text, .message-text, td, .msg, pre, .sms-text');
            for (const msg of messages) {
                const text = msg.innerText || msg.textContent || '';
                // Look for 4-6 digit codes
                const match = text.match(/\b(\d{4,6})\b/);
                if (match) return match[1];
            }
            // Fallback: search entire page body for codes near keywords
            const body = document.body ? document.body.innerText : '';
            const codeMatch = body.match(/(?:code|verify|otp|pin)[^\d]*(\d{4,6})/i);
            if (codeMatch) return codeMatch[1];
            // Last resort: just find any standalone 4-6 digit number in recent content
            const allCodes = body.match(/\b(\d{4,6})\b/g);
            if (allCodes && allCodes.length > 0) {
                // Check if any code appears near ltcminer or verification text
                for (const code of allCodes) {
                    const idx = body.indexOf(code);
                    const surrounding = body.substring(Math.max(0, idx - 100), idx + 100).toLowerCase();
                    if (surrounding.includes('ltc') || surrounding.includes('miner') || surrounding.includes('verif') || surrounding.includes('code')) {
                        return code;
                    }
                }
            }
            return null;
        });

        if (otp) {
            console.log(`[SUCCESS] [SMS] Extracted OTP: ${otp}`);
            return otp;
        }

        if (attempt < 4) {
            console.log('[INFO] [SMS] OTP not found yet, waiting 10 more seconds...');
            await smsPage.waitForTimeout(10000);
        }
    }

    console.log('[ERROR] [SMS] Failed to receive OTP after waiting.');
    return null;
}

module.exports = {
    getSms24Number,
    waitForOtp,
    markNumberUsed
};
