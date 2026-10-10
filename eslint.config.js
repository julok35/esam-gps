// Règles de qualité (npm run lint). La mise en forme relève de Prettier (npm run format), pas d'ESLint.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['vendor/', 'node_modules/'] },
  js.configs.recommended,
  {
    rules: {
      // catch (e) {} volontaire : presse-papier, stockage local ou capteurs indisponibles ne doivent rien bloquer
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { caughtErrors: 'none' }]
    }
  },
  {
    files: ['js/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      // L (Leaflet), qrcode et Tesseract : bibliothèques de vendor/ chargées en script classique
      globals: { ...globals.browser, L: 'readonly', qrcode: 'readonly', Tesseract: 'readonly' }
    }
  },
  { files: ['sw.js'], languageOptions: { sourceType: 'script', globals: globals.serviceworker } },
  { files: ['test/**/*.js', 'eslint.config.js'], languageOptions: { globals: globals.node } }
];
