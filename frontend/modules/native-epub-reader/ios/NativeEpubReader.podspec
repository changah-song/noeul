Pod::Spec.new do |s|
  s.name           = 'NativeEpubReader'
  s.version        = '0.1.0'
  s.summary        = 'Paged EPUB reader view for Noeul'
  s.description    = 'CoreText reader view backing the NativeEpubReader Expo module on iOS.'
  s.author         = 'Noeul'
  s.homepage       = 'https://noeul.app'
  s.license        = { :type => 'Proprietary' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.{h,m,swift}'
end
