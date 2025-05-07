const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const braintreeRoutes = require('./routes/braintreeRoutes');
const { handleServerError } = require('./utils/errorHandler');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Routes
app.use('/api/', braintreeRoutes);

// Global Error Handler
app.use(handleServerError);

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
