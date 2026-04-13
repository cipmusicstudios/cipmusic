import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', error => console.log('PAGE ERROR:', error.message));
  page.on('requestfailed', request =>
    console.log('REQUEST FAILED:', request.url(), request.failure().errorText)
  );

  console.log('Navigating to http://localhost:3001...');
  await page.goto('http://localhost:3001', { waitUntil: 'networkidle0' });
  
  const content = await page.content();
  console.log('DOM length:', content.length);
  const rootHtml = await page.evaluate(() => document.getElementById('root')?.innerHTML || 'ROOT_APP_NOT_FOUND');
  console.log('Root HTML length:', rootHtml.length);
  
  await browser.close();
})();
