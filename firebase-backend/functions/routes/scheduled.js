const express = require('express');
const router = express.Router();
const { FieldValue } = require('firebase-admin/firestore');
const { db } = require('../utils/firebase');

// ============================================
// MARKETING MODULE - SCHEDULED
// ============================================

/**
 * Get all scheduled campaigns
 * GET /
 */
router.get('/', async (req, res) => {
    try {
        const snapshot = await db.collection('marketing_campaigns')
            .where('status', '==', 'scheduled')
            .orderBy('scheduled_at', 'asc')
            .get();

        const scheduled = [];
        snapshot.forEach(doc => {
            scheduled.push({ id: doc.id, ...doc.data() });
        });

        res.json({ success: true, data: scheduled });
    } catch (error) {
        console.error('Error fetching scheduled campaigns:', error);
        res.status(500).json({ error: 'Failed to fetch scheduled campaigns', details: error.message });
    }
});

/**
 * Reschedule a campaign
 * PUT /:id/reschedule
 */
router.put('/:id/reschedule', async (req, res) => {
    try {
        const { id } = req.params;
        const { scheduledAt } = req.body;

        if (!scheduledAt) {
            return res.status(400).json({ error: 'scheduledAt is required' });
        }

        const docRef = db.collection('marketing_campaigns').doc(id);
        const doc = await docRef.get();

        if (!doc.exists) {
            return res.status(404).json({ error: 'Campaign not found' });
        }

        const campaign = doc.data();
        if (campaign.status !== 'scheduled') {
            return res.status(400).json({ error: 'Only scheduled campaigns can be rescheduled' });
        }

        await docRef.update({
            scheduled_at: new Date(scheduledAt),
            updated_at: FieldValue.serverTimestamp()
        });

        res.json({ success: true, message: 'Campaign rescheduled successfully' });
    } catch (error) {
        console.error('Error rescheduling campaign:', error);
        res.status(500).json({ error: 'Failed to reschedule campaign', details: error.message });
    }
});

module.exports = router;
