const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { FieldValue } = require('firebase-admin/firestore');
const { db } = require('../utils/firebase');
const notificationService = require('../utils/notificationService');

// ============================================
// SOCIAL MEDIA POSTS API
// ============================================

/**
 * Get all social media posts
 * GET /posts
 * Query params:
 * - platform: filter by platform (e.g., 'facebook')
 * - status: filter by status (e.g., 'published')
 * - source: filter by source (e.g., 'manual')
 */
router.get('/posts', async (req, res) => {
    try {
        const { platform, status, source } = req.query;

        let query = db.collection('social_media_posts');

        if (platform && platform !== 'all') {
            query = query.where('platforms', 'array-contains', platform);
        }

        if (status && status !== 'all') {
            query = query.where('status', '==', status);
        }

        if (source) {
            query = query.where('source', '==', source);
        }

        query = query.orderBy('created_at', 'desc');

        const snapshot = await query.get();
        const posts = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        res.json({ success: true, data: posts });
    } catch (error) {
        console.error('[Social Media API] Error fetching posts:', error);
        res.status(500).json({
            error: 'Failed to fetch posts',
            message: error.message
        });
    }
});

/**
 * Get post by ID
 * GET /posts/:id
 */
router.get('/posts/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const doc = await db.collection('social_media_posts').doc(id).get();

        if (!doc.exists) {
            return res.status(404).json({ error: 'Post not found' });
        }

        res.json({
            success: true,
            data: { id: doc.id, ...doc.data() }
        });
    } catch (error) {
        console.error('[Social Media API] Error fetching post:', error);
        res.status(500).json({
            error: 'Failed to fetch post',
            message: error.message
        });
    }
});

/**
 * Create a new post
 * POST /posts
 */
router.post('/posts', async (req, res) => {
    try {
        const { content, platforms, scheduledAt, imageUrl, postImmediately } = req.body;

        if (!content || !platforms || !Array.isArray(platforms) || platforms.length === 0) {
            return res.status(400).json({
                error: 'Content and platforms are required'
            });
        }

        const postId = uuidv4();
        const postTime = postImmediately
            ? new Date().toISOString()
            : (scheduledAt || new Date(Date.now() + 3600000).toISOString());

        const postData = {
            content,
            platforms,
            scheduled_date: postTime,
            published_date: postImmediately ? postTime : null,
            status: postImmediately ? 'published' : 'scheduled',
            image: imageUrl || null,
            image_url: imageUrl || null,
            source: 'manual',
            insights: null,
            created_at: FieldValue.serverTimestamp(),
            updated_at: FieldValue.serverTimestamp()
        };

        await db.collection('social_media_posts').doc(postId).set(postData);

        // Create notification
        try {
            const notificationTitle = postImmediately ? 'Social Media Post Published' : 'Social Media Post Scheduled';
            const notificationMessage = postImmediately
                ? `Post published to ${platforms.length} platform(s).`
                : `Post scheduled for ${new Date(postTime).toLocaleString()} on ${platforms.length} platform(s).`;

            await notificationService.createSuccessNotification(
                notificationTitle,
                notificationMessage,
                {
                    category: 'social_media',
                    link: `/marketing/social-media?id=${postId}`,
                    metadata: { postId, platforms, status: postData.status }
                }
            );
        } catch (notifyError) {
            console.error('Error creating notification:', notifyError);
        }

        res.status(201).json({
            success: true,
            message: postImmediately ? 'Post published successfully' : 'Post scheduled successfully',
            data: { id: postId, ...postData }
        });
    } catch (error) {
        console.error('[Social Media API] Error creating post:', error);

        // Create error notification
        try {
            await notificationService.createErrorNotification(
                'Social Media Post Failed',
                `Failed to create post: ${error.message}`,
                {
                    category: 'social_media',
                    metadata: { error: error.message }
                }
            );
        } catch (notifyError) {
            console.error('Error creating error notification:', notifyError);
        }

        res.status(500).json({
            error: 'Failed to create post',
            message: error.message
        });
    }
});

/**
 * Update a post
 * PUT /posts/:id
 */
router.put('/posts/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        // Convert frontend field names to Firestore field names
        const firestoreUpdates = {};
        if (updates.content) firestoreUpdates.content = updates.content;
        if (updates.platforms) firestoreUpdates.platforms = updates.platforms;
        if (updates.scheduledDate) firestoreUpdates.scheduled_date = updates.scheduledDate;
        if (updates.publishedDate) firestoreUpdates.published_date = updates.publishedDate;
        if (updates.status) firestoreUpdates.status = updates.status;
        if (updates.image !== undefined) {
            firestoreUpdates.image = updates.image;
            firestoreUpdates.image_url = updates.image;
        }
        if (updates.insights) firestoreUpdates.insights = updates.insights;

        firestoreUpdates.updated_at = FieldValue.serverTimestamp();

        await db.collection('social_media_posts').doc(id).update(firestoreUpdates);

        res.json({
            success: true,
            message: 'Post updated successfully',
            data: { id, ...updates }
        });
    } catch (error) {
        console.error('[Social Media API] Error updating post:', error);
        res.status(500).json({
            error: 'Failed to update post',
            message: error.message
        });
    }
});

/**
 * Delete a post
 * DELETE /posts/:id
 */
router.delete('/posts/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await db.collection('social_media_posts').doc(id).delete();

        res.json({
            success: true,
            message: 'Post deleted successfully'
        });
    } catch (error) {
        console.error('[Social Media API] Error deleting post:', error);
        res.status(500).json({
            error: 'Failed to delete post',
            message: error.message
        });
    }
});

