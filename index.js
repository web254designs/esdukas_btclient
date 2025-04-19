const express = require('express');
const cors = require('cors');
const braintree = require('braintree');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const bodyParser = require('body-parser');
const wrapAsync = require('./utils/wrapAsync');
const fs = require('fs');
const path = require('path');
const https = require('https');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// 🔐 Optional: Secure with an auth token
const AUTH_SECRET = process.env.AUTH_SECRET || 'sneaky-bear-42';

// 🌍 Currency to Merchant Account mapping
const merchantAccounts = {
    USD: process.env.BRAINTREE_MERCHANT_USD || 'esdukas',
    KES: process.env.BRAINTREE_MERCHANT_KES || 'esdukas_kes',
    UGX: process.env.BRAINTREE_MERCHANT_UGX || 'esdukas_ugx',
    EUR: process.env.BRAINTREE_MERCHANT_EUR || 'esdukas_eur',
    // Add more as needed
};

// Utility function to sanitize inputs (HTML escaping, trimming, etc.)
function sanitize(input) {
    return input ? input.replace(/</g, '&lt;').replace(/>/g, '&gt;').trim() : '';
}

// Function to get Merchant Account ID
function getMerchantAccountId(currency) {
    const code = currency.toUpperCase();
    if (!merchantAccounts[code]) {
        console.warn(`⚠️ Unsupported currency "${currency}", falling back to USD`);
    }
    return merchantAccounts[code] || merchantAccounts['USD'];
}

// 🧾 Nodemailer setup (Gmail example)
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_FROM,
        pass: process.env.EMAIL_PASSWORD,
    },
});

// Decode Firebase credentials from environment variable
const serviceAccount = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, 'base64').toString('utf-8'));

// 🔥 Initialize Firebase Admin with decoded credentials
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// 💳 Braintree setup
const gateway = new braintree.BraintreeGateway({
    environment: braintree.Environment.Sandbox,
    merchantId: process.env.BRAINTREE_MERCHANT_ID,
    publicKey: process.env.BRAINTREE_PUBLIC_KEY,
    privateKey: process.env.BRAINTREE_PRIVATE_KEY,
});

const { v4: uuidv4 } = require('uuid');
const { getAuth } = require('firebase-admin/auth');

// Verify Firebase token middleware
async function verifyFirebaseToken(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const idToken = authHeader.split('Bearer ')[1];

    try {
        const decodedToken = await getAuth().verifyIdToken(idToken);
        req.user = decodedToken; // now available for use in routes
        next();
    } catch (err) {
        console.error('❌ Firebase Auth verification failed:', err);
        return res.status(403).json({ error: 'Unauthorized' });
    }
}

// 🎫 Get client token
app.get('/api/braintree/token', wrapAsync(async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${AUTH_SECRET}`) {
        return res.status(403).json({ error: 'Unauthorized' });
    }

    const response = await gateway.clientToken.generate({});
    res.send(response.clientToken);
}));

// 💰 Checkout handler
app.post('/api/braintree/checkout', verifyFirebaseToken, wrapAsync(async (req, res) => {
    const { nonce, amount, currency = 'USD', email, metadata = {} } = req.body;
    const authHeader = req.headers.authorization;

    if (!authHeader || authHeader !== `Bearer ${AUTH_SECRET}`) {
        return res.status(403).json({ error: 'Unauthorized' });
    }

    const cartId = `cart_${uuidv4()}`;
    const items = (metadata.items || []).map(item => ({
        name: sanitize(item.name),
        quantity: item.quantity || 1,
        price: parseFloat(item.price) || 0
    }));
    const userId = metadata.userId || null;

    // 🛒 Log unpaid cart FIRST
    await db.collection('carts').doc(cartId).set({
        cartId,
        transactionId: null,
        userId,
        email,
        items,
        totalAmount: amount,
        currency,
        createdAt: Date.now(), // 🔄
        paid: false,
    });

    const saleRequest = {
        amount,
        paymentMethodNonce: nonce,
        merchantAccountId: getMerchantAccountId(currency),
        options: { submitForSettlement: true },
        customFields: {
            ...metadata,
            cartId,
        },
    };

    const result = await gateway.transaction.sale(saleRequest);

    if (!result.success) {
        console.error('❌ Braintree Payment Failed:', result.message);
        return res.status(400).json({ error: 'Payment failed', details: result.message });
    }

    const transaction = result.transaction;
    const transactionId = transaction.id;

    // 🧾 Log transaction
    await db.collection('transactions').add({
        transactionId,
        amount,
        currency,
        email,
        metadata: { ...metadata, cartId },
        createdAt: Date.now(), // 🔄
        status: transaction.status,
    });

    // ✅ Update cart to mark as paid
    await db.collection('carts').doc(cartId).update({
        transactionId,
        paid: true,
        updatedAt: Date.now(), // 🔄
    });

    // 📧 Email receipt
    if (email) {
        try {
            const emailTemplate = fs.readFileSync(path.join(__dirname, 'emailTemplate.js'), 'utf8');
            const emailContent = emailTemplate
                .replace('{{transactionId}}', transactionId)
                .replace('{{currency}}', currency)
                .replace('{{amount}}', amount)
                .replace('{{items}}', items.map(item => `
                    <tr>
                        <td>${item.name}</td>
                        <td>${item.quantity}</td>
                        <td>${currency} ${(item.price * item.quantity).toFixed(2)}</td>
                    </tr>
                `).join(''));

            await transporter.sendMail({
                from: `"Esdukas" <${process.env.EMAIL_FROM}>`,
                to: email,
                subject: 'Your Esdukas Payment Receipt',
                html: emailContent
            });
        } catch (err) {
            console.error('❌ Failed to send email:', err);
        }
    }

    res.json({
        success: true,
        transactionId,
        cartId,
        status: transaction.status,
    });
}));

// Server error handling middleware
app.use(async (err, req, res, next) => {
    console.error('❌ Unexpected Error:', err);

    try {
        await db.collection('logs').doc().set({
            type: 'server-error',
            message: err.message,
            stack: err.stack,
            path: req.originalUrl,
            timestamp: Date.now(),
        });
    } catch (logError) {
        console.error('⚠️ Failed to log error to Firestore:', logError);
    }

    res.status(500).json({ error: 'Internal server error' });
});

// 🚀 Server start
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`🚀 Braintree server running on port ${PORT}`);
});
