// ServiceRecordCard.js
// Displays a single service record with the embedded customer signature.
// The signature PNG is shown directly inside the card — no extra click needed.
import React, { useState } from 'react';
import {
  Card, CardContent, Typography, Box, Stack, Chip, Divider,
  Collapse, IconButton, Tooltip
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import BuildIcon from '@mui/icons-material/Build';
import PersonIcon from '@mui/icons-material/Person';
import PhoneIcon from '@mui/icons-material/Phone';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import GestureIcon from '@mui/icons-material/Gesture';

const STATUS_COLORS = {
  Pending: 'warning',
  'In Progress': 'info',
  Completed: 'success',
  Cancelled: 'error',
};

const ServiceRecordCard = ({ record }) => {
  const [expanded, setExpanded] = useState(false);

  const formattedDate = new Date(record.createdAt).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  return (
    <Card elevation={2} sx={{ borderRadius: 3, mb: 2, border: '1px solid #e3eaff' }}>
      <CardContent>
        {/* — Top row: name, device, status, expand button */}
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between">
          <Box flex={1}>
            <Stack direction="row" alignItems="center" spacing={1} mb={0.5}>
              <PersonIcon fontSize="small" color="primary" />
              <Typography variant="h6" fontWeight={700}>
                {record.customerName}
              </Typography>
              <Chip
                label={record.repairStatus}
                color={STATUS_COLORS[record.repairStatus] || 'default'}
                size="small"
                sx={{ fontWeight: 600 }}
              />
            </Stack>

            <Stack direction="row" spacing={2} flexWrap="wrap">
              <Stack direction="row" alignItems="center" spacing={0.5}>
                <BuildIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                <Typography variant="body2" color="text.secondary">
                  {record.deviceModel}
                  {record.serialNumber ? ` · ${record.serialNumber}` : ''}
                </Typography>
              </Stack>
              {record.mobileNumber && (
                <Stack direction="row" alignItems="center" spacing={0.5}>
                  <PhoneIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                  <Typography variant="body2" color="text.secondary">
                    {record.mobileNumber}
                  </Typography>
                </Stack>
              )}
              <Stack direction="row" alignItems="center" spacing={0.5}>
                <AccessTimeIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                <Typography variant="body2" color="text.secondary">
                  {formattedDate}
                </Typography>
              </Stack>
            </Stack>
          </Box>

          <Tooltip title={expanded ? 'Collapse' : 'Expand'}>
            <IconButton onClick={() => setExpanded((prev) => !prev)} size="small">
              {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            </IconButton>
          </Tooltip>
        </Stack>

        {/* — Always-visible: issue summary + signature preview */}
        <Typography variant="body2" sx={{ mt: 1.5, color: 'text.primary' }}>
          <strong>Issue:</strong> {record.issueDescription}
        </Typography>

        {/* Signature — always visible right in the card */}
        <Box sx={{ mt: 2 }}>
          <Stack direction="row" alignItems="center" spacing={0.5} mb={0.75}>
            <GestureIcon fontSize="small" color="secondary" />
            <Typography variant="caption" fontWeight={600} color="secondary">
              Customer Signature
            </Typography>
          </Stack>
          {record.signatureDataUrl ? (
            <Box
              sx={{
                border: '1.5px solid #d1d9f0',
                borderRadius: 2,
                backgroundColor: '#fafbff',
                p: 1,
                display: 'inline-block',
                maxWidth: '100%',
              }}
            >
              <img
                src={record.signatureDataUrl}
                alt="Customer Signature"
                style={{ display: 'block', maxWidth: '100%', height: 'auto', maxHeight: 120 }}
              />
            </Box>
          ) : (
            <Typography variant="caption" color="text.disabled">
              No signature captured
            </Typography>
          )}
        </Box>

        {/* — Collapsible: detailed info */}
        <Collapse in={expanded}>
          <Divider sx={{ my: 2 }} />
          <Stack spacing={1}>
            {record.technicianName && (
              <Typography variant="body2">
                <strong>Technician:</strong> {record.technicianName}
              </Typography>
            )}
            {record.serviceCharges !== '' && (
              <Typography variant="body2">
                <strong>Service Charges:</strong> ₹{record.serviceCharges}
              </Typography>
            )}
            <Typography variant="body2">
              <strong>Record ID:</strong>{' '}
              <Typography component="span" variant="caption" color="text.disabled">
                {record.id}
              </Typography>
            </Typography>
          </Stack>
        </Collapse>
      </CardContent>
    </Card>
  );
};

export default ServiceRecordCard;
