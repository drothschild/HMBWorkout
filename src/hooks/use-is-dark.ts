import { useColorScheme } from '@/hooks/use-color-scheme';

export function useIsDark() {
  return useColorScheme() === 'dark';
}
