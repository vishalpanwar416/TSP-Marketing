const express = require('express');
const router = express.Router();
const { db, getStorageBucket } = require('../utils/firebase');
const { isWhatsAppConfigured, formatPhoneNumber, sendBulkWhatsApp, sendWhatsAppDocument } = require('../utils/whatsappService');
const { FieldValue } = require('firebase-admin/firestore');

// ============================================
// DATABASE INITIALIZATION
// ============================================

/**
 * Initialize Database Collections
 * POST /init-db
 */
router.post('/init-db', async (req, res) => {
    try {
        const collections = [
            'certificates',
            'marketing_contacts',
            'marketing_campaigns',
            'marketing_templates',
            'notifications'
        ];

        const batch = db.batch();
        const results = {};

        for (const col of collections) {
            const docRef = db.collection(col).doc('_init_');
            const doc = await docRef.get();

            if (!doc.exists) {
                batch.set(docRef, {
                    _initialized: true,
                    _created_at: FieldValue.serverTimestamp(),
                    _description: `Collection ${col} initialized`
                });
                results[col] = 'Created';
            } else {
                results[col] = 'Already exists';
            }
        }

        await batch.commit();

        res.json({
            success: true,
            message: 'Database collections initialized',
            results
        });
    } catch (error) {
        console.error('Error initializing database:', error);
        res.status(500).json({
            error: 'Failed to initialize database',
            details: error.message
        });
    }
});

// ============================================
// TEST ENDPOINTS
// ============================================

/**
 * Test Storage Configuration
 * GET /test/storage
 */
router.get('/test/storage', async (req, res) => {
    try {
        console.log('🧪 Testing Firebase Storage configuration...');
        const bucket = await getStorageBucket();
        const [exists] = await bucket.exists();

        if (!exists) {
            return res.status(503).json({
                success: false,
                error: 'Storage bucket does not exist',
                message: 'Please enable Firebase Storage in Firebase Console',
                bucket: bucket.name
            });
        }

        const testFileName = `test/test-${Date.now()}.txt`;
        const testFile = bucket.file(testFileName);

        await testFile.save('Storage test file', {
            metadata: {
                contentType: 'text/plain',
                metadata: {
                    purpose: 'storage_test',
                    createdAt: new Date().toISOString()
                }
            }
        });

        await testFile.delete();

        res.json({
            success: true,
            message: 'Firebase Storage is properly configured and accessible',
            bucket: bucket.name
        });
    } catch (error) {
        console.error('❌ Storage test failed:', error);
        res.status(500).json({
            success: false,
            error: 'Storage configuration test failed',
            message: error.message
        });
    }
});

/**
 * Check phone number status in AiSensy
 * POST /test/whatsapp/check-number
 */
router.post('/test/whatsapp/check-number', async (req, res) => {
    try {
        const { phone_number } = req.body;
        if (!phone_number) return res.status(400).json({ error: 'phone_number is required' });

        if (!isWhatsAppConfigured()) {
            return res.status(503).json({ error: 'WhatsApp service is not configured', configured: false });
        }

        const formattedNumber = formatPhoneNumber(phone_number);

        try {
            const result = await sendBulkWhatsApp(
                phone_number,
                'Test message to check number status',
                null,
                null,
                'pdf_certificate'
            );

            res.json({
                success: true,
                message: 'Number appears to be valid and opted-in',
                data: { formatted_number: formattedNumber, test_result: result }
            });
        } catch (error) {
            res.status(400).json({
                success: false,
                message: 'Number check failed',
                data: { formatted_number: formattedNumber, error: error.message }
            });
        }
    } catch (error) {
        console.error('Error checking phone number:', error);
        res.status(500).json({ error: 'Failed to check phone number', details: error.message });
    }
});

/**
 * Test WhatsApp message sending
 * POST /test/whatsapp
 */
router.post('/test/whatsapp', async (req, res) => {
    try {
        const { phone_number, message, media_url, filename } = req.body;

        if (!phone_number || !message) {
            return res.status(400).json({ error: 'phone_number and message are required' });
        }

        if (!isWhatsAppConfigured()) {
            return res.status(503).json({ error: 'WhatsApp service is not configured', configured: false });
        }

        let result;
        if (media_url) {
            result = await sendWhatsAppDocument(phone_number, media_url, filename || 'document.pdf', message);
        } else {
            result = await sendBulkWhatsApp(phone_number, message);
        }

        res.json({
            success: true,
            message: 'Test message sent successfully',
            data: result
        });
    } catch (error) {
        console.error('Error in test WhatsApp:', error);
        res.status(500).json({
            error: 'Failed to send test message',
            details: error.message
        });
    }
});

module.exports = router;
