const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { FieldValue } = require('firebase-admin/firestore');
const { db } = require('../utils/firebase');
const notificationService = require('../utils/notificationService');
const { sendCampaignMessages } = require('../utils/campaignService');

// ============================================
// MARKETING MODULE - CAMPAIGNS
// ============================================

/**
 * Get all campaigns
 * GET /
 */
router.get('/', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 100;
        const type = req.query.type;
        const status = req.query.status;

        let query = db.collection('marketing_campaigns')
            .orderBy('created_at', 'desc');

        const snapshot = await query.limit(limit).get();

        let campaigns = [];
        snapshot.forEach(doc => {
            campaigns.push({ id: doc.id, ...doc.data() });
        });

        if (type) campaigns = campaigns.filter(c => c.type === type);
        if (status) campaigns = campaigns.filter(c => c.status === status);

        res.json({ success: true, data: campaigns });
    } catch (error) {
        console.error('Error fetching campaigns:', error);
        res.status(500).json({ error: 'Failed to fetch campaigns', details: error.message });
    }
});

/**
 * Get campaign by ID
 * GET /:id
 */
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const doc = await db.collection('marketing_campaigns').doc(id).get();
        if (!doc.exists) return res.status(404).json({ error: 'Campaign not found' });
        res.json({ success: true, data: { id: doc.id, ...doc.data() } });
    } catch (error) {
        console.error('Error fetching campaign:', error);
        res.status(500).json({ error: 'Failed to fetch campaign', details: error.message });
    }
});

/**
 * Create a new campaign
 * POST /
 */
router.post('/', async (req, res) => {
    try {
        const { type, subject, message, contactIds, templateId, scheduledAt, includeCertificate, whatsappCampaign } = req.body;

        if (!type || !['email', 'whatsapp'].includes(type)) return res.status(400).json({ error: 'Valid type (email or whatsapp) is required' });
        if (!message) return res.status(400).json({ error: 'Message is required' });
        if (!Array.isArray(contactIds) || contactIds.length === 0) return res.status(400).json({ error: 'At least one contact is required' });

        const contactsPromises = contactIds.map(id => db.collection('marketing_contacts').doc(id).get());
        const contactDocs = await Promise.all(contactsPromises);
        const contacts = contactDocs.filter(doc => doc.exists).map(doc => ({ id: doc.id, ...doc.data() }));

        if (contacts.length === 0) return res.status(400).json({ error: 'No valid contacts found' });

        const isScheduled = !!scheduledAt;
        const id = uuidv4();

        const certificateAttachment = includeCertificate ? {
            certificateId: 'default',
            formats: { pdf: true, jpg: type === 'whatsapp' }
        } : null;

        const campaignData = {
            id,
            type,
            subject: subject || `${type.charAt(0).toUpperCase() + type.slice(1)} Campaign`,
            message,
            contact_ids: contactIds,
            template_id: templateId || null,
            status: isScheduled ? 'scheduled' : 'pending',
            scheduled_at: isScheduled ? (new Date(scheduledAt)) : null,
            sent_count: 0,
            failed_count: 0,
            created_at: FieldValue.serverTimestamp(),
            updated_at: FieldValue.serverTimestamp(),
            certificate_attachment: certificateAttachment,
            whatsapp_campaign: whatsappCampaign || null
        };

        if (!isScheduled) {
            campaignData.sent_at = FieldValue.serverTimestamp();
        }

        await db.collection('marketing_campaigns').doc(id).set(campaignData);

        if (isScheduled) {
            try {
                await notificationService.createCampaignNotification({
                    id,
                    name: subject || type + ' Campaign',
                    totalContacts: contacts.length,
                }, 'scheduled', {
                    scheduledAt: scheduledAt,
                    message: `Campaign scheduled for ${new Date(scheduledAt).toLocaleString()}`
                });
            } catch (notifyError) {
                console.error('Error creating scheduled notification:', notifyError);
            }
        }

        if (!isScheduled) {
            // Send immediately (async check)
            try {
                // We don't await this to return response quickly? 
                // Original code awaited catch block:
                // await sendCampaignMessages(...)
                // catch(...)
                // But inside the route it WAS awaited. 
                // "await sendCampaignMessages(...)"
                // So we should await it.
                await sendCampaignMessages(id, type, subject, message, contacts, certificateAttachment, whatsappCampaign);
            } catch (sendError) {
                console.error('Error sending campaign:', sendError);
            }
        }

        const savedDoc = await db.collection('marketing_campaigns').doc(id).get();
        res.status(201).json({
            success: true,
            message: isScheduled ? 'Campaign scheduled successfully' : 'Campaign created and sent successfully',
            data: { id: savedDoc.id, ...savedDoc.data() }
        });

    } catch (error) {
        console.error('Error creating campaign:', error);
        res.status(500).json({ error: 'Failed to create campaign', details: error.message });
    }
});

