import React from 'react';
import { useLocation } from 'react-router-dom';
import { Box, Typography, Paper, Alert } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

const SuccessPage = () => {
  const { state } = useLocation();
  return (
    <Box sx={{ minHeight: '100vh', backgroundColor: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3 }}>
      <Paper elevation={2} sx={{ p: 4, borderRadius: 3, textAlign: 'center', maxWidth: 400, width: '100%' }}>
        <CheckCircleIcon sx={{ fontSize: 72, color: '#5B2D8E', mb: 2 }} />
        <Typography variant="h5" fontWeight={700} gutterBottom>
          Signature Submitted
        </Typography>
        <Typography variant="body2" color="text.secondary" mb={2}>
          Your signature has been successfully uploaded to the service record.
        </Typography>
        {state?.csrId && (
          <Alert severity="success">
            Service Request: <strong>{state.csrId}</strong>
          </Alert>
        )}
        <Typography variant="caption" color="text.disabled" display="block" mt={3}>
          You can now close this window.
        </Typography>
      </Paper>
    </Box>
  );
};

export default SuccessPage;
