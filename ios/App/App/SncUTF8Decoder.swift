import Foundation

/// Keeps only an incomplete Unicode scalar between network callbacks.
/// Invalid/truncated UTF-8 fails visibly instead of corrupting model output.
struct SncUTF8Decoder {
    enum DecodingError: Error { case invalidUTF8 }
    private var pending: [UInt8] = []

    mutating func append(_ data: Data, final: Bool = false) throws -> String {
        pending.append(contentsOf: data)
        var end = pending.count
        if !final, let last = pending.last, last >= 0x80 {
            var start = pending.count - 1
            while start > 0 && pending[start] & 0xC0 == 0x80 { start -= 1 }
            let lead = pending[start]
            let expected: Int
            switch lead {
            case 0xC2...0xDF: expected = 2
            case 0xE0...0xEF: expected = 3
            case 0xF0...0xF4: expected = 4
            default: throw DecodingError.invalidUTF8
            }
            if pending.count - start < expected { end = start }
        }
        let units = pending[..<end]
        // Foundation's encoding initializer strips a BOM at the start of each
        // chunk. The standard-library decoder preserves that Unicode scalar.
        // Exact byte round-trip rejects any repaired malformed sequence while
        // keeping compatibility with the app's pre-iOS-18 deployment target.
        let text = String(decoding: units, as: UTF8.self)
        guard text.utf8.elementsEqual(units) else {
            throw DecodingError.invalidUTF8
        }
        pending.removeFirst(end)
        return text
    }
}
