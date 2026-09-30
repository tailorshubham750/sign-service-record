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

  const client = await page.target().createCDPSession();
  await client.send('Network.enable');

  client.on('Network.requestWillBeSent', async params => {
    if (params.request.url.includes('internal/document/upload') && params.request.method === 'POST') {
      console.log('>>> MATCHED UPLOAD REQUEST:', params.requestId, params.request.url);
      console.log('Headers:', params.request.headers);
      try {
        const postData = await client.send('Network.getRequestPostData', { requestId: params.requestId });
        console.log('--- POST DATA BODY ---');
        console.log(postData.postData.substring(0, 1000));
        fs.writeFileSync('/tmp/upload_post_data.txt', postData.postData);
      } catch (err) {
        console.error('Could not get post data via CDP:', err.message);
      }
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

  await page.click('.view-upload-document-component .glyphicon-plus');
  await new Promise(r => setTimeout(r, 1500));

  await page.click('#documentList .servify-value');
  await new Promise(r => setTimeout(r, 500));

  await page.click('#option-5'); // Scanned Service Record
  await new Promise(r => setTimeout(r, 1000));

  const pdfDir = path.join(__dirname, 'signed_pdfs');
  const pdfFiles = fs.readdirSync(pdfDir).filter(f => f.endsWith('.pdf'));
  const testPdfPath = path.join(pdfDir, pdfFiles[0]);

  const fileInput = await page.$('input#newDocument');
  await fileInput.uploadFile(testPdfPath);
  await new Promise(r => setTimeout(r, 3000));

  await browser.close();
})();
