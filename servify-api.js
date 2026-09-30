// servify-api.js
// Handles Servify 360 auth (cookie-based session via Puppeteer), real API calls,
// automatic session refresh, and self-healing on session expiry.
const puppeteer = require('puppeteer');
const https = require('https');
const fs = require('fs');

const BASE_URL = 'https://360.servify.in';
const API_BASE = `${BASE_URL}/api/v1`;

const vault = require('./vault');

let sessionCookies = null; // { authorization, UID, username }
let qFilter = null;
let browser = null;
let sessionExpiresAt = 0; // Epoch ms when session expires
let isLoggingIn = false;
let loginPromise = null;

// Secure encrypted credential retrieval
const initialCreds = vault.loadCredentials();
let storedCredentials = {
  username: initialCreds.username || '',
  password: initialCreds.password || ''
};

// ── Login via real browser session (Puppeteer)
async function login(username, password) {
  if (username) storedCredentials.username = username;
  if (password) storedCredentials.password = password;
  if (!storedCredentials.username || !storedCredentials.password) {
    const reloaded = vault.loadCredentials();
    if (reloaded.username) storedCredentials.username = reloaded.username;
    if (reloaded.password) storedCredentials.password = reloaded.password;
  }

  // Prevent multiple concurrent login attempts
  if (isLoggingIn && loginPromise) {
    console.log('[ServifyAPI] Login already in progress, awaiting current attempt...');
    return loginPromise;
  }

  isLoggingIn = true;
  loginPromise = (async () => {
    console.log(`[ServifyAPI] Authenticating with Servify 360 as ${storedCredentials.username}...`);

    if (!browser || !browser.connected) {
      try {
        const launchOptions = {
          headless: 'new',
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        };
        if (process.env.PUPPETEER_EXECUTABLE_PATH) {
          launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
        }
        browser = await puppeteer.launch(launchOptions);
      } catch (err) {
        console.error('[ServifyAPI] Browser launch error:', err.message);
        throw err;
      }
    }

    let page = null;
    try {
      page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });

      await page.goto(BASE_URL + '/', { waitUntil: 'networkidle2', timeout: 35000 });

      // Check if browser is already authenticated and redirected to /servicerequests
      let currentUrl = page.url();
      let cookies = await page.cookies();
      let authCookie = cookies.find(c => c.name === 'authorization');
      let usernameCookie = cookies.find(c => c.name === 'username');
      const matchesTargetUser = usernameCookie && usernameCookie.value && 
        usernameCookie.value.toLowerCase() === (storedCredentials.username || '').toLowerCase();

      if (currentUrl.includes('/servicerequests') && authCookie && authCookie.value && matchesTargetUser) {
        console.log(`[ServifyAPI] Existing valid session detected on page load for ${storedCredentials.username}, reusing session.`);
      } else {
        // If logged in as someone else or login page needed, clear browser cookies
        console.log(`[ServifyAPI] Session mismatch or unauthenticated. Clearing cookies and loading fresh login for ${storedCredentials.username}...`);
        const cdp = await page.target().createCDPSession();
        await cdp.send('Network.clearBrowserCookies');
        await page.goto(BASE_URL + '/', { waitUntil: 'networkidle2', timeout: 35000 });

        let usernameField = await page.$('input[placeholder="Username"], input[type="text"]:first-of-type');
        let passwordField = await page.$('input[placeholder="Password"], input[type="password"]');
        let submitBtn = await page.$('button[type="submit"]');

        if (!usernameField || !passwordField || !submitBtn) {
          throw new Error('Login form elements not found on ' + BASE_URL);
        }

        await usernameField.click({ clickCount: 3 });
        await usernameField.type(storedCredentials.username, { delay: 40 });
        await passwordField.click();
        await passwordField.type(storedCredentials.password, { delay: 40 });
        await submitBtn.click();

        await Promise.race([
          page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }),
          new Promise(r => setTimeout(r, 10000)),
        ]);
      }

      cookies = await page.cookies();
      authCookie = cookies.find(c => c.name === 'authorization');
      const uidCookie = cookies.find(c => c.name === 'UID');
      usernameCookie = cookies.find(c => c.name === 'username');

      if (!authCookie || !authCookie.value) {
        throw new Error('Authorization cookie not received after login');
      }

      // Extract qFilter from root attributes
      const rootData = await page.evaluate(() => {
        const root = document.getElementById('root');
        return root ? root.getAttribute('data-q-filter') : null;
      });

      sessionCookies = {
        authorization: authCookie.value,
        UID: uidCookie ? uidCookie.value : '',
        username: usernameCookie ? usernameCookie.value : storedCredentials.username,
      };

      if (rootData) {
        try { qFilter = JSON.parse(rootData); } catch {}
      }

      // Set session expiration to 20 minutes from now (Servify expires around 30-45 mins)
      sessionExpiresAt = Date.now() + 20 * 60 * 1000;

      console.log(`[ServifyAPI] Session established successfully — user: ${storedCredentials.username}`);
      await page.close();
      return sessionCookies;

    } catch (err) {
      if (page) {
        try { await page.close(); } catch {}
      }
      throw err;
    } finally {
      isLoggingIn = false;
      loginPromise = null;
    }
  })();

  return loginPromise;
}

