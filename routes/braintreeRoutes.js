const express = require('express');
const router = express.Router();
const gateway = require('../services/braintree');
const db = require('../services/firebase');
const sanitize = require('../utils/sanitize');
const transporter = require('../services/email');
const { AUTH_SECRET, merchantAccounts } = require('../config');
const wrapAsync = require('../utils/wrapAsync');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

// Utility
const getMerchantAccountId = (currency) =>
    merchantAccounts[currency.toUpperCase()] || merchantAccounts['USD'];

// 🔐 Middleware to check Bearer token
function checkAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${AUTH_SECRET}`) {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    next();
}

// 🎫 Client Token
router.get('/token', checkAuth, wrapAsync(async (req, res) => {
    const response = await gateway.clientToken.generate({});
    res.send(response.clientToken);
}));

// 💳 Tokenize Card
router.post('/tokenizeCard', checkAuth, wrapAsync(async (req, res) => {
    const { cardNumber, expirationDate, cvv } = req.body;

    const result = await gateway.paymentMethod.create({
        creditCard: { number: cardNumber, expirationDate, cvv }
    });

    if (result.success) {
        res.json({ nonce: result.paymentMethod.nonce });
    } else {
        res.status(400).json({ error: 'Card tokenization failed', details: result.message });
    }
}));

// 💰 Checkout
router.post('/checkout', checkAuth, wrapAsync(async (req, res) => {
    const { nonce, amount, currency = 'USD', email, metadata = {} } = req.body;

    const cartId = `cart_${uuidv4()}`;
    const items = (metadata.items || []).map(item => ({
        name: sanitize(item.name),
        quantity: item.quantity || 1,
        price: parseFloat(item.price) || 0
    }));
    const userId = metadata.userId || null;

    await db.collection('carts').doc(cartId).set({
        cartId,
        transactionId: null,
        userId,
        email,
        items,
        totalAmount: amount,
        currency,
        createdAt: Date.now(),
        paid: false,
    });

    const saleRequest = {
        amount,
        paymentMethodNonce: nonce,
        merchantAccountId: getMerchantAccountId(currency),
        options: { submitForSettlement: true },
        customFields: { ...metadata, cartId }
    };

    const result = await gateway.transaction.sale(saleRequest);
    if (!result.success) {
        return res.status(400).json({ error: 'Payment failed', details: result.message });
    }

    const transactionId = result.transaction.id;

    await db.collection('transactions').add({
        transactionId,
        amount,
        currency,
        email,
        metadata: { ...metadata, cartId },
        createdAt: Date.now(),
        status: result.transaction.status,
    });

    await db.collection('carts').doc(cartId).update({
        transactionId,
        paid: true,
        updatedAt: Date.now(),
    });

    if (email) {
        try {
            const emailTemplate = fs.readFileSync(path.join(__dirname, '../emailTemplate.js'), 'utf8');
            const emailContent = emailTemplate
                .replace('{{transactionId}}', transactionId)
                .replace('{{currency}}', currency)
                .replace('{{amount}}', amount)
                .replace('{{items}}', items.map(item => `
          <tr>
              <td>${item.name}</td>
              <td>${item.quantity}</td>
              <td>${currency} ${(item.price * item.quantity).toFixed(2)}</td>
          </tr>`).join(''));

            await transporter.sendMail({
                from: `"Esdukas" <${process.env.EMAIL_FROM}>`,
                to: email,
                subject: 'Your Esdukas Payment Receipt',
                html: emailContent,
            });
        } catch (err) {
            console.error('❌ Failed to send email:', err);
        }
    }

    res.json({
        success: true,
        transactionId,
        cartId,
        status: result.transaction.status,
    });
}));

// 🧪 3D Secure (stub)
router.post('/threeDSecure', checkAuth, wrapAsync(async (req, res) => {
    const { nonce, amount } = req.body;
    const result = await gateway.transaction.sale({
        amount,
        paymentMethodNonce: nonce,
        options: {
            submitForSettlement: false,
            threeDSecure: true,
        }
    });

    if (result.success) {
        res.json({ success: true, transactionId: result.transaction.id });
    } else {
        res.status(400).json({ error: '3D Secure Authentication failed', details: result.message });
    }
}));

// 🅿️ PayPal - Create PayPal Transaction (Client sends approval flow request)
router.post('/paypal/createPayment', checkAuth, wrapAsync(async (req, res) => {
    const { amount, currency = 'USD' } = req.body;

    const result = await gateway.transaction.sale({
        amount,
        merchantAccountId: getMerchantAccountId(currency),
        paymentMethodNonce: 'fake-paypal-one-time-nonce', // Use client nonce if available
        options: {
            submitForSettlement: false,
            paypal: {
                customField: 'Esdukas PayPal Order',
                description: 'Your order from Esdukas',
            }
        }
    });

    if (!result.success) {
        return res.status(400).json({ error: result.message });
    }

    res.json({
        success: true,
        transactionId: result.transaction.id,
        status: result.transaction.status,
    });
}));

// ✅ PayPal - Execute after user approval (usually from front-end nonce)
router.post('/paypal/checkout', checkAuth, wrapAsync(async (req, res) => {
    const { nonce, amount, currency = 'USD', email, metadata = {} } = req.body;

    const result = await gateway.transaction.sale({
        amount,
        merchantAccountId: getMerchantAccountId(currency),
        paymentMethodNonce: nonce,
        options: {
            submitForSettlement: true,
        },
        customFields: metadata,
    });

    if (!result.success) {
        return res.status(400).json({ error: result.message });
    }

    const transactionId = result.transaction.id;

    await db.collection('transactions').add({
        transactionId,
        amount,
        currency,
        method: 'paypal',
        email,
        metadata,
        createdAt: Date.now(),
        status: result.transaction.status,
    });

    // You can also send an email here like in the card flow

    res.json({
        success: true,
        transactionId,
        status: result.transaction.status,
    });
}));

// (Optional) 🔐 Vault PayPal account for future use
router.post('/paypal/vault', checkAuth, wrapAsync(async (req, res) => {
    const { nonce, customerId } = req.body;

    const result = await gateway.paymentMethod.create({
        customerId,
        paymentMethodNonce: nonce,
        options: {
            makeDefault: true,
        }
    });

    if (!result.success) {
        return res.status(400).json({ error: result.message });
    }

    res.json({ success: true, paymentMethodToken: result.paymentMethod.token });
}));

module.exports = router;