/**
 * Send campaign immediately
 * POST /:id/send
 */
router.post('/:id/send', async (req, res) => {
    try {
        const { id } = req.params;
        const doc = await db.collection('marketing_campaigns').doc(id).get();

        if (!doc.exists) return res.status(404).json({ error: 'Campaign not found' });
        const campaign = { id: doc.id, ...doc.data() };
        if (campaign.status === 'completed') return res.status(400).json({ error: 'Campaign has already been sent' });

        const contactsPromises = campaign.contact_ids.map(cid => db.collection('marketing_contacts').doc(cid).get());
        const contactDocs = await Promise.all(contactsPromises);
        const contacts = contactDocs.filter(d => d.exists).map(d => ({ id: d.id, ...d.data() }));

        const result = await sendCampaignMessages(
            id,
            campaign.type,
            campaign.subject,
            campaign.message,
            contacts,
            campaign.certificate_attachment || null,
            campaign.whatsapp_campaign
        );

        res.json({ success: true, message: 'Campaign sent successfully', data: result });
    } catch (error) {
        console.error('Error sending campaign:', error);
        res.status(500).json({ error: 'Failed to send campaign', details: error.message });
    }
});

/**
 * Retry failed messages
 * POST /:id/retry
 */
router.post('/:id/retry', async (req, res) => {
    try {
        const { id } = req.params;
        const doc = await db.collection('marketing_campaigns').doc(id).get();
        if (!doc.exists) return res.status(404).json({ error: 'Campaign not found' });

        const campaign = { id: doc.id, ...doc.data() };
        const failedCount = campaign.failed_count || campaign.failedCount || 0;
        if (failedCount === 0) return res.status(400).json({ error: 'No failed messages to retry' });

        const errors = campaign.errors || [];
        const failedContactIds = errors.map(e => e.contactId).filter(id => id);
        if (failedContactIds.length === 0) return res.status(400).json({ error: 'No valid contact IDs found in errors' });

        const contactsPromises = failedContactIds.map(cid => db.collection('marketing_contacts').doc(cid).get());
        const contactDocs = await Promise.all(contactsPromises);
        const failedContacts = contactDocs.filter(d => d.exists).map(d => ({ id: d.id, ...d.data() }));

        if (failedContacts.length === 0) return res.status(400).json({ error: 'No valid contacts found for retry' });

        const result = await sendCampaignMessages(
            id,
            campaign.type,
            campaign.subject,
            campaign.message,
            failedContacts,
            campaign.certificate_attachment || null,
            campaign.whatsapp_campaign
        );

        const updatedDoc = await db.collection('marketing_campaigns').doc(id).get();
        const updatedCampaign = updatedDoc.data();

        res.json({
            success: true,
            message: `Retry completed. Sent ${result.sentCount} messages, ${result.failedCount} failed.`,
            data: { retryResults: result, campaign: { id, ...updatedCampaign } }
        });
    } catch (error) {
        console.error('Error retrying campaign:', error);
        try {
            await notificationService.createErrorNotification(
                'Campaign Retry Failed',
                `Failed to retry campaign: ${error.message}`,
                { category: 'campaign', link: `/campaigns/${error.campaignId || 'unknown'}`, metadata: { error: error.message } }
            );
        } catch (e) { }
        res.status(500).json({ error: 'Failed to retry campaign', details: error.message });
    }
});

