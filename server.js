// server.js — Servify Live Signature, Dual Signatory & Official PDF Generation Server
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const puppeteer = require('puppeteer');
const { PDFDocument } = require('pdf-lib');
const {
  login,
  logout,
  getSessionUser,
  getServiceRequests,
  fetchJobsheet,
  uploadDocument,
  ensureSession
} = require('./servify-api');

const os = require('os');
let QRCode = null;
try {
  QRCode = require('qrcode');
} catch (e) {
  console.warn('[Server] qrcode module not loaded:', e.message);
}

const { spawn } = require('child_process');
let publicTunnelUrl = '';

function startTunnel(port) {
  const cfPath = '/opt/homebrew/bin/cloudflared';
  if (!fs.existsSync(cfPath)) return;

  const cf = spawn(cfPath, ['tunnel', '--url', `http://localhost:${port}`]);
  
  const handleData = (data) => {
    const text = data.toString();
    const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match && !publicTunnelUrl) {
      publicTunnelUrl = match[0];
      console.log('───────────────────────────────────────────────────────');
      console.log(`[Tunnel] Live Universal Access URL:`);
      console.log(`  ${publicTunnelUrl}`);
      console.log(`  (Works for ALL devices on same Wi-Fi, other Macs, phones & internet)`);
      console.log('───────────────────────────────────────────────────────');
    }
  };

  cf.stdout.on('data', handleData);
  cf.stderr.on('data', handleData);
  cf.on('close', () => {
    publicTunnelUrl = '';
  });
}

function getLocalWifiIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}

const vault = require('./vault');
const initialVaultCreds = vault.loadCredentials();
const app = express();
const PORT = process.env.PORT || 4000;
let USERNAME = initialVaultCreds.username || process.env.SERVIFY_USERNAME || '';
let PASSWORD = initialVaultCreds.password || process.env.SERVIFY_PASSWORD || '';

function formatDisplayName(username) {
  if (!username) return 'Millan Parmar';
  let clean = username.replace(/_?(supervisor|technician|admin|lead|executive)$/i, '');
  clean = clean.replace(/[._]/g, ' ').trim();
  const formatted = clean.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  return formatted || username;
}

let currentSessionUser = USERNAME ? {
  username: USERNAME,
  name: formatDisplayName(USERNAME)
} : null;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ── Serve built React app for all frontend assets
app.use(express.static(path.join(__dirname, 'sign-app/build')));

// ── In-memory signature sessions store: { [token]: TokenData }
const signatureTokens = new Map();

// ── Per-Browser Active Sessions Store
// Map: sessionToken -> { sessionToken, username, name, loggedInAt, lastActiveAt, terminated, terminationReason }
const activeBrowserSessions = new Map();

// Map: username (lowercase) -> sessionToken
// Enforces single-browser session per account: logging in from another browser terminates the previous browser!
const userActiveSessionMap = new Map();

function extractSessionToken(req) {
  const authHeader = req.headers['authorization'] || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  if (req.headers['x-session-token']) {
    return req.headers['x-session-token'];
  }
  if (req.query && req.query.sessionToken) {
    return req.query.sessionToken;
  }
  return null;
}

function getBrowserSession(req) {
  const token = extractSessionToken(req);
  if (!token) return { session: null, error: 'no_token' };
  
  const session = activeBrowserSessions.get(token);
  if (!session) return { session: null, error: 'invalid_token' };

  if (session.terminated) {
    return { session: null, error: 'terminated', reason: session.terminationReason || 'logged_in_from_another_browser' };
  }

  session.lastActiveAt = Date.now();
  return { session, error: null };
}

// Middleware to protect supervisor-only API endpoints
function requireSupervisorAuth(req, res, next) {
  const { session, error, reason } = getBrowserSession(req);
  if (error === 'terminated') {
    return res.status(401).json({
      success: false,
      authenticated: false,
      kickedOut: true,
      reason: reason || 'logged_in_from_another_browser',
      error: 'You have been logged out because your account was logged in from another browser.'
    });
  }
  if (!session) {
    return res.status(401).json({
      success: false,
      authenticated: false,
      error: 'Unauthorized: Please log in with your Servify supervisor credentials.'
    });
  }
  req.supervisorSession = session;
  next();
}

// ── Global Authorized Signatory profile — default tied to logged in Servify account
let globalAuthorizedSignatory = {
  name: 'Millan Parmar',
  signatureDataUrl: null
};

// Ensure PDF storage directory exists
const PDF_DIR = path.join(__dirname, 'signed_pdfs');
if (!fs.existsSync(PDF_DIR)) {
  fs.mkdirSync(PDF_DIR, { recursive: true });
}

function formatTimestamp(d = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  const day = pad(d.getDate());
  const month = pad(d.getMonth() + 1);
  const year = d.getFullYear();
  const hours = pad(d.getHours());
  const mins = pad(d.getMinutes());
  return `${day}-${month}-${year} ${hours}:${mins}`;
}

