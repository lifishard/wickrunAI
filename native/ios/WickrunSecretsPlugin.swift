import Foundation
import Security
import Capacitor

/// Device-local credentials. No iCloud sync, backup migration, or plaintext fallback.
@objc(WickrunSecretsPlugin)
public final class WickrunSecretsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WickrunSecretsPlugin"
    public let jsName = "WickrunSecrets"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise)
    ]

    private func query(_ call: CAPPluginCall) -> [String: Any]? {
        guard let key = call.getString("key"), !key.isEmpty, key.utf8.count <= 512,
              let identifier = Bundle.main.bundleIdentifier else {
            call.reject("A valid credential key and app identifier are required.")
            return nil
        }
        return [kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: identifier + ".secrets",
                kSecAttrAccount as String: key,
                kSecAttrSynchronizable as String: false]
    }

    @objc public func get(_ call: CAPPluginCall) {
        guard var query = query(call) else { return }
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { call.resolve(["value": NSNull()]); return }
        guard status == errSecSuccess, let data = item as? Data,
              let value = String(data: data, encoding: .utf8) else {
            call.reject("Secure credential read failed (Keychain status \(status)).")
            return
        }
        call.resolve(["value": value])
    }

    @objc public func set(_ call: CAPPluginCall) {
        guard var query = query(call) else { return }
        guard let value = call.getString("value"), value.utf8.count <= 65536 else {
            call.reject("A credential value of at most 64 KB is required.")
            return
        }
        let attributes: [String: Any] = [kSecValueData as String: Data(value.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            query.merge(attributes) { _, new in new }
            status = SecItemAdd(query as CFDictionary, nil)
            if status == errSecDuplicateItem, let original = self.query(call) {
                status = SecItemUpdate(original as CFDictionary, attributes as CFDictionary)
            }
        }
        guard status == errSecSuccess else {
            call.reject("Secure credential save failed (Keychain status \(status)).")
            return
        }
        call.resolve()
    }

    @objc public func remove(_ call: CAPPluginCall) {
        guard let query = query(call) else { return }
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            call.reject("Secure credential removal failed (Keychain status \(status)).")
            return
        }
        call.resolve()
    }
}
