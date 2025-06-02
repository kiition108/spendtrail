import fetch from 'node-fetch';

export async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'SpendTrail/1.0 (your-email@example.com)' },
    });
    if (!response.ok) throw new Error('Geocode API error');

    const data = await response.json();

    return {
      address: data.display_name,
      city: data.address.city || data.address.town || data.address.village || '',
      country: data.address.country || '',
      placeName: data.name || '',
    };
  } catch (error) {
    console.error('Reverse geocoding failed:', error);
    return null;
  }
}
