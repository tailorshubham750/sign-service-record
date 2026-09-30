const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });

  page.on('request', req => {
    if (req.url().includes('/api/v1/') || req.url().includes('upload') || req.url().includes('doc') || req.url().includes('Doc')) {
      console.log('>> [REQ]', req.method(), req.url());
      if (req.postData()) {
        console.log('   POST DATA:', req.postData().substring(0, 300));
      }
    }
  });

  page.on('response', async res => {
    if (res.url().includes('/api/v1/') || res.url().includes('upload') || res.url().includes('doc') || res.url().includes('Doc')) {
      console.log('<< [RES]', res.status(), res.url());
    }
  });

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

  // Find the plus icon inside the purple header
  const plusDetails = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('*'));
    // Look for element that contains "View / Upload Documents" and has child or svg or i
    const header = all.find(el => el.innerText && el.innerText.includes('View / Upload Documents') && el.children.length > 0 && el.children.length < 5);
    if (!header) return { error: 'header not found' };

    const children = Array.from(header.querySelectorAll('*')).map(c => ({
      tag: c.tagName,
      class: c.className,
      html: c.outerHTML.substring(0, 200)
    }));

    return {
      headerTag: header.tagName,
      headerClass: header.className,
      headerHTML: header.outerHTML.substring(0, 500),
      children
    };
  });

  console.log('Plus details:', JSON.stringify(plusDetails, null, 2));

  // Click on the plus icon or whatever icon is in that header!
  const clickRes = await page.evaluate(() => {
    // Find icon or button inside header
    const headers = Array.from(document.querySelectorAll('*')).filter(el => 
      el.innerText && el.innerText.includes('View / Upload Documents') && (el.querySelector('i') || el.querySelector('svg') || el.querySelector('span'))
    );
    for (const h of headers) {
      const icon = h.querySelector('i, svg, span.fa, span.icon, .pull-right');
      if (icon) {
        icon.click();
        return 'Clicked icon in header: ' + icon.className;
      }
    }
    // Also try clicking any element with fa-plus or plus
    const plus = document.querySelector('.fa-plus, .icon-plus, [class*="plus"]');
    if (plus) {
      plus.click();
      return 'Clicked plus by class: ' + plus.className;
    }
    return 'Could not click plus';
  });
  console.log('Click result:', clickRes);

  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: '/tmp/servify_modal_opened.png' });

  // Check if a modal or popup opened!
  const modalInfo = await page.evaluate(() => {
    const modal = document.querySelector('.modal, [role="dialog"], .dialog, .popup, .fade.in');
    if (!modal) return 'No modal found';
    return {
      modalClass: modal.className,
      modalHTML: modal.outerHTML.substring(0, 1500)
    };
  });
  console.log('Modal Info:', JSON.stringify(modalInfo, null, 2));

  await browser.close();
})();
