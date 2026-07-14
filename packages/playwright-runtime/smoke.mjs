import { chromium } from 'playwright';

const expectedTitle = 'hydraz-playwright-smoke';
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  await page.setContent(`<title>${expectedTitle}</title><main>ready</main>`);
  const title = await page.title();
  const text = await page.locator('main').textContent();
  if (title !== expectedTitle || text !== 'ready') {
    throw new Error(`Unexpected smoke page state: title=${JSON.stringify(title)} text=${JSON.stringify(text)}`);
  }
} finally {
  await browser.close();
}