function formatDateForFilename(d = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function safeDataUrl(url) {
  if (!url) return '';
  return String(url).replace(/"/g, '&quot;');
}

// 100% Exact AirPods Service Record HTML Template Generator matching Servify official reference PDF
function generateAirPodsServiceRecordHtml(data = {}) {
  const refId = data.referenceId || 'LXOEESWHLTNS';
  const serialNo = data.serialNo || data.imei || data.productUniqueId || 'H6Y0HTMXMH';
  const serviceMode = data.serviceMode || 'Carry in';
  const coverageStatus = data.coverageStatus || 'Chargeable';
  const inwardDate = data.inwardDate || '28 Sep 2026 14:24:10';
  
  const customerName = data.customerName || data.name || 'MANAV THAKKAR';
  const customerAddress = data.customerAddress || data.address || 'LAXMI TERRACE FLAT N0 702 BEHIND PARAM GOLD JEWLERS Kandivali West, Mumbai, Maharashtra, India, 400067 Mumbai, Maharashtra';
  const contactNo = data.contactNo || data.mobileNo || '9082198781';
  const emailId = data.emailId || data.email || 'manavthakkar015@gmail.com';
  
  const productName = data.productName || 'AirPods Pro 3rd Gen';
  const modelName = data.modelName || 'AIRPODS PRO 3';
  const warrantyStatus = data.warrantyStatus || 'Apple Limited Warranty';
  
  const issueCategory = data.issueCategory || 'Other';
  const issueDesc = data.issueDesc || '1. CASE MISPLACE (LOST) (SN H6Y0HTMXMH) LEFT AIRPODS (SN H7JHN90B0FF0000UHZ) RIGHT AIRPODS (SN H7FHN80XSA10000UHY)';
  const cosmeticCondition = data.cosmeticCondition || 'Case misplace Left AirPods have dent stain usage marks';
  
  const aspName = data.aspName || 'Aptronix - Borivali';
  const aspAddress = data.aspAddress || 'Shop No. 23 & 24, Satra Park, Shimpoli Road, Kastur Park, Borivali West, Mumbai - 400092 Near Veg. Treat Restaurant 400092 Mumbai Maharashtra';
  const aspContact = data.aspContact || '9182562141';
  const aspEmail = data.aspEmail || 'service.borivali@aptronixindia.com';
  const aspTimings = data.aspTimings || 'Mon Sat<br/>10:30 AM to 07:00 PM';

  const checklist = data.checklist || [
    { name: 'Device is Powering On', value: 'No' },
    { name: 'Battery is Working', value: 'No' },
    { name: 'Bluetooth is Working', value: 'No' },
    { name: 'Charging Port is Working', value: 'No' },
    { name: 'Earphone is Working', value: 'No' },
    { name: 'Speaker is Working', value: 'No' },
    { name: 'Connecting Wire is Damaged or Missing', value: 'No' }
  ];

  const authSignName = data.authorizedSignatoryName || 'Millan Parmar';
  const timeStr = data.timeStr || formatTimestamp(new Date());
  const authSigUrl = safeDataUrl(data.authorizedSignatureUrl);
  const custSigUrl = safeDataUrl(data.customerSignatureUrl);

  const refBarcode = 'data:image/png;base64,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';
  const snBarcode = 'data:image/png;base64,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';

  let checklistRows = '';
  checklist.forEach((item) => {
    checklistRows += `
      <tr>
        <td class="table-content-first-row" colspan="4" style="vertical-align:top;text-align: left; padding: 2px 0 2px 8px;">
          ${item.name}
        </td>
        <td class="table-content-first-row" colspan="2" style="vertical-align: top;text-align: center;word-wrap:break-word; padding: 2px 0;">
          ${item.value}
        </td>
      </tr>
    `;
  });

  return `<!DOCTYPE html>
<html>
<head>
  <title>Service Record</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 0;
    }
    * {
      box-sizing: border-box;
    }
    body {
      background: white;
      font-family: GothamRoundedBook, Arial, sans-serif;
      margin: 0 auto !important;
      padding: 4px 6px !important;
      width: 792px;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    p {
      margin: 1px 4px;
    }
    table {
      width: 100%;
      table-layout: fixed;
      border-collapse: collapse;
    }
    .head-logo {
      height: 28px;
      width: auto;
      object-fit: contain;
    }
    .text-bold {
      font-weight: bold;
    }
    .table-heading {
      font-family: GothamRoundedBook, Arial, sans-serif;
      border-bottom: 1px solid black;
      padding: 3px 0 3px 8px;
      font-size: 11.5px;
    }
    .table-content {
      padding: 2.5px 0 2.5px 8px;
      font-size: 10px;
    }
    .table-content-first-row {
      padding: 2.5px 0 2.5px 8px;
      font-size: 10px;
    }
    .table-text-pupa {
      font-size: 8.5px;
      line-height: 1.25;
      margin: 0;
      padding-left: 14px;
    }
    .table-text-pupa li {
      margin-bottom: 1.5px;
    }
  </style>
</head>
<body>
  <!-- Header with logos and Service Record title -->
  <table style="width: 100%; margin-bottom: 4px;">
    <tr>
      <td style="width: 25%; text-align: left; vertical-align: middle;">
        <img src="https://sfy-assets.s3.ap-south-1.amazonaws.com/partner/262-aptronix/logo/logo.png" alt="Aptronix" class="head-logo" style="height: 32px;" />
      </td>
      <td style="width: 50%; text-align: center; vertical-align: middle;">
        <h2 style="margin: 0; font-size: 20px; font-weight: bold; letter-spacing: 0.5px;">Service Record</h2>
      </td>
      <td style="width: 25%; text-align: right; vertical-align: middle;">
        <img src="https://img.servify.in/Apple/AppleAuthorisedServiceProvider.png" alt="Apple Authorized Service Provider" class="head-logo" style="height: 32px;" />
      </td>
    </tr>
  </table>

  <!-- Main Unified Table Structure -->
  <table style="width: 100%; border: 1px solid black; border-collapse: collapse;">
    <tr>
      <!-- LEFT COLUMN (50%) -->
      <td style="width: 50%; vertical-align: top; border-right: 1px solid black; padding: 0;">
        
        <!-- Service Details Table -->
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td class="table-heading text-bold" colspan="2">Service Details</td>
          </tr>
          <tr>
            <td class="table-content" style="width: 38%; vertical-align: middle; height: 48px; border-bottom: 1px solid black;">Reference ID:</td>
            <td class="table-content" style="width: 62%; vertical-align: middle; text-align: center; height: 48px; border-bottom: 1px solid black; padding: 2px 0;">
              <img src="${refBarcode}" alt="${refId}" style="height: 40px; width: 140px; display: block; margin: 0 auto; object-fit: fill;" />
            </td>
          </tr>
          <tr>
            <td class="table-content" style="width: 38%; vertical-align: middle; height: 48px; border-bottom: 1px solid black;">Serial Number:</td>
            <td class="table-content" style="width: 62%; vertical-align: middle; text-align: center; height: 48px; border-bottom: 1px solid black; padding: 2px 0;">
              <img src="${snBarcode}" alt="${serialNo}" style="height: 40px; width: 140px; display: block; margin: 0 auto; object-fit: fill;" />
            </td>
          </tr>
          <tr>
            <td class="table-content" style="width: 38%;">Service Mode:</td>
            <td class="table-content" style="width: 62%;">${serviceMode}</td>
          </tr>
          <tr>
            <td class="table-content" style="width: 38%;">*Service Coverage Status:</td>
            <td class="table-content" style="width: 62%;">${coverageStatus}</td>
          </tr>
          <tr>
            <td class="table-content" style="width: 38%; border-bottom: 1px solid black;">Date of Device Inward:</td>
            <td class="table-content" style="width: 62%; border-bottom: 1px solid black;">${inwardDate}</td>
          </tr>
        </table>

        <!-- Customer Details Table -->
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td class="table-heading text-bold" colspan="2">Customer Details</td>
          </tr>
          <tr>
            <td class="table-content" style="width: 38%;">Name:</td>
            <td class="table-content text-bold" style="width: 62%;">${customerName}</td>
          </tr>
          <tr>
            <td class="table-content" style="width: 38%; vertical-align: top;">Address:</td>
            <td class="table-content" style="width: 62%; font-size: 9.5px; line-height: 1.2;">${customerAddress}</td>
          </tr>
          <tr>
            <td class="table-content" style="width: 38%;">Contact Number:</td>
            <td class="table-content" style="width: 62%;">${contactNo}</td>
          </tr>
          <tr>
            <td class="table-content" style="width: 38%; border-bottom: 1px solid black;">Email ID:</td>
            <td class="table-content" style="width: 62%; border-bottom: 1px solid black;">${emailId}</td>
          </tr>
        </table>

        <!-- Product Details Table -->
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td class="table-heading text-bold" colspan="2">Product Details</td>
          </tr>
          <tr>
            <td class="table-content" style="width: 38%;">Product Name:</td>
            <td class="table-content" style="width: 62%;">${productName}</td>
          </tr>
          <tr>
            <td class="table-content" style="width: 38%;">Model Name:</td>
            <td class="table-content text-bold" style="width: 62%;">${modelName}</td>
          </tr>
          <tr>
            <td class="table-content" style="width: 38%;">IMEI / Serial Number:</td>
            <td class="table-content" style="width: 62%;">${serialNo}</td>
          </tr>
          <tr>
            <td class="table-content" style="width: 38%; border-bottom: 1px solid black;">Product Warranty Status:</td>
            <td class="table-content" style="width: 62%; border-bottom: 1px solid black;">${warrantyStatus}</td>
          </tr>
        </table>

        <!-- Issue Reported by Customer -->
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td class="table-heading text-bold" colspan="2">Issue Reported by Customer:</td>
          </tr>
          <tr style="border-bottom: 1px solid black;">
            <td class="table-content text-bold" style="width: 38%;">Category</td>
            <td class="table-content text-bold" style="width: 62%;">Description</td>
          </tr>
          <tr>
            <td class="table-content" style="width: 38%; vertical-align: top;">${issueCategory}</td>
            <td class="table-content" style="width: 62%; font-size: 9.5px; line-height: 1.2;">${issueDesc}</td>
          </tr>
          <tr style="border-top: 1px solid black;">
            <td class="table-heading text-bold" colspan="2" style="padding-top: 2px;">Cosmetic Condition of Product:</td>
          </tr>
          <tr>
            <td class="table-content" colspan="2" style="font-size: 9.5px; padding-bottom: 4px;">${cosmeticCondition}</td>
          </tr>
        </table>
      </td>

      <!-- RIGHT COLUMN (50%) -->
      <td style="width: 50%; vertical-align: top; padding: 0;">
        
        <!-- Authorized Service Provider Details Table -->
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td class="table-heading text-bold" colspan="2">Authorized Service Provider Details</td>
          </tr>
          <tr>
            <td class="table-content" style="width: 32%;">Name:</td>
            <td class="table-content" style="width: 68%;">${aspName}</td>
          </tr>
          <tr>
            <td class="table-content" style="width: 32%; vertical-align: top;">Address:</td>
            <td class="table-content" style="width: 68%; font-size: 9.5px; line-height: 1.2;">${aspAddress}</td>
          </tr>
          <tr>
            <td class="table-content" style="width: 32%;">Contact Number:</td>
            <td class="table-content" style="width: 68%;">${aspContact}</td>
          </tr>
          <tr>
            <td class="table-content" style="width: 32%;">Email ID:</td>
            <td class="table-content" style="width: 68%;">${aspEmail}</td>
          </tr>
          <tr>
            <td class="table-content" style="width: 32%; border-bottom: 1px solid black;">Timings:</td>
            <td class="table-content" style="width: 68%; border-bottom: 1px solid black;">${aspTimings}</td>
          </tr>
        </table>

        <!-- AirPods Specific Checklist Table -->
        <table style="width: 100%; border-collapse: collapse;">
          <tr style="border-bottom: 1px solid black;">
            <td class="table-heading text-bold" colspan="4">Checklist</td>
            <td class="table-heading text-bold" colspan="2" style="text-align: center;">Inward Check</td>
          </tr>
          ${checklistRows}
        </table>
      </td>
    </tr>
  </table>

  <!-- Terms and Conditions Section with Aptronix QR code on the right -->
  <div style="width: 100%; margin-top: 4px; display: flex; justify-content: space-between; align-items: flex-start;">
    <div style="width: 88%; text-align: left;">
      <div style="font-size: 10.5px; font-weight: bold; margin-bottom: 2px;">Terms and Conditions:</div>
      <ol class="table-text-pupa" style="list-style-type: decimal; margin: 0; padding-left: 14px;">
        <li>By submitting the device I am authorising Aptronix to undertake the repair / replacement as per the product warranty eligibility.</li>
        <li>Contact details provided by the Customer will be shared to Apple for review and/or feedback.</li>
        <li>This equipment is also accepted subject to repair terms and conditions mentioned on website, attached in e-mail along with digital service record and digital delivery report sent on your email ID.</li>
        <li>The Service Provider will not be responsible for any data loss.</li>
        <li>*Subject to Engineer's inspection.</li>
        <li>*Quality program repairs will not cover all defective parts on non chargeable basis. Only parts covered under quality program premise will be covered as non chargeable post inspection is completed by engineer.</li>
        <li>Once the repair is processed it will not be cancelled.</li>
        <li>In case of display replacement repair, if there is any major scratch or if device is bent, display repair cannot be processed.</li>
        <li>Customer is expected to take data backup, prior to the repair submission.</li>
        <li>Service Centre is not responsible for any kind of data loss.</li>
        <li>Find my Device must be turned off, before submitting the device for a repair.</li>
        <li>Customer should check the service report received on e-mail during repair submission and this service report should be produced during the device collection.</li>
        <li>For ownership confirmation, Proof of purchase would be requested.</li>
        <li>Device will be ineligible for warranty service, If any third party modification or tampering is found in the unit during internal inspection at the service centre.</li>
        <li>Device may not returned in the same condition, if the device is found tampered.</li>
        <li>Turn-around time for repairs or replacements would be as per repair requirement, based on the Apple guidelines.</li>
        <li>While updating software for out of warranty devices, if device gets stuck on Apple logo, Service Centre cannot be held responsible.</li>
        <li>After completion of the repair, customer must collect the device within 15 days, else the unit can be auctioned for recovery of the storage charges.</li>
        <li>Software updates and disabled units of out of warranty devices will be chargeable.</li>
        <li>Service Centre will issue a Loaner(Stand by) device to eligible repairs in warranty.</li>
        <li>If Loaner device is damaged by customer relevant charges would be payable as defined by Apple.</li>
        <li>While processing a display replacement repair, if any other issue is found in the device, prior intimation will be provided and the customer will be liable to pay additionally based on the issue.</li>
        <li>In case of a refund, for the payments made by credit/debit cards for the repair 2% handling charge and service charges will be deducted.</li>
        <li>Before submitting the device at the Service Centre, please go through the Apple Warranty terms & conditions.</li>
        <li>By providing a telephone number and/or e-mail address, you authorize Aptronix to share your contact with Apple and to contact you for the purpose of the service/case review and/or feedback. To learn how Apple safeguards your personal information, please review the Apple Customer Privacy Policy at http://www.apple.com/legal/privacy. To review and update your personal contact information, visit www.apple.com/contact/myinfo.</li>
      </ol>
    </div>
    <div style="width: 11%; text-align: right; padding-top: 4px;">
      <img src="https://img.servify.in/partner/Aptronix/Aptronix_QR_code.png" alt="QR" style="width: 48px; height: 48px; display: block; margin-left: auto;" />
    </div>
  </div>

  <!-- Signatures Section -->
  <div style="display: flex; justify-content: space-between; align-items: flex-end; width: 100%; margin-top: 14px;">
    <!-- Authorized Signatory -->
    <div style="width: 45%; text-align: left;">
      <div style="width: 140px; text-align: center;">
        ${authSigUrl ? `
          <img src="${authSigUrl}" alt="Authorized Signature" style="height: 38px; max-width: 135px; display: block; margin: 0 auto; object-fit: contain;" />
        ` : `
          <div style="height: 38px;"></div>
        `}
        <div style="font-size: 10px; margin-top: 2px; font-weight: 500; color: #111;">
          (${timeStr})
        </div>
        <div style="border-top: 1px solid black; width: 140px; margin-top: 2px; padding-top: 2px;">
          <p style="margin: 0; font-size: 11px; font-weight: bold;">Authorized Signatory</p>
          <p style="margin: 1px 0 0 0; font-size: 10px; font-weight: normal;">(${authSignName})</p>
        </div>
      </div>
    </div>

    <!-- Customer's Signature -->
    <div style="width: 45%; text-align: right;">
      <div style="width: 140px; text-align: center; margin-left: auto;">
        ${custSigUrl ? `
          <img src="${custSigUrl}" alt="Customer Signature" style="height: 38px; max-width: 135px; display: block; margin: 0 auto; object-fit: contain;" />
        ` : `
          <div style="height: 38px;"></div>
        `}
        <div style="font-size: 10px; margin-top: 2px; font-weight: 500; color: #111;">
          (${timeStr})
        </div>
        <div style="border-top: 1px solid black; width: 140px; margin-top: 2px; padding-top: 2px;">
          <p style="margin: 0; font-size: 11px; font-weight: bold;">Customer's Signature</p>
        </div>
      </div>
    </div>
  </div>

  <!-- Bottom Footer -->
  <div style="margin-top: 10px; text-align: left; font-size: 10px;">
    <span style="color: red; font-weight: 500;">Need Help?</span>
    <a href="https://apps.apple.com/app/apple-store/id1130498044?pt=2003&ct=IndASPqr.PLF.780084&mt=8" style="text-decoration: none; color: #0066cc; margin-left: 2px;">
      Click here, to get the support you need for all the Apple products you love - all in one place.
    </a>
  </div>
</body>
</html>`;
}

// Helper to inject BOTH signatures and timestamps into Servify's Service Record HTML
function injectSignatureIntoJobsheet(html, customerSignatureUrl, authorizedSignatureUrl, authorizedSignatoryName = 'Millan Parmar', custDateObj = null, authDateObj = null) {
  if (!html) return html;

  const custTimeStr = custDateObj ? formatTimestamp(custDateObj) : '';
  const authTimeStr = authDateObj ? formatTimestamp(authDateObj) : '';
  const authName = authorizedSignatoryName || 'Millan Parmar';
  const safeCustSig = safeDataUrl(customerSignatureUrl);
  const safeAuthSig = safeDataUrl(authorizedSignatureUrl);

  // Compact empty table paddings and margins to match Servify official 1-page layout without shrinking width or fonts
  const exactStyle = `
    <style id="servify-pixel-exact-style">
      @page {
        size: A4 portrait;
        margin: 0;
      }
      body {
        margin: 0px 6px !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      .job-sheet-table {
        width: 100% !important;
        table-layout: fixed !important;
      }
      thead { display: table-row-group !important; }
      tfoot { display: table-row-group !important; }
      p {
        margin: 1px 4px !important;
      }
      .table-content, .table-content-first-row {
        padding: 1.5px 0px 1.5px 8px !important;
      }
      .table-heading {
        padding: 2px 0px 2px 8px !important;
      }
      .row-terms-and-conditions-div {
        padding: 0px 0px 2px 0px !important;
      }
      .disclamer-section-div {
        margin: 4px 0 0 0 !important;
      }
      .referenceID-serial-no-details-section-table {
        margin: 0px 0px 4px 0px !important;
      }
      .referenceID-serial-no-details-section-table td {
        vertical-align: middle !important;
        padding: 4px 8px !important;
      }
      .referenceID-serial-no-details-section-table td img {
        display: block;
        margin: 0 auto;
        padding: 4px 0;
      }
      /* Header Logos Alignment & Sizing (Flush with Table Borders) */
      .rowDiv1, .logo-section-div {
        width: 100% !important;
        margin: 0 0 6px 0 !important;
        padding: 0 !important;
      }
      .logo-section-table {
        width: 100% !important;
        border-collapse: collapse !important;
        table-layout: fixed !important;
      }
      .logo-section-table td:first-child {
        text-align: left !important;
        padding: 0 !important;
        vertical-align: middle !important;
        width: 25% !important;
      }
      .logo-section-table td:first-child img {
        height: 28px !important;
        width: auto !important;
        max-width: 110px !important;
        margin: 0 !important;
        display: block !important;
        object-fit: contain !important;
      }
      .logo-section-table td:nth-child(2) {
        text-align: center !important;
        padding: 0 !important;
        vertical-align: middle !important;
        width: 50% !important;
      }
      .logo-section-table td:nth-child(2) h4,
      .report-head {
        font-size: 20px !important;
        font-weight: bold !important;
        margin: 0 !important;
      }
      .logo-section-table td:last-child {
        text-align: right !important;
        padding: 0 !important;
        vertical-align: middle !important;
        width: 25% !important;
      }
      .logo-section-table td:last-child img {
        height: 28px !important;
        width: auto !important;
        max-width: 135px !important;
        margin: 0 0 0 auto !important;
        display: block !important;
        object-fit: contain !important;
      }
      .checklist-div {
        display: flex !important;
        flex-direction: column !important;
        justify-content: flex-start !important;
      }
      .checklist-details-section-table {
        height: auto !important;
        width: 100% !important;
      }
      .checklist-details-section-table tr {
        height: auto !important;
      }
      .checklist-details-section-table td {
        padding: 2px 0 2px 8px !important;
        height: auto !important;
      }
      /* Aptronix / Apple QR Code Resizing & Border Flush Alignment */
      .disclamer-section-div {
        width: calc(100% - 60px) !important;
        margin: 4px 0 0 0 !important;
        float: left !important;
      }
      img[src*="QR_code"],
      img[src*="Aptronix_QR_code"] {
        width: 48px !important;
        height: 48px !important;
        max-width: 48px !important;
        max-height: 48px !important;
        margin: 4px 0 0 auto !important;
        display: block !important;
      }
      .authorized-signature-section-table,
      .customer-signature-section-table {
        margin: 0 !important;
      }
      .rowDiv4 {
        margin-top: 8px !important;
      }
    </style>
  `;

  // Standardize AirPods checklist values: NA -> No to match official reference PDF
  if (html.includes('AIRPODS') || html.includes('AirPods') || html.includes('Headphones')) {
    html = html.replace(/>\s*NA\s*</g, '>No<');
  }

  // Replace QR container with flush-aligned 48px box
  html = html.replace(/<div\s+style=[\"']text-align:\s*right;\s*margin-top:\s*10px[\"']>\s*<img\s+src=[^>]*Aptronix_QR_code[^>]*>\s*<\/div>/i,
    '<div style="width: 55px; text-align: right; margin-left: auto; padding-top: 4px;"><img src="https://img.servify.in/partner/Aptronix/Aptronix_QR_code.png" alt="QR" style="width: 48px; height: 48px; display: block; margin-left: auto;" /></div>'
  );

  if (html.includes('</head>')) {
    html = html.replace('</head>', `${exactStyle}</head>`);
  } else {
    html = exactStyle + html;
  }

  // Exact signature block matching Servify official Service Record layout
  const signatureBlock = `
    <div class="rowDiv4" style="display: flex; justify-content: space-between; align-items: flex-end; width: 100%; margin-top: 10px;">
        <!-- Left: Authorized Signatory -->
        <div class="authorized-signature-section-div" style="width: 50%; text-align: left;">
            <div style="width: 130px; text-align: center; margin-left: 2px;">
                ${safeAuthSig ? `
                    <img src="${safeAuthSig}" alt="Authorized Signature" style="height: 48px; max-width: 125px; display: block; margin: 0 auto; object-fit: contain;" />
                    <div style="font-family: GothamRoundedBook, sans-serif; font-size: 11px; margin-top: 2px; font-weight: 500; color: #111; text-align: center;">
                        (${authTimeStr})
                    </div>
                ` : `
                    <div style="height: 48px; display: flex; align-items: center; justify-content: center;">
                        <span style="font-family: GothamRoundedBook, sans-serif; font-size: 10px; color: #b45309; font-style: italic;">(Pending Signature)</span>
                    </div>
                    <div style="font-family: GothamRoundedBook, sans-serif; font-size: 11px; margin-top: 2px; font-weight: 500; color: #888; text-align: center;">
                        —
                    </div>
                `}
                <div style="border-top: 1px solid black; width: 130px; margin-top: 2px; padding-top: 2px; text-align: center;">
                    <p style="margin: 0; font-family: GothamRoundedBook, sans-serif; font-size: 11.5px; font-weight: bold; color: #111;">Authorized Signatory</p>
                    <p style="margin: 1px 0 0 0; font-family: GothamRoundedBook, sans-serif; font-size: 10.5px; font-weight: normal; color: #222;">(${authName})</p>
                </div>
            </div>
        </div>

        <!-- Right: Customer's Signature -->
        <div class="customer-signature-section-div" style="width: 50%; text-align: right;">
            <div style="width: 130px; text-align: center; margin-left: auto; margin-right: 2px;">
                ${safeCustSig ? `
                    <img src="${safeCustSig}" alt="Customer Signature" style="height: 48px; max-width: 125px; display: block; margin: 0 auto; object-fit: contain;" />
                    <div style="font-family: GothamRoundedBook, sans-serif; font-size: 11px; margin-top: 2px; font-weight: 500; color: #111; text-align: center;">
                        (${custTimeStr})
                    </div>
                ` : `
                    <div style="height: 48px; display: flex; align-items: center; justify-content: center;">
                        <span style="font-family: GothamRoundedBook, sans-serif; font-size: 10px; color: #b45309; font-style: italic;">(Pending Signature)</span>
                    </div>
                    <div style="font-family: GothamRoundedBook, sans-serif; font-size: 11px; margin-top: 2px; font-weight: 500; color: #888; text-align: center;">
                        —
                    </div>
                `}
                <div style="border-top: 1px solid black; width: 130px; margin-top: 2px; padding-top: 2px; text-align: center;">
                    <p style="margin: 0; font-family: GothamRoundedBook, sans-serif; font-size: 11.5px; font-weight: bold; color: #111;">Customer's Signature</p>
                </div>
            </div>
        </div>
    </div>
  `;

  const rowDiv4Regex = /<div class="rowDiv4">[\s\S]*?<\/table>\s*<\/div>\s*<\/div>/i;
  if (rowDiv4Regex.test(html)) {
    return html.replace(rowDiv4Regex, signatureBlock);
  }

  return html;
}

// Generate real A4 PDF matching Servify reference PDF 100% (Strictly 1 Page, Full-Width)
async function generatePDF(html) {
  const launchOptions = {
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  };
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  const browser = await puppeteer.launch(launchOptions);

  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 1600 });
  await page.setContent(html, { waitUntil: 'networkidle0' });

  let pdfBuffer = null;
  // Full-width scaling (1.0 down to 0.94) strictly guaranteeing 1 page A4 layout identical to Pic 1
  for (const s of [1.0, 0.98, 0.96, 0.94]) {
    pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      scale: s,
      margin: { top: 0, bottom: 0, left: 0, right: 0 }
    });

    try {
      const doc = await PDFDocument.load(pdfBuffer);
      if (doc.getPageCount() === 1) {
        console.log(`[PDF] Generated 100% full-width single-page A4 PDF with scale ${s}`);
        break;
      }
    } catch {}
  }

  await browser.close();
  return pdfBuffer;
}

