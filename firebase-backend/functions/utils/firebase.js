const admin = require('firebase-admin');

// Initialize Firebase Admin
let adminApp;
try {
    // Check if already initialized
    adminApp = admin.app();
} catch (e) {
    // Initialize if not already initialized
    const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID;
    adminApp = admin.initializeApp({
        // Firebase Admin SDK automatically uses Application Default Credentials
        // in Cloud Functions environment, so no explicit credentials needed
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET ||
            (projectId ? `${projectId}.firebasestorage.app` : undefined) ||
            (projectId ? `${projectId}.appspot.com` : undefined)
    });
}

const db = admin.firestore();
const storage = admin.storage();

// Helper function to get storage bucket with proper error handling
const getStorageBucket = async () => {
    const projectId = process.env.GCLOUD_PROJECT ||
        process.env.FIREBASE_PROJECT_ID ||
        adminApp.options.projectId ||
        adminApp.options.credential?.projectId;

    // Try default bucket first (might auto-detect the correct bucket)
    let bucket = storage.bucket();

    // Verify default bucket exists, if not try explicit names
    let defaultBucketWorks = false;
    if (bucket && bucket.name) {
        try {
            const [exists] = await bucket.exists();
            if (exists) {
                defaultBucketWorks = true;
            }
        } catch (err) {
            // Try getMetadata as fallback
            try {
                await bucket.getMetadata();
                defaultBucketWorks = true;
            } catch (metaErr) {
                // Default bucket doesn't work
            }
        }
    }

    if (defaultBucketWorks) {
        console.log(`✅ Using default storage bucket: ${bucket.name}`);
        return bucket;
    }

    // If default doesn't work, try project-specific buckets
    if (!bucket || !bucket.name) {
        const bucketNames = [
            process.env.FIREBASE_STORAGE_BUCKET,
            process.env.STORAGE_BUCKET,
            projectId ? `${projectId}.firebasestorage.app` : null, // New Firebase Storage format (prioritized)
            projectId ? `${projectId}.appspot.com` : null // Legacy format
        ].filter(Boolean);

        for (const bucketName of bucketNames) {
            try {
                bucket = storage.bucket(bucketName);
                // Try exists() first
                try {
                    const [exists] = await bucket.exists();
                    if (exists) {
                        console.log(`✅ Using storage bucket: ${bucket.name}`);
                        return bucket;
                    }
                } catch (existsErr) {
                    // If exists() fails, try getMetadata() as fallback
                    // Sometimes bucket exists but exists() returns false
                    try {
                        await bucket.getMetadata();
                        console.log(`✅ Using storage bucket (verified via metadata): ${bucket.name}`);
                        return bucket;
                    } catch (metaErr) {
                        // Both failed, try next bucket
                        continue;
                    }
                }
            } catch (err) {
                continue;
            }
        }
    } else {
        // Default bucket found, verify it's accessible
        try {
            const [exists] = await bucket.exists();
            if (exists) {
                console.log(`✅ Using default storage bucket: ${bucket.name}`);
                return bucket;
            }
        } catch (existsErr) {
            // Try getMetadata as fallback
            try {
                await bucket.getMetadata();
                console.log(`✅ Using default storage bucket (verified via metadata): ${bucket.name}`);
                return bucket;
            } catch (metaErr) {
                // Default bucket not accessible, will try explicit names below
            }
        }
    }

    if (!bucket || !bucket.name) {
        throw new Error(
            'Failed to initialize Firebase Storage bucket. ' +
            'Please ensure Firebase Storage is enabled for your project in the Firebase Console ' +
            'and that the service account has appropriate permissions. ' +
            'Also, verify your project ID and bucket name configuration.'
        );
    }

    // Final verification attempt
    try {
        await bucket.getMetadata();
        return bucket;
    } catch (err) {
        throw new Error(
            `Storage bucket "${bucket.name}" is not accessible. ` +
            `Error: ${err.message}. ` +
            'Please check Firebase Storage permissions and ensure Storage is fully enabled.'
        );
    }
};

module.exports = {
    admin,
    db,
    storage,
    getStorageBucket
};
