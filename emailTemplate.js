module.exports = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Your Esdukas Payment Receipt</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 0;
            background-color: #f4f4f4;
        }
        .container {
            width: 100%;
            max-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
        }
        h1 {
            color: #333;
            text-align: center;
        }
        .summary {
            margin-bottom: 20px;
        }
        .summary th, .summary td {
            padding: 8px;
            text-align: left;
        }
        .summary th {
            background-color: #f4f4f4;
        }
        .summary td {
            border-bottom: 1px solid #ddd;
        }
        .items-table {
            width: 100%;
            margin-top: 20px;
            border-collapse: collapse;
        }
        .items-table th, .items-table td {
            padding: 10px;
            border: 1px solid #ddd;
        }
        .items-table th {
            background-color: #f4f4f4;
        }
        .total {
            text-align: right;
            margin-top: 20px;
            font-weight: bold;
        }
        .footer {
            text-align: center;
            font-size: 12px;
            color: #777;
            margin-top: 30px;
        }
    </style>
</head>
<body>

<div class="container">
    <h1>Payment Receipt</h1>
    
    <p>Dear Customer,</p>
    <p>Thank you for your purchase! Below are the details of your transaction.</p>

    <div class="summary">
        <table>
            <tr>
                <th>Transaction ID</th>
                <td>{{transactionId}}</td>
            </tr>
            <tr>
                <th>Amount</th>
                <td>{{currency}} {{amount}}</td>
            </tr>
            <tr>
                <th>Status</th>
                <td>Completed</td>
            </tr>
        </table>
    </div>

    <p>Your items:</p>
    <table class="items-table">
        <thead>
            <tr>
                <th>Item</th>
                <th>Quantity</th>
                <th>Price</th>
                <th>Total</th>
            </tr>
        </thead>
        <tbody>
            {{items}}
        </tbody>
    </table>

    <div class="total">
        <p>Total Amount: {{currency}} {{amount}}</p>
    </div>

    <div class="footer">
        <p>Thank you for shopping with Esdukas! If you have any questions, feel free to contact our support team.</p>
        <p>&copy; 2025 Esdukas. All rights reserved.</p>
    </div>
</div>

</body>
</html>
`;
