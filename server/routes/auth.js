import { Router } from 'express';

const router = Router();

// Client names and auth base URL loaded from .env to keep proprietary config private
const CLIENT_NAMES = JSON.parse(process.env.AUTH_CLIENT_NAMES || '{}');
const COGNITO_BASE = process.env.AUTH_BASE_URL || '';

// Step 1: Send OTP
router.post('/send-otp', async (req, res) => {
  try {
    const { mobile, role } = req.body;

    if (!mobile || !role) {
      return res.status(400).json({ error: 'mobile and role are required' });
    }

    const clientName = CLIENT_NAMES[role];
    if (!clientName) {
      return res.status(400).json({ error: `Invalid role: ${role}. Valid roles: ${Object.keys(CLIENT_NAMES).join(', ')}` });
    }

    const response = await fetch(`${COGNITO_BASE}/signInUser`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile, clientName }),
    });

    const data = await response.json();

    if (data.status === 'success') {
      res.json({
        success: true,
        message: data.result?.message || 'OTP sent',
        code: data.result?.code,
        testOtp: data.result?.testOtp,
      });
    } else {
      res.status(400).json({
        error: data.result?.message || 'Failed to send OTP',
        data,
      });
    }
  } catch (err) {
    console.error('Send OTP error:', err);
    res.status(500).json({ error: `Failed to send OTP: ${err.message}` });
  }
});

// Step 2: Verify OTP & Get Token
router.post('/verify-otp', async (req, res) => {
  try {
    const { mobile, role, otp } = req.body;

    if (!mobile || !role || !otp) {
      return res.status(400).json({ error: 'mobile, role, and otp are required' });
    }

    const clientName = CLIENT_NAMES[role];
    if (!clientName) {
      return res.status(400).json({ error: `Invalid role: ${role}` });
    }

    const response = await fetch(`${COGNITO_BASE}/verifyUser`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mobile,
        clientName,
        otp: String(otp),
        languageId: '1',
        isTcAccepted: 1,
      }),
    });

    const data = await response.json();

    if (data.status === 'success' && data.result?.IdToken) {
      res.json({
        success: true,
        idToken: data.result.IdToken,
        accessToken: data.result.AccessToken,
        refreshToken: data.result.RefreshToken,
        expiresIn: data.result.ExpiresIn,
        message: data.result.message,
      });
    } else {
      res.status(400).json({
        error: data.result?.message || 'Verification failed',
        data,
      });
    }
  } catch (err) {
    console.error('Verify OTP error:', err);
    res.status(500).json({ error: `Verification failed: ${err.message}` });
  }
});

export default router;
