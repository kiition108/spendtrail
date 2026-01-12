import { classifyCategory } from './categoryClassifier.js';

/**
 * Parses transaction details from a message string (SMS or Email body)
 * @param {string} message - The raw message text
 * @returns {object} Extracted transaction details (amount, merchant, type, etc.) or null if invalid
 */
export const parseTransactionMessage = (message) => {
    if (!message) return null;

    // 1. Amount Parsing
    // Matches: Rs. 100, Rs.70.00, INR 100, ₹100, 100.00 Rs, 510 deduction, etc.
    const amountMatch = message.match(/(?:Rs\.?\s*|INR\.?\s*|₹\s*)([0-9,]+(?:\.[0-9]{1,2})?)|([0-9,]+(?:\.[0-9]{1,2})?)[\s]*(?:Rs|INR|₹)|\b([0-9,]+(?:\.[0-9]{1,2})?)[\s]+(?:deduction|debited|credited|spent|paid|withdrawn)/im);

    if (!amountMatch) return { error: 'Could not parse transaction amount' };

    const amountStr = (amountMatch[1] || amountMatch[2] || amountMatch[3]).replace(/,/g, '');
    const amount = parseFloat(amountStr);

    if (!amount || amount <= 0) {
        return { error: 'Could not parse valid transaction amount' };
    }

    // 2. Merchant Extraction
    const merchantPatterns = [
        /(?:to|at)\s+([A-Za-z0-9\s\-\_\.&]+?)(?:\s+(?:via|using|through|on|by|with|for))/i,
        /spent\s+at\s+([A-Za-z0-9\s\-\_\.&]+?)(?:\s+(?:via|using|through|on))/i,
        /UPI[:\-\s]+([A-Za-z0-9\s\-\_\.&]+?)(?:\s+(?:on|via|ref))/i,
        /(?:to|at|from|merchant)\s+([A-Za-z0-9\s\-\_\.&]{3,30})/i,
    ];

    let merchant = 'Unknown';
    for (const pattern of merchantPatterns) {
        const match = message.match(pattern);
        if (match && match[1]) {
            merchant = match[1].trim().replace(/\s+/g, ' ');
            break;
        }
    }
    merchant = merchant.replace(/[\.\,\;\:]+$/, '').trim();

    // 3. Payment Method Detection
    let detectedPaymentMethod = 'other';
    if (/\bUPI\b/i.test(message)) {
        detectedPaymentMethod = 'upi';
    } else if (/\b(?:card|visa|master|maestro|rupay)\b/i.test(message)) {
        detectedPaymentMethod = 'card';
    } else if (/\b(?:net\s*banking|netbanking|NEFT|RTGS|IMPS)\b/i.test(message)) {
        detectedPaymentMethod = 'netbanking';
    } else if (/\b(?:wallet|paytm|phonepe|gpay|googlepay)\b/i.test(message)) {
        detectedPaymentMethod = 'wallet';
    } else if (/\b(?:cash|ATM|withdrawal)\b/i.test(message)) {
        detectedPaymentMethod = 'cash';
    }

    // 4. Transaction Type Detection & Final Amount
    const { category, subCategory } = classifyCategory(message + ' ' + merchant);

    let type = 'expense'; // Default to expense (was 'debit')
    let finalAmount = amount;

    if (/credited|received|refund|cashback/i.test(message)) {
        type = 'income'; // Changed from 'credit' to 'income'
        finalAmount = -amount; // Negative for income logic
    } else if (/debited|spent|purchased|paid|withdrawn|deducted|deduction/i.test(message)) {
        type = 'expense'; // Changed from 'debit' to 'expense', added 'deducted|deduction'
        finalAmount = amount;
    }

    return {
        amount: finalAmount,
        currency: 'INR',
        merchant,
        paymentMethod: detectedPaymentMethod,
        category,
        subCategory,
        type,
        isParsed: true
    };
};
