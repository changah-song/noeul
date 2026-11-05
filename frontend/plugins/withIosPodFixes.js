const { withPodfile } = require('expo/config-plugins');

// Xcode 27 refuses pod targets (mostly privacy/resource bundles) that still
// declare iOS 9-10. Raise every pod target to at least the app's minimum.
// Its clang also rejects fmt 11's consteval format strings under C++20, so
// the fmt pod alone compiles as C++17.
const MARKER = '# withIosPodFixes';
const MIN_TARGET = '15.1';

module.exports = function withIosPodFixes(config) {
  return withPodfile(config, (cfg) => {
    const podfile = cfg.modResults.contents;
    if (podfile.includes(MARKER)) return cfg;
    const hook = [
      `    ${MARKER}`,
      '    installer.pods_project.targets.each do |target|',
      '      target.build_configurations.each do |build_config|',
      "        current = build_config.build_settings['IPHONEOS_DEPLOYMENT_TARGET']",
      `        if current.nil? || Gem::Version.new(current) < Gem::Version.new('${MIN_TARGET}')`,
      `          build_config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${MIN_TARGET}'`,
      '        end',
      "        build_config.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++17' if target.name == 'fmt'",
      '      end',
      '    end',
    ].join('\n');
    cfg.modResults.contents = podfile.replace(
      // After react_native_post_install, which sets its own C++ standard.
      /(\n    react_native_post_install\([\s\S]*?\n    \)\n)/,
      `$1${hook}\n`
    );
    return cfg;
  });
};
