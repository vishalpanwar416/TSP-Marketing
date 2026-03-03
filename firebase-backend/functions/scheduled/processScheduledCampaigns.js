const functions = require('firebase-functions');
const { db } = require('../utils/firebase');
const { FieldValue } = require('firebase-admin/firestore');
const { sendCampaignMessages } = require('../utils/campaignService');

/**
 * Scheduled function to process pending scheduled campaigns
 * Runs every minute
 */
const processScheduledCampaigns = functions.pubsub
    .schedule('every 1 minutes')
    .onRun(async (context) => {
        try {
            const now = new Date();
            console.log(`🕐 Checking for scheduled campaigns at ${now.toISOString()}`);

            const scheduledSnapshot = await db.collection('marketing_campaigns')
                .where('status', '==', 'scheduled')
                .get();

            console.log(`📋 Found ${scheduledSnapshot.docs.length} campaign(s) with status 'scheduled'`);

            const dueCampaigns = scheduledSnapshot.docs.filter(doc => {
                const campaign = doc.data();
                const scheduledAt = campaign.scheduled_at;

                if (!scheduledAt) return false;

                let scheduledDate;
                try {
                    if (scheduledAt.toDate && typeof scheduledAt.toDate === 'function') {
                        scheduledDate = scheduledAt.toDate();
                    } else if (scheduledAt.seconds !== undefined) {
                        scheduledDate = new Date(scheduledAt.seconds * 1000 + (scheduledAt.nanoseconds || 0) / 1000000);
                    } else if (scheduledAt._seconds !== undefined) {
                        scheduledDate = new Date(scheduledAt._seconds * 1000 + (scheduledAt._nanoseconds || 0) / 1000000);
                    } else {
                        scheduledDate = scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt);
                    }

                    if (isNaN(scheduledDate.getTime())) return false;
                    return scheduledDate.getTime() <= now.getTime();
                } catch (error) {
                    console.error(`Error processing scheduled_at for campaign ${doc.id}:`, error);
                    return false;
                }
            });

            if (dueCampaigns.length === 0) {
                console.log(`ℹ️ No due campaigns found.`);
                return null;
            }

            console.log(`📬 Processing ${dueCampaigns.length} due campaign(s)`);

            for (const doc of dueCampaigns) {
                const campaign = { id: doc.id, ...doc.data() };
                try {
                    const contactDocs = await Promise.all(
                        campaign.contact_ids.map(cid => db.collection('marketing_contacts').doc(cid).get())
                    );
                    const contacts = contactDocs.filter(d => d.exists).map(d => ({ id: d.id, ...d.data() }));

                    if (contacts.length === 0) {
                        await db.collection('marketing_campaigns').doc(campaign.id).update({
                            status: 'failed',
                            error_message: 'No valid contacts found',
                            updated_at: FieldValue.serverTimestamp()
                        });
                        continue;
                    }

                    await sendCampaignMessages(
                        campaign.id,
                        campaign.type,
                        campaign.subject,
                        campaign.message,
                        contacts,
                        campaign.certificate_attachment || null,
                        campaign.whatsapp_campaign || null
                    );
                } catch (error) {
                    console.error(`❌ Error processing campaign ${campaign.id}:`, error);
                    await db.collection('marketing_campaigns').doc(campaign.id).update({
                        status: 'failed',
                        error_message: error.message || error.toString(),
                        updated_at: FieldValue.serverTimestamp()
                    });
                }
            }
            return null;
        } catch (error) {
            console.error('Error in scheduled campaign processor:', error);
            return null;
        }
    });

module.exports = processScheduledCampaigns;
