// The iOS 27 SDK traps at launch (SIGTRAP in
// __UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption) unless the app
// adopts the UIScene lifecycle. The config plugin in plugins/withSceneLifecycle.js
// must reproduce the manual shim applied to the prebuild-generated ios/ dir:
// a UIApplicationSceneManifest Info.plist entry and a SceneDelegate class added
// to AppDelegate.swift. These tests cover its pure transforms.
const {
  setSceneManifest,
  appendSceneDelegate,
} = require('../../plugins/withSceneLifecycle');

// Shape of the Expo SDK 57 template AppDelegate.swift (abridged; note: no UIKit import)
const TEMPLATE_APP_DELEGATE = `internal import Expo
import React
import ReactAppDependencyProvider

@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
}
`;

describe('setSceneManifest', () => {
  it('adds the UIApplicationSceneManifest pointing at the module-scoped SceneDelegate', () => {
    const result = setSceneManifest({ CFBundleName: '$(PRODUCT_NAME)' });

    expect(result.UIApplicationSceneManifest).toEqual({
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
          },
        ],
      },
    });
  });

  it('preserves the other Info.plist keys', () => {
    const result = setSceneManifest({ CFBundleName: '$(PRODUCT_NAME)' });

    expect(result.CFBundleName).toBe('$(PRODUCT_NAME)');
  });
});

describe('appendSceneDelegate', () => {
  it('inserts a SceneDelegate between AppDelegate and ReactNativeDelegate', () => {
    const result = appendSceneDelegate(TEMPLATE_APP_DELEGATE);

    const sceneIdx = result.indexOf('class SceneDelegate: UIResponder, UIWindowSceneDelegate');
    expect(sceneIdx).toBeGreaterThan(result.indexOf('class AppDelegate'));
    expect(sceneIdx).toBeLessThan(result.indexOf('class ReactNativeDelegate'));
  });

  it('re-parents the AppDelegate-created window into the connecting scene', () => {
    const result = appendSceneDelegate(TEMPLATE_APP_DELEGATE);

    expect(result).toContain('window.windowScene = windowScene');
    expect(result).toContain('window.makeKeyAndVisible()');
  });

  it('forwards deep links and user activities to the AppDelegate', () => {
    const result = appendSceneDelegate(TEMPLATE_APP_DELEGATE);

    // Cold start: connectionOptions; warm: openURLContexts / continue userActivity
    expect(result).toContain('connectionOptions.urlContexts');
    expect(result).toContain('connectionOptions.userActivities');
    expect(result).toContain('openURLContexts URLContexts: Set<UIOpenURLContext>');
    expect(result).toContain('continue userActivity: NSUserActivity');
  });

  it('adds the UIKit import the template lacks, once', () => {
    const result = appendSceneDelegate(TEMPLATE_APP_DELEGATE);

    expect(result.match(/^import UIKit$/gm)).toHaveLength(1);
  });

  it('is idempotent so re-running prebuild mods cannot duplicate the class', () => {
    const once = appendSceneDelegate(TEMPLATE_APP_DELEGATE);

    expect(appendSceneDelegate(once)).toBe(once);
  });

  it('falls back to appending at end of file when the template anchor is missing', () => {
    const bare = 'internal import Expo\n\n@main\nclass AppDelegate: ExpoAppDelegate {\n}\n';

    const result = appendSceneDelegate(bare);

    expect(result).toContain('class SceneDelegate: UIResponder, UIWindowSceneDelegate');
  });
});
