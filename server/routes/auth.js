import express from 'express';

import { authRequired } from '../utils/helpers.js';
import { register, login, logout, resetRequest, resetConfirm, getMe } from '../controllers/auth.js';

const router = express.Router();

router.post('/register', register);

router.post('/login', login);

router.post('/logout', logout);

router.post('/reset-request', resetRequest);

router.post('/reset-confirm', resetConfirm);

router.get('/me', authRequired, getMe);

export default router;
