const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { FieldValue } = require('firebase-admin/firestore');
const { db } = require('../utils/firebase');
const notificationService = require('../utils/notificationService');

// ============================================
// MARKETING MODULE - CONTACTS
// ============================================

/**
 * Get all contacts
 * GET /
 */
router.get('/', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 100;
        const offset = parseInt(req.query.offset) || 0;
        const search = req.query.search || '';

        let query = db.collection('marketing_contacts')
            .orderBy('created_at', 'desc');

        const snapshot = await query.limit(limit).offset(offset).get();

        let contacts = [];
        snapshot.forEach(doc => {
            contacts.push({ id: doc.id, ...doc.data() });
        });

        // Apply search filter in memory (Firestore doesn't support text search natively)
        if (search) {
            const searchLower = search.toLowerCase();
            contacts = contacts.filter(c =>
                c.name?.toLowerCase().includes(searchLower) ||
                c.email?.toLowerCase().includes(searchLower) ||
                c.phone?.includes(search)
            );
        }

        const allDocs = await db.collection('marketing_contacts').get();
        const total = allDocs.size;

        res.json({
            success: true,
            data: contacts,
            pagination: { total, limit, offset, hasMore: offset + limit < total }
        });
    } catch (error) {
        console.error('Error fetching contacts:', error);
        res.status(500).json({ error: 'Failed to fetch contacts', details: error.message });
    }
});

/**
 * Get contact by ID
 * GET /:id
 */
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const doc = await db.collection('marketing_contacts').doc(id).get();

        if (!doc.exists) {
            return res.status(404).json({ error: 'Contact not found' });
        }

        res.json({ success: true, data: { id: doc.id, ...doc.data() } });
    } catch (error) {
        console.error('Error fetching contact:', error);
        res.status(500).json({ error: 'Failed to fetch contact', details: error.message });
    }
});

/**
 * Create a contact
 * POST /
 */
router.post('/', async (req, res) => {
    try {
        const { name, email, phone, reraAwardeNo, certificateNumber, professional, tags } = req.body;

        if (!name && !email && !phone) {
            return res.status(400).json({ error: 'At least one of name, email, or phone is required' });
        }

        const id = uuidv4();
        const contactData = {
            id,
            name: name || '',
            email: email || '',
            phone: phone || '',
            rera_awarde_no: reraAwardeNo || '',
            certificate_number: certificateNumber || '',
            professional: professional || '',
            tags: tags || [],
            email_sent_count: 0,
            whatsapp_sent_count: 0,
            last_contacted_at: null,
            created_at: FieldValue.serverTimestamp(),
            updated_at: FieldValue.serverTimestamp()
        };

        await db.collection('marketing_contacts').doc(id).set(contactData);

        res.status(201).json({
            success: true,
            message: 'Contact created successfully',
            data: contactData
        });
    } catch (error) {
        console.error('Error creating contact:', error);
        res.status(500).json({ error: 'Failed to create contact', details: error.message });
    }
});

/**
 * Bulk import contacts
 * POST /bulk
 */
