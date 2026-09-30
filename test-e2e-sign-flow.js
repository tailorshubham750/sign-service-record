const http = require('http');
const vault = require('./vault');

function postJson(urlPath, data, sessionToken = null) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    };
    if (sessionToken) headers['x-session-token'] = sessionToken;

    const req = http.request({
      hostname: 'localhost',
      port: 4000,
      path: urlPath,
      method: 'POST',
      headers
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, data: body }); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function getJson(urlPath, sessionToken = null) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (sessionToken) headers['x-session-token'] = sessionToken;

    const req = http.request({
      hostname: 'localhost',
      port: 4000,
      path: urlPath,
      method: 'GET',
      headers
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, data: body }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  console.log('--- STARTING E2E SIGN & AUTO-UPLOAD TEST ---');

  const creds = vault.loadCredentials();
  console.log('Step 0: Logging in as:', creds.username);
  const loginRes = await postJson('/api/login', {
    username: creds.username,
    password: creds.password
  });
  console.log('Login Status:', loginRes.status, 'SessionToken:', loginRes.data.sessionToken?.slice(0, 8));
  const sessionToken = loginRes.data.sessionToken;

  // 1. Fetch CSR list or use WAU0QP5JNKWU
  const refId = 'WAU0QP5JNKWU';
  console.log(`Step 1: Creating signature link for ${refId}...`);

  // Simple 1x1 transparent PNG data URL for test signatures
  const sampleSig = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  const linkRes = await postJson('/api/send-signature-link', {
    referenceId: refId,
    authorizedSignatoryName: 'Millan Parmar',
    authorizedSignatureDataUrl: sampleSig
  }, sessionToken);

  console.log('Create Link Status:', linkRes.status);
  console.log('Token created:', linkRes.data.token);
  const token = linkRes.data.token;

  if (!token) {
    throw new Error('Failed to get token: ' + JSON.stringify(linkRes.data));
  }

  // 2. Submit both signatures
  console.log('Step 2: Submitting Customer & Authorized Signatures...');
  const submitRes = await postJson(`/api/submit-signature/${token}`, {
    signatureDataUrl: sampleSig,
    authorizedSignatureDataUrl: sampleSig,
    authorizedSignatoryName: 'Millan Parmar',
    agreedToTerms: true
  });

  console.log('Submit Signature Status:', submitRes.status);
  console.log('Submit Result:', JSON.stringify(submitRes.data, null, 2));

  // 3. Check signature status
  console.log('Step 3: Checking Signature Status API...');
  const statusRes = await getJson(`/api/signature-status/${token}`);
  console.log('Status API:', JSON.stringify(statusRes.data, null, 2));

  console.log('--- E2E TEST COMPLETED ---');
})();