function buildCookieHeader() {
  if (!sessionCookies) throw new Error('Not logged into Servify');
  return Object.entries(sessionCookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

// ── Generic API POST with auto-retry on session expiration
async function apiPost(endpoint, body, allowRetry = true) {
  // Ensure session is fresh before sending
  if (!sessionCookies || Date.now() > sessionExpiresAt) {
    console.log('[ServifyAPI] Session absent or expired, refreshing before call to ' + endpoint);
    await login(storedCredentials.username, storedCredentials.password);
  }

  const payload = JSON.stringify(body);

  const result = await new Promise((resolve, reject) => {
    const url = new URL(`${API_BASE}/${endpoint}`);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'Cookie': buildCookieHeader(),
        'Origin': BASE_URL,
        'Referer': BASE_URL + '/servicerequests',
        'UUID': Math.random().toString(36).substring(2),
      },
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });

  // Check if Servify returned session expired
  const isSessionExpired = 
    (result.data && typeof result.data === 'object' && (
      result.data.msg === 'Session expired' ||
      result.data.message === 'Session expired' ||
      result.data.msg === 'Invalid token' ||
      result.data.message === 'Invalid token' ||
      result.data.statusCode === 'SFY.CORE.401'
    )) ||
    result.status === 401 ||
    result.status === 403;

  if (isSessionExpired) {
    console.warn(`[ServifyAPI] Endpoint ${endpoint} reported Session Expired.`);
    if (allowRetry) {
      console.log('[ServifyAPI] Auto-reauthenticating and retrying request...');
      sessionCookies = null;
      sessionExpiresAt = 0;
      await login(storedCredentials.username, storedCredentials.password);
      return apiPost(endpoint, body, false); // Retry once with fresh session
    }
  }

  return result;
}

// ── Fetch service requests list
async function getServiceRequests(searchRefId = null) {
  const qf = { ...qFilter };
  qf.startDate = '01-08-2026';
  qf.endDate = '04-10-2026';

  const body = {
    qFilter: qf,
    pagination: { itemsPerPage: 100, pageNo: 1, range: 10 }
  };

  const res = await apiPost('Consumer/getConsumerServiceRequest', body);
  if (res.data && res.data.data && Array.isArray(res.data.data.consumerServiceRequests)) {
    let requests = res.data.data.consumerServiceRequests;
    if (searchRefId) {
      requests = requests.filter(r => 
        (r.ReferenceID && r.ReferenceID.toLowerCase().includes(searchRefId.toLowerCase())) ||
        (r.ProductUniqueID && r.ProductUniqueID.toLowerCase().includes(searchRefId.toLowerCase())) ||
        (r.Name && r.Name.toLowerCase().includes(searchRefId.toLowerCase())) ||
        (r.ProductName && r.ProductName.toLowerCase().includes(searchRefId.toLowerCase())) ||
        (r.ProductSubCategory && r.ProductSubCategory.toLowerCase().includes(searchRefId.toLowerCase())) ||
        (r.AlternateUniqueKey && r.AlternateUniqueKey.toLowerCase().includes(searchRefId.toLowerCase()))
      );
    }
    return { success: true, count: requests.length, requests };
  }
  return { success: false, msg: res.data?.msg || 'Failed to fetch service requests', requests: [] };
}

// ── Fetch Jobsheet HTML for a specific CSR
async function fetchJobsheet(csrId) {
  const body = {
    ConsumerServiceRequestID: csrId,
    qFilter
  };
  const res = await apiPost('ConsumerServicerequest/fetchJobsheet', body);
  return res.data;
}

// Helper to build multipart/form-data body
function buildMultipartBody(fields, files, boundary) {
  const chunks = [];
  for (const [key, val] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${val}\r\n`));
  }
  for (const file of files) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.fieldname}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`));
    chunks.push(file.buffer);
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}

