import React from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { CssBaseline } from '@mui/material';
import App from './App';

const theme = createTheme({
  palette: {
    primary: { main: '#1976d2' },
    secondary: { main: '#7c3aed' },
    background: { default: '#f0f4ff' },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", sans-serif',
  },
});

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
