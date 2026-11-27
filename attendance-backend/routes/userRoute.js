const express = require('express');
const mongoose = require('mongoose');
const { logout, isAuth } = require('../controllers/userController');
const { isConfigured: faceConfigured } = require('../utils/faceClient');
const { isConfigured: emailConfigured } = require('../utils/mailer');
const { isDevMode } = require('../utils/devMode');

const router = express.Router();

// Simple health probe used by deployments and the phone-test tunnel.
// `face` / `email` / `jobs` say whether those services are configured (never the keys themselves).
// `?db=1` adds the server's round-trip time to MongoDB (median of 3 pings), to diagnose latency.
router.get('/health', async (req, res) => {
    const body = { success: true, status: 'ok', face: faceConfigured(), email: emailConfigured(), jobs: Boolean(process.env.JOBS_SECRET), devMode: isDevMode() };
    if (req.query.db === '1') {
        try {
            const pings = [];
            for (let index = 0; index < 3; index += 1) {
                const started = Date.now();
                await mongoose.connection.db.admin().command({ ping: 1 });
                pings.push(Date.now() - started);
            }
            body.dbPingMs = pings.sort((left, right) => left - right)[1];
        } catch (error) {
            body.dbPingMs = null;
        }
    }
    res.status(200).json(body);
});

// Server clock for phones that schedule relay playback together (Phase 6).
router.get('/time', (req, res) => {
    res.status(200).json({ success: true, now: Date.now() });
});

router.route('/logout').get(logout);
router.route('/islogin').get(isAuth);

module.exports = router;
