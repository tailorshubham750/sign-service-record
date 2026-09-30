import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { CssBaseline } from '@mui/material';
import SupervisorDashboard from './SupervisorDashboard';
import SignPage from './SignPage';
import SuccessPage from './SuccessPage';
import NotFoundPage from './NotFoundPage';

const theme = createTheme({
  palette: {
    primary: { main: '#5B2D8E' }, // Servify Purple
    secondary: { main: '#7c3aed' },
    background: { default: '#f4f6fa' },
  },
  typography: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
});

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<SupervisorDashboard />} />
          <Route path="/sign/:token" element={<SignPage role="customer" />} />
          <Route path="/sign-auth/:token" element={<SignPage role="authorized" />} />
          <Route path="/sign-success" element={<SuccessPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>
);
