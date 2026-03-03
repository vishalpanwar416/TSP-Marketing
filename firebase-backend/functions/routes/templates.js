const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { FieldValue } = require('firebase-admin/firestore');
const { db } = require('../utils/firebase');

// ============================================
// MARKETING MODULE - TEMPLATES
// ============================================

/**
 * Get all templates
 * GET /
 */
router.get('/', async (req, res) => {
    try {
        const type = req.query.type;

        let query = db.collection('marketing_templates')
            .orderBy('created_at', 'desc');

        const snapshot = await query.get();

        let templates = [];
        snapshot.forEach(doc => {
            templates.push({ id: doc.id, ...doc.data() });
        });

        if (type) {
            templates = templates.filter(t => t.type === type);
        }

        res.json({ success: true, data: templates });
    } catch (error) {
        console.error('Error fetching templates:', error);
        res.status(500).json({ error: 'Failed to fetch templates', details: error.message });
    }
});

/**
 * Get template by ID
 * GET /:id
 */
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const doc = await db.collection('marketing_templates').doc(id).get();

        if (!doc.exists) {
            return res.status(404).json({ error: 'Template not found' });
        }

        res.json({ success: true, data: { id: doc.id, ...doc.data() } });
    } catch (error) {
        console.error('Error fetching template:', error);
        res.status(500).json({ error: 'Failed to fetch template', details: error.message });
    }
});

/**
 * Create a template
 * POST /
 */
router.post('/', async (req, res) => {
    try {
        const { name, type, subject, content } = req.body;

        if (!name || !type || !content) {
            return res.status(400).json({ error: 'Name, type, and content are required' });
        }

        if (!['email', 'whatsapp'].includes(type)) {
            return res.status(400).json({ error: 'Type must be email or whatsapp' });
        }

        const id = uuidv4();
        const templateData = {
            id,
            name,
            type,
            subject: subject || null,
            content,
            usage_count: 0,
            created_at: FieldValue.serverTimestamp(),
            updated_at: FieldValue.serverTimestamp()
        };

        await db.collection('marketing_templates').doc(id).set(templateData);

        res.status(201).json({
            success: true,
            message: 'Template created successfully',
            data: templateData
        });
    } catch (error) {
        console.error('Error creating template:', error);
        res.status(500).json({ error: 'Failed to create template', details: error.message });
    }
});

/**
 * Update a template
 * PUT /:id
 */
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        delete updates.id;
        delete updates.created_at;
        updates.updated_at = FieldValue.serverTimestamp();

        const docRef = db.collection('marketing_templates').doc(id);
        const doc = await docRef.get();

        if (!doc.exists) {
            return res.status(404).json({ error: 'Template not found' });
        }

        await docRef.update(updates);
        const updatedDoc = await docRef.get();

        res.json({
            success: true,
            message: 'Template updated successfully',
            data: { id: updatedDoc.id, ...updatedDoc.data() }
        });
    } catch (error) {
        console.error('Error updating template:', error);
        res.status(500).json({ error: 'Failed to update template', details: error.message });
    }
});

/**
 * Delete a template
 * DELETE /:id
 */
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const docRef = db.collection('marketing_templates').doc(id);
        const doc = await docRef.get();

        if (!doc.exists) {
            return res.status(404).json({ error: 'Template not found' });
        }

        await docRef.delete();

        res.json({ success: true, message: 'Template deleted successfully' });
    } catch (error) {
        console.error('Error deleting template:', error);
        res.status(500).json({ error: 'Failed to delete template', details: error.message });
    }
});

module.exports = router;
