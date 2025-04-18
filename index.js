const express = require('express');
const cors = require('cors');
const braintree = require('braintree');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const bodyParser = require('body-parser');

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

// 💳 Braintree setup
const gateway = new braintree.BraintreeGateway({
    environment: braintree.Environment.Sandbox,
    merchantId: process.env.BRAINTREE_MERCHANT_ID,
    publicKey: process.env.BRAINTREE_PUBLIC_KEY,
    privateKey: process.env.BRAINTREE_PRIVATE_KEY,
});

// 🎫 Get client token
app.get('/api/braintree/token', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${AUTH_SECRET}`) {
        return res.status(403).json({ error: 'Unauthorized' });
    }

    try {
        const response = await gateway.clientToken.generate({});
        res.send(response.clientToken);
    } catch (err) {
        console.error('❌ Token generation failed:', err);
        res.status(500).json({ error: 'Token generation failed' });
    }
});

// 💰 Checkout handler
const { v4: uuidv4 } = require('uuid');

app.post('/api/braintree/checkout', async (req, res) => {
    const { nonce, amount, currency = 'USD', email, metadata = {} } = req.body;
    const authHeader = req.headers.authorization;

    if (!authHeader || authHeader !== `Bearer ${AUTH_SECRET}`) {
        return res.status(403).json({ error: 'Unauthorized' });
    }

    const cartId = `cart_${uuidv4()}`;
    const items = metadata.items || [];
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
        createdAt: new Date().toISOString(),
        paid: false,
    });

    try {
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
            return res.status(500).json({ error: result.message, cartId });
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
            createdAt: new Date().toISOString(),
            status: transaction.status,
        });

        // ✅ Update cart to mark as paid
        await db.collection('carts').doc(cartId).update({
            transactionId,
            paid: true,
            updatedAt: new Date().toISOString(),
        });

        // 📧 Email receipt
        if (email) {
            await transporter.sendMail({
                from: `"Esdukas" <${process.env.EMAIL_FROM}>`,
                to: email,
                subject: 'Your Payment Receipt',
                text: `Thanks for your payment of ${currency} ${amount}.\nTransaction ID: ${transactionId}`,
            });
        }

        res.json({
            success: true,
            transactionId,
            cartId,
            status: transaction.status,
        });
    } catch (err) {
        console.error('❌ Checkout failed:', err);
        res.status(500).json({ error: 'Transaction failed', cartId });
    }
});

// 🚀 Server start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Braintree server running on port ${PORT}`);
});
