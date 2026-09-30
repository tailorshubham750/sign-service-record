import React from 'react';
import { Box, Typography } from '@mui/material';
const NotFoundPage = () => (
  <Box sx={{ textAlign: 'center', mt: 10, p: 3 }}>
    <Typography variant="h4" fontWeight={700} color="primary">¯\_(ツ)_/¯</Typography>
    <Typography variant="body1" color="text.secondary" mt={2}>
      This link is invalid or has already been used.
    </Typography>
  </Box>
);
export default NotFoundPage;
