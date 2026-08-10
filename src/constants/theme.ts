/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { ProgressBarColors } from '@/theme/progressColors';
import { BackgroundColors } from '@/theme/actionButtonColors';

export const Colors = {
  light: {
    text: '#000000',
    background: '#ffffff',
    backgroundElement: BackgroundColors.lightElement,
    backgroundSelected: '#E0E1E6',
    textSecondary: '#60646C',
    progressFill: ProgressBarColors.light.fill,
    progressTrack: ProgressBarColors.light.track,
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: BackgroundColors.darkElement,
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
    progressFill: ProgressBarColors.dark.fill,
    progressTrack: ProgressBarColors.dark.track,
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const MaxContentWidth = 800;
