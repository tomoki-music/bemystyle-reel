// 画像内の文字を読み取る検証ツール（macOS Vision・オンデバイス。外部APIは使わない）。
// 使い方: swiftc -O ocrText.swift -o ocrText && ./ocrText <画像ファイル>...
// 画像ごとに1行のJSON（{"text":"認識した文字を連結した文字列"}）を出力する。検証スクリプトがプロセス内で照合するだけで、ログへは残さない。
import Foundation
import Vision
import AppKit

for path in CommandLine.arguments.dropFirst() {
    guard let img = NSImage(contentsOfFile: path), let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        print("{\"text\":\"\",\"error\":\"load\"}")
        continue
    }
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    req.recognitionLanguages = ["ja-JP", "en-US"]
    req.usesLanguageCorrection = false
    try? VNImageRequestHandler(cgImage: cg, options: [:]).perform([req])
    let lines = (req.results ?? []).compactMap { $0.topCandidates(1).first?.string }
    let data = try! JSONSerialization.data(withJSONObject: ["text": lines.joined(separator: "\n")], options: [])
    print(String(data: data, encoding: .utf8)!)
}
