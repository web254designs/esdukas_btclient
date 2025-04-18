const express = require('express');
const cors = require('cors');
const braintree = require('braintree');

const app = express();
app.use(cors());

// 🔒 Optional: Secure with an auth token
const AUTH_SECRET = process.env.AUTH_SECRET || 'sneaky-bear-42';

const gateway = new braintree.BraintreeGateway({
    environment: braintree.Environment.Sandbox,
    merchantId: process.env.BRAINTREE_MERCHANT_ID,
    publicKey: process.env.BRAINTREE_PUBLIC_KEY,
    privateKey: process.env.BRAINTREE_PRIVATE_KEY,
});

app.get('/api/braintree/token', async (req, res) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || authHeader !== `Bearer ${AUTH_SECRET}`) {
        return res.status(403).json({ error: 'Unauthorized' });
    }

    try {
        const response = await gateway.clientToken.generate({});
        res.send(response.clientToken);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Token generation failed' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Braintree server running on port ${PORT}`);
});
