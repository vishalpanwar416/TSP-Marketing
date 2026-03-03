const express = require('express');
const router = express.Router();
const { isEmailConfigured } = require('../utils/emailService');
const { isWhatsAppConfigured } = require('../utils/whatsappService');

// ============================================
// MARKETING MODULE - CONFIGURATION
// ============================================

/**
 * Get service configuration status
 * GET /status
 */
router.get('/status', async (req, res) => {
    try {
        res.json({
            success: true,
            data: {
                email: {
                    configured: isEmailConfigured(),
                    service: 'SendGrid/Nodemailer'
                },
                whatsapp: {
                    configured: isWhatsAppConfigured(),
                    service: 'Twilio'
                }
            }
        });
    } catch (error) {
        console.error('Error fetching config status:', error);
        res.status(500).json({ error: 'Failed to fetch config status', details: error.message });
    }
});

module.exports = router;