// ── Upload Document to Servify Service Record as "Signed Service Record" (PDF)
async function uploadDocument(csrId, fileInput, fileName = 'Signed_Service_Record.pdf', options = {}) {
  const targetUser = options.username || storedCredentials.username;
  const targetPass = options.password || storedCredentials.password;
  const uploadedBy = options.uploadedBy || targetUser;

  // STRICTLY switch session to the logged-in user who owns this upload
  await ensureSession(targetUser, targetPass, false);

  let pdfBuffer = fileInput;
  if (typeof fileInput === 'string') {
    const cleanB64 = fileInput.replace(/^data:[^;]+;base64,/, '');
    pdfBuffer = Buffer.from(cleanB64, 'base64');
  }

  const auth = sessionCookies.authorization;
  const boundary = '----NodeUploadBoundary' + Math.random().toString(36).substring(2);

  const fields = {
    docType: 'ConsumerServiceRequestDocument',
    clientRefId: `FEWEBA-${Math.random().toString(36).substring(2)}.pdf`,
    'entity-type': 'ConsumerServiceRequest',
    'entity-id': csrId,
    UploadedBy: uploadedBy,
    UploadedByUser: targetUser
  };

  const files = [
    {
      fieldname: 'file',
      filename: fileName,
      contentType: 'application/pdf',
      buffer: pdfBuffer
    }
  ];

  const multipartBody = buildMultipartBody(fields, files, boundary);

  console.log(`[ServifyAPI] Uploading ${fileName} (${pdfBuffer.length} bytes) strictly as user: ${sessionCookies.username} (${uploadedBy})...`);

  // Step 1: Upload binary to docService/api/v1/internal/document/upload
  const docServiceRes = await new Promise((resolve, reject) => {
    const req = https.request('https://api.servify.in/docService/api/v1/internal/document/upload', {
      method: 'POST',
      headers: {
        'authorization': auth,
        'app': 'WebApp',
        'module': 'WebApp',
        'Origin': BASE_URL,
        'Referer': `${BASE_URL}/`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': multipartBody.length,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    req.write(multipartBody);
    req.end();
  });

  if (!docServiceRes.data || !docServiceRes.data.success || !docServiceRes.data.data) {
    throw new Error('docService upload failed: ' + JSON.stringify(docServiceRes.data));
  }

  const docData = docServiceRes.data.data;
  const docUUID = docData.docServiceUUID || docData.docID;
  const uploadURL = docData.uploadURL || `docID=${docUUID}`;
  const fileUrl = docData.url;

  console.log(`[ServifyAPI] docService accepted document UUID: ${docUUID} for user: ${sessionCookies.username}`);

  // Step 2: Register Document in Servify CSR via addDocsForDS
  const registerPayload = {
    updatedData: [
      {
        ConsumerServiceRequestID: csrId,
        FilePath: uploadURL,
        Type: 'pdf',
        FileName: docUUID,
        OriginalName: fileName,
        Tag: 'Signed Service Record',
        DocumentID: 28,
        app: 'WebApp',
        DocumentCode: 'JOBSHEET',
        FileUrl: fileUrl,
        UploadedBy: uploadedBy,
        CreatedBy: targetUser,
        UploadedByName: uploadedBy,
        UserName: targetUser,
        User: targetUser
      }
    ]
  };

  console.log(`[ServifyAPI] Registering document in CSR as "Signed Service Record" (UploadedBy: ${uploadedBy})...`);
  const registerRes = await apiPost('ConsumerServicerequest/addDocsForDS', registerPayload);

  return {
    status: registerRes.status,
    data: registerRes.data,
    docID: docUUID,
    fileUrl,
    fileName,
    uploadedBy: uploadedBy,
    uploadedByUser: sessionCookies.username
  };
}

// Ensure session is fresh; if force=true or username changed or expired, re-login
async function ensureSession(username, password, force = false) {
  if (username) storedCredentials.username = username;
  if (password) storedCredentials.password = password;

  const currentUsername = sessionCookies?.username;
  const usernameChanged = username && (!currentUsername || (currentUsername.toLowerCase() !== username.toLowerCase()));

  if (force || usernameChanged || !sessionCookies || !sessionCookies.authorization || Date.now() > sessionExpiresAt) {
    console.log(`[ServifyAPI] Ensuring session for user: ${storedCredentials.username} (usernameChanged=${usernameChanged}, force=${force})...`);
    await login(storedCredentials.username, storedCredentials.password);
  }
}

function getCachedQFilter() {
  return qFilter;
}

async function logout() {
  console.log('[ServifyAPI] Logging out session...');
  sessionCookies = null;
  qFilter = null;
  sessionExpiresAt = 0;
  storedCredentials.password = '';
  if (browser && browser.connected) {
    try {
      const pages = await browser.pages();
      for (const p of pages) {
        try {
          const cdp = await p.target().createCDPSession();
          await cdp.send('Network.clearBrowserCookies');
        } catch {}
      }
    } catch {}
  }
  return true;
}

function getSessionUser() {
  if (sessionCookies && sessionCookies.authorization && Date.now() < sessionExpiresAt) {
    return {
      username: sessionCookies.username || storedCredentials.username,
      uid: sessionCookies.UID,
      expiresAt: sessionExpiresAt
    };
  }
  return null;
}

// ── Background Proactive Keep-Alive (every 12 minutes)
setInterval(async () => {
  if (sessionCookies && storedCredentials.username && storedCredentials.password) {
    try {
      console.log('[ServifyAPI] Running scheduled background session refresh...');
      await login(storedCredentials.username, storedCredentials.password);
    } catch (err) {
      console.warn('[ServifyAPI] Background refresh attempt failed:', err.message);
    }
  }
}, 12 * 60 * 1000);

module.exports = {
  login,
  logout,
  getSessionUser,
  getServiceRequests,
  fetchJobsheet,
  uploadDocument,
  ensureSession,
  getCachedQFilter
};
