import { Transaction } from '../models/Transaction.model.js';
import { parseTransactionMessage } from '../utils/transaction.parser.js';
import { reverseGeocode } from '../utils/geocode.helper.js';
import { MerchantLocation } from '../models/MerchantLocation.model.js';
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

    // 6. Location Handling + Merchant Learning
    let location = {
      lat: lat || null,
      lng: lng || null,
    };

    // Try to lookup learned location first
    if (merchant) {
      const merchantKey = merchant.toLowerCase().trim();
      const learned = await MerchantLocation.findOne({
        user: req.user.id,
        merchantKey,
      });

      if (learned && learned.confidence >= 0.5) {
        // Use learned location (5+ visits)
        location = {
          lat: learned.location.lat,
          lng: learned.location.lng,
          city: learned.location.city,
          address: learned.location.address,
        };
        console.log(`✅ Using learned location for ${merchant} (confidence: ${learned.confidence})`);
      }
    }

    // If no learned location and GPS provided, use GPS and learn from it
    if (!location.lat && lat && lng) {
      try {
        const geoData = await reverseGeocode(lat, lng);
        if (geoData) {
          location = { ...location, ...geoData };
        }

        // Learn this location for future
        if (merchant) {
          const merchantKey = merchant.toLowerCase().trim();
          const learned = await MerchantLocation.findOne({
            user: req.user.id,
            merchantKey,
          });

          if (learned) {
            // Update existing
            learned.visits += 1;
            learned.visitHistory.push({
              lat,
              lng,
              timestamp: txnDate,
            });

            // Keep only last 20 visits
            if (learned.visitHistory.length > 20) {
              learned.visitHistory = learned.visitHistory.slice(-20);
            }

            // Recalculate average location
            const avgLat = learned.visitHistory.reduce((sum, v) => sum + v.lat, 0) / learned.visitHistory.length;
            const avgLng = learned.visitHistory.reduce((sum, v) => sum + v.lng, 0) / learned.visitHistory.length;

            learned.location.lat = avgLat;
            learned.location.lng = avgLng;
            learned.confidence = Math.min(learned.visits / 10, 1.0);

            await learned.save();
            console.log(`📚 Learned location updated for ${merchant} (visits: ${learned.visits}, confidence: ${learned.confidence})`);
          } else {
            // Create new learned location
            await MerchantLocation.create({
              user: req.user.id,
              merchantKey,
              merchantName: merchant,
              location: {
                lat,
                lng,
                city: geoData?.city,
                address: geoData?.address,
              },
              visits: 1,
              confidence: 0.2,
              visitHistory: [{ lat, lng, timestamp: txnDate }],
            });
            console.log(`🆕 Started learning location for ${merchant}`);
          }
        }
      } catch (err) {
        console.error('Geocoding failed:', err);
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
