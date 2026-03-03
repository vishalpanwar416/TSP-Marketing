const { v4: uuidv4 } = require('uuid');
const { FieldValue } = require('firebase-admin/firestore');
const { db, getStorageBucket } = require('./firebase');
const notificationService = require('./notificationService');
const { generateCertificatePDF, generateCertificateImage } = require('./pdfGenerator');
const { sendBulkEmail, isEmailConfigured } = require('./emailService');
const { sendBulkWhatsApp, isWhatsAppConfigured } = require('./whatsappService');

/**
 * Get or create a certificate for a contact with a specific format
 */
async function getOrCreateCertificateForContactWithFormat(contact, attachment, format = 'pdf') {
    // Create a modified attachment with only the requested format
    const modifiedAttachment = {
        ...attachment,
        formats: format === 'jpg' ? { pdf: false, jpg: true } : { pdf: true, jpg: false }
    };
    return getOrCreateCertificateForContact(contact, modifiedAttachment);
}

/**
 * Get or create a certificate for a contact
 */
async function getOrCreateCertificateForContact(contact, attachment) {
    const formats = attachment.formats || { pdf: true, jpg: false };
    // Prefer JPG for campaigns if requested (better for WhatsApp/Social)
    const useJpg = formats.jpg === true;
    const extension = useJpg ? 'jpg' : 'pdf';

    // 1. If a specific certificate ID is provided, use that
    if (attachment.certificateId && attachment.certificateId !== 'default') {
        const certDoc = await db.collection('certificates').doc(attachment.certificateId).get();
        if (certDoc.exists) {
            const certData = certDoc.data();

            // If JPG is requested but doesn't exist, generate it
            if (useJpg && !certData.jpg_url) {
                console.log(`JPG requested but not found for certificate ${attachment.certificateId}, generating JPG version...`);

                const certificateData = {
                    recipient_name: certData.recipient_name || contact.name || 'Recipient',
                    certificate_number: certData.certificate_number || `CERT-${Date.now()}`,
                    award_rera_number: certData.award_rera_number || contact.rera_awarde_no || contact.reraAwardeNo || null,
                    professional: certData.professional || contact.professional || null,
                    phone_number: certData.phone_number || contact.phone || null,
                    email: certData.email || contact.email || null
                };

                // Get template URL
                let templateUrl = null;
                try {
                    const defaultTemplateSnapshot = await db.collection('certificate_templates')
                        .where('is_default', '==', true)
                        .limit(1)
                        .get();

                    if (!defaultTemplateSnapshot.empty) {
                        templateUrl = defaultTemplateSnapshot.docs[0].data().url;
                    } else {
                        const templateDoc = await db.collection('certificate_settings').doc('template').get();
                        if (templateDoc.exists && templateDoc.data().url) {
                            templateUrl = templateDoc.data().url;
                        }
                    }
                } catch (error) {
                    console.warn('Could not fetch certificate template:', error.message);
                }

                // Generate JPG
                const jpgBuffer = await generateCertificateImage(certificateData, templateUrl);

                // Upload JPG to storage
                const bucket = await getStorageBucket();
                const jpgFile = bucket.file(`certificates/${certDoc.id}.jpg`);
                await jpgFile.save(jpgBuffer, {
                    metadata: {
                        contentType: 'image/jpeg',
                    }
                });
                await jpgFile.makePublic();
                const jpgUrl = `https://storage.googleapis.com/${bucket.name}/certificates/${certDoc.id}.jpg`;

                // Update certificate document with JPG URL
                await certDoc.ref.update({ jpg_url: jpgUrl });

                return {
                    url: jpgUrl,
                    filename: `certificate_${certData.certificate_number || certDoc.id}.jpg`
                };
            }

            // Use existing URL
            const url = useJpg ? (certData.jpg_url || certData.pdf_url) : certData.pdf_url;
            return {
                url,
                filename: `certificate_${certData.certificate_number || certDoc.id}.${extension}`
            };
        }
    }

    // 2. Skip reuse if customized template might have changed (forceNew = true)
    // 3. Generate a new one for this contact
    console.log(`Generating new ${extension} certificate for ${contact.name}`);

    const certNumber = `CERT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const certificateData = {
        recipient_name: contact.name || 'Recipient',
        certificate_number: certNumber,
        award_rera_number: contact.rera_awarde_no || contact.reraAwardeNo || null,
        professional: contact.professional || null,
        phone_number: contact.phone || null,
        email: contact.email || null,
        created_at: FieldValue.serverTimestamp()
    };

    // Get template URL
    let templateUrl = null;
    try {
        const defaultTemplateSnapshot = await db.collection('certificate_templates')
            .where('is_default', '==', true)
            .limit(1)
            .get();

        if (!defaultTemplateSnapshot.empty) {
            templateUrl = defaultTemplateSnapshot.docs[0].data().url;
        } else {
            const templateDoc = await db.collection('certificate_settings').doc('template').get();
            if (templateDoc.exists && templateDoc.data().url) {
                templateUrl = templateDoc.data().url;
            }
        }
    } catch (error) {
        console.warn('Could not fetch certificate template, using default:', error.message);
    }

    const buffer = useJpg
        ? await generateCertificateImage(certificateData, templateUrl)
        : await generateCertificatePDF(certificateData, templateUrl);

    const id = uuidv4();
    const bucket = await getStorageBucket();
    const file = bucket.file(`certificates/${id}.${extension}`);

    await file.save(buffer, {
        metadata: {
            contentType: useJpg ? 'image/jpeg' : 'application/pdf',
        }
    });

    await file.makePublic();
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/certificates/${id}.${extension}`;

    // Save to Firestore
    const newCertData = {
        ...certificateData,
        id,
        [useJpg ? 'jpg_url' : 'pdf_url']: publicUrl
    };
    await db.collection('certificates').doc(id).set(newCertData);

    return {
        url: publicUrl,
        filename: `certificate_${certNumber}.${extension}`
    };
}

