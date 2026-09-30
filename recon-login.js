// recon-login-v2.js
// Navigate to root /, find real login form, submit, capture session token
const puppeteer = require('puppeteer');
const fs = require('fs');

const vault = require('./vault');
const creds = vault.loadCredentials();
const USERNAME = creds.username || process.env.SERVIFY_USERNAME;
const PASSWORD = creds.password || process.env.SERVIFY_PASSWORD;
const BASE_URL = 'https://360.servify.in';

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  const networkLog = [];
  page.on('request', req => {
    const url = req.url();
    if (url.includes('servify') || url.includes('/api/')) {
      networkLog.push({
        type: 'REQUEST',
        method: req.method(),
        url,
        postData: req.postData() || '',
        headers: req.headers(),
      });
    }
  });

  page.on('response', async res => {
    const url = res.url();
    if (url.includes('servify') && !url.includes('.js') && !url.includes('.css') && !url.includes('.png')) {
      let body = '';
      try { body = await res.text(); } catch {}
      networkLog.push({
        type: 'RESPONSE',
        status: res.status(),
        url,
        headers: res.headers(),
        body: body.substring(0, 2000),
      });
    }
  });

  // ── Step 1: Go to ROOT (login is served at /)
  console.log('Navigating to root...');
  await page.goto(BASE_URL + '/', { waitUntil: 'networkidle2', timeout: 30000 });
  await page.screenshot({ path: '/tmp/step1_root.png' });
  
  const rootURL = page.url();
  console.log('URL after root nav:', rootURL);

  // Get all input fields
  const inputs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('input')).map(i => ({
      type: i.type, name: i.name, id: i.id, placeholder: i.placeholder,
      value: i.value, className: i.className.substring(0, 60),
    }))
  );
  console.log('INPUTS:', JSON.stringify(inputs, null, 2));

  // Get page title and form HTML
  const title = await page.title();
  const formHTML = await page.evaluate(() => {
    const forms = document.querySelectorAll('form');
    return Array.from(forms).map(f => f.outerHTML.substring(0, 1000));
  });
  console.log('Page title:', title);
  console.log('Forms:', JSON.stringify(formHTML, null, 2));

  // Get all buttons
  const buttons = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button, [role="button"], .btn, input[type="submit"]')).map(b => ({
      tag: b.tagName, type: b.type, text: b.textContent.trim().substring(0, 50),
      id: b.id, className: b.className.substring(0, 60),
    }))
  );
  console.log('BUTTONS:', JSON.stringify(buttons, null, 2));

  // ── Step 2: Try to fill login form
  console.log('\nAttempting login form fill...');
  
  // Try various selectors for username
  const possibleUsernames = [
    '#username', '#userName', '#email', '#userId',
    'input[name="username"]', 'input[name="userName"]', 
    'input[name="email"]', 'input[type="text"]:first-of-type',
    'input[placeholder*="username" i]', 'input[placeholder*="email" i]',
    'input[placeholder*="user" i]',
  ];
  
  let usernameFound = false;
  for (const sel of possibleUsernames) {
    try {
      const el = await page.$(sel);
      if (el) {
        console.log('Username field found:', sel);
        await el.click({ clickCount: 3 });
        await el.type(USERNAME, { delay: 80 });
        usernameFound = true;
        break;
      }
    } catch {}
  }
  if (!usernameFound) console.log('WARNING: No username field found');

  const possiblePasswords = [
    '#password', '#Password', 
    'input[name="password"]', 'input[name="Password"]',
    'input[type="password"]',
  ];
  
  let passwordFound = false;
  for (const sel of possiblePasswords) {
    try {
      const el = await page.$(sel);
      if (el) {
        console.log('Password field found:', sel);
        await el.click();
        await el.type(PASSWORD, { delay: 80 });
        passwordFound = true;
        break;
      }
    } catch {}
  }
  if (!passwordFound) console.log('WARNING: No password field found');

  await page.screenshot({ path: '/tmp/step2_filled.png' });

  // ── Step 3: Submit
  const submitSelectors = [
    'button[type="submit"]', 'input[type="submit"]',
    'button.login-btn', '#login-btn', '.login-button',
    'button:last-of-type',
  ];
  
  for (const sel of submitSelectors) {
    try {
      const btn = await page.$(sel);
      if (btn) {
        console.log('Submit button found:', sel);
        await btn.click();
        break;
      }
    } catch {}
  }

  // Wait for navigation or API response
  await Promise.race([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }),
    new Promise(r => setTimeout(r, 8000)),
  ]);

  await page.screenshot({ path: '/tmp/step3_after_submit.png' });
  console.log('URL after submit:', page.url());

  // ── Step 4: Grab session data
  const cookies = await page.cookies();
  const servifyCookies = cookies.filter(c => c.domain.includes('servify'));
  console.log('SERVIFY COOKIES:', JSON.stringify(servifyCookies, null, 2));

  const rootData = await page.evaluate(() => {
    const root = document.getElementById('root');
    if (!root) return {};
    const attrs = {};
    for (const attr of root.attributes) attrs[attr.name] = attr.value;
    return attrs;
  });
  console.log('ROOT ATTRIBUTES:', JSON.stringify(rootData, null, 2));

  const storage = await page.evaluate(() => {
    const ls = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      ls[k] = localStorage.getItem(k);
    }
    return ls;
  });
  console.log('LOCAL STORAGE:', JSON.stringify(storage, null, 2));

  fs.writeFileSync('/tmp/servify_session.json', JSON.stringify({
    url: page.url(),
    cookies: servifyCookies,
    rootData,
    storage,
  }, null, 2));

  fs.writeFileSync('/tmp/servify_network_v2.json', JSON.stringify(networkLog, null, 2));

  console.log('\nNetwork requests captured:', networkLog.length);
  // Print all servify API calls
  networkLog
    .filter(n => n.url.includes('/api/'))
    .forEach(n => console.log(`[${n.type}] ${n.method || ''} ${n.url} ${n.postData ? '| BODY: ' + n.postData.substring(0, 200) : ''}`));

  await browser.close();
})();
