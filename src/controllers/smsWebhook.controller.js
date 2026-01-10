import { Transaction } from '../models/Transaction.model.js';
import { parseTransactionMessage } from '../utils/transactionParser.js';
import { reverseGeocode } from '../utils/geocode.js'; // optional
import crypto from 'crypto';

export const handleSmsWebhook = async (req, res) => {
  const { message, sender, receivedAt, lat, lng } = req.body;
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'Unauthorized: user context missing' });
    }

    // Use shared parser
    const parsedData = parseTransactionMessage(message);

    if (parsedData.error) {
      return res.status(400).json({ error: parsedData.error });
    }

    const {
      amount: finalAmount,
      merchant,
      paymentMethod,
      category,
      subCategory
    } = parsedData;

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
