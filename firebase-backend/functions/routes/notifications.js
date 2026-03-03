const express = require('express');
const router = express.Router();
const { db } = require('../utils/firebase');
const notificationService = require('../utils/notificationService');

// ============================================
// NOTIFICATIONS MODULE
// ============================================

/**
 * Get all notifications
 * GET /
 * Query params:
 * - limit: number of notifications to return (default: 50)
 * - unread: 'true' to get only unread notifications
 * - userId: filter by user ID (null for global notifications)
 * - category: filter by category (e.g., 'campaign', 'certificate', 'system')
 */
router.get('/', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const unreadOnly = req.query.unread === 'true';
        const userId = req.query.userId !== undefined ? req.query.userId : null;
        const category = req.query.category || null;

        let query = db.collection('notifications');

        // Filter by userId
        if (userId !== null && userId !== 'null') {
            query = query.where('userId', '==', userId);
        } else {
            query = query.where('userId', '==', null);
        }

        // Filter by category if provided
        if (category) {
            query = query.where('category', '==', category);
        }

        // Filter by read status
        if (unreadOnly) {
            query = query.where('read', '==', false);
        }

        // Order by created_at descending
        query = query.orderBy('created_at', 'desc').limit(limit);

        const snapshot = await query.get();

        const notifications = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            notifications.push({
                id: doc.id,
                ...data,
                // Convert Firestore timestamps to ISO strings for JSON response
                created_at: data.created_at?.toDate ? data.created_at.toDate().toISOString() : data.created_at,
                updated_at: data.updated_at?.toDate ? data.updated_at.toDate().toISOString() : data.updated_at,
                read_at: data.read_at?.toDate ? data.read_at.toDate().toISOString() : data.read_at
            });
        });

        // Get unread count for the user
        const unreadCount = await notificationService.getUnreadCount(userId);

        res.json({
            success: true,
            data: notifications,
            unreadCount
        });
    } catch (error) {
        console.error('Error fetching notifications:', error);
        res.status(500).json({ error: 'Failed to fetch notifications', details: error.message });
    }
});

/**
 * Get unread notification count
 * GET /unread-count
 * Query params:
 * - userId: Optional user ID (null for global notifications)
 */
router.get('/unread-count', async (req, res) => {
    try {
        const userId = req.query.userId !== undefined ? req.query.userId : null;
        const count = await notificationService.getUnreadCount(userId);

        res.json({
            success: true,
            count
        });
    } catch (error) {
        console.error('Error fetching unread count:', error);
        res.status(500).json({ error: 'Failed to fetch unread count', details: error.message });
    }
});

/**
 * Create a notification
 * POST /
 * Body params:
 * - title: Notification title (required)
 * - message: Notification message (required)
 * - type: 'info', 'success', 'warning', 'error' (default: 'info')
 * - link: Optional link/URL
 * - userId: Optional user ID (null for global notifications)
 * - category: Optional category (e.g., 'campaign', 'certificate', 'system')
 * - metadata: Optional metadata object
 */
router.post('/', async (req, res) => {
    try {
        const { title, message, type, link, userId, category, metadata } = req.body;

        if (!title || !message) {
            return res.status(400).json({ error: 'Title and message are required' });
        }

        const notificationData = await notificationService.createNotification({
            title,
            message,
            type: type || 'info',
            link: link || null,
            userId: userId !== undefined ? userId : null,
            category: category || null,
            metadata: metadata || {}
        });

        res.status(201).json({
            success: true,
            message: 'Notification created successfully',
            data: notificationData
        });
    } catch (error) {
        console.error('Error creating notification:', error);
        res.status(500).json({ error: 'Failed to create notification', details: error.message });
    }
});

/**
 * Mark notification as read
 * PUT /:id/read
 */
router.put('/:id/read', async (req, res) => {
    try {
        const { id } = req.params;
        await notificationService.markAsRead(id);

        res.json({ success: true, message: 'Notification marked as read' });
    } catch (error) {
        if (error.message === 'Notification not found') {
            return res.status(404).json({ error: 'Notification not found' });
        }
        console.error('Error marking notification as read:', error);
        res.status(500).json({ error: 'Failed to update notification', details: error.message });
    }
});

/**
 * Mark all notifications as read
 * PUT /read-all
 * Query params:
 * - userId: Optional user ID (null for global notifications)
 */
router.put('/read-all', async (req, res) => {
    try {
        const userId = req.query.userId !== undefined ? req.query.userId : null;
        const count = await notificationService.markAllAsRead(userId);

        res.json({
            success: true,
            message: `Marked ${count} notifications as read`
        });
    } catch (error) {
        console.error('Error marking all notifications as read:', error);
        res.status(500).json({ error: 'Failed to update notifications', details: error.message });
    }
});

/**
 * Delete a notification
 * DELETE /:id
 */
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const docRef = db.collection('notifications').doc(id);
        const doc = await docRef.get();

        if (!doc.exists) {
            return res.status(404).json({ error: 'Notification not found' });
        }

        await docRef.delete();

        res.json({ success: true, message: 'Notification deleted successfully' });
    } catch (error) {
        console.error('Error deleting notification:', error);
        res.status(500).json({ error: 'Failed to delete notification', details: error.message });
    }
});

/**
 * Delete old read notifications (cleanup)
 * DELETE /cleanup
 * Query params:
 * - daysOld: Number of days old to delete (default: 30)
 * - userId: Optional user ID (null for global notifications)
 */
router.delete('/cleanup', async (req, res) => {
    try {
        const daysOld = parseInt(req.query.daysOld) || 30;
        const userId = req.query.userId !== undefined ? req.query.userId : null;
        const deletedCount = await notificationService.deleteOldNotifications(daysOld, userId);

        res.json({
            success: true,
            message: `Deleted ${deletedCount} old notifications`,
            deletedCount
        });
    } catch (error) {
        console.error('Error cleaning up notifications:', error);
        res.status(500).json({ error: 'Failed to cleanup notifications', details: error.message });
    }
});

module.exports = router;
