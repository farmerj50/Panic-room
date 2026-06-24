import { Platform } from 'react-native';

// Set EXPO_PUBLIC_API_URL for deployed builds or physical-device testing.
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL || (Platform.OS === 'web' ? 'http://localhost:5000' : 'http://192.168.1.68:5000');

export const EMERGENCY_NUMBER = '911';
export const COUNTDOWN_SECONDS = 5;

// Set to true only when ready for production testing.
// Keeps the 911 dialer disabled during development so accidental activations
// don't place real emergency calls.
export const ENABLE_EMERGENCY_DIALER = false;
