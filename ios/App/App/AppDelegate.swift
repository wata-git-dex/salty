import UIKit
import Capacitor
import PhotosUI
import UniformTypeIdentifiers
import AVFoundation
import AuthenticationServices
import WebKit

@objc(SodiumAuthPlugin)
public class SodiumAuthPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    public let identifier = "SodiumAuthPlugin"
    public let jsName = "SodiumAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "logDiagnostic", returnType: CAPPluginReturnPromise)
    ]

    private var authenticationSession: ASWebAuthenticationSession?

    @objc func logDiagnostic(_ call: CAPPluginCall) {
        let message = call.getString("message") ?? "Unknown startup diagnostic"
        print("[Sodium native startup] \(message)")
        call.resolve()
    }

    @objc func authenticate(_ call: CAPPluginCall) {
        guard let rawURL = call.getString("url"), let url = URL(string: rawURL) else {
            call.reject("Sodium received an invalid Google sign-in address.")
            return
        }
        let callbackScheme = call.getString("callbackScheme") ?? "sodium"
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.authenticationSession?.cancel()
            print("[SodiumAuth] Starting native authentication session")
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: callbackScheme) { [weak self] callbackURL, error in
                self?.authenticationSession = nil
                if let callbackURL {
                    let keys = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)?.queryItems?.map(\.name) ?? []
                    print("[SodiumAuth] Received \(callbackURL.scheme ?? "unknown") callback with keys: \(keys)")
                    call.resolve(["url": callbackURL.absoluteString])
                    return
                }
                print("[SodiumAuth] Authentication ended without a callback: \(error?.localizedDescription ?? "unknown error")")
                if let authError = error as? ASWebAuthenticationSessionError, authError.code == .canceledLogin {
                    call.reject("Google sign-in was cancelled.")
                } else {
                    call.reject(error?.localizedDescription ?? "Google could not return to Sodium.")
                }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.authenticationSession = session
            if !session.start() {
                self.authenticationSession = nil
                call.reject("Sodium could not open Google sign-in.")
            }
        }
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        if let window = bridge?.viewController?.view.window { return window }
        for case let scene as UIWindowScene in UIApplication.shared.connectedScenes {
            if let keyWindow = scene.windows.first(where: { $0.isKeyWindow }) { return keyWindow }
        }
        return ASPresentationAnchor()
    }
}

