import base from './playwright.nonvisual.config.ts';
import { defineConfig } from '@playwright/test';

// Dedicated interactive Windows session; no screenshots, video or trace capture.
export default defineConfig({ ...base, testMatch: ['windows-ime.spec.ts'], outputDir: '../../.artifacts/desktop-native-ime' });
