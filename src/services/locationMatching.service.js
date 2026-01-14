import { UserLocationHistory } from '../models/UserLocationHistory.model.js';
import { EmailLocationPattern } from '../models/EmailLocationPattern.model.js';
import { MerchantLocation } from '../models/MerchantLocation.model.js';
import logger from '../utils/logger.js';
import {
    LOCATION_SOURCES,
    LOCATION_CONFIDENCE,
    BACKGROUND_LOCATION_TIME_WINDOW,
    MERCHANT_LEARNING
} from '../constants/locationConstants.js';

/**
 * Service for intelligent location matching and learning
 */
class LocationMatchingService {
    /**
     * Try to determine transaction location using multiple strategies
     * @param {Object} params - Parameters
     * @param {ObjectId} params.userId - User ID
     * @param {Date} params.timestamp - Transaction timestamp
     * @param {String} params.merchantName - Merchant name
     * @param {String} params.emailSender - Email sender
     * @param {String} params.emailContent - Email content for pattern matching
     * @param {Object} params.parsedLocation - Already parsed location (if any)
     * @returns {Object|null} Location data with confidence score
     */
    async matchTransactionLocation({
        userId,
        timestamp,
        merchantName,
        emailSender,
        emailContent,
        parsedLocation
    }) {
        try {
            // Strategy 1: Use already parsed location (highest priority)
            if (parsedLocation && parsedLocation.coordinates) {
                logger.info('📍 Using parsed GPS location', { parsedLocation });
                return {
                    location: parsedLocation,
                    source: LOCATION_SOURCES.PARSED_GPS_COORDINATES,
                    confidence: LOCATION_CONFIDENCE.VERY_HIGH
                };
            }

            // Strategy 2: Check learned merchant location
            if (merchantName) {
                const learnedLocation = await this.getLearnedMerchantLocation(userId, merchantName);
                if (learnedLocation) {
                    logger.info('📍 Using learned merchant location', {
                        merchant: merchantName,
                        confidence: learnedLocation.confidence
                    });
                    return {
                        location: {
                            type: 'Point',
                            coordinates: [learnedLocation.lng, learnedLocation.lat]
                        },
                        lat: learnedLocation.lat,
                        lng: learnedLocation.lng,
                        source: LOCATION_SOURCES.LEARNED_MERCHANT_LOCATION,
                        confidence: learnedLocation.confidence
                    };
                }
            }

            // Strategy 3: Match user's background location near transaction time
            // Use AVERAGE location for better approximation over the time window
            const backgroundLocation = await this.matchBackgroundLocation(userId, timestamp);
            if (backgroundLocation) {
                logger.info('📍 Using background location match (AVERAGE)', {
                    count: backgroundLocation.count,
                    confidence: backgroundLocation.confidence
                });
                return {
                    location: {
                        type: 'Point',
                        coordinates: backgroundLocation.coordinates // [lng, lat]
                    },
                    lat: backgroundLocation.lat,
                    lng: backgroundLocation.lng,
                    source: LOCATION_SOURCES.BACKGROUND_LOCATION_HISTORY,
                    confidence: backgroundLocation.confidence,
                    timeDiffMinutes: 0 // Averaged over window
                };
            }

            // Strategy 4: Try learned email location patterns
            if (emailSender && emailContent) {
                const patternLocation = await this.matchEmailLocationPattern(
                    userId,
                    emailSender,
                    emailContent,
                    merchantName
                );
                if (patternLocation) {
                    logger.info('📍 Using learned email pattern location', {
                        sender: emailSender,
                        confidence: patternLocation.confidence
                    });
                    return {
                        location: {
                            type: 'Point',
                            coordinates: [patternLocation.lng, patternLocation.lat]
                        },
                        lat: patternLocation.lat,
                        lng: patternLocation.lng,
                        source: 'email_pattern',
                        confidence: patternLocation.confidence
                    };
                }
            }

            // Strategy 5: Use text hint if available
            if (parsedLocation && parsedLocation.hint) {
                logger.info('📍 Location hint available for geocoding', {
                    hint: parsedLocation.hint
                });
                return {
                    locationHint: parsedLocation.hint,
                    city: parsedLocation.city,
                    source: 'text_hint',
                    confidence: 0.3,
                    needsGeocoding: true
                };
            }

            logger.debug('📍 No location match found');
            return null;

        } catch (error) {
            logger.error('Error in location matching', { error: error.message });
            return null;
        }
    }

