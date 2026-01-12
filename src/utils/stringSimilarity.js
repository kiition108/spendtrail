/**
 * String Similarity Utilities
 * Fuzzy matching for merchant names without external dependencies
 */

/**
 * Calculate Levenshtein distance between two strings
 * Returns number of edits needed to transform s1 into s2
 */
export const levenshteinDistance = (s1, s2) => {
    const len1 = s1.length;
    const len2 = s2.length;
    
    // Create 2D array
    const dp = Array(len1 + 1).fill(null).map(() => Array(len2 + 1).fill(0));
    
    // Initialize first row and column
    for (let i = 0; i <= len1; i++) dp[i][0] = i;
    for (let j = 0; j <= len2; j++) dp[0][j] = j;
    
    // Fill the matrix
    for (let i = 1; i <= len1; i++) {
        for (let j = 1; j <= len2; j++) {
            if (s1[i - 1] === s2[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1];
            } else {
                dp[i][j] = Math.min(
                    dp[i - 1][j] + 1,    // deletion
                    dp[i][j - 1] + 1,    // insertion
                    dp[i - 1][j - 1] + 1 // substitution
                );
            }
        }
    }
    
    return dp[len1][len2];
};

/**
 * Calculate similarity ratio between two strings (0-1)
 * 1.0 = exact match, 0.0 = completely different
 */
export const similarityRatio = (s1, s2) => {
    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;
    
    if (longer.length === 0) return 1.0;
    
    const distance = levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
};

/**
 * Normalize merchant name for comparison
 * - Lowercase
 * - Remove special chars
 * - Remove extra spaces
 * - Remove common words (the, and, etc.)
 */
export const normalizeMerchantName = (name) => {
    if (!name) return '';
    
    return name
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '') // Remove special chars
        .replace(/\b(the|and|pvt|ltd|limited|inc|corp|llc)\b/g, '') // Remove common words
        .replace(/\s+/g, ' ') // Remove extra spaces
        .trim();
};

/**
 * Check if two merchant names are fuzzy matches
 * Returns { match: boolean, similarity: number }
 */
export const fuzzyMatch = (name1, name2, threshold = 0.75) => {
    const normalized1 = normalizeMerchantName(name1);
    const normalized2 = normalizeMerchantName(name2);
    
    // Exact match after normalization
    if (normalized1 === normalized2) {
        return { match: true, similarity: 1.0 };
    }
    
    // Check if one contains the other (for "SBUX" vs "Starbucks")
    if (normalized1.includes(normalized2) || normalized2.includes(normalized1)) {
        const containsSimilarity = 0.85; // High similarity for contains
        return { match: containsSimilarity >= threshold, similarity: containsSimilarity };
    }
    
    // Calculate similarity ratio
    const similarity = similarityRatio(normalized1, normalized2);
    
    return {
        match: similarity >= threshold,
        similarity
    };
};

/**
 * Find best matching merchant from a list
 * Returns { merchant, similarity } or null
 */
export const findBestMatch = (searchName, merchantList, threshold = 0.75) => {
    let bestMatch = null;
    let bestSimilarity = 0;
    
    for (const merchant of merchantList) {
        const { match, similarity } = fuzzyMatch(searchName, merchant.name || merchant, threshold);
        
        if (match && similarity > bestSimilarity) {
            bestMatch = merchant;
            bestSimilarity = similarity;
        }
    }
    
    return bestMatch ? { merchant: bestMatch, similarity: bestSimilarity } : null;
};
