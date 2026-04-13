import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  page.on('requestfailed', request =>
    console.log('REQUEST FAILED:', request.url(), request.failure()?.errorText || 'Unknown error')
  );

  console.log('Navigating to http://localhost:3001...');
  await page.goto('http://localhost:3001', { waitUntil: 'networkidle0', timeout: 30000 });
  
  // Get audio element src
  const audioSrc = await page.evaluate(() => {
    const audio = document.querySelector('audio');
    return audio ? audio.src : 'NO_AUDIO_ELEMENT';
  });
  console.log('Actual <audio> src:', audioSrc);

  // Retrieve track title from the UI
  const trackTitle = await page.evaluate(() => {
    const el = document.querySelector('.player-bar .font-medium');
    return el ? el.textContent : 'NOT_FOUND';
  });
  console.log('UI Track Title:', trackTitle);

  // Grab the text of the duration span
  const timeSpans = await page.evaluate(() => {
    const spans = Array.from(document.querySelectorAll('span'));
    return spans.map(s => s.textContent).filter(t => t && t.includes(':'));
  });
  console.log('Time spans:', timeSpans);

  await browser.close();
})();