    /**
     * Get learned merchant location
     */
    async getLearnedMerchantLocation(userId, merchantName) {
        try {
            const merchantKey = merchantName.toLowerCase().trim();
            const learned = await MerchantLocation.findOne({
                user: userId,
                merchantKey: merchantKey,
                visits: { $gte: MERCHANT_LEARNING.MIN_VISITS_FOR_CONFIDENCE },
                confidence: { $gte: LOCATION_CONFIDENCE.MEDIUM }
            });

            return learned;
        } catch (error) {
            logger.error('Error getting learned merchant location', { error: error.message });
            return null;
        }
    }

    /**
     * Match user's background location near transaction timestamp
     */
    async matchBackgroundLocation(userId, timestamp, windowMinutes = BACKGROUND_LOCATION_TIME_WINDOW) {
        try {
            const location = await UserLocationHistory.getAverageLocationNearTime(
                userId,
                timestamp,
                windowMinutes
            );

            // Only return if confidence is reasonable
            if (location && location.confidence >= LOCATION_CONFIDENCE.MINIMUM) {
                return location;
            }

            return null;
        } catch (error) {
            logger.error('Error matching background location', { error: error.message });
            return null;
        }
    }

    /**
     * Match location using learned email patterns
     */
    async matchEmailLocationPattern(userId, sender, emailContent, merchantName) {
        try {
            const patterns = await EmailLocationPattern.findPatternForSender(
                userId,
                sender,
                merchantName
            );

            if (patterns.length === 0) return null;

            // Try to match patterns against email content
            for (const pattern of patterns) {
                if (pattern.locationPattern?.pattern) {
                    const regex = new RegExp(pattern.locationPattern.pattern, 'i');
                    if (regex.test(emailContent)) {
                        // Pattern matched!
                        await pattern.recordSuccess();
                        return pattern.location;
                    }
                }
            }

            return null;
        } catch (error) {
            logger.error('Error matching email location pattern', { error: error.message });
            return null;
        }
    }

    /**
     * Learn location pattern from user correction
     */
    async learnFromCorrection({
        userId,
        sender,
        emailContent,
        merchantName,
        originalLocation,
        correctedLocation
    }) {
        try {
            if (!correctedLocation || (!correctedLocation.lat && !correctedLocation.coordinates)) {
                return;
            }

            // Extract lat/lng from either format
            let lat, lng;
            if (correctedLocation.coordinates && correctedLocation.coordinates.length === 2) {
                [lng, lat] = correctedLocation.coordinates;
            } else if (correctedLocation.lat && correctedLocation.lng) {
                lat = correctedLocation.lat;
                lng = correctedLocation.lng;
            } else {
                return; // Invalid format
            }

            // Learn merchant location
            if (merchantName) {
                await this.learnMerchantLocation(userId, merchantName, lat, lng);
            }

            // Learn email pattern
            if (sender && emailContent) {
                const senderDomain = sender.match(/@([a-z0-9.-]+\.[a-z]{2,})$/i)?.[1]?.toLowerCase();
                const merchantKey = merchantName ? merchantName.toLowerCase().trim() : null;

                // Try to identify what pattern in the email indicates location
                const locationPattern = this.extractLocationPattern(emailContent);

                // Create or update location pattern
                const existingPattern = await EmailLocationPattern.findOne({
                    user: userId,
                    sender: sender.toLowerCase(),
                    merchantKey: merchantKey
                });

                if (existingPattern) {
                    // Update existing pattern
                    existingPattern.location = {
                        lat,
                        lng,
                        address: correctedLocation.address,
                        city: correctedLocation.city,
                        placeName: correctedLocation.placeName
                    };
                    existingPattern.successfulExtractions += 1;
                    existingPattern.timesMatched += 1;
                    existingPattern.confidence = Math.min(
                        existingPattern.successfulExtractions / existingPattern.timesMatched,
                        1.0
                    );
                    if (locationPattern) {
                        existingPattern.locationPattern = locationPattern;
                    }
                    await existingPattern.save();
                    logger.info('📚 Updated location learning pattern', { sender, merchantName });
                } else {
                    // Create new pattern
                    await EmailLocationPattern.create({
                        user: userId,
                        sender: sender.toLowerCase(),
                        senderDomain,
                        merchantKey,
                        merchantName,
                        locationPattern,
                        location: { lat, lng, address: correctedLocation.address, city: correctedLocation.city, placeName: correctedLocation.placeName },
                        confidence: 0.6,
                        successfulExtractions: 1,
                        timesMatched: 1
                    });
                    logger.info('📚 Created new location learning pattern', { sender, merchantName });
                }
            }

        } catch (error) {
            logger.error('Error learning from correction', { error: error.message });
        }
    }

