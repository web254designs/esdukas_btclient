const db = require('../services/firebase');

const handleServerError = async (err, req, res, next) => {
    console.error('❌ Unexpected Error:', err);
    try {
        await db.collection('logs').add({
            type: 'server-error',
            message: err.message,
            stack: err.stack,
            path: req.originalUrl,
            timestamp: Date.now(),
        });
    } catch (logErr) {
        console.error('⚠️ Failed to log to Firestore:', logErr);
    }

    res.status(500).json({ error: 'Internal server error' });
};

module.exports = { handleServerError };
