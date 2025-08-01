import { test, expect } from '@playwright/test';

const BASE_URL = 'https://d1-starter-sessions-api.megan-d14.workers.dev';

test('visual check of dashboard', async ({ page }) => {
  // Navigate to dashboard
  await page.goto(`${BASE_URL}/dashboard-v2.html`);
  
  // Wait for page to load
  await page.waitForLoadState('networkidle');
  
  // Take screenshot
  await page.screenshot({ path: 'dashboard-screenshot.png', fullPage: true });
  
  // Log page title
  const title = await page.title();
  console.log('Page title:', title);
  
  // Check if any content is visible
  const body = await page.locator('body').textContent();
  console.log('Page has content:', body?.length > 0);
  
  // Check for error messages
  const errors = await page.locator('.error, .error-message').count();
  console.log('Error messages found:', errors);
  
  // Check what's actually visible
  const h1 = await page.locator('h1').textContent();
  console.log('H1 text:', h1);
  
  // Get all visible text
  const visibleText = await page.locator('body').innerText();
  console.log('Visible text preview:', visibleText.substring(0, 200));
});