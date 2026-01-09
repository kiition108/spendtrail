import { Transaction } from '../models/Transaction.model.js';
import { classifyCategory } from '../utils/categoryClassifier.js';
import { reverseGeocode } from '../utils/geocode.js'; // optional
import crypto from 'crypto';

export const handleSmsWebhook = async (req, res) => {
  const { message, sender, receivedAt, lat, lng } = req.body;
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'Unauthorized: user context missing' });
    }

    // 1. Improved Amount Parsing
    const amountMatch = message.match(/(?:Rs\.?|INR\.?|₹)[\s]*([0-9,]+(?:\.[0-9]{1,2})?)|([0-9,]+(?:\.[0-9]{1,2})?)[\s]*(?:Rs|INR|₹)/i);
    if (!amountMatch) {
      return res.status(400).json({ error: 'Could not parse transaction amount' });
    }
    const amount = parseFloat((amountMatch[1] || amountMatch[2]).replace(/,/g, ''));

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Could not parse valid transaction amount' });
    }

    // 2. Improved Merchant Extraction
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
      detectedPaymentMethod = 'upi';
    } else if (/\b(?:wallet|paytm|phonepe|gpay|googlepay)\b/i.test(message)) {
      detectedPaymentMethod = 'wallet';
    } else if (/\b(?:cash|ATM|withdrawal)\b/i.test(message)) {
      detectedPaymentMethod = 'cash';
    }

    // 4. Transaction Type Detection
    const { category, subCategory } = classifyCategory(message + ' ' + merchant);

    let type = 'debit';
    let finalAmount = amount;
    if (/credited|received|refund|cashback/i.test(message)) {
      type = 'credit';
      finalAmount = -amount; // Store negative for income if that's your convention, OR keep positive and rely on 'type' field if you have one. 
      // Note: The provided Transaction model doesn't explicitly show a 'type' field (credit/debit), 
      // but usually 'amount' sign or a separate 'type' field is used.
      // Assuming typical logic: Expense = positive, Income = negative IS NOT standard.
      // Standard is: Amount is absolute, Type is 'income'/'expense'.
      // However, the prompt snippet said "Income is negative in your schema" in the comments.
      // I will follow the user's prompt valid logic but be careful.
      // Let's stick to the prompt's logic: "finalAmount = -amount".
    } else if (/debited|spent|purchased|paid|withdrawn/i.test(message)) {
      type = 'debit';
      finalAmount = amount;
    }

    // 5. Deduplication (Composite Key)
    // Create a hash based on core transaction details to catch duplicates even if message format varies slightly
    const txnDate = receivedAt ? new Date(receivedAt) : new Date();
    const dateStr = txnDate.toISOString().slice(0, 10); // YYYY-MM-DD
    const dedupeKey = `${amount}_${merchant}_${dateStr}`;
    const messageHash = crypto.createHash('sha256').update(dedupeKey).digest('hex');

    const isDuplicate = await Transaction.findOne({ user: req.user.id, messageHash });
    if (isDuplicate) {
      return res.status(200).json({
        success: true,
        duplicate: true,
        message: 'Transaction already processed',
        transaction: isDuplicate
      });
    }

    // 6. Location Handling
    let location = {
      lat: lat || null,
      lng: lng || null,
    };
    if (lat && lng) {
      try {
        const geoData = await reverseGeocode(lat, lng);
        if (geoData) {
          location = { ...location, ...geoData };
        }
      } catch (err) {
        console.error('Geocoding failed:', err);
        // Continue without full address data
      }
    }

    const transaction = new Transaction({
      user: req.user.id,
      amount: finalAmount,
      currency: 'INR',
      category,
      subCategory,
      merchant,
      note: `Parsed from SMS: ${sender}`,
      paymentMethod: detectedPaymentMethod,
      source: 'sms',
      tags: ['parsed', detectedPaymentMethod],
      timestamp: txnDate,
      location,
      messageHash,
    });

    await transaction.save();

    res.status(200).json({ success: true, transaction });
  } catch (err) {
    console.error('Failed SMS parse', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
