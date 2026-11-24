// Web App-configuratie voor het Loopcade-hackathonproject.
// Dit zijn publieke clientinstellingen, geen serviceaccount- of AI-sleutels.
export const firebaseConfig = {
  apiKey: 'AIzaSyAIEHrGvDWFELQQkzbBGNBgT7qOybCcFNw',
  authDomain: 'hack-the-future-92568.firebaseapp.com',
  projectId: 'hack-the-future-92568',
  storageBucket: 'hack-the-future-92568.firebasestorage.app',
  messagingSenderId: '42919652526',
  appId: '1:42919652526:web:e0f71bd06d2e0f6940d13f',
};

export const FIREBASE_SDK_VERSION = '13.4.0';

// Alleen voor lokale emulator-tests. Laat dit in normale gebruik uitgeschakeld.
export const emulatorConfig = {
  enabled: false,
  authUrl: 'http://127.0.0.1:9099',
  firestoreHost: '127.0.0.1',
  firestorePort: 8080,
};

const placeholders = ['VUL_', 'JOUW_PROJECT_ID'];
export const firebaseIsConfigured = () => {
  const required = ['apiKey', 'authDomain', 'projectId', 'appId'];
  return required.every(key => {
    const value = firebaseConfig[key];
    return typeof value === 'string' && value.trim().length > 0
      && !placeholders.some(prefix => value.includes(prefix));
  });
};
