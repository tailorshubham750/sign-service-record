// debug-login.js — check what the login page actually looks like
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  await page.goto('https://360.servify.in/', { waitUntil: 'networkidle2', timeout: 30000 });

  const url = page.url();
  console.log('URL:', url);
  console.log('Title:', await page.title());

  // All inputs
  const inputs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('input')).map(i => ({
      type: i.type, name: i.name, id: i.id,
      placeholder: i.placeholder, className: i.className.substring(0, 80),
    }))
  );
  console.log('INPUTS:', JSON.stringify(inputs, null, 2));

  // All buttons
  const buttons = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button, [type=submit]')).map(b => ({
      tag: b.tagName, type: b.type, text: b.innerText.trim().substring(0, 50),
      id: b.id, className: b.className.substring(0, 80),
    }))
  );
  console.log('BUTTONS:', JSON.stringify(buttons, null, 2));

  // Full body structure
  const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
  console.log('BODY TEXT:', bodyText);

  await page.screenshot({ path: '/tmp/login_debug.png' });
  console.log('Screenshot: /tmp/login_debug.png');

  await browser.close();
})();
