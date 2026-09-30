// LoginPage.js — Official Servify 360 Partner Portal Login Screen
// Clean, professional username & password authentication with per-browser session isolation
import React, { useState } from 'react';
import {
  Box, Card, CardContent, Typography, TextField, Button,
  CircularProgress, Alert, InputAdornment, IconButton, Container,
  Stack, Divider
} from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';

export default function LoginPage({ onLoginSuccess, kickedOutMessage }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleManualLogin = async (e) => {
    if (e) e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError('Please enter both username and password.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          password: password.trim()
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Authentication with Servify 360 failed');
      }

      // Store per-browser session token
      if (data.sessionToken) {
        localStorage.setItem('servify_session_token', data.sessionToken);
      }

      if (onLoginSuccess) {
        onLoginSuccess(data.user, data.authorizedSignatory);
      }
    } catch (err) {
      setError(err.message || 'Unable to connect to Servify 360 server');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #3A1C59 0%, #5B2D8E 50%, #2A1145 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: 2
      }}
    >
      <Container maxWidth="xs">
        <Card
          elevation={8}
          sx={{
            borderRadius: 3,
            overflow: 'hidden',
            backgroundColor: '#ffffff'
          }}
        >
          {/* Header Banner */}
          <Box
            sx={{
              backgroundColor: '#5B2D8E',
              color: '#ffffff',
              py: 3.5,
              px: 3,
              textAlign: 'center'
            }}
          >
            <Box
              sx={{
                width: 52,
                height: 52,
                borderRadius: '50%',
                backgroundColor: 'rgba(255, 255, 255, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                mx: 'auto',
                mb: 1.5
              }}
            >
              <VerifiedUserIcon sx={{ fontSize: 32, color: '#ffffff' }} />
            </Box>
            <Typography variant="h5" fontWeight={700} sx={{ letterSpacing: 0.5 }}>
              Servify 360
            </Typography>
            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.85)', letterSpacing: 0.3 }}>
              Authorized Partner Service Portal
            </Typography>
          </Box>

          {/* Form Content */}
          <CardContent sx={{ p: { xs: 2.5, sm: 3.5 } }}>
            {kickedOutMessage && (
              <Alert severity="warning" sx={{ mb: 2.5, fontSize: '0.85rem' }}>
                {kickedOutMessage}
              </Alert>
            )}

            {error && (
              <Alert severity="error" sx={{ mb: 2.5, fontSize: '0.85rem' }}>
                {error}
              </Alert>
            )}

            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2.5, textAlign: 'center' }}>
              Sign in with your Servify supervisor or technician credentials
            </Typography>

            <form onSubmit={handleManualLogin}>
              <Stack spacing={2.5}>
                <TextField
                  fullWidth
                  label="Servify Username"
                  variant="outlined"
                  size="medium"
                  placeholder="Enter your username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={loading}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <PersonOutlineIcon sx={{ color: '#5B2D8E' }} />
                      </InputAdornment>
                    )
                  }}
                />

                <TextField
                  fullWidth
                  label="Password"
                  variant="outlined"
                  type={showPassword ? 'text' : 'password'}
                  size="medium"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <LockOutlinedIcon sx={{ color: '#5B2D8E' }} />
                      </InputAdornment>
                    ),
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          onClick={() => setShowPassword(!showPassword)}
                          edge="end"
                          size="small"
                        >
                          {showPassword ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                        </IconButton>
                      </InputAdornment>
                    )
                  }}
                />

                <Button
                  fullWidth
                  type="submit"
                  variant="contained"
                  size="large"
                  disabled={loading}
                  sx={{
                    backgroundColor: '#5B2D8E',
                    color: '#ffffff',
                    py: 1.4,
                    fontSize: '1rem',
                    fontWeight: 700,
                    textTransform: 'none',
                    borderRadius: 1.5,
                    boxShadow: '0 4px 14px rgba(91, 45, 142, 0.4)',
                    '&:hover': {
                      backgroundColor: '#472270',
                      boxShadow: '0 6px 20px rgba(91, 45, 142, 0.6)'
                    }
                  }}
                >
                  {loading ? (
                    <CircularProgress size={24} sx={{ color: '#ffffff' }} />
                  ) : (
                    'Sign In to Servify 360'
                  )}
                </Button>
              </Stack>
            </form>

            <Divider sx={{ my: 3 }} />

            <Box sx={{ textAlign: 'center' }}>
              <Typography variant="caption" color="text.secondary" display="block">
                Single-session active security enforced. Signing in from another device terminates previous sessions automatically.
              </Typography>
            </Box>
          </CardContent>
        </Card>
      </Container>
    </Box>
  );
}
