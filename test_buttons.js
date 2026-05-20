const { chromium } = require('playwright');
(async () => {
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();
    await page.goto('https://ltcminer.com', { waitUntil: 'load' });
    const locators = await page.getByRole('button', { name: /Sign Up/i }).all();
    console.log(`Found ${locators.length} buttons matching Sign Up`);
    for (let i = 0; i < locators.length; i++) {
        const isVisible = await locators[i].isVisible();
        const html = await locators[i].evaluate(e => e.outerHTML);
        console.log(`Button ${i}: visible=${isVisible}, html=${html.substring(0, 100)}...`);
    }
    await browser.close();
})();
