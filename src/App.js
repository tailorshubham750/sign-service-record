// App.js — Servify Service Portal root
import React, { useState } from 'react';
import {
  Container, Box, AppBar, Toolbar, Typography, Stack, Tab, Tabs
} from '@mui/material';
import MiscellaneousServicesIcon from '@mui/icons-material/MiscellaneousServices';
import ServiceRecordForm from './components/ServiceRecordForm';
import ServiceRecordList from './components/ServiceRecordList';

const App = () => {
  const [tab, setTab] = useState(0);
  // Increment to force ServiceRecordList to re-read localStorage
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleRecordSaved = () => {
    setRefreshTrigger((n) => n + 1);
    // Auto-switch to Records tab after saving
    setTab(1);
  };

  return (
    <Box sx={{ minHeight: '100vh', backgroundColor: 'background.default' }}>
      {/* — Top Nav */}
      <AppBar position="sticky" elevation={1} sx={{ backgroundColor: '#fff', color: 'primary.main' }}>
        <Toolbar>
          <MiscellaneousServicesIcon sx={{ mr: 1.5 }} />
          <Typography variant="h6" fontWeight={700} sx={{ flexGrow: 1 }}>
            Servify — Service Portal
          </Typography>
          <Stack direction="row" spacing={1}>
            <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
              Powered by localStorage
            </Typography>
          </Stack>
        </Toolbar>

        {/* — Tabs */}
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          indicatorColor="primary"
          textColor="primary"
          variant="fullWidth"
          sx={{ borderTop: '1px solid #e8eef8' }}
        >
          <Tab label="New Service Record" />
          <Tab label="All Records" />
        </Tabs>
      </AppBar>

      {/* — Content */}
      <Container maxWidth="md" sx={{ pt: 4, pb: 8 }}>
        {tab === 0 && (
          <ServiceRecordForm onRecordSaved={handleRecordSaved} />
        )}
        {tab === 1 && (
          <ServiceRecordList refreshTrigger={refreshTrigger} />
        )}
      </Container>
    </Box>
  );
};

export default App;