// ──────────────────────────────────────────────
// API ROUTES
// ──────────────────────────────────────────────

// POST /api/login — authenticates with Servify 360 using username and password
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username and password are required' });
  }

  try {
    const trimmedUser = username.trim();
    const trimmedPass = password.trim();

    // Authenticate with Servify 360
    await login(trimmedUser, trimmedPass);

    // Save encrypted credentials to vault securely
    try {
      vault.saveCredentials(trimmedUser, trimmedPass);
    } catch (ve) {
      console.warn('[Server] Vault update warning:', ve.message);
    }

    const userKey = trimmedUser.toLowerCase();

    // Single-device / Single-browser enforcement:
    // If another browser is already logged in with this account, terminate its session!
    const prevToken = userActiveSessionMap.get(userKey);
    if (prevToken && activeBrowserSessions.has(prevToken)) {
      const prevSession = activeBrowserSessions.get(prevToken);
      prevSession.terminated = true;
      prevSession.terminationReason = 'logged_in_from_another_browser';
      console.log(`[Server] User ${trimmedUser} logged in from another browser. Terminating previous browser session ${prevToken.slice(0, 8)}...`);
    }

    // Generate unique cryptographically secure session token for THIS browser
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const displayName = formatDisplayName(trimmedUser);

    const sessionObj = {
      sessionToken,
      username: trimmedUser,
      password: trimmedPass,
      name: displayName,
      loggedInAt: Date.now(),
      lastActiveAt: Date.now(),
      terminated: false
    };

    activeBrowserSessions.set(sessionToken, sessionObj);
    userActiveSessionMap.set(userKey, sessionToken);

    globalAuthorizedSignatory.name = displayName;
    USERNAME = trimmedUser;
    PASSWORD = trimmedPass;

    console.log(`[Server] Created isolated browser session for ${displayName} (${sessionToken.slice(0, 8)}...)`);

    res.json({
      success: true,
      message: 'Login successful',
      sessionToken,
      user: {
        username: sessionObj.username,
        name: sessionObj.name,
        loggedInAt: sessionObj.loggedInAt
      },
      authorizedSignatory: globalAuthorizedSignatory
    });
  } catch (err) {
    console.error('[Server] Login error:', err.message);
    res.status(401).json({ success: false, error: err.message || 'Servify authentication failed' });
  }
});

