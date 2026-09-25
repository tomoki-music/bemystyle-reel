// QRコードの読み取り検証ツール（macOS Vision）。画像を1枚読み、QRの内容そのものではなく「読み取れたか・文字数・ドメイン・SHA-256」だけを出力する。
// 使い方: swiftc -O qrDecode.swift -o qrDecode && ./qrDecode <画像ファイル>
import Foundation
import Vision
import AppKit
import CryptoKit

let path = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : ""
guard let img = NSImage(contentsOfFile: path), let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { print("{\"decoded\":false,\"reason\":\"load\"}"); exit(2) }
let req = VNDetectBarcodesRequest()
req.symbologies = [.qr]
try VNImageRequestHandler(cgImage: cg, options: [:]).perform([req])
guard let r = req.results?.first, let p = r.payloadStringValue else { print("{\"decoded\":false,\"reason\":\"none\"}"); exit(1) }
let sha = SHA256.hash(data: Data(p.utf8)).map { String(format: "%02x", $0) }.joined()
let host = URL(string: p)?.host ?? ""
print("{\"decoded\":true,\"length\":\(p.count),\"host\":\"\(host)\",\"sha256\":\"\(sha)\"}")