@objc(SodiumMediaPlugin)
public class SodiumMediaPlugin: CAPPlugin, CAPBridgedPlugin, PHPickerViewControllerDelegate {
    public let identifier = "SodiumMediaPlugin"
    public let jsName = "SodiumMedia"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pickAndCompressVideos", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "uploadTus", returnType: CAPPluginReturnPromise)
    ]

    private var pendingCall: CAPPluginCall?
    private var maximumDuration: Double = 300
    private var uploads: [String: SodiumTusUploadOperation] = [:]

    @objc func uploadTus(_ call: CAPPluginCall) {
        guard let rawPath = call.getString("path"),
              let uploadAddress = call.getString("uploadUrl"),
              let uploadURL = URL(string: uploadAddress),
              uploadURL.scheme == "https" else {
            call.reject("Sodium received an invalid native upload request.")
            return
        }
        let fileURL: URL
        if let parsed = URL(string: rawPath), parsed.isFileURL {
            fileURL = parsed
        } else {
            fileURL = URL(fileURLWithPath: rawPath)
        }
        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            call.reject("The compressed clip is no longer available on this iPhone. Choose it again.")
            return
        }
        let uploadID = call.getString("uploadId") ?? UUID().uuidString
        let operation = SodiumTusUploadOperation(
            uploadID: uploadID,
            fileURL: fileURL,
            uploadURL: uploadURL,
            progress: { [weak self] uploaded, total in
                self?.notifyListeners("uploadProgress", data: [
                    "uploadId": uploadID,
                    "bytesUploaded": uploaded,
                    "bytesTotal": total,
                    "progress": total > 0 ? Double(uploaded) / Double(total) : 0
                ])
            },
            completion: { [weak self] result in
                self?.uploads.removeValue(forKey: uploadID)
                switch result {
                case .success(let bytes):
                    call.resolve(["uploadId": uploadID, "bytesUploaded": bytes])
                case .failure(let error):
                    call.reject(error.localizedDescription)
                }
            }
        )
        uploads[uploadID] = operation
        operation.start()
    }

    @objc func pickAndCompressVideos(_ call: CAPPluginCall) {
        guard pendingCall == nil else {
            call.reject("Another clip selection is already open.")
            return
        }
        pendingCall = call
        maximumDuration = min(300, max(1, call.getDouble("maxDurationSeconds") ?? 300))
        let selectionLimit = min(5, max(1, call.getInt("maxCount") ?? 5))

        // Capacitor invokes plugin methods on its bridge queue. PhotosUI has
        // main-thread-only initialization assertions and will SIGABRT if the
        // picker itself (not merely presentation) is created on that queue.
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            guard let controller = self.bridge?.viewController else {
                self.finishWithError("Sodium could not open the video picker.")
                return
            }
            var configuration = PHPickerConfiguration(photoLibrary: .shared())
            configuration.filter = .videos
            configuration.selectionLimit = selectionLimit
            configuration.selection = .ordered
            let picker = PHPickerViewController(configuration: configuration)
            picker.delegate = self
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
        // 720p is intentional for Stoke: it keeps phone uploads materially
        // smaller while preserving enough detail for social surf clips. The
        // original remains untouched in Photos.
        guard let exporter = AVAssetExportSession(asset: asset, presetName: AVAssetExportPreset1280x720) else {
            completion(.failure(NSError(domain: "SodiumMedia", code: 3, userInfo: [NSLocalizedDescriptionKey: "This video cannot be compressed on this iPhone."])))
            return
        }

        do {
            let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("sodium-media", isDirectory: true)
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

private final class SodiumTusUploadOperation {
    private static let chunkSize = 5 * 1024 * 1024
    private static let retryDelays: [TimeInterval] = [1, 3, 5, 10, 20, 30]

    private let uploadID: String
    private let fileURL: URL
    private let uploadURL: URL
    private let totalSize: Int64
    private let progress: (Int64, Int64) -> Void
    private let completion: (Result<Int64, Error>) -> Void
    private var offset: Int64 = 0
    private var retryAttempt = 0
    private var finished = false

    init(uploadID: String, fileURL: URL, uploadURL: URL, progress: @escaping (Int64, Int64) -> Void, completion: @escaping (Result<Int64, Error>) -> Void) {
        self.uploadID = uploadID
        self.fileURL = fileURL
        self.uploadURL = uploadURL
        self.progress = progress
        self.completion = completion
        let values = try? fileURL.resourceValues(forKeys: [.fileSizeKey])
        self.totalSize = Int64(values?.fileSize ?? 0)
    }

    func start() {
        guard totalSize > 0 else {
            finish(.failure(error("The compressed clip is empty.")))
            return
        }
        recoverOffset()
    }

    private func recoverOffset() {
        var request = URLRequest(url: uploadURL)
        request.httpMethod = "HEAD"
        request.setValue("1.0.0", forHTTPHeaderField: "Tus-Resumable")
        URLSession.shared.dataTask(with: request) { [weak self] _, response, requestError in
            guard let self else { return }
            if let requestError { self.retryOrFail(requestError); return }
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                self.retryOrFail(self.error("Cloudflare could not resume this upload.")); return
            }
            self.offset = Int64(http.value(forHTTPHeaderField: "Upload-Offset") ?? "0") ?? 0
            self.retryAttempt = 0
            self.progress(self.offset, self.totalSize)
            self.uploadNextChunk()
        }.resume()
    }

    private func uploadNextChunk() {
        if offset >= totalSize {
            finish(.success(totalSize))
            return
        }
        let remaining = totalSize - offset
        let length = Int(min(Int64(Self.chunkSize), remaining))
        let chunkURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("sodium-tus-\(uploadID)-\(offset)")
            .appendingPathExtension("chunk")
        do {
            let source = try FileHandle(forReadingFrom: fileURL)
            defer { try? source.close() }
            try source.seek(toOffset: UInt64(offset))
            guard let data = try source.read(upToCount: length), !data.isEmpty else {
                throw error("Sodium could not read the next part of this clip.")
            }
            try data.write(to: chunkURL, options: .atomic)
        } catch {
            finish(.failure(error)); return
        }

        var request = URLRequest(url: uploadURL)
        request.httpMethod = "PATCH"
        request.setValue("1.0.0", forHTTPHeaderField: "Tus-Resumable")
        request.setValue("application/offset+octet-stream", forHTTPHeaderField: "Content-Type")
        request.setValue(String(offset), forHTTPHeaderField: "Upload-Offset")
        URLSession.shared.uploadTask(with: request, fromFile: chunkURL) { [weak self] _, response, requestError in
            try? FileManager.default.removeItem(at: chunkURL)
            guard let self else { return }
            if let requestError { self.retryOrFail(requestError); return }
            guard let http = response as? HTTPURLResponse, http.statusCode == 204 else {
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                if status == 409 || status == 412 { self.recoverOffset(); return }
                self.retryOrFail(self.error("Cloudflare stopped the upload (\(status)).")); return
            }
            let next = Int64(http.value(forHTTPHeaderField: "Upload-Offset") ?? "")
            self.offset = next ?? min(self.totalSize, self.offset + Int64(length))
            self.retryAttempt = 0
            self.progress(self.offset, self.totalSize)
            self.uploadNextChunk()
        }.resume()
    }

    private func retryOrFail(_ uploadError: Error) {
        guard retryAttempt < Self.retryDelays.count else {
            finish(.failure(error("The connection stopped. Your upload can resume from its saved Cloudflare checkpoint when you try again.")))
            return
        }
        let delay = Self.retryDelays[retryAttempt]
        retryAttempt += 1
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + delay) { [weak self] in
            self?.recoverOffset()
        }
    }

    private func finish(_ result: Result<Int64, Error>) {
        guard !finished else { return }
        finished = true
        DispatchQueue.main.async { [completion] in completion(result) }
    }

    private func error(_ message: String) -> NSError {
        NSError(domain: "SodiumTusUpload", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
}

public class SodiumBridgeViewController: CAPBridgeViewController, WKScriptMessageHandler {
    private let sodiumRefreshControl = UIRefreshControl()
    private let sodiumRefreshIcon = UIImageView()
    private var sodiumRefreshInFlight = false
    private var sodiumRefreshTimeout: DispatchWorkItem?

    public override func capacitorDidLoad() {
        bridge?.webView?.configuration.userContentController.add(self, name: "sodiumDiagnostic")
        bridge?.webView?.configuration.userContentController.add(self, name: "sodiumRefresh")
        bridge?.registerPluginInstance(SodiumAuthPlugin())
        bridge?.registerPluginInstance(SodiumMediaPlugin())
        configurePullToRefresh()
    }

    private func configurePullToRefresh() {
        guard let webView = bridge?.webView else { return }
        let scrollView = webView.scrollView
        let sodiumBackground = UIColor(red: 10.0 / 255.0, green: 20.0 / 255.0, blue: 28.0 / 255.0, alpha: 1)
        webView.isOpaque = false
        webView.backgroundColor = sodiumBackground
        scrollView.backgroundColor = sodiumBackground
        // Capacitor disables bouncing by default. A refresh control cannot be
        // revealed on short pages unless vertical bouncing is explicitly on.
        scrollView.bounces = true
        scrollView.alwaysBounceVertical = true
        scrollView.alwaysBounceHorizontal = false
        scrollView.isDirectionalLockEnabled = true

        sodiumRefreshControl.tintColor = UIColor(red: 246.0 / 255.0, green: 162.0 / 255.0, blue: 60.0 / 255.0, alpha: 1)
        sodiumRefreshControl.backgroundColor = .clear
        sodiumRefreshControl.addTarget(self, action: #selector(refreshSodium), for: .valueChanged)

        let iconURL = Bundle.main.bundleURL
            .appendingPathComponent("public/assets/emojis/png/core/salt-shaker-stoked.png")
        sodiumRefreshIcon.image = UIImage(contentsOfFile: iconURL.path)
        sodiumRefreshIcon.contentMode = .scaleAspectFit
        sodiumRefreshIcon.translatesAutoresizingMaskIntoConstraints = false
        sodiumRefreshControl.addSubview(sodiumRefreshIcon)
        NSLayoutConstraint.activate([
            sodiumRefreshIcon.centerXAnchor.constraint(equalTo: sodiumRefreshControl.centerXAnchor),
            sodiumRefreshIcon.centerYAnchor.constraint(equalTo: sodiumRefreshControl.centerYAnchor),
            sodiumRefreshIcon.widthAnchor.constraint(equalToConstant: 32),
            sodiumRefreshIcon.heightAnchor.constraint(equalToConstant: 32)
        ])
        scrollView.refreshControl = sodiumRefreshControl
        scrollView.sendSubviewToBack(sodiumRefreshControl)
    }

    @objc private func refreshSodium() {
        guard !sodiumRefreshInFlight else { return }
        print("[Sodium refresh] Pull-to-refresh triggered")
        guard let webView = bridge?.webView else {
            sodiumRefreshControl.endRefreshing()
            return
        }
        let canRefresh = """
        (() => {
          const app = document.getElementById('app');
          const blocked = document.querySelector('.sheet.open, #drawer.open, #guideViewer:not(.hidden)');
          return Boolean(app && !app.classList.contains('hidden') && !blocked);
        })()
        """
        webView.evaluateJavaScript(canRefresh) { [weak self, weak webView] result, _ in
            guard let self else { return }
            guard result as? Bool == true else {
                self.finishSodiumRefresh()
                return
            }
            self.sodiumRefreshInFlight = true
            let rotation = CABasicAnimation(keyPath: "transform.rotation.z")
            rotation.fromValue = 0
            rotation.toValue = Double.pi * 2
            rotation.duration = 0.7
            rotation.repeatCount = .infinity
            self.sodiumRefreshIcon.layer.add(rotation, forKey: "sodium-refresh-spin")
            webView?.evaluateJavaScript("window.sodiumNativeRefresh?.(); true") { _, error in
                if let error {
                    print("[Sodium refresh] JavaScript refresh failed: \(error.localizedDescription)")
                    self.finishSodiumRefresh()
                }
            }
            let timeout = DispatchWorkItem { [weak self] in
                print("[Sodium refresh] Timed out waiting for the web app")
                self?.finishSodiumRefresh()
            }
            self.sodiumRefreshTimeout?.cancel()
            self.sodiumRefreshTimeout = timeout
            DispatchQueue.main.asyncAfter(deadline: .now() + 20, execute: timeout)
        }
    }

    private func finishSodiumRefresh() {
        sodiumRefreshTimeout?.cancel()
        sodiumRefreshTimeout = nil
        sodiumRefreshIcon.layer.removeAnimation(forKey: "sodium-refresh-spin")
        sodiumRefreshControl.endRefreshing()
        sodiumRefreshInFlight = false
    }

    public func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "sodiumRefresh" {
            print("[Sodium refresh] Completed: \(String(describing: message.body))")
            finishSodiumRefresh()
        } else if message.name == "sodiumDiagnostic" {
            print("[Sodium native startup] \(String(describing: message.body))")
        }
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
