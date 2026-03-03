const functions = require('firebase-functions');
const express = require('express');
const cors = require('cors');
const { admin, db, storage, getStorageBucket } = require('./utils/firebase');

// Create Express app
const app = express();

// Configure CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

    if (req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
    }
    next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ============================================
// ROUTE MOUNTS
// ============================================

// Base System & Admin Routes
app.use('/', require('./routes/system'));
app.use('/health', require('./routes/health'));



// Marketing Module
app.use('/marketing/contacts', require('./routes/contacts'));
app.use('/marketing/campaigns', require('./routes/campaigns'));
app.use('/marketing/templates', require('./routes/templates'));
app.use('/marketing/scheduled', require('./routes/scheduled'));
app.use('/marketing/stats', require('./routes/analytics'));
app.use('/marketing/config', require('./routes/configuration'));

// Social Media & Webhooks
app.use('/api/social-media', require('./routes/socialMedia'));
app.use('/api/webhooks', require('./routes/webhooks'));

// Notifications
app.use('/notifications', require('./routes/notifications'));

// ============================================
// CLOUD FUNCTIONS EXPORTS
// ============================================

// Export the Express app as a Cloud Function
exports.api = functions.runWith({
    timeoutSeconds: 300,
    memory: '1GB'
}).https.onRequest(app);

// Export Scheduled Functions
exports.processScheduledCampaigns = require('./scheduled/processScheduledCampaigns');
