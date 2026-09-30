// SupervisorDashboard.js — Servify Live Hub with Dual Signatory & PDF Download
import React, { useState, useEffect, useCallback, useRef } from 'react';
import SignaturePad from 'signature_pad';
import {
  Box, Container, AppBar, Toolbar, Typography, TextField, Button,
  Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Chip, Dialog, DialogTitle, DialogContent, DialogActions, Alert,
  CircularProgress, IconButton, Tooltip, Stack, InputAdornment, Card, CardContent
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import SendIcon from '@mui/icons-material/Send';
import VisibilityIcon from '@mui/icons-material/Visibility';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import RefreshIcon from '@mui/icons-material/Refresh';
import SyncIcon from '@mui/icons-material/Sync';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import EditIcon from '@mui/icons-material/Edit';
import ReplayIcon from '@mui/icons-material/Replay';
import LogoutIcon from '@mui/icons-material/Logout';
import PersonIcon from '@mui/icons-material/Person';
import AddLinkIcon from '@mui/icons-material/AddLink';
import WifiIcon from '@mui/icons-material/Wifi';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import LoginPage from './LoginPage';

export default function SupervisorDashboard() {
  // Session / Authentication state
  const [sessionUser, setSessionUser] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(true);

  // Network / Wi-Fi configuration
  const [networkInfo, setNetworkInfo] = useState({ wifiIp: '192.168.1.29', port: 4000 });

  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  
  // Authorized Signatory profile
  const [authSignerName, setAuthSignerName] = useState('');
  const [authSignerDataUrl, setAuthSignerDataUrl] = useState(null);
  const [authSignerDialog, setAuthSignerDialog] = useState(false);

  // Kicked out by another browser notice
  const [kickedOutMessage, setKickedOutMessage] = useState('');

  // Link generation dialog
  const [linkDialog, setLinkDialog] = useState(false);
  const [activeLinkData, setActiveLinkData] = useState(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [creatingLink, setCreatingLink] = useState(false);

  // Live status tracking for created tokens
  const [trackedTokens, setTrackedTokens] = useState({});

  // Jobsheet preview dialog
  const [jobsheetDialog, setJobsheetDialog] = useState(false);
  const [jobsheetHtml, setJobsheetHtml] = useState('');
  const [loadingJobsheet, setLoadingJobsheet] = useState(false);
  const [jobsheetTitle, setJobsheetTitle] = useState('');

  // Canvas & SignaturePad for Authorized Signatory drawing
  const authCanvasRef = useRef(null);
  const authPadRef = useRef(null);

  // Helper to attach per-browser session token to requests
  const getAuthHeaders = useCallback((extra = {}) => {
    const token = localStorage.getItem('servify_session_token') || '';
    return {
      ...extra,
      'Authorization': `Bearer ${token}`
    };
  }, []);

  // Check active Servify session for THIS browser
  const checkSession = useCallback(async (isSilent = false) => {
    try {
      if (!isSilent) setSessionLoading(true);
      const token = localStorage.getItem('servify_session_token');
      if (!token) {
        setSessionUser(null);
        return;
      }
      const res = await fetch('/api/session', {
        headers: getAuthHeaders()
      });
      const data = await res.json();
      if (data.kickedOut) {
        localStorage.removeItem('servify_session_token');
        setSessionUser(null);
        setKickedOutMessage('You were logged out because this account was logged into from another browser.');
        return;
      }
      if (data.success && data.authenticated && data.user) {
        setSessionUser(data.user);
        setKickedOutMessage('');
        if (data.user?.name) {
          setAuthSignerName(data.user.name);
        } else if (data.authorizedSignatory?.name) {
          setAuthSignerName(data.authorizedSignatory.name);
        }
        if (data.authorizedSignatory?.signatureDataUrl) {
          setAuthSignerDataUrl(data.authorizedSignatory.signatureDataUrl);
        }
      } else {
        localStorage.removeItem('servify_session_token');
        setSessionUser(null);
      }
    } catch {
      setSessionUser(null);
    } finally {
      if (!isSilent) setSessionLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    checkSession();
    fetch('/api/network-info')
      .then(r => r.json())
      .then(d => { if (d.success) setNetworkInfo(d); })
      .catch(() => {});
  }, [checkSession]);

  // Real-time heartbeat to enforce single active session (detects if another browser logged in)
  useEffect(() => {
    if (!sessionUser) return;
    const interval = setInterval(() => {
      checkSession(true);
    }, 4000);
    return () => clearInterval(interval);
  }, [sessionUser, checkSession]);

  // Fetch live requests from backend with browser auth token
  const fetchRequests = useCallback(async (query = '') => {
    setLoading(true);
    setError('');
    try {
      const url = query ? `/api/service-requests?query=${encodeURIComponent(query)}` : '/api/service-requests';
      const res = await fetch(url, { headers: getAuthHeaders() });
      const data = await res.json();
      if (data.kickedOut) {
        checkSession();
        return;
      }
      if (!res.ok || !data.success) {
        throw new Error(data.error || data.msg || 'Failed to fetch from Servify');
      }
      setRequests(data.requests || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [checkSession, getAuthHeaders]);

  // When sessionUser becomes active, fetch initial service requests
  useEffect(() => {
    if (sessionUser) {
      fetchRequests();
    }
  }, [sessionUser, fetchRequests]);

  // Handle successful login
  const handleLoginSuccess = (user, authorizedSignatory) => {
    setSessionUser(user);
    setKickedOutMessage('');
    if (authorizedSignatory?.name) {
      setAuthSignerName(authorizedSignatory.name);
    } else if (user?.name) {
      setAuthSignerName(user.name);
    }
    if (authorizedSignatory?.signatureDataUrl) {
      setAuthSignerDataUrl(authorizedSignatory.signatureDataUrl);
    }
  };

  // Handle logout strictly for this browser
  const handleLogout = async () => {
    try {
      await fetch('/api/logout', { method: 'POST', headers: getAuthHeaders() });
    } catch {}
    localStorage.removeItem('servify_session_token');
    setSessionUser(null);
    setRequests([]);
    setTrackedTokens({});
    setKickedOutMessage('');
  };

  // Polling for signature completion and expiration on active tokens
  useEffect(() => {
    const activeTokenKeys = Object.keys(trackedTokens).filter(t => !trackedTokens[t].signed && !trackedTokens[t].expired);
    if (activeTokenKeys.length === 0) return;

    const interval = setInterval(async () => {
      for (const token of activeTokenKeys) {
        try {
          const res = await fetch(`/api/signature-status/${token}`);
          const data = await res.json();
          if (data.success) {
            setTrackedTokens(prev => ({
              ...prev,
              [token]: {
                ...prev[token],
                customerSigned: !!data.customerSigned,
                customerSignedAt: data.customerSignedAt,
                authorizedSigned: !!data.authorizedSigned,
                authorizedSignedAt: data.authorizedSignedAt,
                signed: !!data.signed,
                expired: !!data.expired,
                signedAt: data.signedAt,
                customerSignatureUrl: data.customerSignatureUrl,
                authorizedSignatureDataUrl: data.authorizedSignatureDataUrl,
                pdfUrl: data.pdfUrl,
                servifyUploadStatus: data.servifyUploadStatus
              }
            }));
          }
        } catch (e) {
          console.warn('Poll error:', e.message);
        }
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [trackedTokens]);

  // Lock body scroll and pull-to-refresh while auth signer dialog is open
  useEffect(() => {
    if (authSignerDialog) {
      const origOverflow = document.body.style.overflow;
      const origTouchAction = document.body.style.touchAction;
      const origOverscroll = document.body.style.overscrollBehavior;
      document.body.style.overflow = 'hidden';
      document.body.style.touchAction = 'none';
      document.body.style.overscrollBehavior = 'none';
      return () => {
        document.body.style.overflow = origOverflow;
        document.body.style.touchAction = origTouchAction;
        document.body.style.overscrollBehavior = origOverscroll;
      };
    }
  }, [authSignerDialog]);

  // Initialize SignaturePad for Authorized Signatory profile
  const authCanvasCallback = useCallback((canvas) => {
    if (canvas) {
      authCanvasRef.current = canvas;
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      const rect = canvas.getBoundingClientRect();
      const width = rect.width || 500;
      const height = rect.height || 160;

      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      const ctx = canvas.getContext('2d');
      ctx.scale(ratio, ratio);

      if (authPadRef.current) {
        try { authPadRef.current.off(); } catch {}
      }

      authPadRef.current = new SignaturePad(canvas, {
        penColor: '#111827',
        minWidth: 1.6,
        maxWidth: 3.6,
        throttle: 0
      });
    }
  }, []);

  const clearAuthCanvas = () => {
    if (authPadRef.current) {
      authPadRef.current.clear();
    } else if (authCanvasRef.current) {
      const ctx = authCanvasRef.current.getContext('2d');
      ctx.clearRect(0, 0, authCanvasRef.current.width, authCanvasRef.current.height);
    }
  };

  const handleSaveAuthSigner = async () => {
    let sigUrl = authSignerDataUrl;
    if (authPadRef.current && !authPadRef.current.isEmpty()) {
      sigUrl = authPadRef.current.toDataURL('image/png');
      setAuthSignerDataUrl(sigUrl);
    } else if (authCanvasRef.current) {
      const dataUrl = authCanvasRef.current.toDataURL('image/png');
      const ctx = authCanvasRef.current.getContext('2d');
      const imgData = ctx.getImageData(0, 0, authCanvasRef.current.width, authCanvasRef.current.height);
      const hasPixels = imgData.data.some(c => c > 0);
      if (hasPixels) {
        sigUrl = dataUrl;
        setAuthSignerDataUrl(dataUrl);
      }
    }

    try {
      await fetch('/api/save-authorized-signatory', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          name: authSignerName,
          signatureDataUrl: sigUrl
        })
      });
    } catch {}

    setAuthSignerDialog(false);
  };

  // Generate signature link
  const handleGenerateLink = async (csr) => {
    setCreatingLink(true);
    try {
      const res = await fetch('/api/send-signature-link', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          csrId: csr.ConsumerServiceRequestID,
          referenceId: csr.ReferenceID,
          customerName: csr.Name,
          productName: csr.ProductName,
          mobileNo: csr.MobileNo,
          authorizedSignatoryName: authSignerName || sessionUser?.name,
          authorizedSignatureDataUrl: authSignerDataUrl
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to create signature link');
      }
      setActiveLinkData(data);
      setTrackedTokens(prev => ({
        ...prev,
        [data.token]: {
          token: data.token,
          referenceId: data.referenceId,
          customerName: data.customerName,
          productName: data.productName,
          link: data.link,
          customerLink: data.customerLink || data.link,
          customerWifiLink: data.customerWifiLink,
          authorizedLink: data.authorizedLink,
          authorizedWifiLink: data.authorizedWifiLink,
          signed: false,
          expired: false,
          csr
        }
      }));
      setLinkDialog(true);
    } catch (err) {
      alert('Error creating link: ' + err.message);
    } finally {
      setCreatingLink(false);
    }
  };

  // Re-generate a fresh signature link for an expired or previously signed record
  const handleRegenerateLink = async (item) => {
    if (item.csr) {
      await handleGenerateLink(item.csr);
    } else {
      const dummyCsr = {
        ReferenceID: item.referenceId,
        Name: item.customerName,
        ProductName: item.productName
      };
      await handleGenerateLink(dummyCsr);
    }
  };

  // View Service Record Jobsheet HTML
  const handleViewJobsheet = async (csr) => {
    setJobsheetTitle(`Service Record — #${csr.ReferenceID}`);
    setJobsheetDialog(true);
    setLoadingJobsheet(true);
    setJobsheetHtml('');
    try {
      const res = await fetch(`/api/service-request/${csr.ReferenceID}`, {
        headers: getAuthHeaders()
      });
      const data = await res.json();
      if (data.jobsheetHtml) {
        setJobsheetHtml(data.jobsheetHtml);
      } else {
        setJobsheetHtml('<p style="padding: 20px;">No jobsheet HTML available</p>');
      }
    } catch (err) {
      setJobsheetHtml(`<p style="color: red; padding: 20px;">Error: ${err.message}</p>`);
    } finally {
      setLoadingJobsheet(false);
    }
  };

  // View signed HTML from token
  const handleViewSignedJobsheet = async (token, refId) => {
    setJobsheetTitle(`Signed Service Record — #${refId}`);
    setJobsheetDialog(true);
    setLoadingJobsheet(true);
    setJobsheetHtml('');
    try {
      const res = await fetch(`/api/view-jobsheet/${token}`);
      const html = await res.text();
      setJobsheetHtml(html);
    } catch (err) {
      setJobsheetHtml(`<p style="color: red; padding: 20px;">Error: ${err.message}</p>`);
    } finally {
      setLoadingJobsheet(false);
    }
  };

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  // If session is still loading, show spinner
  if (sessionLoading) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundColor: '#5B2D8E' }}>
        <CircularProgress sx={{ color: '#fff' }} />
      </Box>
    );
  }

  // If no active session, render the Servify Login Page
  if (!sessionUser) {
    return <LoginPage onLoginSuccess={handleLoginSuccess} kickedOutMessage={kickedOutMessage} />;
  }

  return (
    <Box sx={{ minHeight: '100vh', backgroundColor: '#f0f4f8' }}>
      {/* Top Header */}
      <AppBar position="static" sx={{ backgroundColor: '#5B2D8E' }}>
        <Toolbar>
          <Typography variant="h6" fontWeight={700} sx={{ flexGrow: 1, letterSpacing: 0.3 }}>
            Servify 360 — Service Record & Customer Signature Hub
          </Typography>

          {/* Wi-Fi Local Network Badge */}
          <Tooltip title="Click to copy Wi-Fi access address. Anyone on the same Wi-Fi can open this link!">
            <Chip
              icon={<WifiIcon sx={{ color: '#fff !important' }} />}
              label={`Wi-Fi: http://${networkInfo?.wifiIp || '192.168.1.29'}:${networkInfo?.port || 4000}`}
              onClick={() => handleCopy(`http://${networkInfo?.wifiIp || '192.168.1.29'}:${networkInfo?.port || 4000}`)}
              sx={{
                backgroundColor: 'rgba(255,255,255,0.22)',
                color: '#fff',
                fontWeight: 600,
                cursor: 'pointer',
                mr: 2,
                '&:hover': { backgroundColor: 'rgba(255,255,255,0.35)' }
              }}
            />
          </Tooltip>

          {/* Logged in account display */}
          <Chip
            icon={<PersonIcon sx={{ color: '#fff !important' }} />}
            label={`Logged In: ${sessionUser.name}`}
            sx={{
              backgroundColor: 'rgba(255,255,255,0.18)',
              color: '#fff',
              fontWeight: 600,
              mr: 2
            }}
          />

          {/* Authorized Signatory Configuration */}
          <Button
            color="inherit"
            variant="outlined"
            size="small"
            startIcon={<EditIcon />}
            onClick={() => setAuthSignerDialog(true)}
            sx={{ borderColor: 'rgba(255,255,255,0.7)', mr: 2, textTransform: 'none' }}
          >
            Signatory: {authSignerName}
          </Button>

          {/* Logout Button */}
          <Button
            color="inherit"
            variant="outlined"
            size="small"
            startIcon={<LogoutIcon />}
            onClick={handleLogout}
            sx={{ borderColor: 'rgba(255,255,255,0.7)', mr: 2, textTransform: 'none' }}
          >
            Logout
          </Button>

          <IconButton color="inherit" onClick={() => fetchRequests(searchTerm)} title="Refresh">
            <RefreshIcon />
          </IconButton>
        </Toolbar>
      </AppBar>

      <Container maxWidth="xl" sx={{ py: 4 }}>
        {/* Active Signing Trackers */}
        {Object.keys(trackedTokens).length > 0 && (
          <Box sx={{ mb: 4 }}>
            <Typography variant="subtitle1" fontWeight={700} sx={{ color: '#5B2D8E', mb: 1 }}>
              Active Signature Links & Live Acknowledgment Status:
            </Typography>
            <Stack direction="row" spacing={2} flexWrap="wrap">
              {Object.entries(trackedTokens).map(([token, item]) => {
                const isCompleted = item.signed || item.expired;
                const isPendingAuth = item.customerSigned && !item.authorizedSigned && !isCompleted;

                let cardBorder = '2px solid #ed6c02';
                if (isCompleted) cardBorder = '2px solid #2e7d32';
                else if (isPendingAuth) cardBorder = '2px solid #0284c7';

                return (
                  <Card
                    key={token}
                    sx={{
                      minWidth: 340,
                      maxWidth: 420,
                      border: cardBorder,
                      borderRadius: 2,
                      mb: 2
                    }}
                  >
                    <CardContent sx={{ pb: '12px !important' }}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography variant="h6" fontWeight={700}>
                          #{item.referenceId}
                        </Typography>
                        {isCompleted ? (
                          <Chip icon={<CheckCircleIcon />} label="Both Signed & Expired" color="success" size="small" />
                        ) : isPendingAuth ? (
                          <Chip icon={<SyncIcon className="spin" />} label="Step 2: Pending Auth Signatory" sx={{ backgroundColor: '#e0f2fe', color: '#0369a1', fontWeight: 600 }} size="small" />
                        ) : (
                          <Chip icon={<SyncIcon className="spin" />} label="Step 1: Awaiting Customer" color="warning" size="small" />
                        )}
                      </Stack>
                      
                      {isCompleted ? (
                        <Box sx={{ mt: 1.5 }}>
                          <Typography variant="caption" color="text.secondary" display="block">
                            {item.signedAt ? `Both signed at: ${new Date(item.signedAt).toLocaleTimeString()}` : 'Both signatures complete. Link expired automatically.'}
                          </Typography>
                          {item.customerSignatureUrl && (
                            <Box sx={{ my: 1, p: 0.5, border: '1px solid #ccc', borderRadius: 1, backgroundColor: '#fff', display: 'inline-block' }}>
                              <img src={item.customerSignatureUrl} alt="Signature" style={{ maxHeight: 36, maxWidth: 140, display: 'block' }} />
                            </Box>
                          )}
                          <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap', gap: 1 }}>
                            <Button
                              variant="outlined"
                              size="small"
                              sx={{ color: '#5B2D8E', borderColor: '#5B2D8E' }}
                              onClick={() => handleViewSignedJobsheet(token, item.referenceId)}
                            >
                              View HTML
                            </Button>
                            {item.pdfUrl && (
                              <Button
                                variant="contained"
                                size="small"
                                startIcon={<PictureAsPdfIcon />}
                                sx={{ backgroundColor: '#2e7d32' }}
                                onClick={() => window.open(item.pdfUrl, '_blank')}
                              >
                                PDF
                              </Button>
                            )}
                            <Button
                              variant="contained"
                              size="small"
                              startIcon={<ReplayIcon />}
                              sx={{ backgroundColor: '#5B2D8E' }}
                              onClick={() => handleRegenerateLink(item)}
                            >
                              Generate New Link
                            </Button>
                          </Stack>
                        </Box>
                      ) : (
                        <Box sx={{ mt: 1.5 }}>
                          {/* 1. Customer Signature Link */}
                          <Paper variant="outlined" sx={{ p: 1.5, mb: 1.5, backgroundColor: '#fcfcfc', borderRadius: 1.5 }}>
                            <Typography variant="caption" sx={{ fontWeight: 700, color: '#1f2937', display: 'block', mb: 0.5 }}>
                              1. Customer Signature Link (Customer Only):
                            </Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all', display: 'block', mb: 1, fontFamily: 'monospace' }}>
                              {item.customerWifiLink || item.customerLink || item.link}
                            </Typography>
                            <Stack direction="row" spacing={1}>
                              <Button size="small" variant="outlined" onClick={() => handleCopy(item.customerWifiLink || item.customerLink || item.link)}>
                                Copy Customer Link
                              </Button>
                              <Button
                                size="small"
                                variant="contained"
                                endIcon={<OpenInNewIcon />}
                                sx={{ backgroundColor: '#5B2D8E', textTransform: 'none' }}
                                onClick={() => window.open(item.customerWifiLink || item.customerLink || item.link, '_blank')}
                              >
                                Open Customer Link
                              </Button>
                            </Stack>
                          </Paper>

                          {/* 2. Authorized Signatory Link */}
                          <Paper variant="outlined" sx={{ p: 1.5, backgroundColor: '#fdf4ff', borderColor: '#f0abfc', borderRadius: 1.5 }}>
                            <Typography variant="caption" sx={{ fontWeight: 700, color: '#701a75', display: 'block', mb: 0.5 }}>
                              2. Authorized Signatory Link (Supervisor / Tech Only):
                            </Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all', display: 'block', mb: 1, fontFamily: 'monospace' }}>
                              {item.authorizedWifiLink || item.authorizedLink || (item.link ? item.link.replace('/sign/', '/sign-auth/') : '')}
                            </Typography>
                            <Stack direction="row" spacing={1}>
                              <Button
                                size="small"
                                variant="outlined"
                                sx={{ color: '#701a75', borderColor: '#701a75' }}
                                onClick={() => handleCopy(item.authorizedWifiLink || item.authorizedLink || (item.link ? item.link.replace('/sign/', '/sign-auth/') : ''))}
                              >
                                Copy Auth Link
                              </Button>
                              <Button
                                size="small"
                                variant="contained"
                                endIcon={<OpenInNewIcon />}
                                sx={{ backgroundColor: isPendingAuth ? '#0284c7' : '#701a75', textTransform: 'none' }}
                                onClick={() => window.open(item.authorizedWifiLink || item.authorizedLink || (item.link ? item.link.replace('/sign/', '/sign-auth/') : ''), '_blank')}
                              >
                                {isPendingAuth ? 'Sign as Auth Signatory' : 'Open Auth Link'}
                              </Button>
                            </Stack>
                          </Paper>

                          <Typography variant="caption" sx={{ color: isPendingAuth ? '#0369a1' : '#ed6c02', display: 'block', mt: 1, fontWeight: 500 }}>
                            {isPendingAuth
                              ? '✓ Customer signed. Link is LIVE awaiting Authorized Signatory signature on Link 2.'
                              : '* Customer must sign Link 1 first. Authorized Signatory signs Link 2 to expire both & upload PDF.'}
                          </Typography>
                        </Box>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </Stack>
          </Box>
        )}

        {/* Search Bar */}
        <Paper sx={{ p: 2, mb: 3, borderRadius: 2 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
            <TextField
              fullWidth
              size="small"
              placeholder="Search by Reference ID (e.g. D57GG3ZT7ARU, HPHDPZXLCXTQ), Customer Name, or Serial No..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && fetchRequests(searchTerm)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon color="action" />
                  </InputAdornment>
                ),
              }}
            />
            <Button
              variant="contained"
              sx={{ minWidth: 120, backgroundColor: '#5B2D8E', height: 40 }}
              onClick={() => fetchRequests(searchTerm)}
            >
              Search
            </Button>
          </Stack>
        </Paper>

        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
          </Alert>
        )}

        {/* Requests Table */}
        <Paper sx={{ borderRadius: 2, overflow: 'hidden' }}>
          <Box sx={{ p: 2, backgroundColor: '#fafafa', borderBottom: '1px solid #e0e0e0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="subtitle1" fontWeight={700}>
              Live Service Records from Servify ({requests.length})
            </Typography>
            {loading && <CircularProgress size={20} />}
          </Box>

          <TableContainer sx={{ maxHeight: 600 }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>Reference ID</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Customer Name</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Device / Product</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Serial / IMEI</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Date</TableCell>
                  <TableCell sx={{ fontWeight: 700, textAlign: 'center' }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {requests.length === 0 && !loading ? (
                  <TableRow>
                    <TableCell colSpan={7} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                      No service records found.
                    </TableCell>
                  </TableRow>
                ) : (
                  requests.map((csr) => {
                    const isTarget = csr.ReferenceID === 'D57GG3ZT7ARU' || csr.ReferenceID === 'HPHDPZXLCXTQ';
                    return (
                      <TableRow
                        key={csr.ConsumerServiceRequestID || csr.ReferenceID}
                        sx={{
                          backgroundColor: isTarget ? '#f3e8ff' : 'inherit',
                          '&:hover': { backgroundColor: isTarget ? '#ede9fe' : '#f9f9f9' }
                        }}
                      >
                        <TableCell>
                          <Typography variant="body2" fontWeight={700} color={isTarget ? '#5B2D8E' : 'inherit'}>
                            #{csr.ReferenceID}
                          </Typography>
                          {isTarget && (
                            <Chip label="Target Record" size="small" color="secondary" sx={{ height: 20, fontSize: '0.7rem' }} />
                          )}
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">{csr.Name || '—'}</Typography>
                          <Typography variant="caption" color="text.secondary">{csr.MobileNo || ''}</Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" fontWeight={500}>{csr.ProductName || '—'}</Typography>
                          <Typography variant="caption" color="text.secondary">{csr.Type || ''}</Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                            {csr.ProductUniqueID || csr.AlternateUniqueKey || '—'}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={csr.Status || 'Open'}
                            size="small"
                            color={csr.Status?.includes('accept') ? 'success' : 'default'}
                            sx={{ fontWeight: 600 }}
                          />
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption">
                            {csr.CreatedDate ? new Date(csr.CreatedDate).toLocaleDateString() : '—'}
                          </Typography>
                        </TableCell>
                        <TableCell align="center">
                          <Stack direction="row" spacing={1} justifyContent="center">
                            <Tooltip title="Send Customer Signature Link (Valid until Continue & Sign)">
                              <Button
                                variant="contained"
                                size="small"
                                startIcon={<SendIcon />}
                                disabled={creatingLink}
                                sx={{ backgroundColor: '#5B2D8E', fontSize: '0.75rem', textTransform: 'none' }}
                                onClick={() => handleGenerateLink(csr)}
                              >
                                Sign Link
                              </Button>
                            </Tooltip>
                            <Tooltip title="View Service Record (Jobsheet)">
                              <IconButton size="small" onClick={() => handleViewJobsheet(csr)}>
                                <VisibilityIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </Stack>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      </Container>

      {/* Authorized Signatory Setup Dialog */}
      <Dialog open={authSignerDialog} onClose={() => setAuthSignerDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ backgroundColor: '#5B2D8E', color: '#fff', fontWeight: 700 }}>
          Authorized Signatory Signature Setup
        </DialogTitle>
        <DialogContent sx={{ pt: 3 }}>
          <TextField
            fullWidth
            label="Authorized Signatory Name"
            value={authSignerName}
            onChange={e => setAuthSignerName(e.target.value)}
            helperText="Appears below the Authorized Signatory line on the Service Record (defaults to logged-in Servify account)"
            sx={{ my: 2 }}
          />

          <Typography variant="subtitle2" fontWeight={600} gutterBottom>
            Draw Authorized Signatory Signature:
          </Typography>
          <Box
            sx={{
              border: '1px solid #ccc',
              borderRadius: 2,
              position: 'relative',
              backgroundColor: '#fff',
              overflow: 'hidden',
              touchAction: 'none !important',
              overscrollBehavior: 'none !important',
              userSelect: 'none !important',
              WebkitUserSelect: 'none !important',
              WebkitTouchCallout: 'none !important'
            }}
          >
            <IconButton
              onClick={clearAuthCanvas}
              size="small"
              sx={{ position: 'absolute', top: 8, right: 8, zIndex: 10, backgroundColor: 'rgba(255,255,255,0.8)' }}
            >
              <ReplayIcon fontSize="small" />
            </IconButton>
            <canvas
              ref={authCanvasCallback}
              style={{
                width: '100%',
                height: '160px',
                display: 'block',
                cursor: 'crosshair',
                touchAction: 'none'
              }}
            />
          </Box>
          {authSignerDataUrl && (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
              Current signature saved. Draw above and save to update.
            </Typography>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setAuthSignerDialog(false)}>Cancel</Button>
          <Button variant="contained" sx={{ backgroundColor: '#5B2D8E' }} onClick={handleSaveAuthSigner}>
            Save Signature Profile
          </Button>
        </DialogActions>
      </Dialog>

      {/* Link Dialog */}
      <Dialog open={linkDialog} onClose={() => setLinkDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ backgroundColor: '#5B2D8E', color: '#fff', fontWeight: 700 }}>
          Dual Signature Links Generated
        </DialogTitle>
        <DialogContent sx={{ pt: 3 }}>
          {copySuccess && <Alert severity="success" sx={{ mb: 2 }}>Link copied to clipboard!</Alert>}

          {/* Section 1: Customer Signature Link */}
          <Paper variant="outlined" sx={{ p: 2, mb: 2.5, backgroundColor: '#fcfcfc', borderRadius: 2, borderColor: '#cbd5e1' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#1f2937', mb: 0.5 }}>
              1. Customer Signature Link (For Customer Only):
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
              Authorized Signatory is completely hidden on this link. Customer can only sign the customer acknowledgement section.
            </Typography>

            {/* QR Code for instant phone camera scanning over Wi-Fi */}
            {activeLinkData?.qrCodeUrl && (
              <Box sx={{ textAlign: 'center', my: 1.5 }}>
                <Paper variant="outlined" sx={{ p: 1, display: 'inline-block', backgroundColor: '#fff', borderRadius: 2 }}>
                  <img src={activeLinkData.qrCodeUrl} alt="Scan QR Code" style={{ width: 160, height: 160, display: 'block' }} />
                </Paper>
                <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: '#374151', fontWeight: 600 }}>
                  Point customer's phone camera to scan & open directly
                </Typography>
              </Box>
            )}

            <Paper variant="outlined" sx={{ p: 1.5, my: 1, backgroundColor: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Box sx={{ mr: 1, overflow: 'hidden' }}>
                <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all', fontWeight: 600, color: '#5B2D8E', fontSize: '0.85rem' }}>
                  {activeLinkData?.customerWifiLink || activeLinkData?.customerLink || activeLinkData?.link}
                </Typography>
              </Box>
              <IconButton onClick={() => handleCopy(activeLinkData?.customerWifiLink || activeLinkData?.customerLink || activeLinkData?.link)} color="primary">
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </Paper>

            <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
              <Button
                variant="outlined"
                size="small"
                onClick={() => handleCopy(activeLinkData?.customerWifiLink || activeLinkData?.customerLink || activeLinkData?.link)}
                sx={{ textTransform: 'none' }}
              >
                Copy Customer Link
              </Button>
              <Button
                variant="contained"
                size="small"
                endIcon={<OpenInNewIcon />}
                sx={{ backgroundColor: '#5B2D8E', textTransform: 'none' }}
                onClick={() => window.open(activeLinkData?.customerWifiLink || activeLinkData?.customerLink || activeLinkData?.link, '_blank')}
              >
                Open Customer View
              </Button>
            </Stack>
          </Paper>

          {/* Section 2: Authorized Signatory Link */}
          <Paper variant="outlined" sx={{ p: 2, mb: 2, backgroundColor: '#fdf4ff', borderRadius: 2, borderColor: '#f0abfc' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#701a75', mb: 0.5 }}>
              2. Authorized Signatory Link (Supervisor / Technician Only):
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
              Dedicated link for Authorized Signatory ({activeLinkData?.authorizedSignatoryName || authSignerName}). Open after customer has signed to finalize and upload PDF.
            </Typography>

            <Paper variant="outlined" sx={{ p: 1.5, my: 1, backgroundColor: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Box sx={{ mr: 1, overflow: 'hidden' }}>
                <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all', fontWeight: 600, color: '#701a75', fontSize: '0.85rem' }}>
                  {activeLinkData?.authorizedWifiLink || activeLinkData?.authorizedLink || (activeLinkData?.link ? activeLinkData.link.replace('/sign/', '/sign-auth/') : '')}
                </Typography>
              </Box>
              <IconButton onClick={() => handleCopy(activeLinkData?.authorizedWifiLink || activeLinkData?.authorizedLink || (activeLinkData?.link ? activeLinkData.link.replace('/sign/', '/sign-auth/') : ''))} sx={{ color: '#701a75' }}>
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </Paper>

            <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
              <Button
                variant="outlined"
                size="small"
                onClick={() => handleCopy(activeLinkData?.authorizedWifiLink || activeLinkData?.authorizedLink || (activeLinkData?.link ? activeLinkData.link.replace('/sign/', '/sign-auth/') : ''))}
                sx={{ color: '#701a75', borderColor: '#701a75', textTransform: 'none' }}
              >
                Copy Auth Link
              </Button>
              <Button
                variant="contained"
                size="small"
                endIcon={<OpenInNewIcon />}
                sx={{ backgroundColor: '#701a75', '&:hover': { backgroundColor: '#581c87' }, textTransform: 'none' }}
                onClick={() => window.open(activeLinkData?.authorizedWifiLink || activeLinkData?.authorizedLink || (activeLinkData?.link ? activeLinkData.link.replace('/sign/', '/sign-auth/') : ''), '_blank')}
              >
                Open & Sign as Authorized Signatory
              </Button>
            </Stack>
          </Paper>

          <Box sx={{ p: 1.5, border: '1px solid #e2e8f0', borderRadius: 1.5, backgroundColor: '#f8fafc' }}>
            <Typography variant="caption" sx={{ color: '#0369a1', display: 'block', fontWeight: 600 }}>
              • Flow: Customer signs on Link 1 first (link remains live) $\to$ Supervisor/Tech signs on Link 2 $\to$ Both signatures complete $\to$ Both links expire simultaneously & PDF uploads to Servify 360 automatically.
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setLinkDialog(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Jobsheet Preview Dialog */}
      <Dialog open={jobsheetDialog} onClose={() => setJobsheetDialog(false)} maxWidth="lg" fullWidth>
        <DialogTitle sx={{ backgroundColor: '#5B2D8E', color: '#fff', fontWeight: 700, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{jobsheetTitle}</span>
          <IconButton size="small" onClick={() => setJobsheetDialog(false)} sx={{ color: '#fff' }}>
            ✕
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 0 }}>
          {loadingJobsheet ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', p: 8 }}>
              <CircularProgress />
            </Box>
          ) : (
            <Box
              dangerouslySetInnerHTML={{ __html: jobsheetHtml }}
              sx={{
                p: 2,
                backgroundColor: '#fff',
                '& table': { width: '100% !important' },
                '& img': { maxWidth: '100%' }
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </Box>
  );
}
