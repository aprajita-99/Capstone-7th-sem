const express = require('express');
const { logout, isAuth } = require('../controllers/userController');
const { isConfigured: faceConfigured } = require('../utils/faceClient');

const router = express.Router();

// Simple health probe used by deployments and the phone-test tunnel.
// `face` says whether the AWS face service keys are set (never the keys themselves).
router.get('/health', (req, res) => {
    res.status(200).json({ success: true, status: 'ok', face: faceConfigured() });
});

// Server clock for phones that schedule relay playback together (Phase 6).
router.get('/time', (req, res) => {
    res.status(200).json({ success: true, now: Date.now() });
});

router.route('/logout').get(logout);
router.route('/islogin').get(isAuth);

module.exports = router;