// POST /api/logout — clears Servify session strictly for the requesting browser
app.post('/api/logout', async (req, res) => {
  const token = extractSessionToken(req);
  if (token && activeBrowserSessions.has(token)) {
    const session = activeBrowserSessions.get(token);
    session.terminated = true;
    activeBrowserSessions.delete(token);
    const userKey = session.username.toLowerCase();
    if (userActiveSessionMap.get(userKey) === token) {
      userActiveSessionMap.delete(userKey);
    }
    console.log(`[Server] Logged out browser session ${token.slice(0, 8)}...`);
  }

  // If no other sessions are active on the server, clear Puppeteer cookies
  if (activeBrowserSessions.size === 0) {
    try {
      await logout();
      PASSWORD = '';
    } catch {}
  }

  res.json({ success: true, message: 'Logged out successfully' });
});

// GET /api/session — returns active Servify session status strictly for the calling browser
app.get('/api/session', (req, res) => {
  const { session, error, reason } = getBrowserSession(req);

  // If kicked out by another browser logging into the same account
  if (error === 'terminated') {
    return res.json({
      success: false,
      authenticated: false,
      kickedOut: true,
      reason: reason || 'logged_in_from_another_browser',
      error: 'You have been logged out because your account was logged into from another browser.'
    });
  }

  // If browser has no token or invalid token
  if (!session) {
    return res.json({
      success: true,
      authenticated: false,
      user: null,
      authorizedSignatory: globalAuthorizedSignatory
    });
  }

  // Valid session for this browser
  res.json({
    success: true,
    authenticated: true,
    user: {
      username: session.username,
      name: session.name,
      loggedInAt: session.loggedInAt
    },
    authorizedSignatory: globalAuthorizedSignatory
  });
});

