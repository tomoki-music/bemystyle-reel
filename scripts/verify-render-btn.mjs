import { chromium } from '/tmp/node_modules/playwright/index.mjs';

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true
});
const page = await browser.newPage();
await page.setViewportSize({ width: 1400, height: 900 });
await page.goto('http://localhost:3001', { waitUntil: 'networkidle', timeout: 15000 });

// Scroll panel-left-body to the point where btn-render is visible
const panelBody = await page.$('.panel-left-body');
await panelBody.evaluate(el => {
  const btn = el.querySelector('.btn-render');
  if (btn) btn.scrollIntoView({ block: 'center' });
});
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/render-btn-visible.png' });

// Also scroll to テンプレートとして保存
await panelBody.evaluate(el => {
  const btn = el.querySelector('.btn-save-template');
  if (btn) btn.scrollIntoView({ block: 'center' });
});
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/template-btn-visible.png' });

console.log('Done');
await browser.close();