    /**
     * Extract location pattern from email content
     */
    extractLocationPattern(emailContent) {
        // Look for common location indicators
        const patterns = [
            { regex: /(?:at|location|address)[:\s]+([^\n]+)/i, type: 'address_text' },
            { regex: /(?:branch|store)[:\s]+([^\n]+)/i, type: 'branch_info' },
            { regex: /([A-Za-z\s]+,\s+[A-Za-z\s]+)/i, type: 'city_name' },
            { regex: /(lat|latitude)[:\s]+[\-]?\d+\.\d+/i, type: 'gps_coordinates' }
        ];

        for (const { regex, type } of patterns) {
            const match = emailContent.match(regex);
            if (match) {
                return {
                    pattern: regex.source,
                    type,
                    example: match[0]
                };
            }
        }

        return null;
    }

    /**
     * Learn merchant location from user visit
     */
    async learnMerchantLocation(userId, merchantName, lat, lng, timestamp = new Date()) {
        try {
            const merchantKey = merchantName.toLowerCase().trim();

            const learned = await MerchantLocation.findOne({
                user: userId,
                merchantKey
            });

            if (learned) {
                // Update existing learned location
                learned.visits += 1;
                learned.visitHistory.push({ lat, lng, timestamp });

                // Keep only last N visits
                if (learned.visitHistory.length > MERCHANT_LEARNING.MAX_VISIT_HISTORY_SIZE) {
                    learned.visitHistory = learned.visitHistory.slice(-MERCHANT_LEARNING.MAX_VISIT_HISTORY_SIZE);
                }

                // Recalculate average location
                const avgLat = learned.visitHistory.reduce((sum, v) => sum + v.lat, 0) / learned.visitHistory.length;
                const avgLng = learned.visitHistory.reduce((sum, v) => sum + v.lng, 0) / learned.visitHistory.length;

                learned.location.lat = avgLat;
                learned.location.lng = avgLng;
                learned.confidence = Math.min(learned.visits / MERCHANT_LEARNING.VISITS_FOR_MAX_CONFIDENCE, 1.0);
                learned.lastVisit = timestamp;

                await learned.save();
                logger.info('🏪 Updated merchant location', {
                    merchant: merchantName,
                    visits: learned.visits,
                    confidence: learned.confidence
                });
            } else {
                // Create new learned location
                await MerchantLocation.create({
                    user: userId,
                    merchantKey,
                    merchantName,
                    location: { lat, lng },
                    visits: 1,
                    confidence: 0.2,
                    visitHistory: [{ lat, lng, timestamp }],
                    firstVisit: timestamp,
                    lastVisit: timestamp
                });
                logger.info('🏪 Started learning merchant location', { merchant: merchantName });
            }
        } catch (error) {
            logger.error('Error learning merchant location', { error: error.message });
        }
    }
}

export const locationMatchingService = new LocationMatchingService();
