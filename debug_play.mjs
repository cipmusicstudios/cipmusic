import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

  console.log('Navigating and waiting for ready...');
  await page.goto('http://localhost:3001', { waitUntil: 'networkidle0' });
  
  // Get initial state
  const timeSpans0 = await page.evaluate(() => {
    const spans = Array.from(document.querySelectorAll('span'));
    return spans.map(s => s.textContent).filter(t => t && t.includes(':'));
  });
  console.log('Time spans before play:', timeSpans0);

  // click play button
  console.log('Clicking play button...');
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    // The play button has an SVG with lucide-play, wait, let's just find the big button with Pause/Play icon
    const playBtn = btns.find(b => b.innerHTML.includes('<svg') && b.className.includes('w-12 h-12'));
    if (playBtn) playBtn.click();
    else console.log('Play button not found');
  });

  // wait 2 seconds
  await new Promise(r => setTimeout(r, 2000));
  
  // check time spans
  const timeSpans = await page.evaluate(() => {
    const spans = Array.from(document.querySelectorAll('span'));
    return spans.map(s => s.textContent).filter(t => t && t.includes(':'));
  });
  console.log('Time spans after 2s:', timeSpans);

  // Check if audio is actually playing
  const isPlaying = await page.evaluate(() => {
    const audio = document.querySelector('audio');
    return audio ? (!audio.paused && audio.currentTime > 0) : false;
  });
  console.log('Is <audio> playing natively?', isPlaying);

  await browser.close();
})();
