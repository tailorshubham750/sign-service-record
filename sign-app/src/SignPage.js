// SignPage.js — Servify Dedicated Role-Separated Signature Flow
// 1. Customer Link (/sign/:token): Customer Acknowledgement ONLY. Zero Authorized Signatory UI.
// 2. Authorized Signatory Link (/sign-auth/:token): Authorized Signatory Verification ONLY.
// When both signatures are completed -> links expire simultaneously & PDF is uploaded to Servify 360.
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import SignaturePad from 'signature_pad';
import {
  Box, Typography, Checkbox, FormControlLabel, Button,
  CircularProgress, Alert, Paper, AppBar, Toolbar,
  IconButton, Dialog, Slide, Container, TextField, Chip, Stack
} from '@mui/material';
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew';
import CloseIcon from '@mui/icons-material/Close';
import ReplayIcon from '@mui/icons-material/Replay';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import LockClockIcon from '@mui/icons-material/LockClock';
import HourglassTopIcon from '@mui/icons-material/HourglassTop';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';

const Transition = React.forwardRef(function Transition(props, ref) {
  return <Slide direction="up" ref={ref} {...props} />;
});

export default function SignPage({ role: propRole }) {
  const { token } = useParams();

  // Detect mode: Customer vs Authorized Signatory
  const isAuthMode = propRole === 'authorized' || window.location.pathname.startsWith('/sign-auth');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isExpired, setIsExpired] = useState(false);
  const [signData, setSignData] = useState(null);

  // Acknowledgement modal state
  const [ackOpen, setAckOpen] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [hasCustSignature, setHasCustSignature] = useState(false);
  const [hasAuthSignature, setHasAuthSignature] = useState(false);
  const [authSignerName, setAuthSignerName] = useState('Millan Parmar');
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  // Canvas & SignaturePad refs
  const custCanvasRef = useRef(null);
  const authCanvasRef = useRef(null);
  const custPadRef = useRef(null);
  const authPadRef = useRef(null);

  // Document preview auto-scaling refs & state (fits 100% on phone like Image 1)
  const docContainerRef = useRef(null);
  const docContentRef = useRef(null);
  const [docScale, setDocScale] = useState(1);
  const [scaledHeight, setScaledHeight] = useState('auto');

  const updateDocScale = useCallback(() => {
    if (docContainerRef.current && docContentRef.current) {
      const containerWidth = docContainerRef.current.clientWidth;
      const targetWidth = 792;
      const scale = containerWidth < targetWidth ? (containerWidth - 6) / targetWidth : 1;
      setDocScale(scale);

      const contentHeight = docContentRef.current.scrollHeight || 1180;
      setScaledHeight(Math.ceil(contentHeight * scale) + 24);
    }
  }, []);

  useEffect(() => {
    updateDocScale();
    const t1 = setTimeout(updateDocScale, 150);
    const t2 = setTimeout(updateDocScale, 450);
    const t3 = setTimeout(updateDocScale, 1000);
    window.addEventListener('resize', updateDocScale);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      window.removeEventListener('resize', updateDocScale);
    };
  }, [updateDocScale, signData]);

  // Load signature data from server
  const loadSignData = useCallback(async (isPolling = false) => {
    if (!isPolling) setLoading(true);
    try {
      const res = await fetch(`/api/sign-data/${token}`);
      const data = await res.json();

      // If already expired or both signed
      if (res.status === 410 || data.expired || (data.signed && data.expired)) {
        setIsExpired(true);
        setSignData(data);
        if (data.signed) {
          setSubmitSuccess(true);
        }
        return;
      }

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to load service record');
      }

      setSignData(data);
      if (data.authorizedSignatoryName) {
        setAuthSignerName(data.authorizedSignatoryName);
      }
      if (data.signed) {
        setSubmitSuccess(true);
        setIsExpired(true);
      }
    } catch (err) {
      if (!isPolling) setError(err.message);
    } finally {
      if (!isPolling) setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadSignData();
  }, [loadSignData]);

  // If in Authorized Signatory mode and waiting for customer to sign, poll every 3s
  useEffect(() => {
    if (isAuthMode && signData && !signData.customerSigned && !isExpired) {
      const pollTimer = setInterval(() => {
        loadSignData(true);
      }, 3000);
      return () => clearInterval(pollTimer);
    }
  }, [isAuthMode, signData, isExpired, loadSignData]);

  // Lock body scroll and pull-to-refresh completely while modal is open
  useEffect(() => {
    if (ackOpen) {
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
  }, [ackOpen]);

  // Helper to initialize or reconfigure a canvas for crisp retina DPI & SignaturePad
  const initPad = (canvas, padRef, onEndStroke) => {
    if (!canvas) return null;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const rect = canvas.getBoundingClientRect();
    const width = rect.width || (canvas.parentElement ? canvas.parentElement.clientWidth : 600);
    const height = rect.height || 220;

    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);

    if (padRef.current) {
      try { padRef.current.off(); } catch {}
    }

    const pad = new SignaturePad(canvas, {
      penColor: '#111827',
      minWidth: 1.6,
      maxWidth: 3.6,
      throttle: 0
    });

    pad.addEventListener('endStroke', onEndStroke);
    padRef.current = pad;
    return pad;
  };

  // Callback refs execute the EXACT millisecond the canvas mounts into the DOM
  const custCanvasCallback = useCallback((canvas) => {
    if (canvas) {
      custCanvasRef.current = canvas;
      initPad(canvas, custPadRef, () => {
        if (custPadRef.current) {
          setHasCustSignature(!custPadRef.current.isEmpty());
        }
      });
    }
  }, []);

  const authCanvasCallback = useCallback((canvas) => {
    if (canvas) {
      authCanvasRef.current = canvas;
      initPad(canvas, authPadRef, () => {
        if (authPadRef.current) {
          setHasAuthSignature(!authPadRef.current.isEmpty());
        }
      });
    }
  }, []);

  // When modal opens, guarantee canvas dimensions are calibrated
  useEffect(() => {
    if (ackOpen) {
      const timer = setTimeout(() => {
        if (!isAuthMode && custCanvasRef.current && (!custPadRef.current || custCanvasRef.current.width === 0)) {
          initPad(custCanvasRef.current, custPadRef, () => {
            if (custPadRef.current) setHasCustSignature(!custPadRef.current.isEmpty());
          });
        }
        if (isAuthMode && authCanvasRef.current && (!authPadRef.current || authCanvasRef.current.width === 0)) {
          initPad(authCanvasRef.current, authPadRef, () => {
            if (authPadRef.current) setHasAuthSignature(!authPadRef.current.isEmpty());
          });
        }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [ackOpen, isAuthMode]);

  const clearCustCanvas = () => {
    if (custPadRef.current) {
      custPadRef.current.clear();
    } else if (custCanvasRef.current) {
      const ctx = custCanvasRef.current.getContext('2d');
      ctx.clearRect(0, 0, custCanvasRef.current.width, custCanvasRef.current.height);
    }
    setHasCustSignature(false);
  };

  const clearAuthCanvas = () => {
    if (authPadRef.current) {
      authPadRef.current.clear();
    } else if (authCanvasRef.current) {
      const ctx = authCanvasRef.current.getContext('2d');
      ctx.clearRect(0, 0, authCanvasRef.current.width, authCanvasRef.current.height);
    }
    setHasAuthSignature(false);
  };

  // Step 1: Customer submits signature (Link remains LIVE, status: Pending Authorized Signatory)
  const handleCustomerSubmit = async () => {
    if (!agreedToTerms || !hasCustSignature) return;

    setSubmitting(true);
    try {
      let signatureDataUrl = null;
      if (custPadRef.current && !custPadRef.current.isEmpty()) {
        signatureDataUrl = custPadRef.current.toDataURL('image/png');
      } else if (custCanvasRef.current) {
        signatureDataUrl = custCanvasRef.current.toDataURL('image/png');
      }

      const res = await fetch(`/api/submit-signature/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: 'customer',
          signatureDataUrl,
          agreedToTerms: true
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to submit customer signature');
      }

      setSignData(prev => ({
        ...prev,
        customerSigned: true,
        customerSignedAt: new Date().toISOString(),
        jobsheetHtml: data.jobsheetHtml || prev.jobsheetHtml,
        status: 'pending_authorized_signatory'
      }));

      setAckOpen(false);
    } catch (err) {
      alert('Error submitting customer signature: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Step 2: Authorized Signatory submits signature (BOTH PERSONS SIGNED -> LINK EXPIRES & UPLOADS TO SERVIFY)
  const handleAuthorizedSubmit = async () => {
    if (!hasAuthSignature) return;

    setSubmitting(true);
    try {
      let authorizedSignatureDataUrl = null;
      if (authPadRef.current && !authPadRef.current.isEmpty()) {
        authorizedSignatureDataUrl = authPadRef.current.toDataURL('image/png');
      } else if (authCanvasRef.current) {
        authorizedSignatureDataUrl = authCanvasRef.current.toDataURL('image/png');
      }

      const res = await fetch(`/api/submit-signature/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: 'authorized',
          authorizedSignatureDataUrl,
          authorizedSignatoryName: authSignerName
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to submit authorized signatory signature');
      }

      setSubmitSuccess(true);
      setIsExpired(true);
      setAckOpen(false);

      setSignData(prev => ({
        ...prev,
        customerSigned: true,
        authorizedSigned: true,
        signed: true,
        expired: true,
        pdfUrl: data.pdfUrl,
        signedAt: data.signedAt,
        jobsheetHtml: data.jobsheetHtml || prev.jobsheetHtml,
        status: 'completed'
      }));
    } catch (err) {
      alert('Error submitting authorized signature: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundColor: '#5B2D8E' }}>
        <CircularProgress sx={{ color: '#fff' }} />
      </Box>
    );
  }

  // If link has expired and both parties signed
  if (isExpired && !ackOpen && (submitSuccess || signData?.signed)) {
    return (
      <Box sx={{ minHeight: '100vh', backgroundColor: '#f0f0f0', pb: 10 }}>
        <AppBar position="sticky" sx={{ backgroundColor: '#5B2D8E', boxShadow: 'none' }}>
          <Toolbar sx={{ justifyContent: 'center', position: 'relative' }}>
            <Typography variant="h6" fontWeight={600} sx={{ fontSize: '1.1rem' }}>
              Service Record — Completed
            </Typography>
            {signData?.pdfUrl && (
              <Button
                color="inherit"
                size="small"
                variant="outlined"
                startIcon={<PictureAsPdfIcon />}
                onClick={() => window.open(signData.pdfUrl, '_blank')}
                sx={{ position: 'absolute', right: 16, borderColor: 'rgba(255,255,255,0.7)', fontSize: '0.75rem' }}
              >
                PDF
              </Button>
            )}
          </Toolbar>
        </AppBar>

        <Container maxWidth="sm" sx={{ mt: 4 }}>
          <Paper elevation={3} sx={{ p: 4, textAlign: 'center', borderRadius: 3, backgroundColor: '#ffffff' }}>
            <Box
              sx={{
                width: 68,
                height: 68,
                borderRadius: '50%',
                backgroundColor: '#e8f5e9',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                mx: 'auto',
                mb: 2.5
              }}
            >
              <CheckCircleIcon sx={{ fontSize: 44, color: '#2e7d32' }} />
            </Box>

            <Typography variant="h5" fontWeight={700} color="#1b5e20" gutterBottom>
              Both Signatures Completed
            </Typography>

            <Chip
              icon={<LockClockIcon />}
              label="Signature Link Expired & Uploaded to Servify 360"
              color="success"
              sx={{ mb: 2.5, fontWeight: 600 }}
            />

            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Both Customer and Authorized Signatory have signed this Service Record. The link has expired automatically, and the official PDF is saved and uploaded to Servify 360.
            </Typography>

            {signData?.referenceId && (
              <Paper variant="outlined" sx={{ p: 2, mb: 3, backgroundColor: '#fafafa', textAlign: 'left' }}>
                <Typography variant="body2" sx={{ mb: 0.5 }}>
                  <strong>Reference ID:</strong> #{signData.referenceId}
                </Typography>
                {signData.customerName && (
                  <Typography variant="body2" sx={{ mb: 0.5 }}>
                    <strong>Customer:</strong> {signData.customerName}
                  </Typography>
                )}
                {signData.productName && (
                  <Typography variant="body2" sx={{ mb: 0.5 }}>
                    <strong>Product:</strong> {signData.productName}
                  </Typography>
                )}
                {signData.customerSignedAt && (
                  <Typography variant="body2" sx={{ mb: 0.5 }}>
                    <strong>Customer Signed:</strong> {new Date(signData.customerSignedAt).toLocaleString()}
                  </Typography>
                )}
                {signData.signedAt && (
                  <Typography variant="body2">
                    <strong>Authorized Signatory Signed:</strong> {new Date(signData.signedAt).toLocaleString()}
                  </Typography>
                )}
              </Paper>
            )}

            {signData?.pdfUrl && (
              <Button
                variant="contained"
                size="large"
                fullWidth
                startIcon={<PictureAsPdfIcon />}
                onClick={() => window.open(signData.pdfUrl, '_blank')}
                sx={{
                  backgroundColor: '#5B2D8E',
                  color: '#fff',
                  fontWeight: 600,
                  py: 1.5,
                  mb: 2,
                  '&:hover': { backgroundColor: '#4a2474' }
                }}
              >
                Download Signed PDF Record
              </Button>
            )}

            <Typography variant="caption" color="text.secondary" display="block">
              Need another copy or updated signature? Please ask the service supervisor to generate a fresh link.
            </Typography>
          </Paper>
        </Container>
      </Box>
    );
  }

  // If invalid or generic expired error
  if (error || !signData) {
    return (
      <Box sx={{ minHeight: '100vh', p: 3, display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f5f5' }}>
        <Paper sx={{ p: 4, maxWidth: 450, textAlign: 'center', borderRadius: 2 }}>
          <Typography variant="h5" fontWeight={700} color="error" gutterBottom>
            Invalid or Expired Link
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {error || 'This signature link is no longer valid or has expired.'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            If you need to sign a service record, please ask the service center to generate a new link.
          </Typography>
        </Paper>
      </Box>
    );
  }

  const isCustSigned = !!signData.customerSigned;

  return (
    <Box sx={{ minHeight: '100vh', backgroundColor: '#ffffff', pb: 10 }}>
      {/* Top Bar — matches Image 1 */}
      <AppBar position="sticky" sx={{ backgroundColor: '#5B2D8E', boxShadow: 'none' }}>
        <Toolbar sx={{ justifyContent: 'center', position: 'relative', minHeight: 56 }}>
          <IconButton edge="start" color="inherit" sx={{ position: 'absolute', left: 16 }}>
            <ArrowBackIosNewIcon fontSize="small" />
          </IconButton>
          <Typography variant="h6" fontWeight={600} sx={{ fontSize: '1.2rem', color: '#fff' }}>
            {isAuthMode ? 'Service Record — Authorized Signatory' : 'Service Record'}
          </Typography>
        </Toolbar>
      </AppBar>

      {/* Role-Specific Status Banner under Header */}
      {!isAuthMode && isCustSigned && (
        <Alert
          severity="success"
          icon={<CheckCircleIcon fontSize="inherit" />}
          sx={{
            borderRadius: 0,
            py: 1,
            px: 2,
            backgroundColor: '#e8f5e9',
            color: '#1b5e20',
            fontWeight: 500,
            fontSize: '0.85rem'
          }}
        >
          ✓ Customer Signature Recorded. The Service Record will be finalized by Authorized Signatory.
        </Alert>
      )}

      {isAuthMode && !isCustSigned && (
        <Alert
          severity="warning"
          icon={<HourglassTopIcon fontSize="inherit" />}
          sx={{
            borderRadius: 0,
            py: 1,
            px: 2,
            backgroundColor: '#fffbeb',
            color: '#b45309',
            fontWeight: 500,
            fontSize: '0.85rem'
          }}
        >
          Waiting for Customer: The customer must sign via their link first before Authorized Signatory can sign.
        </Alert>
      )}

      {isAuthMode && isCustSigned && !signData.authorizedSigned && (
        <Alert
          severity="info"
          icon={<VerifiedUserIcon fontSize="inherit" />}
          sx={{
            borderRadius: 0,
            py: 1,
            px: 2,
            backgroundColor: '#eff6ff',
            color: '#1d4ed8',
            fontWeight: 500,
            fontSize: '0.85rem'
          }}
        >
          ✓ Customer signature verified. Sign below to complete both signatures and upload to Servify 360.
        </Alert>
      )}

      {/* Main Service Record Document Display — 100% Scaled Edge-to-Edge like Image 1 */}
      <Box
        ref={docContainerRef}
        sx={{
          width: '100%',
          minHeight: scaledHeight,
          height: scaledHeight,
          overflow: 'hidden',
          position: 'relative',
          backgroundColor: '#ffffff',
          pt: 0.5
        }}
      >
        <Box
          ref={docContentRef}
          sx={{
            width: '792px',
            position: 'absolute',
            top: 2,
            left: '50%',
            transform: `translateX(-50%) scale(${docScale})`,
            transformOrigin: 'top center',
            backgroundColor: '#ffffff',
            '& table': { width: '100% !important' },
            '& img': { maxWidth: '100%' }
          }}
          dangerouslySetInnerHTML={{ __html: signData.jobsheetHtml }}
        />
      </Box>

      {/* Floating Bottom Bar */}
      {!submitSuccess && !isExpired && (
        <>
          {/* CUSTOMER MODE BOTTOM BAR */}
          {!isAuthMode && (
            isCustSigned ? (
              <Box
                sx={{
                  position: 'fixed',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  backgroundColor: '#2e7d32',
                  py: 2,
                  px: 2,
                  boxShadow: '0 -2px 10px rgba(0,0,0,0.12)',
                  zIndex: 1000,
                  textAlign: 'center',
                  userSelect: 'none'
                }}
              >
                <Typography sx={{ color: '#ffffff', fontSize: '1.15rem', fontWeight: 600 }}>
                  ✓ Customer Signature Recorded
                </Typography>
              </Box>
            ) : (
              <Box
                sx={{
                  position: 'fixed',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  backgroundColor: '#5B2D8E',
                  py: 2,
                  px: 2,
                  boxShadow: '0 -2px 10px rgba(0,0,0,0.12)',
                  zIndex: 1000,
                  cursor: 'pointer',
                  textAlign: 'center',
                  userSelect: 'none',
                  WebkitTapHighlightColor: 'transparent',
                  '&:active': { backgroundColor: '#4a2474' }
                }}
                onClick={() => setAckOpen(true)}
              >
                <Typography sx={{ color: '#ffffff', fontSize: '1.25rem', fontWeight: 600, letterSpacing: 0.3 }}>
                  Acknowledge
                </Typography>
              </Box>
            )
          )}

          {/* AUTHORIZED SIGNATORY MODE BOTTOM BAR */}
          {isAuthMode && (
            !isCustSigned ? (
              <Box
                sx={{
                  position: 'fixed',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  backgroundColor: '#9ca3af',
                  py: 2,
                  px: 2,
                  boxShadow: '0 -2px 10px rgba(0,0,0,0.12)',
                  zIndex: 1000,
                  textAlign: 'center',
                  userSelect: 'none',
                  cursor: 'not-allowed'
                }}
              >
                <Typography sx={{ color: '#ffffff', fontSize: '1.1rem', fontWeight: 600 }}>
                  Waiting for Customer to Sign First...
                </Typography>
              </Box>
            ) : (
              <Box
                sx={{
                  position: 'fixed',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  backgroundColor: '#5B2D8E',
                  py: 2,
                  px: 2,
                  boxShadow: '0 -2px 10px rgba(0,0,0,0.12)',
                  zIndex: 1000,
                  cursor: 'pointer',
                  textAlign: 'center',
                  userSelect: 'none',
                  WebkitTapHighlightColor: 'transparent',
                  '&:active': { backgroundColor: '#4a2474' }
                }}
                onClick={() => setAckOpen(true)}
              >
                <Typography sx={{ color: '#ffffff', fontSize: '1.2rem', fontWeight: 600, letterSpacing: 0.3 }}>
                  Sign as Authorized Signatory
                </Typography>
              </Box>
            )
          )}
        </>
      )}

      {/* ── MODAL 1: CUSTOMER ACKNOWLEDGEMENT DIALOG (NO TABS, ZERO MENTION OF AUTH SIGNATORY) ── */}
      {!isAuthMode && (
        <Dialog
          fullScreen
          open={ackOpen}
          onClose={() => setAckOpen(false)}
          TransitionComponent={Transition}
          sx={{
            '& .MuiPaper-root': {
              backgroundColor: '#fff',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between'
            }
          }}
        >
          <Box>
            {/* Header (Purple with ✕) */}
            <AppBar position="static" sx={{ backgroundColor: '#5B2D8E', boxShadow: 'none' }}>
              <Toolbar sx={{ justifyContent: 'center', position: 'relative' }}>
                <IconButton
                  edge="start"
                  color="inherit"
                  onClick={() => setAckOpen(false)}
                  sx={{ position: 'absolute', left: 16 }}
                >
                  <CloseIcon />
                </IconButton>
                <Typography variant="h6" fontWeight={600} sx={{ fontSize: '1.1rem' }}>
                  Service Record Acknowledgement
                </Typography>
              </Toolbar>
            </AppBar>

            <Container maxWidth="sm" sx={{ py: 3, px: 2.5 }}>
              <Typography variant="h6" fontWeight={600} sx={{ color: '#222', mb: 2 }}>
                Customer Acknowledgement
              </Typography>

              {/* Checkbox: I agree to the Terms and Conditions */}
              <FormControlLabel
                control={
                  <Checkbox
                    checked={agreedToTerms}
                    onChange={(e) => setAgreedToTerms(e.target.checked)}
                    sx={{
                      color: '#5B2D8E',
                      '&.Mui-checked': { color: '#5B2D8E' },
                      p: 0,
                      mr: 1.5
                    }}
                  />
                }
                label={
                  <Typography variant="body2" sx={{ color: '#333' }}>
                    I agree to the{' '}
                    <span style={{ color: '#5B2D8E', fontWeight: 500 }}>
                      Terms and Conditions
                    </span>
                  </Typography>
                }
                sx={{ m: 0, mb: 2.5, alignItems: 'center' }}
              />

              {/* Signature Pad Canvas Box (Screenshot 3 style) */}
              <Box
                sx={{
                  border: '1px solid #d1d5db',
                  borderRadius: 2,
                  position: 'relative',
                  overflow: 'hidden',
                  backgroundColor: '#fff',
                  height: 280,
                  display: 'flex',
                  flexDirection: 'column',
                  touchAction: 'none !important',
                  overscrollBehavior: 'none !important',
                  userSelect: 'none !important',
                  WebkitUserSelect: 'none !important',
                  WebkitTouchCallout: 'none !important'
                }}
              >
                <IconButton
                  onClick={clearCustCanvas}
                  sx={{
                    position: 'absolute',
                    top: 10,
                    right: 10,
                    color: '#1976d2',
                    backgroundColor: 'rgba(255, 255, 255, 0.9)',
                    zIndex: 10,
                    '&:hover': { backgroundColor: '#f0f0f0' }
                  }}
                >
                  <ReplayIcon />
                </IconButton>

                <canvas
                  ref={custCanvasCallback}
                  style={{
                    width: '100%',
                    height: '220px',
                    display: 'block',
                    cursor: 'crosshair',
                    touchAction: 'none'
                  }}
                />

                <Box
                  sx={{
                    backgroundColor: '#e5e7eb',
                    py: 1.5,
                    textAlign: 'center',
                    mt: 'auto',
                    pointerEvents: 'none',
                    userSelect: 'none'
                  }}
                >
                  <Typography variant="body2" sx={{ color: '#4b5563', fontWeight: 500 }}>
                    Please provide your signature
                  </Typography>
                </Box>
              </Box>
            </Container>
          </Box>

          {/* Bottom Customer Submit Button */}
          <Box sx={{ p: 2, borderTop: '1px solid #e0e0e0', backgroundColor: '#fff' }}>
            <Container maxWidth="sm">
              <Button
                fullWidth
                variant="contained"
                size="large"
                disabled={submitting || !agreedToTerms || !hasCustSignature}
                onClick={handleCustomerSubmit}
                sx={{
                  backgroundColor: '#5B2D8E',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: '1.05rem',
                  textTransform: 'none',
                  py: 1.5,
                  borderRadius: 1,
                  boxShadow: 'none',
                  '&:hover': { backgroundColor: '#4a2474' }
                }}
              >
                {submitting ? (
                  <CircularProgress size={24} sx={{ color: '#fff' }} />
                ) : (
                  'Continue & Sign Record'
                )}
              </Button>
            </Container>
          </Box>
        </Dialog>
      )}

      {/* ── MODAL 2: AUTHORIZED SIGNATORY DIALOG (ONLY FOR AUTHORIZED LINK) ── */}
      {isAuthMode && (
        <Dialog
          fullScreen
          open={ackOpen}
          onClose={() => setAckOpen(false)}
          TransitionComponent={Transition}
          sx={{
            '& .MuiPaper-root': {
              backgroundColor: '#fff',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between'
            }
          }}
        >
          <Box>
            {/* Header (Purple with ✕) */}
            <AppBar position="static" sx={{ backgroundColor: '#5B2D8E', boxShadow: 'none' }}>
              <Toolbar sx={{ justifyContent: 'center', position: 'relative' }}>
                <IconButton
                  edge="start"
                  color="inherit"
                  onClick={() => setAckOpen(false)}
                  sx={{ position: 'absolute', left: 16 }}
                >
                  <CloseIcon />
                </IconButton>
                <Typography variant="h6" fontWeight={600} sx={{ fontSize: '1.1rem' }}>
                  Authorized Signatory Verification
                </Typography>
              </Toolbar>
            </AppBar>

            <Container maxWidth="sm" sx={{ py: 3, px: 2.5 }}>
              <Typography variant="h6" fontWeight={600} sx={{ color: '#222', mb: 1 }}>
                Authorized Signatory Sign-off
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
                Pre-configured from logged-in Servify supervisor account. Sign below to complete both signatures, expire link, and upload PDF to Servify 360.
              </Typography>

              <TextField
                fullWidth
                size="small"
                label="Authorized Signatory Name"
                value={authSignerName}
                onChange={(e) => setAuthSignerName(e.target.value)}
                sx={{ mb: 2.5 }}
              />

              {/* Signature Pad Canvas Box */}
              <Box
                sx={{
                  border: '1px solid #d1d5db',
                  borderRadius: 2,
                  position: 'relative',
                  overflow: 'hidden',
                  backgroundColor: '#fff',
                  height: 260,
                  display: 'flex',
                  flexDirection: 'column',
                  touchAction: 'none !important',
                  overscrollBehavior: 'none !important',
                  userSelect: 'none !important',
                  WebkitUserSelect: 'none !important',
                  WebkitTouchCallout: 'none !important'
                }}
              >
                <IconButton
                  onClick={clearAuthCanvas}
                  sx={{
                    position: 'absolute',
                    top: 10,
                    right: 10,
                    color: '#1976d2',
                    backgroundColor: 'rgba(255, 255, 255, 0.9)',
                    zIndex: 10,
                    '&:hover': { backgroundColor: '#f0f0f0' }
                  }}
                >
                  <ReplayIcon />
                </IconButton>

                <canvas
                  ref={authCanvasCallback}
                  style={{
                    width: '100%',
                    height: '200px',
                    display: 'block',
                    cursor: 'crosshair',
                    touchAction: 'none'
                  }}
                />

                <Box
                  sx={{
                    backgroundColor: '#e5e7eb',
                    py: 1.2,
                    textAlign: 'center',
                    mt: 'auto',
                    pointerEvents: 'none',
                    userSelect: 'none'
                  }}
                >
                  <Typography variant="body2" sx={{ color: '#4b5563', fontWeight: 500 }}>
                    Draw Authorized Signatory Signature
                  </Typography>
                </Box>
              </Box>
            </Container>
          </Box>

          {/* Bottom Authorized Submit Button */}
          <Box sx={{ p: 2, borderTop: '1px solid #e0e0e0', backgroundColor: '#fff' }}>
            <Container maxWidth="sm">
              <Button
                fullWidth
                variant="contained"
                size="large"
                disabled={submitting || !hasAuthSignature}
                onClick={handleAuthorizedSubmit}
                sx={{
                  backgroundColor: '#5B2D8E',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: '1.05rem',
                  textTransform: 'none',
                  py: 1.5,
                  borderRadius: 1,
                  boxShadow: 'none',
                  '&:hover': { backgroundColor: '#4a2474' }
                }}
              >
                {submitting ? (
                  <CircularProgress size={24} sx={{ color: '#fff' }} />
                ) : (
                  'Complete Both Signatures & Upload to Servify'
                )}
              </Button>
            </Container>
          </Box>
        </Dialog>
      )}
    </Box>
  );
}
