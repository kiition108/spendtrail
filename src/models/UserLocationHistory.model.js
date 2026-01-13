import mongoose from 'mongoose';

/**
 * User's background location history
 * Stores user's location at different timestamps for transaction correlation
 */
const userLocationHistorySchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },

    location: {
        type: {
            type: String,
            enum: ['Point'],
            default: 'Point'
        },
        coordinates: {
            type: [Number], // [longitude, latitude]
            required: true
        }
    },

    // Flat coordinates for easier queries
    lat: {
        type: Number,
        required: true
    },

    lng: {
        type: Number,
        required: true
    },

    // Additional location details
    accuracy: {
        type: Number, // meters
        default: null
    },

    altitude: Number,
    speed: Number,
    heading: Number,

    // Address details (if available)
    address: String,
    city: String,
    country: String,

    // Timestamp when location was recorded
    timestamp: {
        type: Date,
        required: true,
        index: true
    },

    // Source of location data
    source: {
        type: String,
        enum: ['gps', 'wifi', 'cell', 'manual'],
        default: 'gps'
    },

    // Activity type (if available)
    activity: {
        type: String,
        enum: ['stationary', 'walking', 'running', 'driving', 'unknown'],
        default: 'unknown'
    }
}, {
    timestamps: true
});

// Compound index for efficient time-range queries
userLocationHistorySchema.index({ user: 1, timestamp: -1 });

// Geospatial index for location-based queries
userLocationHistorySchema.index({ location: '2dsphere' });

/**
 * Find user's location within a time window
 * @param {ObjectId} userId - User ID
 * @param {Date} targetTime - Target timestamp
 * @param {Number} windowMinutes - Time window in minutes (±)
 * @returns {Object|null} Closest location or null
 */
userLocationHistorySchema.statics.findLocationNearTime = async function(userId, targetTime, windowMinutes = 15) {
    const startTime = new Date(targetTime.getTime() - windowMinutes * 60 * 1000);
    const endTime = new Date(targetTime.getTime() + windowMinutes * 60 * 1000);

    const locations = await this.find({
        user: userId,
        timestamp: { $gte: startTime, $lte: endTime }
    })
    .sort({ timestamp: 1 })
    .lean();

    if (locations.length === 0) return null;

    // Find the location closest to target time
    let closestLocation = locations[0];
    let smallestTimeDiff = Math.abs(targetTime - locations[0].timestamp);

    for (const loc of locations) {
        const timeDiff = Math.abs(targetTime - loc.timestamp);
        if (timeDiff < smallestTimeDiff) {
            smallestTimeDiff = timeDiff;
            closestLocation = loc;
        }
    }

    return {
        ...closestLocation,
        timeDiffMinutes: Math.round(smallestTimeDiff / 60000), // Convert to minutes
        confidence: Math.max(0, 1 - (smallestTimeDiff / (windowMinutes * 60 * 1000)))
    };
};

/**
 * Get average location within a time window
 * @param {ObjectId} userId - User ID
 * @param {Date} targetTime - Target timestamp
 * @param {Number} windowMinutes - Time window in minutes (±)
 * @returns {Object|null} Average location or null
 */
userLocationHistorySchema.statics.getAverageLocationNearTime = async function(userId, targetTime, windowMinutes = 15) {
    const startTime = new Date(targetTime.getTime() - windowMinutes * 60 * 1000);
    const endTime = new Date(targetTime.getTime() + windowMinutes * 60 * 1000);

    const locations = await this.find({
        user: userId,
        timestamp: { $gte: startTime, $lte: endTime }
    })
    .lean();

    if (locations.length === 0) return null;

    // Calculate average location
    const avgLat = locations.reduce((sum, loc) => sum + loc.lat, 0) / locations.length;
    const avgLng = locations.reduce((sum, loc) => sum + loc.lng, 0) / locations.length;

    return {
        lat: avgLat,
        lng: avgLng,
        coordinates: [avgLng, avgLat],
        count: locations.length,
        confidence: Math.min(locations.length / 5, 1.0) // Higher confidence with more data points
    };
};

/**
 * Clean old location history (older than X days)
 * @param {ObjectId} userId - User ID
 * @param {Number} daysToKeep - Number of days to retain
 */
userLocationHistorySchema.statics.cleanOldHistory = async function(userId, daysToKeep = 90) {
    const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);
    
    const result = await this.deleteMany({
        user: userId,
        timestamp: { $lt: cutoffDate }
    });

    return result.deletedCount;
};

export const UserLocationHistory = mongoose.model('UserLocationHistory', userLocationHistorySchema);