// GET /api/service-requests — list live requests from 360.servify.in (protected)
app.get('/api/service-requests', requireSupervisorAuth, async (req, res) => {
  try {
    const activeUser = req.supervisorSession?.username || USERNAME;
    const activePass = req.supervisorSession?.password || PASSWORD;
    if (!activeUser || !activePass) {
      return res.status(401).json({ success: false, error: 'Please log in to Servify 360 first' });
    }
    await ensureSession(activeUser, activePass);
    const search = req.query.query || req.query.search || null;
    const result = await getServiceRequests(search);
    res.json({
      ...result,
      user: {
        username: req.supervisorSession.username,
        name: req.supervisorSession.name,
        loggedInAt: req.supervisorSession.loggedInAt
      }
    });
  } catch (err) {
    console.error('[Server] getServiceRequests error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/service-request/:refId — get single CSR details + live Jobsheet HTML (protected)
app.get('/api/service-request/:refId', requireSupervisorAuth, async (req, res) => {
  try {
    const activeUser = req.supervisorSession?.username || USERNAME;
    const activePass = req.supervisorSession?.password || PASSWORD;
    await ensureSession(activeUser, activePass);
    const refId = req.params.refId.trim();
    const result = await getServiceRequests(refId);
    
    const csr = (result.requests || []).find(r => 
      r.ReferenceID?.toLowerCase() === refId.toLowerCase() ||
      r.ConsumerServiceRequestID === refId
    );

    if (!csr) {
      return res.status(404).json({ success: false, error: 'Service record not found for ' + refId });
    }

    let jobsheetHtml = '';
    try {
      const jobsheetRes = await fetchJobsheet(csr.ConsumerServiceRequestID);
      jobsheetHtml = jobsheetRes.data || '';
    } catch (e) {
      console.warn('[Server] fetchJobsheet warning:', e.message);
    }

    // If jobsheet is empty from Servify, generate 100% accurate template
    const isAirPods = (csr.ProductName && csr.ProductName.toLowerCase().includes('airpod')) ||
                      (csr.ProductSubCategory && csr.ProductSubCategory.toLowerCase().includes('headphone')) ||
                      (jobsheetHtml && (jobsheetHtml.includes('AIRPODS') || jobsheetHtml.includes('AirPods')));
    if (!jobsheetHtml) {
      if (isAirPods) {
        jobsheetHtml = generateAirPodsServiceRecordHtml({
          referenceId: csr.ReferenceID,
          serialNo: csr.ProductUniqueID,
          customerName: csr.Name,
          mobileNo: csr.MobileNo,
          productName: csr.ProductName,
          modelName: csr.ProductName.toUpperCase()
        });
      }
    } else {
      if (isAirPods) {
        jobsheetHtml = jobsheetHtml.replace(/>\s*NA\s*</g, '>No<');
      }
      const checklistFixStyle = `
        <style id="checklist-compact-fix">
          .checklist-div {
            display: flex !important;
            flex-direction: column !important;
            justify-content: flex-start !important;
          }
          .checklist-details-section-table {
            height: auto !important;
            width: 100% !important;
          }
          .checklist-details-section-table tr {
            height: auto !important;
          }
          .checklist-details-section-table td {
            padding: 2px 0 2px 8px !important;
            height: auto !important;
          }
        </style>
      `;
      if (!jobsheetHtml.includes('checklist-compact-fix')) {
        if (jobsheetHtml.includes('</head>')) {
          jobsheetHtml = jobsheetHtml.replace('</head>', `${checklistFixStyle}</head>`);
        } else {
          jobsheetHtml = checklistFixStyle + jobsheetHtml;
        }
      }
    }

    res.json({
      success: true,
      csr,
      jobsheetHtml
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/save-authorized-signatory — save default technician signature profile (protected)
app.post('/api/save-authorized-signatory', requireSupervisorAuth, (req, res) => {
  const { name, signatureDataUrl } = req.body;
  if (name) globalAuthorizedSignatory.name = name;
  if (signatureDataUrl) globalAuthorizedSignatory.signatureDataUrl = signatureDataUrl;

  res.json({
    success: true,
    message: 'Authorized Signatory saved',
    authorizedSignatory: globalAuthorizedSignatory
  });
});

// GET /api/get-authorized-signatory — get current technician signature profile
app.get('/api/get-authorized-signatory', (req, res) => {
  res.json({
    success: true,
    authorizedSignatory: globalAuthorizedSignatory
  });
});

// POST /api/send-signature-link — generate a unique token & link for a CSR (protected)
app.post('/api/send-signature-link', requireSupervisorAuth, async (req, res) => {
  try {
    const { csrId, referenceId, customerName, productName, mobileNo, authorizedSignatoryName, authorizedSignatureDataUrl } = req.body;
    if (!csrId && !referenceId) {
      return res.status(400).json({ success: false, error: 'csrId or referenceId required' });
    }

    const activeUser = req.supervisorSession?.username || USERNAME;
    const activePass = req.supervisorSession?.password || PASSWORD;
    const activeUploaderName = req.supervisorSession?.name || formatDisplayName(activeUser);

    await ensureSession(activeUser, activePass);

    let activeCsrId = csrId;
    let activeRefId = referenceId;
    let activeName = customerName || '';
    let activeProduct = productName || '';
    let activeMobile = mobileNo || '';

    if (!activeCsrId) {
      const listRes = await getServiceRequests(referenceId);
      const matched = (listRes.requests || []).find(r => r.ReferenceID === referenceId);
      if (matched) {
        activeCsrId = matched.ConsumerServiceRequestID;
        activeRefId = matched.ReferenceID;
        activeName = matched.Name || activeName;
        activeProduct = matched.ProductName || activeProduct;
        activeMobile = matched.MobileNo || activeMobile;
      }
    }

    let jobsheetHtml = '';
    try {
      const jRes = await fetchJobsheet(activeCsrId);
      jobsheetHtml = jRes.data || '';
    } catch (e) {
      console.warn('[Server] Could not pre-fetch jobsheet:', e.message);
    }

    if (!jobsheetHtml) {
      const isAirPods = (activeProduct && activeProduct.toLowerCase().includes('airpod'));
      if (isAirPods) {
        jobsheetHtml = generateAirPodsServiceRecordHtml({
          referenceId: activeRefId,
          customerName: activeName,
          mobileNo: activeMobile,
          productName: activeProduct,
          modelName: activeProduct.toUpperCase()
        });
      }
    }

    const activeAuthName = authorizedSignatoryName || globalAuthorizedSignatory.name || currentSessionUser?.name || 'Millan Parmar';
    const activeAuthSig = authorizedSignatureDataUrl || globalAuthorizedSignatory.signatureDataUrl;

    const token = crypto.randomBytes(20).toString('hex');
    const tokenData = {
      token,
      csrId: activeCsrId,
      referenceId: activeRefId,
      customerName: activeName,
      productName: activeProduct,
      mobileNo: activeMobile,
      jobsheetHtml,
      rawJobsheetHtml: jobsheetHtml,
      authorizedSignatoryName: activeAuthName,
      uploaderUsername: activeUser,
      uploaderPassword: activePass,
      uploaderName: activeUploaderName,
      authorizedSignatureDataUrl: null, // do NOT mark as signed until authorized signatory confirms/signs!
      customerSigned: false,
      customerSignatureUrl: null,
      customerSignedAt: null,
      agreedToTerms: false,
      authorizedSigned: false,
      authorizedSignedAt: null,
      createdAt: Date.now(),
      signed: false,
      expired: false,
      signedAt: null,
      signedJobsheetHtml: null,
      pdfFilename: null,
      servifyUploadStatus: 'pending'
    };

    signatureTokens.set(token, tokenData);

    const protocol = req.protocol;
    const requestHost = req.get('host') || `localhost:${PORT}`;
    const port = requestHost.includes(':') ? requestHost.split(':')[1] : PORT;
    const wifiIp = getLocalWifiIp();
    const bonjourHost = 'Shubham-Mac.local';

    const customerTunnelLink = publicTunnelUrl ? `${publicTunnelUrl}/sign/${token}` : null;
    const customerBonjourLink = `http://${bonjourHost}:${port}/sign/${token}`;
    const customerWifiLink = `http://${wifiIp}:${port}/sign/${token}`;
    const customerLocalLink = `http://localhost:${port}/sign/${token}`;
    const customerLink = customerTunnelLink || customerBonjourLink || customerWifiLink;

    const authorizedTunnelLink = publicTunnelUrl ? `${publicTunnelUrl}/sign-auth/${token}` : null;
    const authorizedBonjourLink = `http://${bonjourHost}:${port}/sign-auth/${token}`;
    const authorizedWifiLink = `http://${wifiIp}:${port}/sign-auth/${token}`;
    const authorizedLocalLink = `http://localhost:${port}/sign-auth/${token}`;
    const authorizedLink = authorizedTunnelLink || authorizedBonjourLink || authorizedWifiLink;

    // Prefer tunnelLink (universal for all devices/phones) > bonjourLink (Mac-to-Mac) > wifiLink (IP)
    const link = customerLink;

    let qrCodeUrl = '';
    if (QRCode) {
      try {
        qrCodeUrl = await QRCode.toDataURL(customerLink, { margin: 1, width: 220 });
      } catch (qrErr) {
        console.warn('[Server] QRCode generation failed:', qrErr.message);
      }
    }

    console.log(`[Server] Created dual signature links for #${activeRefId}:`);
    console.log(`  Customer Link:   ${customerLink}`);
    console.log(`  Authorized Link: ${authorizedLink}`);

    res.json({
      success: true,
      token,
      link: customerLink,
      customerLink,
      customerTunnelLink,
      customerWifiLink,
      customerBonjourLink,
      customerLocalLink,
      authorizedLink,
      authorizedTunnelLink,
      authorizedWifiLink,
      authorizedBonjourLink,
      authorizedLocalLink,
      tunnelLink: customerTunnelLink,
      bonjourLink: customerBonjourLink,
      wifiLink: customerWifiLink,
      localLink: customerLocalLink,
      qrCodeUrl,
      wifiIp,
      port,
      referenceId: activeRefId,
      customerName: activeName,
      productName: activeProduct,
      authorizedSignatoryName: tokenData.authorizedSignatoryName
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/network-info — get server local network, Wi-Fi IP, and Cloudflare tunnel configuration
app.get('/api/network-info', (req, res) => {
  const wifiIp = getLocalWifiIp();
  const bonjourHost = 'Shubham-Mac.local';
  res.json({
    success: true,
    wifiIp,
    bonjourHost,
    port: PORT,
    tunnelUrl: publicTunnelUrl,
    wifiUrl: `http://${wifiIp}:${PORT}`,
    bonjourUrl: `http://${bonjourHost}:${PORT}`,
    localUrl: `http://localhost:${PORT}`,
    primaryUrl: publicTunnelUrl || `http://${bonjourHost}:${PORT}`
  });
});

// GET /api/sign-data/:token — customer page loads this to get jobsheet & details
app.get('/api/sign-data/:token', (req, res) => {
  const tokenData = signatureTokens.get(req.params.token);
  if (!tokenData) {
    return res.status(404).json({ success: false, error: 'Signature link is invalid or does not exist.' });
  }

  // Once both signed, link expires automatically
  if (tokenData.signed || tokenData.expired) {
    return res.status(410).json({
      success: false,
      expired: true,
      signed: true,
      referenceId: tokenData.referenceId,
      customerName: tokenData.customerName,
      productName: tokenData.productName,
      customerSignedAt: tokenData.customerSignedAt,
      authorizedSignedAt: tokenData.authorizedSignedAt,
      signedAt: tokenData.signedAt,
      pdfUrl: tokenData.pdfFilename ? `/api/download-pdf/${tokenData.token}` : null,
      error: 'This signature link has expired. Both Customer and Authorized Signatory have completed their signatures. If a new signature is required, please ask the service center to generate a new link.'
    });
  }

  res.json({
    success: true,
    token: tokenData.token,
    referenceId: tokenData.referenceId,
    customerName: tokenData.customerName,
    productName: tokenData.productName,
    mobileNo: tokenData.mobileNo,
    customerSigned: !!tokenData.customerSigned,
    customerSignedAt: tokenData.customerSignedAt,
    customerSignatureUrl: tokenData.customerSignatureUrl,
    authorizedSigned: !!tokenData.authorizedSigned,
    authorizedSignedAt: tokenData.authorizedSignedAt,
    authorizedSignatoryName: tokenData.authorizedSignatoryName || globalAuthorizedSignatory.name || currentSessionUser?.name || 'Millan Parmar',
    hasAuthorizedSignature: !!tokenData.authorizedSignatureDataUrl,
    jobsheetHtml: tokenData.jobsheetHtml,
    signed: false,
    expired: false,
    status: tokenData.customerSigned ? 'pending_authorized_signatory' : 'pending_customer'
  });
});

// POST /api/submit-signature/:token — customer & authorized signatory submit signatures
app.post('/api/submit-signature/:token', async (req, res) => {
  const tokenData = signatureTokens.get(req.params.token);
  if (!tokenData) {
    return res.status(404).json({ success: false, error: 'Invalid or expired signature link' });
  }

  if (tokenData.signed || tokenData.expired) {
    return res.status(410).json({
      success: false,
      expired: true,
      error: 'This signature link has already been used and is expired. Please generate a new signature link to sign again.'
    });
  }

  const {
    role, // 'customer' | 'authorized'
    signatureDataUrl,
    authorizedSignatureDataUrl,
    authorizedSignatoryName,
    agreedToTerms
  } = req.body;

  // Handle Customer Signature (Step 1)
  if (role === 'customer' || (signatureDataUrl && !authorizedSignatureDataUrl)) {
    if (!signatureDataUrl) {
      return res.status(400).json({ success: false, error: 'Customer signature drawing is required' });
    }
    if (!agreedToTerms) {
      return res.status(400).json({ success: false, error: 'Terms and conditions must be accepted' });
    }

    tokenData.customerSigned = true;
    tokenData.customerSignatureUrl = signatureDataUrl;
    tokenData.customerSignedAt = new Date().toISOString();
    tokenData.agreedToTerms = true;

    // Inject customer signature into jobsheetHtml while keeping Authorized Signatory pending
    const baseHtml = tokenData.rawJobsheetHtml || tokenData.jobsheetHtml;
    tokenData.jobsheetHtml = injectSignatureIntoJobsheet(
      baseHtml,
      tokenData.customerSignatureUrl,
      tokenData.authorizedSignatureDataUrl,
      tokenData.authorizedSignatoryName,
      new Date(tokenData.customerSignedAt),
      tokenData.authorizedSignedAt ? new Date(tokenData.authorizedSignedAt) : null
    );

    // If Authorized Signatory has not signed yet, LINK REMAINS LIVE!
    if (!tokenData.authorizedSigned) {
      tokenData.signed = false;
      tokenData.expired = false;
      signatureTokens.set(req.params.token, tokenData);

      console.log(`[Server] Customer signed for #${tokenData.referenceId}. Link remains LIVE pending Authorized Signatory.`);
      return res.json({
        success: true,
        customerSigned: true,
        authorizedSigned: false,
        signed: false,
        expired: false,
        status: 'pending_authorized_signatory',
        message: 'Customer signature recorded successfully. Pending Authorized Signatory signature.',
        referenceId: tokenData.referenceId,
        jobsheetHtml: tokenData.jobsheetHtml
      });
    }
  }

  // Handle Authorized Signatory Signature (Step 2)
  if (role === 'authorized' || authorizedSignatureDataUrl) {
    if (!authorizedSignatureDataUrl) {
      return res.status(400).json({ success: false, error: 'Authorized Signatory signature drawing is required' });
    }

    tokenData.authorizedSigned = true;
    tokenData.authorizedSignatureDataUrl = authorizedSignatureDataUrl;
    tokenData.authorizedSignatoryName = authorizedSignatoryName || tokenData.authorizedSignatoryName || globalAuthorizedSignatory.name || currentSessionUser?.name || 'Millan Parmar';
    tokenData.authorizedSignedAt = new Date().toISOString();
  }

  // Check if Customer signature also provided in same payload
  if (signatureDataUrl && !tokenData.customerSigned) {
    tokenData.customerSigned = true;
    tokenData.customerSignatureUrl = signatureDataUrl;
    tokenData.customerSignedAt = new Date().toISOString();
    tokenData.agreedToTerms = !!agreedToTerms;
  }

  // If customer has NOT yet signed, authorized signatory cannot finalize
  if (!tokenData.customerSigned) {
    return res.status(400).json({
      success: false,
      error: 'Customer must agree to terms and provide signature first before authorized signatory finalizes.'
    });
  }

  // If authorized has NOT yet signed
  if (!tokenData.authorizedSigned) {
    tokenData.signed = false;
    tokenData.expired = false;
    signatureTokens.set(req.params.token, tokenData);
    return res.json({
      success: true,
      customerSigned: true,
      authorizedSigned: false,
      signed: false,
      expired: false,
      status: 'pending_authorized_signatory',
      message: 'Pending Authorized Signatory signature.',
      jobsheetHtml: tokenData.jobsheetHtml
    });
  }

  // ── BOTH PERSONS HAVE NOW SIGNED! ──
  // Link is expired on the same time and uploaded to Servify!
  try {
    const custDate = tokenData.customerSignedAt ? new Date(tokenData.customerSignedAt) : new Date();
    const authDate = tokenData.authorizedSignedAt ? new Date(tokenData.authorizedSignedAt) : new Date();

    const signedHtml = injectSignatureIntoJobsheet(
      tokenData.rawJobsheetHtml || tokenData.jobsheetHtml,
      tokenData.customerSignatureUrl,
      tokenData.authorizedSignatureDataUrl,
      tokenData.authorizedSignatoryName,
      custDate,
      authDate
    );

    tokenData.signed = true;
    tokenData.expired = true; // EXPIRED AT THE SAME TIME BOTH SIGN
    tokenData.signedAt = authDate.toISOString();
    tokenData.signedJobsheetHtml = signedHtml;
    tokenData.jobsheetHtml = signedHtml;

    // Generate actual A4 PDF
    const pdfDatePrefix = formatDateForFilename(authDate);
    const pdfFilename = `${pdfDatePrefix}_${tokenData.referenceId}_JobSheet.pdf`;
    const pdfPath = path.join(PDF_DIR, pdfFilename);

    let pdfBase64 = '';
    try {
      const pdfBuffer = await generatePDF(signedHtml);
      fs.writeFileSync(pdfPath, pdfBuffer);
      pdfBase64 = pdfBuffer.toString('base64');
      tokenData.pdfFilename = pdfFilename;
      console.log(`[Server] Generated Final PDF with BOTH signatures: ${pdfPath} (${pdfBuffer.length} bytes)`);
    } catch (pdfErr) {
      console.error('[Server] PDF generation error:', pdfErr.message);
    }

    // Auto-upload to Servify 360 strictly under the logged-in user account
    try {
      const uploaderUser = tokenData.uploaderUsername || USERNAME;
      const uploaderPass = tokenData.uploaderPassword || PASSWORD;
      const uploaderName = tokenData.uploaderName || formatDisplayName(uploaderUser);

      console.log(`[Server] Uploading document to Servify 360 strictly as logged-in user: ${uploaderUser} (${uploaderName})...`);
      await ensureSession(uploaderUser, uploaderPass, true);
      const fileBufferToUpload = fs.existsSync(pdfPath) ? fs.readFileSync(pdfPath) : Buffer.from(pdfBase64, 'base64');
      
      const uploadResult = await uploadDocument(
        tokenData.csrId,
        fileBufferToUpload,
        pdfFilename,
        {
          username: uploaderUser,
          password: uploaderPass,
          uploadedBy: uploaderName
        }
      );
      console.log(`[Server] Uploaded finalized PDF to Servify as ${uploaderName} (${uploaderUser}):`, uploadResult.status);
      tokenData.servifyUploadStatus = 'uploaded';
      tokenData.uploadResult = uploadResult.data;
      tokenData.servifyDocId = uploadResult.docID;
      tokenData.servifyFileUrl = uploadResult.fileUrl;
      tokenData.uploadedBy = uploaderName;
      tokenData.uploadedByUser = uploaderUser;
    } catch (uploadErr) {
      console.error('[Server] Servify upload error:', uploadErr.message);
      tokenData.servifyUploadStatus = 'upload_failed: ' + uploadErr.message;
    }

    signatureTokens.set(req.params.token, tokenData);

    console.log(`[Server] Record #${tokenData.referenceId} completely signed by BOTH parties. Link expired and uploaded.`);

    res.json({
      success: true,
      customerSigned: true,
      authorizedSigned: true,
      signed: true,
      expired: true,
      status: 'completed',
      message: 'Both customer and authorized signatures completed. Link expired and document uploaded to Servify 360.',
      referenceId: tokenData.referenceId,
      pdfFilename,
      pdfUrl: `/api/download-pdf/${tokenData.token}`,
      servifyUploadStatus: tokenData.servifyUploadStatus
    });
  } catch (err) {
    console.error('[Server] Finalize signature error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/download-pdf/:token — stream the generated PDF
app.get('/api/download-pdf/:token', (req, res) => {
  const tokenData = signatureTokens.get(req.params.token);
  if (!tokenData || !tokenData.pdfFilename) {
    return res.status(404).send('PDF not found or not yet signed');
  }

  const filePath = path.join(PDF_DIR, tokenData.pdfFilename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('PDF file does not exist on disk');
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${tokenData.pdfFilename}"`);
  fs.createReadStream(filePath).pipe(res);
});

// GET /api/signature-status/:token — live polling by supervisor dashboard
app.get('/api/signature-status/:token', (req, res) => {
  const tokenData = signatureTokens.get(req.params.token);
  if (!tokenData) {
    return res.status(404).json({ success: false, error: 'Token not found' });
  }
  res.json({
    success: true,
    token: tokenData.token,
    referenceId: tokenData.referenceId,
    customerSigned: !!tokenData.customerSigned,
    customerSignedAt: tokenData.customerSignedAt,
    authorizedSigned: !!tokenData.authorizedSigned,
    authorizedSignedAt: tokenData.authorizedSignedAt,
    signed: !!tokenData.signed,
    expired: !!tokenData.expired,
    signedAt: tokenData.signedAt,
    customerSignatureUrl: tokenData.customerSignatureUrl,
    authorizedSignatureDataUrl: tokenData.authorizedSignatureDataUrl,
    authorizedSignatoryName: tokenData.authorizedSignatoryName,
    pdfUrl: tokenData.pdfFilename ? `/api/download-pdf/${tokenData.token}` : null,
    servifyUploadStatus: tokenData.servifyUploadStatus,
    status: tokenData.signed ? 'completed' : (tokenData.customerSigned ? 'pending_authorized_signatory' : 'pending_customer')
  });
});

// GET /api/signed-jobsheet/:token — view the rendered signed jobsheet HTML
app.get('/api/signed-jobsheet/:token', (req, res) => {
  const tokenData = signatureTokens.get(req.params.token);
  if (!tokenData || !tokenData.signedJobsheetHtml) {
    return res.status(404).send('<h3>Service record not yet signed or token expired</h3>');
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(tokenData.signedJobsheetHtml);
});

// GET /api/tokens — list all active tokens
app.get('/api/tokens', (req, res) => {
  const list = [];
  for (const [token, data] of signatureTokens.entries()) {
    list.push({
      token,
      referenceId: data.referenceId,
      customerName: data.customerName,
      productName: data.productName,
      createdAt: new Date(data.createdAt).toISOString(),
      signed: data.signed,
      signedAt: data.signedAt,
      pdfUrl: data.pdfFilename ? `/api/download-pdf/${token}` : null,
      servifyUploadStatus: data.servifyUploadStatus
    });
  }
  res.json({ success: true, tokens: list });
});

// GET /api/airpods-reference-preview — instant 100% accurate AirPods service record preview
app.get('/api/airpods-reference-preview', (req, res) => {
  const html = generateAirPodsServiceRecordHtml({
    referenceId: req.query.refId || 'LXOEESWHLTNS',
    serialNo: req.query.serialNo || 'H6Y0HTMXMH',
    customerName: req.query.name || 'MANAV THAKKAR',
    productName: req.query.product || 'AirPods Pro 3rd Gen',
    modelName: req.query.model || 'AIRPODS PRO 3'
  });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// SPA wildcard fallback
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'sign-app/build/index.html'));
});

// ── Start Server
app.listen(PORT, '0.0.0.0', async () => {
  const wifiIp = getLocalWifiIp();
  console.log('───────────────────────────────────────────────────────');
  console.log(`[Server] Servify Live Hub listening on 0.0.0.0:${PORT}`);
  console.log(`  Local Access:   http://localhost:${PORT}`);
  console.log(`  Mac Bonjour:    http://Shubham-Mac.local:${PORT}`);
  console.log(`  Wi-Fi IP:       http://${wifiIp}:${PORT}`);
  console.log('───────────────────────────────────────────────────────');
  
  startTunnel(PORT);

  try {
    await login(USERNAME, PASSWORD);
    console.log('[Server] Connected to https://360.servify.in as', USERNAME);
  } catch (err) {
    console.warn('[Server] Initial login delayed (will retry on first request):', err.message);
  }
});
