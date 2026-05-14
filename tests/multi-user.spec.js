const { test, expect, chromium } = require('@playwright/test');

const USERS = [
  { name: 'Operator', url: '/' },
  { name: 'Supervisor', url: '/' },
  { name: 'Material Handler', url: '/' }
];

async function runUser(user) {
  const browser = await chromium.launch(); 
  const context = await browser.newContext(); // isolated cookies/session
  const page = await context.newPage(); 

  await page.goto(user.url);

  // Wait for AP-Tracker shell to load.
  await page.waitForLoadState('networkidle'); 

  // Basic smoke check.
  await expect(page).toHaveTitle(/AP|Tracker/i);

  // Keep session alive briefly to overlap with other users.
  await page.waitForTimeout(5000);

  await browser.close(); 
}

test('simulate multiple simultaneous users', async () => {
  await Promise.all(USERS.map(runUser)); 
}); 
