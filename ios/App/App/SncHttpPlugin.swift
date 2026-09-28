import Foundation
import Capacitor

/// HTTPS transport only. SSE parsing remains shared with the other platforms.
@objc(SncHttpPlugin)
public final class SncHttpPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SncHttpPlugin"
    public let jsName = "SncHttp"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "abort", returnType: CAPPluginReturnPromise)
    ]

    // Capacitor may invoke methods off-main. All accesses to this dictionary,
    // and all URLSession callbacks below, run on the main dispatch queue.
    private var requests: [String: SncHttpRequest] = [:]

    @objc public func request(_ call: CAPPluginCall) {
        guard let requestID = call.getString("requestId"), !requestID.isEmpty,
              requestID.utf8.count <= 256,
              let rawURL = call.getString("url"), let url = URL(string: rawURL),
              url.scheme?.lowercased() == "https", url.host != nil,
              url.user == nil, url.password == nil else {
            call.reject("A request ID and HTTPS API URL without embedded credentials are required.")
            return
        }
        let method = (call.getString("method") ?? "POST").uppercased()
        guard ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].contains(method) else {
            call.reject("Unsupported HTTP method.")
            return
        }
        let timeout = TimeInterval(max(1000, min(call.getInt("timeoutMs") ?? 180000, 1800000))) / 1000
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
        request.httpMethod = method
        for (key, value) in call.getObject("headers") ?? [:] {
            guard let text = value as? String,
                  !key.contains("\r"), !key.contains("\n"),
                  !text.contains("\r"), !text.contains("\n") else {
                call.reject("Invalid HTTP headers.")
                return
            }
            request.setValue(text, forHTTPHeaderField: key)
        }
        let stream = call.getBool("stream") ?? false
        if stream { request.setValue("identity", forHTTPHeaderField: "Accept-Encoding") }
        if method != "GET" && method != "HEAD" {
            request.httpBody = Data((call.getString("body") ?? "").utf8)
        }
        let preparedRequest = request
        DispatchQueue.main.async { [weak self] in
            guard let self else { call.reject("The network bridge is unavailable."); return }
            guard self.requests[requestID] == nil else { call.reject("Request ID is already active."); return }
            guard self.requests.count < 16 else { call.reject("Too many active network requests."); return }
            let operation = SncHttpRequest(call: call, requestID: requestID, stream: stream,
                event: { [weak self] event in self?.notifyListeners("sncHttpEvent", data: event) },
                complete: { [weak self] in self?.requests.removeValue(forKey: requestID) })
            self.requests[requestID] = operation
            operation.start(preparedRequest, timeout: timeout)
        }
    }

    @objc public func abort(_ call: CAPPluginCall) {
        guard let requestID = call.getString("requestId") else { call.reject("Missing request ID."); return }
        DispatchQueue.main.async { [weak self] in
            self?.requests[requestID]?.cancel()
            call.resolve()
        }
    }
}

/// URLSession requires a Sendable delegate. This object's mutable state is
/// synchronized by the main queue: start/cancel and every delegate callback
/// assert that boundary. It performs no blocking network work on that queue.
private final class SncHttpRequest: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private let call: CAPPluginCall
    private let requestID: String
    private let stream: Bool
    private let event: (JSObject) -> Void
    private let complete: () -> Void
    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var status = 0
    private var body = Data()
    private var decoder = SncUTF8Decoder()
    private var settled = false
    private let maximumBodyBytes = 32 * 1024 * 1024

    init(call: CAPPluginCall, requestID: String, stream: Bool,
         event: @escaping (JSObject) -> Void, complete: @escaping () -> Void) {
        self.call = call
        self.requestID = requestID
        self.stream = stream
        self.event = event
        self.complete = complete
    }

    func start(_ request: URLRequest, timeout: TimeInterval) {
        dispatchPrecondition(condition: .onQueue(.main))
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = timeout
        configuration.timeoutIntervalForResource = timeout
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCredentialStorage = nil
        configuration.urlCache = nil
        configuration.waitsForConnectivity = false
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: .main)
        self.session = session
        let task = session.dataTask(with: request)
        self.task = task
        task.resume()
    }

    func cancel() {
        dispatchPrecondition(condition: .onQueue(.main))
        guard !settled else { return }
        emit("done")
        finish(["status": 499])
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        dispatchPrecondition(condition: .onQueue(.main))
        guard !settled, let response = response as? HTTPURLResponse else {
            completionHandler(.cancel)
            fail("Invalid HTTP response.")
            return
        }
        status = response.statusCode
        guard !(300...399).contains(status) else {
            completionHandler(.cancel)
            fail("The API redirected the request. Configure its final HTTPS URL.")
            return
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        dispatchPrecondition(condition: .onQueue(.main))
        guard !settled else { return }
        if stream && status < 400 {
            do {
                let text = try decoder.append(data)
                if !text.isEmpty { emit("chunk", data: text) }
            } catch { fail("The API returned invalid UTF-8 text.") }
        } else {
            guard data.count <= maximumBodyBytes - body.count else {
                fail("The API response exceeded the 32 MB text-response limit.")
                return
            }
            body.append(data)
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        dispatchPrecondition(condition: .onQueue(.main))
        guard !settled else { return }
        if let error {
            let code = (error as NSError).code
            fail(code == NSURLErrorTimedOut ? "The API request timed out." : "The API connection failed. Check the URL, network and certificate.")
            return
        }
        if stream && status < 400 {
            do {
                let remaining = try decoder.append(Data(), final: true)
                if !remaining.isEmpty { emit("chunk", data: remaining) }
                emit("done")
                finish(["status": status])
            } catch { fail("The API stream ended with incomplete UTF-8 text.") }
        } else {
            guard let text = String(data: body, encoding: .utf8) else {
                fail("The API returned invalid UTF-8 text.")
                return
            }
            finish(["status": status, "body": text])
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        dispatchPrecondition(condition: .onQueue(.main))
        // A gateway redirect must never send an Authorization header to another host.
        completionHandler(nil)
    }

    private func emit(_ type: String, data: String? = nil) {
        var value: JSObject = ["requestId": requestID, "type": type]
        if let data { value["data"] = data }
        if status > 0 { value["status"] = status }
        event(value)
    }

    private func fail(_ message: String) {
        guard !settled else { return }
        emit("error", data: message)
        settled = true
        call.reject(message)
        cleanup()
    }

    private func finish(_ result: JSObject) {
        guard !settled else { return }
        settled = true
        call.resolve(result)
        cleanup()
    }

    private func cleanup() {
        task?.cancel()
        task = nil
        session?.invalidateAndCancel()
        session = nil
        body.removeAll()
        complete()
    }
}