/**
 * Bulk delete posts
 * POST /posts/bulk-delete
 */
router.post('/posts/bulk-delete', async (req, res) => {
    try {
        const { ids } = req.body;

        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'Post IDs array is required' });
        }

        const batch = db.batch();
        ids.forEach(id => {
            const docRef = db.collection('social_media_posts').doc(id);
            batch.delete(docRef);
        });

        await batch.commit();

        res.json({
            success: true,
            message: `${ids.length} post(s) deleted successfully`,
            deleted: ids.length
        });
    } catch (error) {
        console.error('[Social Media API] Error bulk deleting posts:', error);
        res.status(500).json({
            error: 'Failed to delete posts',
            message: error.message
        });
    }
});

/**
 * Update post status
 * PATCH /posts/:id/status
 */
router.patch('/posts/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!status || !['scheduled', 'published', 'paused', 'failed'].includes(status)) {
            return res.status(400).json({ error: 'Valid status is required' });
        }

        await db.collection('social_media_posts').doc(id).update({
            status,
            updated_at: FieldValue.serverTimestamp()
        });

        res.json({
            success: true,
            message: 'Post status updated successfully',
            data: { id, status }
        });
    } catch (error) {
        console.error('[Social Media API] Error updating post status:', error);
        res.status(500).json({
            error: 'Failed to update post status',
            message: error.message
        });
    }
});

/**
 * Get post insights
 * GET /posts/:id/insights
 */
router.get('/posts/:id/insights', async (req, res) => {
    try {
        const { id } = req.params;
        const doc = await db.collection('social_media_posts').doc(id).get();

        if (!doc.exists) {
            return res.status(404).json({ error: 'Post not found' });
        }

        const postData = doc.data();
        const insights = postData.insights || null;

        res.json({
            success: true,
            data: insights
        });
    } catch (error) {
        console.error('[Social Media API] Error fetching insights:', error);
        res.status(500).json({
            error: 'Failed to fetch insights',
            message: error.message
        });
    }
});

/**
 * Get aggregated insights
 * GET /insights
 */
router.get('/insights', async (req, res) => {
    try {
        const { platform, startDate, endDate } = req.query;

        let query = db.collection('social_media_posts');

        if (platform && platform !== 'all') {
            query = query.where('platforms', 'array-contains', platform);
        }

        const snapshot = await query.get();
        const posts = snapshot.docs.map(doc => doc.data());

        // Calculate aggregated insights
        const insights = {
            totalPosts: posts.length,
            totalReach: 0,
            totalEngagement: 0,
            totalLikes: 0,
            totalComments: 0,
            totalShares: 0,
            platformStats: {
                facebook: { posts: 0, reach: 0, engagement: 0 },
                twitter: { posts: 0, reach: 0, engagement: 0 },
                instagram: { posts: 0, reach: 0, engagement: 0 },
                linkedin: { posts: 0, reach: 0, engagement: 0 },
                whatsapp: { posts: 0, reach: 0, engagement: 0 },
                youtube: { posts: 0, reach: 0, engagement: 0 }
            }
        };

        posts.forEach(post => {
            if (post.insights) {
                insights.totalReach += post.insights.reach || 0;
                insights.totalEngagement += post.insights.engagement || 0;
                insights.totalLikes += post.insights.likes || 0;
                insights.totalComments += post.insights.comments || 0;
                insights.totalShares += post.insights.shares || 0;
            }

            if (post.platforms) {
                post.platforms.forEach(platformId => {
                    if (insights.platformStats[platformId]) {
                        insights.platformStats[platformId].posts += 1;
                        if (post.insights) {
                            insights.platformStats[platformId].reach += post.insights.reach || 0;
                            insights.platformStats[platformId].engagement += post.insights.engagement || 0;
                        }
                    }
                });
            }
        });

        res.json({
            success: true,
            data: insights
        });
    } catch (error) {
        console.error('[Social Media API] Error fetching insights:', error);
        res.status(500).json({
            error: 'Failed to fetch insights',
            message: error.message
        });
    }
});

/**
 * Get platform statistics
 * GET /stats
 */
router.get('/stats', async (req, res) => {
    try {
        const snapshot = await db.collection('social_media_posts').get();
        const posts = snapshot.docs.map(doc => doc.data());

        const stats = {
            total: posts.length,
            published: posts.filter(p => p.status === 'published').length,
            scheduled: posts.filter(p => p.status === 'scheduled').length,
            paused: posts.filter(p => p.status === 'paused').length,
            failed: posts.filter(p => p.status === 'failed').length,
            webhook: posts.filter(p => p.source === 'webhook').length,
            manual: posts.filter(p => p.source === 'manual' || !p.source).length,
            byPlatform: {
                facebook: posts.filter(p => p.platforms?.includes('facebook')).length,
                twitter: posts.filter(p => p.platforms?.includes('twitter')).length,
                instagram: posts.filter(p => p.platforms?.includes('instagram')).length,
                linkedin: posts.filter(p => p.platforms?.includes('linkedin')).length,
                whatsapp: posts.filter(p => p.platforms?.includes('whatsapp')).length,
                youtube: posts.filter(p => p.platforms?.includes('youtube')).length
            }
        };

        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('[Social Media API] Error fetching stats:', error);
        res.status(500).json({
            error: 'Failed to fetch stats',
            message: error.message
        });
    }
});

module.exports = router;
