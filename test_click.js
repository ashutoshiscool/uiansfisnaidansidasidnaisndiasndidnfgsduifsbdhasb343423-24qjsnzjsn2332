const { chromium } = require('playwright');
(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    console.log('Navigating...');
    await page.goto('https://ltcminer.com', { waitUntil: 'load' });
    const btns = await page.locator('button').allInnerTexts();
    console.log('Buttons:', btns);
    const signUpBtn = page.getByRole('button', { name: /Sign Up/i }).first();
    console.log('SignUp btn visible:', await signUpBtn.isVisible());
    await signUpBtn.click({ timeout: 5000 });
    console.log('Clicked!');
    await browser.close();
})();
