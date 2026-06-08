import { chromium } from '/tmp/node_modules/playwright/index.mjs';

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true
});
const page = await browser.newPage();
await page.setViewportSize({ width: 1400, height: 900 });
await page.goto('http://localhost:3001', { waitUntil: 'networkidle', timeout: 15000 });
await page.screenshot({ path: '/tmp/before-scroll.png' });

const panelBody = await page.$('.panel-left-body');
console.log('panel-left-body found:', !!panelBody);

if (panelBody) {
  // Scroll the panel-left-body to bottom
  await panelBody.evaluate(el => el.scrollTop = el.scrollHeight);
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/after-scroll.png' });

  const renderBtn = await page.$('.btn-render');
  const saveTemplateBtn = await page.$('.btn-save-template');
  console.log('btn-render exists:', !!renderBtn);
  console.log('btn-save-template exists:', !!saveTemplateBtn);

  if (renderBtn) {
    const bb = await renderBtn.boundingBox();
    console.log('btn-render boundingBox:', JSON.stringify(bb));
  }
  if (saveTemplateBtn) {
    const bb = await saveTemplateBtn.boundingBox();
    console.log('btn-save-template boundingBox:', JSON.stringify(bb));
  }
}

await browser.close();
