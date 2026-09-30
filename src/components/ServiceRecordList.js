// ServiceRecordList.js
// Loads all service records from localStorage and renders them.
// Accepts a `refreshTrigger` prop — increment it from parent to force re-read.
import React, { useMemo } from 'react';
import { Box, Typography, Stack, TextField, InputAdornment } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import ServiceRecordCard from './ServiceRecordCard';

const STORAGE_KEY = 'servify_service_records';

const loadRecords = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
};

const ServiceRecordList = ({ refreshTrigger }) => {
  const [search, setSearch] = React.useState('');

  // Re-read from localStorage whenever refreshTrigger changes
  const records = useMemo(() => loadRecords(), [refreshTrigger]); // eslint-disable-line

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return records;
    return records.filter(
      (r) =>
        r.customerName?.toLowerCase().includes(q) ||
        r.deviceModel?.toLowerCase().includes(q) ||
        r.mobileNumber?.includes(q) ||
        r.technicianName?.toLowerCase().includes(q) ||
        r.repairStatus?.toLowerCase().includes(q)
    );
  }, [records, search]);

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={1} mb={2}>
        <ReceiptLongIcon color="primary" />
        <Typography variant="h5" fontWeight={700} color="primary">
          Service Records
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>
          ({records.length} total)
        </Typography>
      </Stack>

      <TextField
        fullWidth
        placeholder="Search by customer, device, technician, status…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        size="small"
        sx={{ mb: 2 }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" />
            </InputAdornment>
          ),
        }}
      />

      {filtered.length === 0 ? (
        <Box
          sx={{
            py: 6,
            textAlign: 'center',
            color: 'text.disabled',
            border: '2px dashed #dde3f5',
            borderRadius: 3,
          }}
        >
          <ReceiptLongIcon sx={{ fontSize: 48, mb: 1, opacity: 0.3 }} />
          <Typography variant="body1">
            {records.length === 0 ? 'No service records yet.' : 'No records match your search.'}
          </Typography>
        </Box>
      ) : (
        filtered.map((record) => (
          <ServiceRecordCard key={record.id} record={record} />
        ))
      )}
    </Box>
  );
};

export default ServiceRecordList;
