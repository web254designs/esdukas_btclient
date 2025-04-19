require('dotenv').config();

module.exports = {
    AUTH_SECRET: process.env.AUTH_SECRET || 'sneaky-bear-42',
    merchantAccounts: {
        USD: process.env.BRAINTREE_MERCHANT_USD || 'esdukas',
        KES: process.env.BRAINTREE_MERCHANT_KES || 'esdukas_kes',
        UGX: process.env.BRAINTREE_MERCHANT_UGX || 'esdukas_ugx',
        EUR: process.env.BRAINTREE_MERCHANT_EUR || 'esdukas_eur',
    }
};
