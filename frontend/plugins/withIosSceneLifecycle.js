const fs = require('fs');
const path = require('path');
const {
  IOSConfig,
  withAppDelegate,
  withDangerousMod,
  withInfoPlist,
  withXcodeProject,
} = require('expo/config-plugins');

// iOS 27 terminates apps that haven't adopted the UIScene lifecycle, and the
// Expo 54 template still builds its window in the app delegate. This moves
// window creation into a SceneDelegate and forwards scene URL events back to
// the app delegate, where Expo subscribers (Google Sign-In) and
// RCTLinkingManager already handle them.

const SCENE_DELEGATE = `import React
import UIKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard
      let windowScene = scene as? UIWindowScene,
      let appDelegate = UIApplication.shared.delegate as? AppDelegate,
      let factory = appDelegate.reactNativeFactory
    else { return }

    // Linking.getInitialURL reads the launch URL from launchOptions.
    var launchOptions: [UIApplication.LaunchOptionsKey: Any] = [:]
    if let url = connectionOptions.urlContexts.first?.url {
      launchOptions[.url] = url
    }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    // Modules such as expo-system-ui and react-native-screens look the
    // window up on the app delegate.
    appDelegate.window = window
    factory.startReactNative(withModuleName: "main", in: window, launchOptions: launchOptions)
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    let app = UIApplication.shared
    for context in URLContexts {
      var options: [UIApplication.OpenURLOptionsKey: Any] = [:]
      options[.sourceApplication] = context.options.sourceApplication
      options[.annotation] = context.options.annotation
      _ = app.delegate?.application?(app, open: context.url, options: options)
    }
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    let app = UIApplication.shared
    _ = app.delegate?.application?(app, continue: userActivity, restorationHandler: { _ in })
  }
}
`;

const withSceneManifest = (config) =>
  withInfoPlist(config, (cfg) => {
    cfg.modResults.UIApplicationSceneManifest = {
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
    return cfg;
  });

// The template starts React Native into a delegate-owned window; the scene
// delegate does that now.
const withAppDelegateWithoutWindow = (config) =>
  withAppDelegate(config, (cfg) => {
    const block = /#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n[\s\S]*?#endif\n/;
    if (cfg.modResults.language !== 'swift' || !block.test(cfg.modResults.contents)) {
      throw new Error('withIosSceneLifecycle: AppDelegate.swift no longer matches the expected template');
    }
    cfg.modResults.contents = cfg.modResults.contents.replace(
      block,
      '    // SceneDelegate creates the window and starts React Native.\n'
    );
    return cfg;
  });

const withSceneDelegateFile = (config) => {
  config = withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const projectName = IOSConfig.XcodeUtils.getProjectName(cfg.modRequest.projectRoot);
      const target = path.join(cfg.modRequest.platformProjectRoot, projectName, 'SceneDelegate.swift');
      fs.writeFileSync(target, SCENE_DELEGATE);
      return cfg;
    },
  ]);
  return withXcodeProject(config, (cfg) => {
    const projectName = IOSConfig.XcodeUtils.getProjectName(cfg.modRequest.projectRoot);
    const filepath = `${projectName}/SceneDelegate.swift`;
    if (!cfg.modResults.hasFile(filepath)) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath,
        groupName: projectName,
        project: cfg.modResults,
      });
    }
    return cfg;
  });
};

module.exports = function withIosSceneLifecycle(config) {
  config = withSceneManifest(config);
  config = withAppDelegateWithoutWindow(config);
  config = withSceneDelegateFile(config);
  return config;
};
