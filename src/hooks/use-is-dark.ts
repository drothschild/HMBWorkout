import { Colors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function useIsDark() {
  const theme = useTheme();
  return theme.background !== Colors.light.background;
}
