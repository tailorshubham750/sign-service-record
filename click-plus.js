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
    if (req.url().includes('/api/v1/') || req.url().includes('upload') || req.url().includes('Doc') || req.url().includes('doc')) {
      console.log('>> [REQ]', req.method(), req.url());
      if (req.postData()) {
        console.log('   POST DATA:', req.postData().substring(0, 400));
      }
    }
  });

  page.on('response', async res => {
    if (res.url().includes('/api/v1/') || res.url().includes('upload') || res.url().includes('Doc') || res.url().includes('doc')) {
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
  await new Promise(r => setTimeout(r, 2000));

  console.log('Clicking .glyphicon-plus...');
  await page.click('.view-upload-document-component .glyphicon-plus');
  await new Promise(r => setTimeout(r, 2000));

  const formDetails = await page.evaluate(() => {
    const comp = document.querySelector('.view-upload-document-component');
    if (!comp) return 'No comp';

    const inputs = Array.from(comp.querySelectorAll('select, input, button, textarea, .Select, [class*="select"]')).map(el => ({
      tag: el.tagName,
      id: el.id,
      name: el.name,
      type: el.type,
      class: el.className,
      placeholder: el.placeholder,
      value: el.value,
      options: el.tagName === 'SELECT' ? Array.from(el.options).map(o => ({ value: o.value, text: o.text })) : []
    }));

    return { inputs, innerHTML: comp.innerHTML.substring(comp.innerHTML.indexOf('Select File Name:')) };
  });

  console.log('Form Details:');
  console.log(JSON.stringify(formDetails.inputs, null, 2));
  console.log('HTML snippet:');
  console.log(formDetails.innerHTML ? formDetails.innerHTML.substring(0, 1500) : 'none');

  await browser.close();
})();
