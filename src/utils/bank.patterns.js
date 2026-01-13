/**
 * Bank-specific email parsing patterns
 * Each bank has different email formats - this helps parse them accurately
 */

export const BANK_PATTERNS = {
    // HDFC Bank
    'hdfcbank.com': {
        name: 'HDFC Bank',
        amountPatterns: [
            /(?:Rs\.?\s*)([0-9,]+(?:\.[0-9]{1,2})?)/i,
            /(?:INR\s*)([0-9,]+(?:\.[0-9]{1,2})?)/i
        ],
        merchantPatterns: [
            /at\s+([A-Z0-9\s\-\_\.&]+?)(?:\s+on\s+)/i,
            /to\s+([A-Z0-9\s\-\_\.&]+?)(?:\s+using)/i
        ],
        transactionTypeKeywords: {
            debit: ['debited', 'spent', 'paid'],
            credit: ['credited', 'received', 'refund']
        }
    },

    // SBI Card
    'sbicard.com': {
        name: 'SBI Card',
        amountPatterns: [
            /Rs\.([0-9,]+(?:\.[0-9]{1,2})?)/i,
            /INR\s*([0-9,]+(?:\.[0-9]{1,2})?)/i
        ],
        merchantPatterns: [
            /at\s+([A-Z0-9\s\-\_\.&]+?)(?:\s+on\s+)/i,
            /merchant[:\s]+([A-Z0-9\s\-\_\.&]+)/i
        ],
        transactionTypeKeywords: {
            debit: ['transaction', 'purchase', 'spent'],
            credit: ['refund', 'reversal']
        }
    },

    // ICICI Bank
    'icicibank.com': {
        name: 'ICICI Bank',
        amountPatterns: [
            /(?:Rs\.?\s*)([0-9,]+(?:\.[0-9]{1,2})?)/i,
            /(?:INR\s*)([0-9,]+(?:\.[0-9]{1,2})?)/i
        ],
        merchantPatterns: [
            /at\s+([A-Z0-9\s\-\_\.&]+?)(?:\s+on\s+)/i,
            /to\s+([A-Z0-9\s\-\_\.&]+?)(?:\s+using)/i
        ],
        transactionTypeKeywords: {
            debit: ['debited', 'withdrawn', 'paid'],
            credit: ['credited', 'deposit', 'received']
        }
    },

    // Axis Bank
    'axisbank.com': {
        name: 'Axis Bank',
        amountPatterns: [
            /(?:Rs\.?\s*)([0-9,]+(?:\.[0-9]{1,2})?)/i,
            /(?:INR\s*)([0-9,]+(?:\.[0-9]{1,2})?)/i
        ],
        merchantPatterns: [
            /at\s+([A-Z0-9\s\-\_\.&]+?)(?:\s+on\s+)/i
        ],
        transactionTypeKeywords: {
            debit: ['debited', 'spent'],
            credit: ['credited', 'received']
        }
    },

    // Paytm
    'paytm.com': {
        name: 'Paytm',
        amountPatterns: [
            /Rs\.?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
            /₹\s*([0-9,]+(?:\.[0-9]{1,2})?)/i
        ],
        merchantPatterns: [
            /to\s+([A-Z0-9\s\-\_\.&]+?)(?:\s+via)/i,
            /payment\s+to\s+([A-Z0-9\s\-\_\.&]+)/i
        ],
        transactionTypeKeywords: {
            debit: ['sent', 'paid', 'payment to'],
            credit: ['received', 'payment from']
        }
    },

    // PhonePe
    'phonepe.com': {
        name: 'PhonePe',
        amountPatterns: [
            /Rs\.?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
            /₹\s*([0-9,]+(?:\.[0-9]{1,2})?)/i
        ],
        merchantPatterns: [
            /to\s+([A-Z0-9\s\-\_\.&]+?)(?:\s+via)/i,
            /at\s+([A-Z0-9\s\-\_\.&]+?)(?:\s+on)/i
        ],
        transactionTypeKeywords: {
            debit: ['sent', 'paid', 'payment'],
            credit: ['received', 'got']
        }
    },

    // Google Pay
    'google.com': {
        name: 'Google Pay',
        amountPatterns: [
            /₹([0-9,]+(?:\.[0-9]{1,2})?)/i,
            /Rs\.?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i
        ],
        merchantPatterns: [
            /to\s+([A-Z0-9\s\-\_\.&]+?)(?:\s+via)/i,
            /You\s+(?:paid|sent)\s+to\s+([A-Z0-9\s\-\_\.&]+)/i
        ],
        transactionTypeKeywords: {
            debit: ['paid', 'sent'],
            credit: ['received']
        }
    }
};

/**
 * Parse email using bank-specific patterns
 */
export const parseBankEmail = (emailFrom, subject, body) => {
    // Extract sender domain
    const domain = emailFrom.match(/@([a-z0-9.-]+\.[a-z]{2,})$/i)?.[1]?.toLowerCase();
    
    if (!domain) return null;

    // Check if we have patterns for this bank
    const bankPattern = BANK_PATTERNS[domain];
    
    if (!bankPattern) return null;

    const fullText = `${subject} ${body}`;
    let amount = null;
    let merchant = null;
    let type = 'expense';

    // Try bank-specific amount patterns
    for (const pattern of bankPattern.amountPatterns) {
        const match = fullText.match(pattern);
        if (match && match[1]) {
            amount = parseFloat(match[1].replace(/,/g, ''));
            if (amount > 0) break;
        }
    }

    // Try bank-specific merchant patterns
    for (const pattern of bankPattern.merchantPatterns) {
        const match = fullText.match(pattern);
        if (match && match[1]) {
            merchant = match[1].trim().replace(/\s+/g, ' ');
            break;
        }
    }

    // Determine transaction type using bank-specific keywords
    const lowerText = fullText.toLowerCase();
    if (bankPattern.transactionTypeKeywords.credit.some(keyword => lowerText.includes(keyword))) {
        type = 'income';
        amount = amount ? -Math.abs(amount) : null; // Apply negative sign for income
    } else if (bankPattern.transactionTypeKeywords.debit.some(keyword => lowerText.includes(keyword))) {
        type = 'expense';
        amount = amount ? Math.abs(amount) : null; // Ensure positive for expense
    }

    // Extract location if available
    let location = null;
    
    // Pattern 1: GPS coordinates (some banks include this)
    const gpsPattern = /(?:lat|latitude)[:\s]+([\-]?\d+\.\d+)[,\s]+(?:lon|lng|longitude)[:\s]+([\-]?\d+\.\d+)/i;
    const gpsMatch = fullText.match(gpsPattern);
    
    if (gpsMatch) {
        location = {
            type: 'Point',
            coordinates: [parseFloat(gpsMatch[2]), parseFloat(gpsMatch[1])] // [lng, lat] for GeoJSON
        };
    }

    return {
        amount,
        merchant: merchant || 'Unknown',
        type,
        location,
        bankName: bankPattern.name,
        parsedBy: 'bank-pattern'
    };
};
