// ServiceRecordForm.js
// Form to create a new service record with Customer Signature integration.
// On submit → saves to localStorage and triggers onRecordSaved callback.
import React, { useState } from 'react';
import {
  Box, TextField, Typography, Button, Stack, Divider,
  FormControl, InputLabel, Select, MenuItem, Alert, Paper
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import SignaturePad from './SignaturePad';
import { v4 as uuidv4 } from 'uuid';

const STORAGE_KEY = 'servify_service_records';

const STATUS_OPTIONS = ['Pending', 'In Progress', 'Completed', 'Cancelled'];

const emptyForm = {
  customerName: '',
  mobileNumber: '',
  deviceModel: '',
  serialNumber: '',
  issueDescription: '',
  technicianName: '',
  serviceCharges: '',
  repairStatus: 'Pending',
};

const loadRecords = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
};

const saveRecords = (records) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
};

const ServiceRecordForm = ({ onRecordSaved }) => {
  const [form, setForm] = useState(emptyForm);
  const [signatureDataUrl, setSignatureDataUrl] = useState(null);
  const [signatureConfirmed, setSignatureConfirmed] = useState(false);
  const [errors, setErrors] = useState({});
  const [successMsg, setSuccessMsg] = useState('');

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: '' }));
  };

  const handleSignatureSave = (dataUrl) => {
    setSignatureDataUrl(dataUrl);
    setSignatureConfirmed(true);
  };

  const handleSignatureClear = () => {
    setSignatureDataUrl(null);
    setSignatureConfirmed(false);
  };

  const validate = () => {
    const newErrors = {};
    if (!form.customerName.trim()) newErrors.customerName = 'Customer name is required.';
    if (!form.deviceModel.trim()) newErrors.deviceModel = 'Device model is required.';
    if (!form.issueDescription.trim()) newErrors.issueDescription = 'Issue description is required.';
    if (!signatureConfirmed) newErrors.signature = 'Customer signature is required before saving.';
    return newErrors;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    const record = {
      id: uuidv4(),
      createdAt: new Date().toISOString(),
      ...form,
      signatureDataUrl, // embedded PNG as base64
    };

    const existing = loadRecords();
    saveRecords([record, ...existing]);

    setSuccessMsg(`Service record for "${form.customerName}" saved successfully.`);
    setForm(emptyForm);
    setSignatureDataUrl(null);
    setSignatureConfirmed(false);
    setErrors({});

    if (onRecordSaved) onRecordSaved(record);

    // clear success banner after 4s
    setTimeout(() => setSuccessMsg(''), 4000);
  };

  return (
    <Paper elevation={2} sx={{ p: 3, borderRadius: 3, mb: 4 }}>
      <Typography variant="h5" fontWeight={700} gutterBottom color="primary">
        New Service Record
      </Typography>
      <Divider sx={{ mb: 3 }} />

      {successMsg && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {successMsg}
        </Alert>
      )}

      <Box component="form" onSubmit={handleSubmit}>
        {/* — Customer Info */}
        <Typography variant="subtitle1" fontWeight={600} color="text.secondary" mb={1}>
          Customer Info
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} mb={2}>
          <TextField
            fullWidth
            label="Customer Name"
            name="customerName"
            value={form.customerName}
            onChange={handleChange}
            error={Boolean(errors.customerName)}
            helperText={errors.customerName}
            required
          />
          <TextField
            fullWidth
            label="Mobile Number"
            name="mobileNumber"
            value={form.mobileNumber}
            onChange={handleChange}
            inputProps={{ maxLength: 10 }}
          />
        </Stack>

        {/* — Device Info */}
        <Typography variant="subtitle1" fontWeight={600} color="text.secondary" mb={1}>
          Device Info
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} mb={2}>
          <TextField
            fullWidth
            label="Device Model"
            name="deviceModel"
            value={form.deviceModel}
            onChange={handleChange}
            error={Boolean(errors.deviceModel)}
            helperText={errors.deviceModel}
            required
          />
          <TextField
            fullWidth
            label="Serial Number"
            name="serialNumber"
            value={form.serialNumber}
            onChange={handleChange}
          />
        </Stack>

        <TextField
          fullWidth
          label="Issue Description"
          name="issueDescription"
          value={form.issueDescription}
          onChange={handleChange}
          error={Boolean(errors.issueDescription)}
          helperText={errors.issueDescription}
          multiline
          rows={3}
          required
          sx={{ mb: 2 }}
        />

        {/* — Service Info */}
        <Typography variant="subtitle1" fontWeight={600} color="text.secondary" mb={1}>
          Service Info
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} mb={3}>
          <TextField
            fullWidth
            label="Technician Name"
            name="technicianName"
            value={form.technicianName}
            onChange={handleChange}
          />
          <TextField
            fullWidth
            label="Service Charges (₹)"
            name="serviceCharges"
            value={form.serviceCharges}
            onChange={handleChange}
            type="number"
            inputProps={{ min: 0 }}
          />
          <FormControl fullWidth>
            <InputLabel id="status-label">Repair Status</InputLabel>
            <Select
              labelId="status-label"
              name="repairStatus"
              value={form.repairStatus}
              onChange={handleChange}
              label="Repair Status"
            >
              {STATUS_OPTIONS.map((s) => (
                <MenuItem key={s} value={s}>{s}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>

        {/* — Signature Section */}
        <Divider sx={{ mb: 3 }} />
        <SignaturePad
          onSave={handleSignatureSave}
          onClear={handleSignatureClear}
          disabled={false}
        />

        {signatureConfirmed && (
          <Alert severity="success" sx={{ mt: 1.5, mb: 1 }}>
            ✓ Signature captured — will be embedded in the service record.
          </Alert>
        )}
        {errors.signature && (
          <Alert severity="error" sx={{ mt: 1.5, mb: 1 }}>
            {errors.signature}
          </Alert>
        )}

        <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            type="submit"
            variant="contained"
            color="primary"
            size="large"
            startIcon={<SaveIcon />}
          >
            Save Service Record
          </Button>
        </Box>
      </Box>
    </Paper>
  );
};

export default ServiceRecordForm;
