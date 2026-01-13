import fetch from 'node-fetch';
import logger from './logger.js';

export async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'SpendTrail/1.0 (iamsinghkishan@gmail.com)' },
    });
    if (!response.ok) throw new Error('Geocode API error');

    const data = await response.json();

    return {
      address: data.display_name,
      city: data.address?.city || data.address?.town || data.address?.village || '',
      country: data.address?.country || '',
      placeName: data.name || data.address?.attraction || '',
    };
  } catch (error) {
    logger.error('Reverse geocoding failed:', { error: error.message });
    return null;
  }
}
