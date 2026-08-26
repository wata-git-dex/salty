import UIKit
import Capacitor
import PhotosUI
import UniformTypeIdentifiers
import AVFoundation

@objc(SodiumMediaPlugin)
public class SodiumMediaPlugin: CAPPlugin, CAPBridgedPlugin, PHPickerViewControllerDelegate {
    public let identifier = "SodiumMediaPlugin"
    public let jsName = "SodiumMedia"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pickAndCompressVideos", returnType: CAPPluginReturnPromise)
    ]

    private var pendingCall: CAPPluginCall?
    private var maximumDuration: Double = 300

    @objc func pickAndCompressVideos(_ call: CAPPluginCall) {
        guard pendingCall == nil else {
            call.reject("Another clip selection is already open.")
            return
        }
        pendingCall = call
        maximumDuration = min(300, max(1, call.getDouble("maxDurationSeconds") ?? 300))

        var configuration = PHPickerConfiguration(photoLibrary: .shared())
        configuration.filter = .videos
        configuration.selectionLimit = min(5, max(1, call.getInt("maxCount") ?? 5))
        configuration.selection = .ordered

        let picker = PHPickerViewController(configuration: configuration)
        picker.delegate = self
        DispatchQueue.main.async { [weak self] in
            guard let controller = self?.bridge?.viewController else {
                self?.finishWithError("Sodium could not open the video picker.")
                return
            }
            controller.present(picker, animated: true)
        }
    }

    public func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        guard !results.isEmpty else {
            pendingCall?.resolve(["files": []])
            pendingCall = nil
            return
        }
        compress(results: results, index: 0, completed: [])
    }

    private func compress(results: [PHPickerResult], index: Int, completed: [[String: Any]]) {
        guard index < results.count else {
            pendingCall?.resolve(["files": completed])
            pendingCall = nil
            return
        }

        let provider = results[index].itemProvider
        guard provider.hasItemConformingToTypeIdentifier(UTType.movie.identifier) else {
            finishWithError("One selected item was not a video.")
            return
        }

        provider.loadFileRepresentation(forTypeIdentifier: UTType.movie.identifier) { [weak self] sourceURL, error in
            guard let self else { return }
            guard let sourceURL else {
                self.finishWithError(error?.localizedDescription ?? "Sodium could not read that clip.")
                return
            }
            do {
                let inputDirectory = FileManager.default.temporaryDirectory.appendingPathComponent("sodium-media-input", isDirectory: true)
                try FileManager.default.createDirectory(at: inputDirectory, withIntermediateDirectories: true)
                let inputURL = inputDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension(sourceURL.pathExtension.isEmpty ? "mov" : sourceURL.pathExtension)
                try? FileManager.default.removeItem(at: inputURL)
                try FileManager.default.copyItem(at: sourceURL, to: inputURL)
                self.compressVideo(at: inputURL, position: index, total: results.count) { result in
                    try? FileManager.default.removeItem(at: inputURL)
                    switch result {
                    case .success(let file):
                        self.compress(results: results, index: index + 1, completed: completed + [file])
                    case .failure(let compressionError):
                        self.finishWithError(compressionError.localizedDescription)
                    }
                }
            } catch {
                self.finishWithError("Sodium could not prepare that clip: \(error.localizedDescription)")
            }
        }
    }

    private func compressVideo(at inputURL: URL, position: Int, total: Int, completion: @escaping (Result<[String: Any], Error>) -> Void) {
        let asset = AVURLAsset(url: inputURL)
        let duration = CMTimeGetSeconds(asset.duration)
        guard duration.isFinite, duration > 0 else {
            completion(.failure(NSError(domain: "SodiumMedia", code: 1, userInfo: [NSLocalizedDescriptionKey: "Sodium could not read the clip duration."])))
            return
        }
        guard duration <= maximumDuration + 0.5 else {
            completion(.failure(NSError(domain: "SodiumMedia", code: 2, userInfo: [NSLocalizedDescriptionKey: "This clip is longer than five minutes."])))
            return
        }
        guard let exporter = AVAssetExportSession(asset: asset, presetName: AVAssetExportPreset1920x1080) else {
            completion(.failure(NSError(domain: "SodiumMedia", code: 3, userInfo: [NSLocalizedDescriptionKey: "This video cannot be compressed on this iPhone."])))
            return
        }

        do {
            let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("sodium-media", isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let outputURL = directory.appendingPathComponent(UUID().uuidString).appendingPathExtension("mp4")
            try? FileManager.default.removeItem(at: outputURL)
            exporter.outputURL = outputURL
            exporter.outputFileType = .mp4
            exporter.shouldOptimizeForNetworkUse = true

            DispatchQueue.main.async {
                let timer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self, weak exporter] timer in
                    guard let exporter else { timer.invalidate(); return }
                    self?.notifyListeners("compressionProgress", data: [
                        "index": position,
                        "total": total,
                        "progress": Double(exporter.progress)
                    ])
                    if exporter.status != .waiting && exporter.status != .exporting { timer.invalidate() }
                }
                RunLoop.main.add(timer, forMode: .common)
            }

            exporter.exportAsynchronously {
                switch exporter.status {
                case .completed:
                    do {
                        let values = try outputURL.resourceValues(forKeys: [.fileSizeKey])
                        completion(.success([
                            "path": outputURL.absoluteString,
                            "name": "sodium-clip-\(position + 1).mp4",
                            "type": "video/mp4",
                            "size": values.fileSize ?? 0,
                            "duration": duration
                        ]))
                    } catch {
                        completion(.failure(error))
                    }
                case .cancelled:
                    completion(.failure(NSError(domain: "SodiumMedia", code: 4, userInfo: [NSLocalizedDescriptionKey: "Video compression was cancelled."])))
                default:
                    completion(.failure(exporter.error ?? NSError(domain: "SodiumMedia", code: 5, userInfo: [NSLocalizedDescriptionKey: "Video compression failed."])))
                }
            }
        } catch {
            completion(.failure(error))
        }
    }

    private func finishWithError(_ message: String) {
        DispatchQueue.main.async { [weak self] in
            self?.pendingCall?.reject(message)
            self?.pendingCall = nil
        }
    }
}

public class SodiumBridgeViewController: CAPBridgeViewController {
    public override func capacitorDidLoad() {
        bridge?.registerPluginInstance(SodiumMediaPlugin())
    }
}

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}
