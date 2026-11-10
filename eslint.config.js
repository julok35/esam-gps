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
      'no-unused-vars': ['error', { caughtErrors: 'none' }],
      // JavaScript actuel : const / let (portée de bloc), fonctions fléchées pour les rappels, propriétés abrégées
      'no-var': 'error',
      'prefer-const': 'error',
      'prefer-arrow-callback': 'error',
      'object-shorthand': 'error',
      'arrow-body-style': ['error', 'as-needed'],
      // pièges classiques
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-duplicate-imports': 'error',
      'no-throw-literal': 'error',
      'no-implicit-coercion': ['error', { allow: ['!!', '+'] }],
      'no-console': ['error', { allow: ['error', 'warn'] }]
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
