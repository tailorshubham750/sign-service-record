// SignaturePad.js
// Canvas-based finger/mouse draw signature pad.
// Exposes: onSave(dataUrl) callback, onClear().
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Box, Button, Typography, Stack } from '@mui/material';
import GestureIcon from '@mui/icons-material/Gesture';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';

const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 200;
const PEN_COLOR = '#1a1a2e';
const PEN_WIDTH = 2.5;

const SignaturePad = ({ onSave, onClear: onClearProp, disabled }) => {
  const canvasRef = useRef(null);
  const isDrawing = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const [hasStrokes, setHasStrokes] = useState(false);

  // — get canvas-relative coordinates for both mouse and touch
  const getPos = (e, canvas) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if (e.touches) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const drawLine = useCallback((from, to) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = PEN_COLOR;
    ctx.lineWidth = PEN_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }, []);

  const startDraw = useCallback((e) => {
    if (disabled) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    isDrawing.current = true;
    lastPos.current = getPos(e, canvas);
    setHasStrokes(true);
  }, [disabled]);

  const draw = useCallback((e) => {
    if (!isDrawing.current || disabled) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const pos = getPos(e, canvas);
    drawLine(lastPos.current, pos);
    lastPos.current = pos;
  }, [disabled, drawLine]);

  const endDraw = useCallback(() => {
    isDrawing.current = false;
  }, []);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasStrokes(false);
    if (onClearProp) onClearProp();
  }, [onClearProp]);

  const saveSignature = useCallback(() => {
    const canvas = canvasRef.current;
    const dataUrl = canvas.toDataURL('image/png');
    if (onSave) onSave(dataUrl);
  }, [onSave]);

  // — attach/detach event listeners
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', endDraw);
    canvas.addEventListener('mouseleave', endDraw);
    canvas.addEventListener('touchstart', startDraw, { passive: false });
    canvas.addEventListener('touchmove', draw, { passive: false });
    canvas.addEventListener('touchend', endDraw);

    return () => {
      canvas.removeEventListener('mousedown', startDraw);
      canvas.removeEventListener('mousemove', draw);
      canvas.removeEventListener('mouseup', endDraw);
      canvas.removeEventListener('mouseleave', endDraw);
      canvas.removeEventListener('touchstart', startDraw);
      canvas.removeEventListener('touchmove', draw);
      canvas.removeEventListener('touchend', endDraw);
    };
  }, [startDraw, draw, endDraw]);

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={1} mb={1}>
        <GestureIcon fontSize="small" color="primary" />
        <Typography variant="subtitle2" fontWeight={600} color="primary">
          Customer Signature
        </Typography>
      </Stack>

      <Box
        sx={{
          border: '2px dashed',
          borderColor: disabled ? '#ccc' : 'primary.main',
          borderRadius: 2,
          backgroundColor: disabled ? '#f9f9f9' : '#fff',
          overflow: 'hidden',
          cursor: disabled ? 'not-allowed' : 'crosshair',
          touchAction: 'none',
          userSelect: 'none',
        }}
      >
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          style={{ display: 'block', width: '100%', height: 'auto' }}
        />
      </Box>

      {!disabled && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
          Draw your signature above using mouse or finger
        </Typography>
      )}

      <Stack direction="row" spacing={2} mt={2}>
        <Button
          variant="outlined"
          color="error"
          size="small"
          startIcon={<DeleteOutlineIcon />}
          onClick={clearCanvas}
          disabled={disabled || !hasStrokes}
        >
          Clear
        </Button>
        <Button
          variant="contained"
          color="primary"
          size="small"
          startIcon={<CheckCircleOutlineIcon />}
          onClick={saveSignature}
          disabled={disabled || !hasStrokes}
        >
          Confirm Signature
        </Button>
      </Stack>
    </Box>
  );
};

export default SignaturePad;