/**
 * Send campaign messages
 */
async function sendCampaignMessages(campaignId, type, subject, message, contacts, certificateAttachment = null, whatsappCampaign = null) {
    let sentCount = 0;
    let failedCount = 0;
    const errors = [];

    const batch = db.batch();

    // Check if service is configured before starting
    if (type === 'email' && !isEmailConfigured()) {
        throw new Error('Email service is not configured');
    }
    if (type === 'whatsapp' && !isWhatsAppConfigured()) {
        throw new Error('WhatsApp service is not configured');
    }

    // Personalize message helper
    const personalizeMessage = (text, contact) => {
        if (!text || typeof text !== 'string') return '';
        let result = text
            .replace(/\{\{name\}\}/gi, contact.name || 'Valued Customer')
            .replace(/\{\{certificate\}\}/gi, contact.certificate_number || contact.certificateNumber || '')
            .replace(/\{\{rera\}\}/gi, contact.rera_awarde_no || contact.reraAwardeNo || '')
            .replace(/\{\{professional\}\}/gi, contact.professional || '')
            .replace(/\{\{email\}\}/gi, contact.email || '')
            .replace(/\{\{phone\}\}/gi, contact.phone || '');
        return result;
    };

    for (const contact of contacts) {
        try {
            const personalizedMessage = personalizeMessage(message, contact);

            if (type === 'email' && contact.email) {
                try {
                    let attachments = [];
                    // Attach certificate if requested
                    if (certificateAttachment) {
                        try {
                            const certResult = await getOrCreateCertificateForContact(contact, certificateAttachment);
                            if (certResult) {
                                attachments.push({
                                    filename: certResult.filename,
                                    path: certResult.url
                                });
                            }
                        } catch (certError) {
                            console.error(`Error getting certificate for ${contact.id}:`, certError);
                            errors.push({ contactId: contact.id, contact: contact.email, error: `Certificate generation failed: ${certError.message}` });
                        }
                    }

                    await sendBulkEmail(contact.email, subject, personalizedMessage, attachments);
                    sentCount++;

                    // Update contact stats
                    const contactRef = db.collection('marketing_contacts').doc(contact.id);
                    batch.update(contactRef, {
                        email_sent_count: FieldValue.increment(1),
                        last_contacted_at: FieldValue.serverTimestamp(),
                        last_contact_type: 'email'
                    });
                } catch (error) {
                    console.error(`Failed to send email to ${contact.email}:`, error);
                    failedCount++;
                    errors.push({ contactId: contact.id, contact: contact.email, error: error.message });
                }
            } else if (type === 'whatsapp' && contact.phone) {
                try {
                    const formats = certificateAttachment?.formats || { pdf: false, jpg: false };
                    const wantsPdf = formats.pdf === true;
                    const wantsJpg = formats.jpg === true;
                    const hasCertificate = certificateAttachment && (wantsPdf || wantsJpg);
                    const campaignName = whatsappCampaign || null;

                    if (!hasCertificate) {
                        if (!personalizedMessage || personalizedMessage.trim().length === 0) {
                            failedCount++;
                            errors.push({ contactId: contact.id, contact: contact.phone, error: 'Message is empty or invalid' });
                            continue;
                        }
                    }

                    const messageToSend = String(personalizedMessage || '');
                    let messagesSent = 0;
                    let lastError = null;

                    if (wantsPdf) {
                        try {
                            const pdfResult = await getOrCreateCertificateForContactWithFormat(contact, certificateAttachment, 'pdf');
                            if (pdfResult && pdfResult.url) {
                                const result = await sendBulkWhatsApp(contact.phone, messageToSend, pdfResult.url, pdfResult.filename, campaignName || 'pdf_certificate');
                                if (result && result.success !== false) messagesSent++;
                                else throw new Error(result?.error || 'PDF send failed');
                            } else throw new Error('PDF generation failed');
                        } catch (e) {
                            lastError = e.message;
                            errors.push({ contactId: contact.id, contact: contact.phone, error: `PDF failed: ${e.message}` });
                        }
                    }

                    if (wantsJpg) {
                        try {
                            const jpgResult = await getOrCreateCertificateForContactWithFormat(contact, certificateAttachment, 'jpg');
                            if (jpgResult && jpgResult.url) {
                                const result = await sendBulkWhatsApp(contact.phone, messageToSend, jpgResult.url, jpgResult.filename, campaignName || 'image_certificate');
                                if (result && result.success !== false) messagesSent++;
                                else throw new Error(result?.error || 'JPG send failed');
                            } else throw new Error('JPG generation failed');
                        } catch (e) {
                            lastError = e.message;
                            errors.push({ contactId: contact.id, contact: contact.phone, error: `JPG failed: ${e.message}` });
                        }
                    }

                    if (!hasCertificate) {
                        try {
                            const result = await sendBulkWhatsApp(contact.phone, messageToSend, null, null, campaignName);
                            if (result && result.success !== false) messagesSent++;
                            else throw new Error(result?.error || 'Text send failed');
                        } catch (e) {
                            lastError = e.message;
                            errors.push({ contactId: contact.id, contact: contact.phone, error: `Text failed: ${e.message}` });
                        }
                    }

                    if (messagesSent > 0) {
                        sentCount += messagesSent;
                        batch.update(db.collection('marketing_contacts').doc(contact.id), {
                            whatsapp_sent_count: FieldValue.increment(messagesSent),
                            last_contacted_at: FieldValue.serverTimestamp(),
                            last_contact_type: 'whatsapp'
                        });
                    } else {
                        failedCount++;
                        throw new Error(lastError || 'All messages failed');
                    }
                } catch (error) {
                    if (!errors.some(e => e.contactId === contact.id && e.contact === contact.phone)) {
                        failedCount++;
                        errors.push({ contactId: contact.id, contact: contact.phone, error: error.message });
                    }
                }
            } else {
                failedCount++;
                errors.push({ contactId: contact.id, contact: contact.name, error: type === 'email' ? 'No email' : 'No phone' });
            }
        } catch (error) {
            failedCount++;
            errors.push({ contactId: contact.id, error: error.message });
        }
    }

    try { await batch.commit(); } catch (e) { console.error(e); }

    const campaignDoc = await db.collection('marketing_campaigns').doc(campaignId).get();
    const currentCampaign = campaignDoc.exists ? campaignDoc.data() : null;
    const isRetry = currentCampaign && currentCampaign.sent_count > 0;

    const finalSentCount = isRetry ? (currentCampaign.sent_count || 0) + sentCount : sentCount;
    const finalFailedCount = isRetry ? Math.max(0, (currentCampaign.failed_count || 0) - errors.length + failedCount) : failedCount;

    let finalErrors = errors;
    if (isRetry && currentCampaign.errors && Array.isArray(currentCampaign.errors)) {
        const retriedContactIds = new Set(contacts.map(c => c.id));
        const remainingErrors = currentCampaign.errors.filter(e => !retriedContactIds.has(e.contactId));
        finalErrors = [...remainingErrors, ...errors];
    }

    let finalStatus = 'completed'; // simplified status logic
    if (finalFailedCount === 0) finalStatus = 'completed';
    else if (finalSentCount > 0) finalStatus = 'partial';
    else finalStatus = 'failed';

    await db.collection('marketing_campaigns').doc(campaignId).update({
        status: finalStatus,
        sent_count: finalSentCount,
        failed_count: finalFailedCount,
        sent_at: finalSentCount > 0 ? FieldValue.serverTimestamp() : currentCampaign?.sent_at || null,
        updated_at: FieldValue.serverTimestamp(),
        errors: finalErrors.length > 0 ? finalErrors : FieldValue.delete()
    });

    try {
        await notificationService.createCampaignNotification({
            id: campaignId,
            name: currentCampaign?.name || 'Campaign',
            totalContacts: contacts.length,
            successfulContacts: finalSentCount,
            failedContacts: finalFailedCount
        }, finalStatus, { userId: currentCampaign?.userId || null });
    } catch (e) { console.error(e); }

    return { sentCount, failedCount, errors };
}

module.exports = {
    sendCampaignMessages,
    getOrCreateCertificateForContact,
    getOrCreateCertificateForContactWithFormat
};
