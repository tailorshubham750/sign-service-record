const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });

  let capturedRequests = [];

  page.on('request', req => {
    const u = req.url();
    if (u.includes('/api/v1/') || u.includes('upload') || u.includes('doc') || u.includes('Doc') || u.includes('add')) {
      const info = {
        method: req.method(),
        url: u,
        headers: req.headers(),
        postData: req.postData()
      };
      console.log('>> [CAPTURED REQ]', req.method(), u);
      if (req.postData()) {
        console.log('   POST BODY:', req.postData().substring(0, 500));
      }
      capturedRequests.push(info);
    }
  });

  page.on('response', async res => {
    const u = res.url();
    if (u.includes('/api/v1/') || u.includes('upload') || u.includes('doc') || u.includes('Doc') || u.includes('add')) {
      console.log('<< [RES]', res.status(), u);
      try {
        const text = await res.text();
        console.log('   RES BODY:', text.substring(0, 300));
      } catch {}
    }
  });

  console.log('Logging in...');
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

  console.log('Clicking plus icon to open form...');
  await page.click('.view-upload-document-component .glyphicon-plus');
  await new Promise(r => setTimeout(r, 1500));

  // 1. Open the dropdown and select an option
  console.log('Selecting document type in dropdown...');
  await page.click('#documentList .servify-value');
  await new Promise(r => setTimeout(r, 500));

  // Inspect available dropdown options
  const options = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('#servify-dropdown-options .servify-dropdown-option')).map((el, i) => ({
      index: i,
      id: el.id,
      text: el.innerText.trim()
    }));
  });
  console.log('Available options:', options);

  // Click on the option, e.g. "Scanned Service Record" or "Others"
  const targetOption = options.find(o => o.text.includes('Service Record')) || options[0];
  console.log('Selecting option:', targetOption);
  await page.click(`#${targetOption.id}`);
  await new Promise(r => setTimeout(r, 1000));

  // 2. Attach a sample PDF file to #newDocument
  // Find a PDF in signed_pdfs
  const pdfDir = path.join(__dirname, 'signed_pdfs');
  const pdfFiles = fs.readdirSync(pdfDir).filter(f => f.endsWith('.pdf'));
  const testPdfPath = path.join(pdfDir, pdfFiles[0]);
  console.log('Attaching test PDF:', testPdfPath);

  const fileInput = await page.$('input#newDocument');
  await fileInput.uploadFile(testPdfPath);
  await new Promise(r => setTimeout(r, 2000));

  await page.screenshot({ path: '/tmp/servify_before_save.png' });

  // 3. Click #saveButton
  console.log('Clicking #saveButton...');
  await page.click('#saveButton');
  await new Promise(r => setTimeout(r, 6000));

  await page.screenshot({ path: '/tmp/servify_after_save.png' });

  fs.writeFileSync('/tmp/captured_upload_reqs.json', JSON.stringify(capturedRequests, null, 2));
  console.log('Done! Captured', capturedRequests.length, 'requests');

  await browser.close();
})();