router.post('/bulk', async (req, res) => {
    try {
        const { contacts } = req.body;

        if (!Array.isArray(contacts) || contacts.length === 0) {
            return res.status(400).json({ error: 'Contacts array is required' });
        }

        const BATCH_SIZE = 500;
        const importedContacts = [];
        let currentBatch = db.batch();
        let operationCount = 0;

        for (let i = 0; i < contacts.length; i++) {
            const contact = contacts[i];
            const id = uuidv4();
            const contactData = {
                id,
                name: contact.name || contact.Name || contact['AWARDE NAME'] || contact['Awarde Name'] || '',
                email: contact.email || contact.Email || contact.EMAIL || '',
                phone: String(contact.phone || contact.Phone || contact['Phone Number'] || contact['Phone number'] || contact.Whatsapp || contact.whatsapp || contact.WHATSAPP || contact['WhatsApp'] || ''),
                rera_awarde_no: contact['AWARDE RERA REGISTRATION NO.'] || contact['RERA Awarde No.'] || contact['RERA Awarde No'] || contact.reraAwardeNo || contact['Rera No'] || '',
                certificate_number: contact['CERTIFICATE NUMBER'] || contact['Certificate Number'] || contact.certificateNumber || '',
                professional: contact['AWARDE PROFESSION'] || contact.Professional || contact.professional || contact.Profession || '',
                tags: contact.tags || [],
                email_sent_count: 0,
                whatsapp_sent_count: 0,
                last_contacted_at: null,
                created_at: FieldValue.serverTimestamp(),
                updated_at: FieldValue.serverTimestamp()
            };

            currentBatch.set(db.collection('marketing_contacts').doc(id), contactData);
            importedContacts.push(contactData);
            operationCount++;

            // If batch is full, commit and start a new one
            if (operationCount === BATCH_SIZE) {
                await currentBatch.commit();
                currentBatch = db.batch();
                operationCount = 0;
            }
        }

        // Commit any remaining operations
        if (operationCount > 0) {
            await currentBatch.commit();
        }

        // Create notification
        try {
            await notificationService.createBulkOperationNotification(
                'Bulk Contact Import',
                importedContacts.length,
                importedContacts.length,
                0, // Assuming all valid since we don't have per-row validation failure tracking here
                {
                    link: '/marketing/contacts',
                    metadata: { importedCount: importedContacts.length }
                }
            );
        } catch (notifyError) {
            console.error('Error creating notification:', notifyError);
        }

        res.status(201).json({
            success: true,
            message: `Successfully imported ${importedContacts.length} contacts`,
            data: { count: importedContacts.length, contacts: importedContacts }
        });
    } catch (error) {
        console.error('Error bulk importing contacts:', error);
        // Create error notification
        try {
            await notificationService.createErrorNotification(
                'Bulk Import Failed',
                `Failed to import contacts: ${error.message}`,
                {
                    category: 'bulk_operation',
                    metadata: { error: error.message }
                }
            );
        } catch (notifyError) {
            console.error('Error creating error notification:', notifyError);
        }

        res.status(500).json({ error: 'Failed to import contacts', details: error.message });
    }
});

/**
 * Bulk delete contacts
 * POST /bulk-delete
 */
router.post('/bulk-delete', async (req, res) => {
    try {
        const { ids } = req.body;

        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'IDs array is required' });
        }

        const batch = db.batch();
        ids.forEach(id => {
            batch.delete(db.collection('marketing_contacts').doc(id));
        });

        await batch.commit();

        res.json({
            success: true,
            message: `Successfully deleted ${ids.length} contacts`
        });
    } catch (error) {
        console.error('Error bulk deleting contacts:', error);
        res.status(500).json({ error: 'Failed to delete contacts', details: error.message });
    }
});

/**
 * Update a contact
 * PUT /:id
 */
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        delete updates.id;
        delete updates.created_at;
        updates.updated_at = FieldValue.serverTimestamp();

        const docRef = db.collection('marketing_contacts').doc(id);
        const doc = await docRef.get();

        if (!doc.exists) {
            return res.status(404).json({ error: 'Contact not found' });
        }

        await docRef.update(updates);
        const updatedDoc = await docRef.get();

        res.json({
            success: true,
            message: 'Contact updated successfully',
            data: { id: updatedDoc.id, ...updatedDoc.data() }
        });
    } catch (error) {
        console.error('Error updating contact:', error);
        res.status(500).json({ error: 'Failed to update contact', details: error.message });
    }
});

/**
 * Delete a contact
 * DELETE /:id
 */
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const docRef = db.collection('marketing_contacts').doc(id);
        const doc = await docRef.get();

        if (!doc.exists) {
            return res.status(404).json({ error: 'Contact not found' });
        }

        await docRef.delete();

        res.json({ success: true, message: 'Contact deleted successfully' });
    } catch (error) {
        console.error('Error deleting contact:', error);
        res.status(500).json({ error: 'Failed to delete contact', details: error.message });
    }
});

module.exports = router;
