import { test, expect } from '@playwright/test';

const BASE_URL = 'https://d1-starter-sessions-api.megan-d14.workers.dev';

test.describe('Keap Orders Page', () => {
  test('should load the Keap orders page successfully', async ({ page }) => {
    await page.goto(`${BASE_URL}/keap-orders.html`);
    
    // Check that the page title is correct
    await expect(page).toHaveTitle('Keap Orders');
    
    // Check that the main heading is present
    await expect(page.locator('h1')).toContainText('Keap Orders');
    
    // Check that the back button is present
    await expect(page.locator('a[role="button"]')).toContainText('Back to D1 Orders');
  });

  test('should show loading state initially', async ({ page }) => {
    await page.goto(`${BASE_URL}/keap-orders.html`);
    
    // Should show loading message initially
    await expect(page.locator('.loading')).toBeVisible();
    await expect(page.locator('.loading p')).toContainText('Loading orders from Keap...');
    await expect(page.locator('progress')).toBeVisible();
  });

  test('should load orders data or show appropriate message', async ({ page }) => {
    await page.goto(`${BASE_URL}/keap-orders.html`);
    
    // Wait for loading to complete (up to 30 seconds for API call)
    await page.waitForSelector('.loading', { state: 'hidden', timeout: 30000 });
    
    // Should either show orders table or error message
    const hasError = await page.locator('.error').isVisible();
    
    if (hasError) {
      // If there's an error, verify it's displayed properly
      await expect(page.locator('.error')).toBeVisible();
      await expect(page.locator('.error')).toContainText('Error:');
    } else {
      // If no error, should show the orders table
      await expect(page.locator('table')).toBeVisible();
      
      // Check table headers
      await expect(page.locator('th')).toHaveCount(8);
      await expect(page.locator('th').nth(0)).toContainText('Order ID');
      await expect(page.locator('th').nth(1)).toContainText('Date');
      await expect(page.locator('th').nth(2)).toContainText('Customer');
      await expect(page.locator('th').nth(3)).toContainText('Title');
      await expect(page.locator('th').nth(4)).toContainText('Status');
      await expect(page.locator('th').nth(5)).toContainText('Items');
      await expect(page.locator('th').nth(6)).toContainText('Total');
      await expect(page.locator('th').nth(7)).toContainText('Actions');
      
      // Check if stats section is visible
      await expect(page.locator('.stats')).toBeVisible();
      await expect(page.locator('.stat-card')).toHaveCount(4);
    }
  });

  test('should have working navigation back to main page', async ({ page }) => {
    await page.goto(`${BASE_URL}/keap-orders.html`);
    
    // Click the back button
    await page.click('a[role="button"]:has-text("Back to D1 Orders")');
    
    // Should navigate to the main page
    await expect(page).toHaveURL(BASE_URL + '/');
    await expect(page).toHaveTitle('D1 Sessions API');
  });
});

test.describe('Keap API Endpoint', () => {
  test('should respond to /api/keap-orders endpoint', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/keap-orders?limit=5&offset=0`);
    
    // Should get a response (either success or error)
    expect(response.status()).toBeLessThan(500);
    
    const data = await response.json();
    
    if (response.ok()) {
      // If successful, should have expected structure
      expect(data).toHaveProperty('orders');
      expect(data).toHaveProperty('count');
      expect(Array.isArray(data.orders)).toBe(true);
      expect(typeof data.count).toBe('number');
    } else {
      // If error, should have error message
      expect(data).toHaveProperty('error');
      expect(typeof data.error).toBe('string');
    }
  });

  test('should handle pagination parameters', async ({ request }) => {
    // Test with different pagination parameters
    const response1 = await request.get(`${BASE_URL}/api/keap-orders?limit=10&offset=0`);
    const response2 = await request.get(`${BASE_URL}/api/keap-orders?limit=5&offset=5`);
    
    expect(response1.status()).toBeLessThan(500);
    expect(response2.status()).toBeLessThan(500);
    
    // Both should return same structure
    const data1 = await response1.json();
    const data2 = await response2.json();
    
    if (response1.ok()) {
      expect(data1).toHaveProperty('orders');
      expect(data1).toHaveProperty('count');
    }
    
    if (response2.ok()) {
      expect(data2).toHaveProperty('orders');
      expect(data2).toHaveProperty('count');
    }
  });
});

test.describe('Main Page Integration', () => {
  test('should have link to Keap orders page from main page', async ({ page }) => {
    await page.goto(BASE_URL);
    
    // Should have a button/link to view Keap orders
    const keapOrdersLink = page.locator('a:has-text("View Keap Orders")');
    await expect(keapOrdersLink).toBeVisible();
    
    // Click the link
    await keapOrdersLink.click();
    
    // Should navigate to Keap orders page (Cloudflare redirects .html to clean URL)
    await expect(page).toHaveURL(`${BASE_URL}/keap-orders`);
    await expect(page).toHaveTitle('Keap Orders');
  });
});