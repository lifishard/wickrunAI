import Foundation

// Run on the macOS CI runner before the app build:
// swiftc native/ios/SncUTF8Decoder.swift native/ios/tests/main.swift -o /tmp/wickrun-utf8-tests
// /tmp/wickrun-utf8-tests
let samples = ["", "ASCII\n\ndata: done", "中文与🙂🚀混合\r\ndata: {\"text\":\"𐐷é\"}\n\n", "a\u{FEFF}终",
               "\u{FEFF}start\u{FEFF}\u{FEFF}end", "a\0b\u{FFFD}é"]
for (sampleIndex, sample) in samples.enumerated() {
    let bytes = Array(sample.utf8)
    for split in 0...bytes.count {
        var decoder = SncUTF8Decoder()
        var output = try decoder.append(Data(bytes[..<split]))
        output += try decoder.append(Data(bytes[split...]))
        output += try decoder.append(Data(), final: true)
        precondition(output.utf8.elementsEqual(bytes), "UTF-8 changed in sample \(sampleIndex) at network boundary \(split)")
    }
    var decoder = SncUTF8Decoder()
    var output = ""
    for byte in bytes { output += try decoder.append(Data([byte])) }
    output += try decoder.append(Data(), final: true)
    precondition(output.utf8.elementsEqual(bytes), "Single-byte network chunks changed UTF-8 in sample \(sampleIndex)")
}
let invalidSequences: [[UInt8]] = [[0x80], [0xC0, 0x80], [0xED, 0xA0, 0x80], [0xF4, 0x90, 0x80, 0x80], [0xE4, 0xB8], [0x61, 0x80, 0x62]]
for invalid in invalidSequences {
    for split in 0...invalid.count {
        var decoder = SncUTF8Decoder()
        var rejected = false
        do {
            _ = try decoder.append(Data(invalid[..<split]))
            _ = try decoder.append(Data(invalid[split...]))
            _ = try decoder.append(Data(), final: true)
        } catch { rejected = true }
        precondition(rejected, "Malformed or truncated UTF-8 was accepted at boundary \(split)")
    }
}
print("PASS: every UTF-8 split, BOM/null/replacement preservation, single-byte chunks, malformed and truncated input")
