import { readFileSync } from 'fs';
import { join } from 'path';

it('describes both exercise photos and workout-diary selfies in the shared image-picker permission copy', () => {
  const appConfig = JSON.parse(readFileSync(join(__dirname, '..', '..', 'app.json'), 'utf8'));
  const picker = appConfig.expo.plugins.find((plugin: unknown) => Array.isArray(plugin) && plugin[0] === 'expo-image-picker')[1];

  for (const permission of [picker.cameraPermission, picker.photosPermission]) {
    expect(permission).toMatch(/exercise/i);
    expect(permission).toMatch(/workout/i);
  }
});
