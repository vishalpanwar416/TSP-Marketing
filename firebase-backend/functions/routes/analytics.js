const express = require('express');
const router = express.Router();
const { db } = require('../utils/firebase');

// ============================================
// MARKETING MODULE - STATISTICS
// ============================================

/**
 * Get overview statistics
 * GET /overview
 */
router.get('/overview', async (req, res) => {
    try {
        const [contactsSnap, campaignsSnap] = await Promise.all([
            db.collection('marketing_contacts').get(),
            db.collection('marketing_campaigns').get()
        ]);

        let emailsSent = 0;
        let whatsappSent = 0;
        let totalCampaigns = campaignsSnap.size;

        campaignsSnap.forEach(doc => {
            const campaign = doc.data();
            if (campaign.type === 'email') {
                emailsSent += campaign.sent_count || 0;
            } else if (campaign.type === 'whatsapp') {
                whatsappSent += campaign.sent_count || 0;
            }
        });

        res.json({
            success: true,
            data: {
                totalContacts: contactsSnap.size,
                emailsSent,
                whatsappSent,
                totalCampaigns,
                totalMessagesSent: emailsSent + whatsappSent
            }
        });
    } catch (error) {
        console.error('Error fetching overview stats:', error);
        res.status(500).json({ error: 'Failed to fetch statistics', details: error.message });
    }
});

module.exports = router;
