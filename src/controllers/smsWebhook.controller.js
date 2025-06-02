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

    const amountMatch = message.match(/(?:Rs|INR|₹)[\s\.]*([0-9,]+(?:\.\d{1,2})?)/i);
    if (!amountMatch) {
      return res.status(400).json({ error: 'Could not parse transaction amount' });
    }

    // Deduplication
    const messageHash = crypto.createHash('sha256').update(message).digest('hex');
    const isDuplicate = await Transaction.findOne({ userId: req.user.id, messageHash });
    if (isDuplicate) {
      return res.status(409).json({ error: 'Duplicate transaction detected' });
    }

    const amount = parseFloat(amountMatch[1].replace(/,/g, ''));
    const merchantMatch = message.match(/(?:To|at|on behalf of)[\s:]*([A-Za-z0-9\s\-\_\.&]+)/i);
    const merchant = merchantMatch ? merchantMatch[1].trim() : 'Unknown';

    const { category, subCategory } = classifyCategory(message + ' ' + merchant);

    const type = /credited/i.test(message)
      ? 'credit'
      : /debited|spent|purchased/i.test(message)
      ? 'debit'
      : 'unknown';

    // Optionally reverse geocode if lat/lng available
    let location = {};
    if (lat && lng) {
      location = (await reverseGeocode(lat, lng)) || {};
    }

    const transaction = new Transaction({
      userId: req.user.id,
      amount,
      currency: 'INR',
      category,
      subCategory,
      merchant,
      note: `Parsed from SMS: ${sender}`,
      paymentMethod: 'other',
      source: 'sms',
      tags: ['parsed'],
      timestamp: receivedAt ? new Date(receivedAt) : new Date(),
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
