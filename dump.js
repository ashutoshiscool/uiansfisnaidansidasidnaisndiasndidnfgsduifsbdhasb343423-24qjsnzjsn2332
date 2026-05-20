const { chromium } = require('playwright');
(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto('https://ltcminer.com/', { waitUntil: 'load' });
    await page.locator('button').filter({ hasText: 'Sign Up' }).or(page.getByText('Sign Up', { exact: true })).first().click();
    await page.waitForTimeout(2000);
    const html = await page.content();
    require('fs').writeFileSync('dom.html', html);
    await browser.close();
})();
