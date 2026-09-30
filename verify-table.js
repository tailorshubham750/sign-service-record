const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });

  await page.goto('https://360.servify.in/', { waitUntil: 'networkidle2' });
  const u = await page.$('input[type="text"]:first-of-type');
  const p = await page.$('input[type="password"]');
  const btn = await page.$('button[type="submit"]');

  const creds = require('./vault').loadCredentials();
  await u.type(creds.username);
  await p.type(creds.password);
  await btn.click();
  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 });

  const csrId = 'AW2N8PKkWYs1P68I7Y8aMhPZau5mMI2g0Q5O4syJOH_SqnZ8QQGY7g==';
  await page.goto('https://360.servify.in/servicerequests/view?csrid=' + encodeURIComponent(csrId), { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 4000));

  await page.click('#view_upload_doc_tab');
  await new Promise(r => setTimeout(r, 3000));

  await page.screenshot({ path: '/tmp/servify_verified_table.png' });
  console.log('Saved screenshot to /tmp/servify_verified_table.png');

  await browser.close();
})();
