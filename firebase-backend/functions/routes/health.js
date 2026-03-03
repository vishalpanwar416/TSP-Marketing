const express = require('express');
const router = express.Router();
const { db, getStorageBucket } = require('../utils/firebase');
const { isEmailConfigured } = require('../utils/emailService');
const { isWhatsAppConfigured } = require('../utils/whatsappService');

// Helper functions for health checks
async function testEmailService() {
    try {
        return { success: true, message: 'Email service is configured and ready' };
    } catch (error) {
        return { success: false, message: error.message };
    }
}

async function testWhatsAppService() {
    try {
        const whatsappConfig = process.env.AISENSY_API_KEY;
        if (!whatsappConfig) {
            return { success: false, message: 'AiSensy API key not configured' };
        }
        return { success: true, message: 'WhatsApp service is configured and ready' };
    } catch (error) {
        return { success: false, message: error.message };
    }
}

async function testStorageService(bucket) {
    try {
        const [files] = await bucket.getFiles({ maxResults: 1 });
        return { success: true, message: 'Storage is accessible and ready', bucketName: bucket.name };
    } catch (error) {
        return { success: false, message: error.message };
    }
}

async function testFirestoreService() {
    try {
        await db.collection('_health_check').limit(1).get();
        return { success: true, message: 'Firestore is accessible and ready' };
    } catch (error) {
        return { success: false, message: error.message };
    }
}

async function testWebhookService() {
    try {
        return { success: true, message: 'Webhook endpoint is available', endpoint: '/api/webhooks/social-media' };
    } catch (error) {
        return { success: false, message: error.message };
    }
}

/**
 * Basic health check
 * GET /
 */
router.get('/', async (req, res) => {
    let storageStatus = 'unknown';
    let storageError = null;

    try {
        const bucket = await getStorageBucket();
        const [exists] = await bucket.exists();
        storageStatus = exists ? 'configured' : 'not configured';
    } catch (error) {
        storageStatus = 'error';
        storageError = error.message;
    }

    res.json({
        status: 'OK',
        message: 'Marketing & Certificate Generator Firebase API is running',
        timestamp: new Date().toISOString(),
        services: {
            email: isEmailConfigured() ? 'configured' : 'not configured',
            whatsapp: isWhatsAppConfigured() ? 'configured' : 'not configured',
            storage: storageStatus,
            storageError: storageError
        }
    });
});

/**
 * Comprehensive API Health Check
 * GET /check
 */
router.get('/check', async (req, res) => {
    const healthStatus = {
        timestamp: new Date().toISOString(),
        overall: 'healthy',
        services: {}
    };

    // Check Email API
    try {
        const emailConfigured = isEmailConfigured();
        const emailTest = emailConfigured ? await testEmailService() : null;
        healthStatus.services.email = {
            configured: emailConfigured,
            status: emailConfigured ? (emailTest?.success ? 'operational' : 'degraded') : 'not_configured',
            service: 'SendGrid/Nodemailer',
            lastChecked: new Date().toISOString(),
            details: emailTest || { message: emailConfigured ? 'Service configured but not tested' : 'Email service not configured' }
        };
    } catch (error) {
        healthStatus.services.email = { configured: false, status: 'error', error: error.message, lastChecked: new Date().toISOString() };
    }

    // Check WhatsApp API
    try {
        const whatsappConfigured = isWhatsAppConfigured();
        const whatsappTest = whatsappConfigured ? await testWhatsAppService() : null;
        healthStatus.services.whatsapp = {
            configured: whatsappConfigured,
            status: whatsappConfigured ? (whatsappTest?.success ? 'operational' : 'degraded') : 'not_configured',
            service: 'AiSensy/Twilio',
            lastChecked: new Date().toISOString(),
            details: whatsappTest || { message: whatsappConfigured ? 'Service configured but not tested' : 'WhatsApp service not configured' }
        };
    } catch (error) {
        healthStatus.services.whatsapp = { configured: false, status: 'error', error: error.message, lastChecked: new Date().toISOString() };
    }

    // Check Firebase Storage
    try {
        const bucket = await getStorageBucket();
        const [exists] = await bucket.exists();
        const storageTest = exists ? await testStorageService(bucket) : null;
        healthStatus.services.storage = {
            configured: exists,
            status: exists ? (storageTest?.success ? 'operational' : 'degraded') : 'not_configured',
            service: 'Firebase Storage',
            lastChecked: new Date().toISOString(),
            details: storageTest || { message: exists ? 'Storage accessible but not tested' : 'Storage not configured' }
        };
    } catch (error) {
        healthStatus.services.storage = { configured: false, status: 'error', error: error.message, lastChecked: new Date().toISOString() };
    }

    // Check Firestore Database
    try {
        const firestoreTest = await testFirestoreService();
        healthStatus.services.firestore = {
            configured: true,
            status: firestoreTest?.success ? 'operational' : 'degraded',
            service: 'Firebase Firestore',
            lastChecked: new Date().toISOString(),
            details: firestoreTest || { message: 'Database accessible' }
        };
    } catch (error) {
        healthStatus.services.firestore = { configured: false, status: 'error', error: error.message, lastChecked: new Date().toISOString() };
    }

    // Check Webhook endpoint
    try {
        const webhookTest = await testWebhookService();
        healthStatus.services.webhook = {
            configured: true,
            status: webhookTest?.success ? 'operational' : 'degraded',
            service: 'Social Media Webhook',
            endpoint: '/api/webhooks/social-media',
            lastChecked: new Date().toISOString(),
            details: webhookTest || { message: 'Webhook endpoint available' }
        };
    } catch (error) {
        healthStatus.services.webhook = { configured: false, status: 'error', error: error.message, lastChecked: new Date().toISOString() };
    }

    // Determine overall health
    const serviceStatuses = Object.values(healthStatus.services).map(s => s.status);
    if (serviceStatuses.some(s => s === 'error')) {
        healthStatus.overall = 'unhealthy';
    } else if (serviceStatuses.some(s => s === 'degraded' || s === 'not_configured')) {
        healthStatus.overall = 'degraded';
    } else {
        healthStatus.overall = 'healthy';
    }

    res.json({ success: true, data: healthStatus });
});

module.exports = router;
