const express = require('express');
const router = express.Router();
const functions = require('firebase-functions');
const { v4: uuidv4 } = require('uuid');
const { FieldValue } = require('firebase-admin/firestore');
const { db } = require('../utils/firebase');
const notificationService = require('../utils/notificationService');

/**
 * Format property data into social media post content
 */
function formatPropertyPost(property) {
    const {
        title,
        location,
        price,
        area,
        bedrooms,
        bathrooms,
        description,
        propertyUrl,
        reraNumber,
        amenities
    } = property;

    let post = `🏠 NEW PROPERTY LISTING\n\n`;
    post += `📍 ${title}\n`;
    post += `📍 Location: ${location}\n`;
    post += `💰 Price: ${price}\n`;

    if (area) post += `📐 Area: ${area}\n`;

    if (bedrooms || bathrooms) {
        const bedBath = [];
        if (bedrooms) bedBath.push(`${bedrooms} BHK`);
        if (bathrooms) bedBath.push(`${bathrooms} Bath`);
        if (bedBath.length > 0) post += `🛏️ ${bedBath.join(' | ')}\n`;
    }

    if (description) post += `\n${description}\n`;

    if (amenities && Array.isArray(amenities) && amenities.length > 0) {
        post += `\n✨ Amenities: ${amenities.slice(0, 5).join(', ')}`;
        if (amenities.length > 5) post += ` +${amenities.length - 5} more`;
        post += `\n`;
    }

    if (reraNumber) post += `\n🏆 RERA: ${reraNumber}\n`;

    post += `\n🔗 View Details: ${propertyUrl || 'Contact us for more information'}\n`;

    const hashtags = ['#RealEstate', '#PropertyListing', '#NewListing', '#HomeForSale', '#Investment'];
    post += `\n${hashtags.join(' ')}`;

    return post;
}

/**
 * Webhook endpoint for property listings to social media
 * POST /social-media
 */
router.post('/social-media', async (req, res) => {
    try {
        const { type, property, platforms, postImmediately, scheduledAt, webhookSecret } = req.body;

        const expectedSecret = functions.config() && functions.config().webhook ? functions.config().webhook.secret : null;
        if (expectedSecret && webhookSecret !== expectedSecret) {
            return res.status(401).json({ error: 'Invalid webhook secret' });
        }

        if (!type || type !== 'property_listing') {
            return res.status(400).json({ error: 'Invalid type', message: 'Expected type: "property_listing"' });
        }

        if (!property) {
            return res.status(400).json({ error: 'Property data required' });
        }

        const requiredFields = ['title', 'location', 'price'];
        const missingFields = requiredFields.filter(field => !property[field]);
        if (missingFields.length > 0) {
            return res.status(400).json({ error: 'Missing required fields', message: `Missing fields: ${missingFields.join(', ')}` });
        }

        const postContent = formatPropertyPost(property);
        const targetPlatforms = platforms && Array.isArray(platforms) && platforms.length > 0
            ? platforms
            : ['facebook', 'twitter', 'instagram', 'linkedin', 'whatsapp'];

        const shouldPostNow = postImmediately === true;
        const postTime = shouldPostNow
            ? new Date().toISOString()
            : (scheduledAt || new Date(Date.now() + 3600000).toISOString());

        const postId = uuidv4();
        const postData = {
            id: postId,
            content: postContent,
            platforms: targetPlatforms,
            scheduled_date: postTime,
            published_date: shouldPostNow ? postTime : null,
            status: shouldPostNow ? 'published' : 'scheduled',
            image: property.imageUrl || null,
            image_url: property.imageUrl || null,
            source: 'webhook',
            webhook_id: `wh_${Date.now()}`,
            received_at: new Date().toISOString(),
            property_data: {
                propertyId: property.id,
                title: property.title,
                location: property.location,
                price: property.price,
                propertyUrl: property.propertyUrl || null
            },
            insights: null,
            created_at: FieldValue.serverTimestamp(),
            updated_at: FieldValue.serverTimestamp()
        };

        await db.collection('social_media_posts').doc(postId).set(postData);

        if (shouldPostNow) {
            console.log(`[Webhook] Posting property listing to platforms: ${targetPlatforms.join(', ')}`);
        }

        try {
            await notificationService.createInfoNotification(
                'New Property Listing Webhook',
                `Received listing for ${property.title}. ${shouldPostNow ? 'Published immediately.' : 'Scheduled for later.'}`,
                {
                    category: 'social_media',
                    link: `/marketing/social-media?id=${postId}`,
                    metadata: { postId, propertyTitle: property.title, type: 'property_listing' }
                }
            );
        } catch (notifyError) {
            console.error('Error creating notification:', notifyError);
        }

        res.json({
            success: true,
            message: 'Property listing received and processed',
            data: { id: postId, status: postData.status, scheduled_date: postData.scheduled_date }
        });
    } catch (error) {
        console.error('[Webhook] Error processing social-media webhook:', error);
        res.status(500).json({ error: 'Failed to process webhook', details: error.message });
    }
});

module.exports = router;