/**
 * Cancel a scheduled campaign
 * POST /:id/cancel
 */
router.post('/:id/cancel', async (req, res) => {
    try {
        const { id } = req.params;
        const docRef = db.collection('marketing_campaigns').doc(id);
        const doc = await docRef.get();
        if (!doc.exists) return res.status(404).json({ error: 'Campaign not found' });

        if (doc.data().status !== 'scheduled') {
            return res.status(400).json({ error: 'Only scheduled campaigns can be cancelled' });
        }

        await docRef.update({
            status: 'cancelled',
            updated_at: FieldValue.serverTimestamp()
        });

        res.json({ success: true, message: 'Campaign cancelled successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to cancel campaign', details: error.message });
    }
});

/**
 * Process overdue campaigns
 * POST /process-overdue
 */
router.post('/process-overdue', async (req, res) => {
    try {
        const now = new Date();
        const scheduledSnapshot = await db.collection('marketing_campaigns')
            .where('status', '==', 'scheduled')
            .get();

        const dueCampaigns = scheduledSnapshot.docs.filter(doc => {
            const campaign = doc.data();
            const scheduledAt = campaign.scheduled_at;
            if (!scheduledAt) return false;
            let scheduledDate;
            try {
                if (scheduledAt.toDate) scheduledDate = scheduledAt.toDate();
                else if (scheduledAt.seconds) scheduledDate = new Date(scheduledAt.seconds * 1000);
                else scheduledDate = new Date(scheduledAt);
                if (isNaN(scheduledDate.getTime())) return false;
                return scheduledDate.getTime() <= now.getTime();
            } catch (e) { return false; }
        });

        if (dueCampaigns.length === 0) return res.json({ success: true, message: 'No overdue scheduled campaigns found', processed: 0 });

        const results = [];
        for (const doc of dueCampaigns) {
            const campaign = { id: doc.id, ...doc.data() };
            try {
                const contactsPromises = campaign.contact_ids.map(cid => db.collection('marketing_contacts').doc(cid).get());
                const contactDocs = await Promise.all(contactsPromises);
                const contacts = contactDocs.filter(d => d.exists).map(d => ({ id: d.id, ...d.data() }));

                if (contacts.length === 0) {
                    await db.collection('marketing_campaigns').doc(campaign.id).update({
                        status: 'failed',
                        error_message: 'No valid contacts found',
                        updated_at: FieldValue.serverTimestamp()
                    });
                    results.push({ id: campaign.id, status: 'failed', reason: 'No valid contacts' });
                    continue;
                }

                await sendCampaignMessages(
                    campaign.id,
                    campaign.type,
                    campaign.subject,
                    campaign.message,
                    contacts,
                    campaign.certificate_attachment || null,
                    campaign.whatsapp_campaign
                );

                // Helper to check status after send
                // Since sendCampaignMessages already updates status, we can skip explicit update unless we want to ensure "completed" vs "failed"
                // logic here duplicates sendCampaignMessages logic somewhat, but safe to leave.

                results.push({ id: campaign.id, status: 'success' });
            } catch (error) {
                console.error(`Error processing campaign ${campaign.id}:`, error);
                await db.collection('marketing_campaigns').doc(campaign.id).update({
                    status: 'failed',
                    error_message: error.message,
                    updated_at: FieldValue.serverTimestamp()
                });
                results.push({ id: campaign.id, status: 'failed', error: error.message });
            }
        }

        res.json({ success: true, message: `Processed ${dueCampaigns.length} overdue campaign(s)`, processed: dueCampaigns.length, results });

    } catch (error) {
        console.error('Error processing overdue campaigns:', error);
        res.status(500).json({ error: 'Failed to process overdue campaigns', details: error.message });
    }
});

/**
 * Delete a campaign
 * DELETE /:id
 */
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const docRef = db.collection('marketing_campaigns').doc(id);
        const doc = await docRef.get();
        if (!doc.exists) return res.status(404).json({ error: 'Campaign not found' });
        await docRef.delete();
        res.json({ success: true, message: 'Campaign deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete campaign', details: error.message });
    }
});

module.exports = router;
