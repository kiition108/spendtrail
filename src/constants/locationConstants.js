/**
 * Location matching source types
 * Standardized constants for location determination methods
 */
export const LOCATION_SOURCES = {
    PARSED_GPS_COORDINATES: 'parsed_gps_coordinates',
    LEARNED_MERCHANT_LOCATION: 'learned_merchant_location',
    BACKGROUND_LOCATION_HISTORY: 'background_location_history',
    LEARNED_EMAIL_PATTERN: 'learned_email_pattern',
    TEXT_HINT: 'text_hint'
};

/**
 * Confidence thresholds for location matching
 */
export const LOCATION_CONFIDENCE = {
    VERY_HIGH: 0.9,   // GPS coordinates from email
    HIGH: 0.7,        // Learned merchant with many visits
    MEDIUM: 0.5,      // Background location or learned pattern
    LOW: 0.3,         // Text hints for geocoding
    MINIMUM: 0.4      // Minimum confidence to use a match
};

/**
 * Time window for background location matching (in minutes)
 */
export const BACKGROUND_LOCATION_TIME_WINDOW = 15;

/**
 * Merchant location learning thresholds
 */
export const MERCHANT_LEARNING = {
    MIN_VISITS_FOR_CONFIDENCE: 2,     // Minimum visits before using location
    VISITS_FOR_MAX_CONFIDENCE: 10,    // Visits needed for 100% confidence
    MAX_VISIT_HISTORY_SIZE: 20        // Maximum number of visits to store
};

/**
 * Location cleanup settings
 */
export const LOCATION_CLEANUP = {
    DEFAULT_RETENTION_DAYS: 90
};

/**
 * Location type enum
 */
export const LOCATION_PATTERN_TYPES = {
    GPS_COORDINATES: 'gps_coordinates',
    ADDRESS_TEXT: 'address_text',
    MERCHANT_NAME: 'merchant_name',
    CITY_NAME: 'city_name',
    BRANCH_INFO: 'branch_info'
};
