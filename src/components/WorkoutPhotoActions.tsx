import { Host, Column, Row, Button, Text, Icon } from '@expo/ui';
import { useTheme } from '@/hooks/use-theme';
import { ActionButtonColor } from '@/theme/actionButtonColors';

export function WorkoutPhotoActions({ width, disabled, onCamera, onLibrary, onSkip }: {
  width: number;
  disabled: boolean;
  onCamera(): void;
  onLibrary(): void;
  onSkip(): void;
}) {
  const theme = useTheme();
  return <Host matchContents={{ vertical: true }} seedColor={ActionButtonColor.primary}>
    <Column spacing={12}>
      <Button variant="text" disabled={disabled} onPress={onCamera}>
        <Row alignment="center" spacing={12} style={{ width, paddingHorizontal: 20, paddingVertical: 18,
          backgroundColor: ActionButtonColor.primary, borderRadius: 16, opacity: disabled ? 0.5 : 1 }}>
          <Icon name="camera.fill" size={22} color="#ffffff" />
          <Text style={{ width: width - 80 }} textStyle={{ fontSize: 17, fontWeight: '600', color: '#ffffff' }}>Take a selfie</Text>
        </Row>
      </Button>
      <Button variant="text" disabled={disabled} onPress={onLibrary}>
        <Row alignment="center" spacing={12} style={{ width, paddingHorizontal: 20, paddingVertical: 18,
          backgroundColor: theme.backgroundElement, borderRadius: 16, opacity: disabled ? 0.5 : 1 }}>
          <Icon name="photo.on.rectangle" size={22} color={theme.text} />
          <Text style={{ width: width - 80 }} textStyle={{ fontSize: 17, fontWeight: '600', color: theme.text }}>Choose from library</Text>
        </Row>
      </Button>
      <Button variant="text" disabled={disabled} onPress={onSkip}>
        <Text style={{ width, paddingVertical: 16 }} textStyle={{ fontSize: 16, color: theme.text, textAlign: 'center' }}>Continue without photo</Text>
      </Button>
    </Column>
  </Host>;
}
