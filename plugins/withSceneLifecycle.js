// UIScene lifecycle adoption for the iOS 27 SDK, which traps at launch
// (__UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption) without it.
// Expo SDK 57 has no official scene support (expo/expo#46733 is main-only, SDK 58);
// delete this plugin once the SDK ships ExpoAppSceneDelegate.
//
// Expo startup stays in didFinishLaunchingWithOptions: moving startReactNative
// into the scene breaks expo-dev-menu (expo/expo#33836). The SceneDelegate only
// re-parents the AppDelegate-created window and forwards the events UIKit now
// routes to scenes.

const SCENE_MANIFEST = {
  UIApplicationSupportsMultipleScenes: false,
  UISceneConfigurations: {
    UIWindowSceneSessionRoleApplication: [
      {
        UISceneConfigurationName: 'Default Configuration',
        UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
      },
    ],
  },
};

const SCENE_DELEGATE_CLASS = `// Minimal UIScene adoption: the iOS 27 SDK refuses to launch apps without a
// scene lifecycle. React Native / Expo SDK 57 still start via the app delegate,
// so the scene delegate only re-parents the window AppDelegate already created
// and forwards URL/user-activity events that UIKit now routes to scenes.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
          let appDelegate = UIApplication.shared.delegate as? AppDelegate,
          let window = appDelegate.window
    else { return }
    window.windowScene = windowScene
    window.makeKeyAndVisible()

    // Cold-start deep links arrive in connectionOptions under the scene lifecycle
    if let urlContext = connectionOptions.urlContexts.first {
      _ = appDelegate.application(UIApplication.shared, open: urlContext.url, options: [:])
    }
    if let userActivity = connectionOptions.userActivities.first {
      _ = appDelegate.application(UIApplication.shared, continue: userActivity) { _ in }
    }
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate else { return }
    for context in URLContexts {
      _ = appDelegate.application(UIApplication.shared, open: context.url, options: [:])
    }
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate else { return }
    _ = appDelegate.application(UIApplication.shared, continue: userActivity) { _ in }
  }
}`;

function setSceneManifest(infoPlist) {
  return { ...infoPlist, UIApplicationSceneManifest: SCENE_MANIFEST };
}

function appendSceneDelegate(contents) {
  if (contents.includes('class SceneDelegate:')) {
    return contents;
  }

  let result = contents;
  if (!/^import UIKit$/m.test(result)) {
    // UIWindowSceneDelegate & friends; the SDK 57 template does not import UIKit
    result = result.replace(
      /^((?:internal |public )?import .+)$(?![\s\S]*^(?:internal |public )?import .+$)/m,
      '$1\nimport UIKit'
    );
  }

  const anchor = /\nclass ReactNativeDelegate/;
  if (anchor.test(result)) {
    return result.replace(anchor, `\n${SCENE_DELEGATE_CLASS}\n\nclass ReactNativeDelegate`);
  }
  return `${result}\n${SCENE_DELEGATE_CLASS}\n`;
}

function withSceneLifecycle(config) {
  const { withInfoPlist, withAppDelegate } = require('expo/config-plugins');

  config = withInfoPlist(config, (c) => {
    c.modResults = setSceneManifest(c.modResults);
    return c;
  });

  config = withAppDelegate(config, (c) => {
    if (c.modResults.language !== 'swift') {
      throw new Error('withSceneLifecycle only supports the Swift AppDelegate template');
    }
    c.modResults.contents = appendSceneDelegate(c.modResults.contents);
    return c;
  });

  return config;
}

module.exports = withSceneLifecycle;
module.exports.setSceneManifest = setSceneManifest;
module.exports.appendSceneDelegate = appendSceneDelegate;
