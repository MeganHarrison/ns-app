import { test, expect } from '@playwright/test';

const BASE_URL = 'https://d1-starter-sessions-api.megan-d14.workers.dev';

test.describe('Nutrition Solutions Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard-v2.html`);
  });

  test('dashboard loads without errors', async ({ page }) => {
    // Check page title
    await expect(page).toHaveTitle(/Nutrition Solutions Dashboard/);
    
    // Check main heading is visible
    const heading = page.locator('h1');
    await expect(heading).toBeVisible();
    await expect(heading).toContainText('Nutrition Solutions Dashboard');
  });

  test('all metric cards are visible and properly styled', async ({ page }) => {
    // Check metrics grid exists
    const metricsGrid = page.locator('.metrics-grid');
    await expect(metricsGrid).toBeVisible();
    
    // Check all 4 metric cards
    const metricCards = page.locator('.metric-card');
    await expect(metricCards).toHaveCount(4);
    
    // Verify each card has proper structure
    for (let i = 0; i < 4; i++) {
      const card = metricCards.nth(i);
      await expect(card).toBeVisible();
      
      // Check card has icon, title, value, and change
      await expect(card.locator('.icon')).toBeVisible();
      await expect(card.locator('h3')).toBeVisible();
      await expect(card.locator('.value')).toBeVisible();
      await expect(card.locator('.change')).toBeVisible();
    }
    
    // Check specific metric titles
    await expect(page.locator('h3:has-text("Total Revenue")')).toBeVisible();
    await expect(page.locator('h3:has-text("Orders")')).toBeVisible();
    await expect(page.locator('h3:has-text("Avg Order Value")')).toBeVisible();
    await expect(page.locator('h3:has-text("Active Subscriptions")')).toBeVisible();
  });

  test('charts section is visible and contains canvas elements', async ({ page }) => {
    // Check charts section
    const chartsSection = page.locator('.charts-section');
    await expect(chartsSection).toBeVisible();
    
    // Check both chart containers
    const chartContainers = page.locator('.chart-container');
    await expect(chartContainers).toHaveCount(2);
    
    // Verify canvas elements for charts
    const revenueCanvas = page.locator('#revenueChart');
    const ordersCanvas = page.locator('#ordersChart');
    
    await expect(revenueCanvas).toBeVisible();
    await expect(ordersCanvas).toBeVisible();
    
    // Check chart titles
    await expect(page.locator('h2:has-text("Daily Revenue")')).toBeVisible();
    await expect(page.locator('h2:has-text("Orders by Status")')).toBeVisible();
  });

  test('actions section has all sync buttons', async ({ page }) => {
    // Check actions section
    const actionsSection = page.locator('.actions');
    await expect(actionsSection).toBeVisible();
    
    // Check all sync buttons
    const syncButtons = [
      'Sync All Data',
      'Sync Orders',
      'Sync Contacts',
      'Sync Products',
      'Sync Subscriptions'
    ];
    
    for (const buttonText of syncButtons) {
      const button = page.locator(`button:has-text("${buttonText}")`);
      await expect(button).toBeVisible();
      await expect(button).toBeEnabled();
    }
  });

  test('API endpoints return valid data', async ({ page }) => {
    // Test metrics endpoint
    const metricsResponse = await page.request.get(`${BASE_URL}/api/dashboard/metrics`);
    expect(metricsResponse.ok()).toBeTruthy();
    const metricsData = await metricsResponse.json();
    
    // Verify metrics structure
    expect(metricsData).toHaveProperty('revenue');
    expect(metricsData).toHaveProperty('customers');
    expect(metricsData).toHaveProperty('subscriptions');
    
    // Test orders endpoint
    const ordersResponse = await page.request.get(`${BASE_URL}/api/orders`);
    expect(ordersResponse.ok()).toBeTruthy();
    const ordersData = await ordersResponse.json();
    expect(Array.isArray(ordersData)).toBeTruthy();
  });

  test('responsive design works on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    
    // Check header is still visible
    const header = page.locator('.header');
    await expect(header).toBeVisible();
    
    // Check metrics grid adjusts to single column
    const metricsGrid = page.locator('.metrics-grid');
    await expect(metricsGrid).toBeVisible();
    
    // Charts should stack vertically
    const chartContainers = page.locator('.chart-container');
    for (let i = 0; i < 2; i++) {
      await expect(chartContainers.nth(i)).toBeVisible();
    }
  });

  test('loading states work correctly', async ({ page }) => {
    // Reload page and check for loading spinner
    await page.reload();
    
    // Loading spinner should appear initially
    const loadingSpinner = page.locator('.loading-spinner');
    
    // Content should eventually load
    await expect(page.locator('.metrics-grid')).toBeVisible({ timeout: 10000 });
  });

  test('sync button functionality', async ({ page }) => {
    // Click sync all button
    const syncAllButton = page.locator('button:has-text("Sync All Data")');
    
    // Check button exists and is clickable
    await expect(syncAllButton).toBeVisible();
    await expect(syncAllButton).toBeEnabled();
    
    // Click and check for response
    const responsePromise = page.waitForResponse(response => 
      response.url().includes('/sync-all') && response.status() === 200
    );
    
    await syncAllButton.click();
    
    // Button should show loading state
    await expect(syncAllButton).toContainText('Syncing...');
    
    // Wait for response
    const response = await responsePromise;
    expect(response.ok()).toBeTruthy();
  });

  test('visual regression - no overlapping elements', async ({ page }) => {
    // Wait for all content to load
    await page.waitForLoadState('networkidle');
    
    // Check for no overlapping text
    const allTextElements = await page.locator('h1, h2, h3, p, .value').all();
    const boundingBoxes = [];
    
    for (const element of allTextElements) {
      if (await element.isVisible()) {
        const box = await element.boundingBox();
        if (box) {
          boundingBoxes.push(box);
        }
      }
    }
    
    // Simple overlap check
    for (let i = 0; i < boundingBoxes.length; i++) {
      for (let j = i + 1; j < boundingBoxes.length; j++) {
        const box1 = boundingBoxes[i];
        const box2 = boundingBoxes[j];
        
        const overlap = !(
          box1.x + box1.width <= box2.x ||
          box2.x + box2.width <= box1.x ||
          box1.y + box1.height <= box2.y ||
          box2.y + box2.height <= box1.y
        );
        
        expect(overlap).toBeFalsy();
      }
    }
  });

  test('data loads and displays correctly', async ({ page }) => {
    // Wait for data to load
    await page.waitForFunction(() => {
      const revenue = document.querySelector('#totalRevenue');
      return revenue && revenue.textContent !== '-' && revenue.textContent !== 'Loading...';
    }, { timeout: 10000 });
    
    // Check that values are displayed
    const totalRevenue = page.locator('#totalRevenue');
    const orderCount = page.locator('#orderCount');
    const avgOrderValue = page.locator('#avgOrderValue');
    const activeSubscriptions = page.locator('#activeSubscriptions');
    
    // Values should not be loading or empty
    await expect(totalRevenue).not.toHaveText('-');
    await expect(totalRevenue).not.toHaveText('Loading...');
    await expect(orderCount).not.toHaveText('-');
    await expect(avgOrderValue).not.toHaveText('-');
    await expect(activeSubscriptions).not.toHaveText('-');
  });
});

test.describe('Homepage', () => {
  test('homepage links to dashboard correctly', async ({ page }) => {
    await page.goto(BASE_URL);
    
    // Find dashboard link
    const dashboardLink = page.locator('a:has-text("Analytics Dashboard")');
    await expect(dashboardLink).toBeVisible();
    
    // Click and verify navigation
    await dashboardLink.click();
    await expect(page).toHaveURL(/dashboard/);
  });
});