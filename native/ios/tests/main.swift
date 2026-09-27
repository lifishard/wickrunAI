import Foundation

// Run on the macOS CI runner before the app build:
// swiftc native/ios/SncUTF8Decoder.swift native/ios/tests/main.swift -o /tmp/wickrun-utf8-tests
// /tmp/wickrun-utf8-tests
let samples = ["", "ASCII\n\ndata: done", "中文与🙂🚀混合\r\ndata: {\"text\":\"𐐷é\"}\n\n", "a\u{FEFF}终"]
for sample in samples {
    let bytes = Array(sample.utf8)
    for split in 0...bytes.count {
        var decoder = SncUTF8Decoder()
        var output = try decoder.append(Data(bytes[..<split]))
        output += try decoder.append(Data(bytes[split...]))
        output += try decoder.append(Data(), final: true)
        precondition(output == sample, "UTF-8 changed at network boundary \(split)")
    }
    var decoder = SncUTF8Decoder()
    var output = ""
    for byte in bytes { output += try decoder.append(Data([byte])) }
    output += try decoder.append(Data(), final: true)
    precondition(output == sample, "Single-byte network chunks changed UTF-8")
}
let invalidSequences: [[UInt8]] = [[0x80], [0xC0, 0x80], [0xED, 0xA0, 0x80], [0xF4, 0x90, 0x80, 0x80], [0xE4, 0xB8]]
for invalid in invalidSequences {
    var decoder = SncUTF8Decoder()
    var rejected = false
    do {
        _ = try decoder.append(Data(invalid))
        _ = try decoder.append(Data(), final: true)
    } catch { rejected = true }
    precondition(rejected, "Malformed or truncated UTF-8 was accepted")
}
print("PASS: every UTF-8 split, single-byte chunks, malformed and truncated input")
