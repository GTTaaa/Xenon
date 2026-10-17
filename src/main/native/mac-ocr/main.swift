import Foundation
import CoreGraphics
import ImageIO
import Vision

// 识别参数：高精度 + 智能纠错 + 中文优先语言列表
// 注意：显式指定 recognitionLanguages 会触发 Vision 模型首次编译（冷启动 30~60s），
// 因此 daemon 模式把「编译一次、常驻复用」作为默认路径。
private let recognitionLanguages = ["zh-Hans", "en-US", "ja-JP", "ko-KR"]

/// 构造一次文字识别请求（不执行）
private func makeRequest() -> VNRecognizeTextRequest {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = recognitionLanguages
    return request
}

/// 读取图片为 CGImage
private func loadImage(_ imagePath: String) -> CGImage? {
    let fileURL = URL(fileURLWithPath: imagePath)
    guard let imageSource = CGImageSourceCreateWithURL(fileURL as CFURL, nil) else { return nil }
    return CGImageSourceCreateImageAtIndex(imageSource, 0, nil)
}

/// 同步识别单张图片，返回按行拼接的文本
private func recognize(_ imagePath: String) -> (text: String?, error: String?) {
    guard let cgImage = loadImage(imagePath) else {
        return (nil, "无法加载目标图片文件: \(imagePath)")
    }

    let request = makeRequest()
    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])

    do {
        try handler.perform([request])
    } catch {
        return (nil, "执行图片识别请求失败: \(error.localizedDescription)")
    }

    // 无识别结果（例如纯色图片）视为成功但输出为空字符串
    // 新版 SDK 已将 results 类型化为 [VNRecognizedTextObservation]，旧版需做一次运行时转换
    let observations: [VNRecognizedTextObservation] = request.results ?? []

    // 提取每个识别文本块最高置信度的候选字符串
    let recognizedLines = observations.compactMap { $0.topCandidates(1).first?.string }

    return (recognizedLines.joined(separator: "\n"), nil)
}

/// 将文本转义为可安全放入单行 JSON 字符串的形式
private func escapeJSON(_ value: String) -> String {
    var escaped = ""
    escaped.reserveCapacity(value.count + 16)
    for scalar in value.unicodeScalars {
        switch scalar {
        case "\"": escaped += "\\\""
        case "\\": escaped += "\\\\"
        case "\n": escaped += "\\n"
        case "\r": escaped += "\\r"
        case "\t": escaped += "\\t"
        default:
            if scalar.value < 0x20 {
                escaped += String(format: "\\u%04x", scalar.value)
            } else {
                escaped.unicodeScalars.append(scalar)
            }
        }
    }
    return escaped
}

/// daemon 模式：从 stdin 逐行读取图片路径，每行输出一条单行 JSON 结果
/// 输出格式：{"ok":true,"text":"..."} 或 {"ok":false,"error":"..."}
private func runDaemon() -> Never {
    while let rawLine = readLine(strippingNewline: true) {
        let imagePath = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
        if imagePath.isEmpty { continue }

        let (text, error) = recognize(imagePath)
        if let text = text {
            print("{\"ok\":true,\"text\":\"\(escapeJSON(text))\"}")
        } else {
            print("{\"ok\":false,\"error\":\"\(escapeJSON(error ?? "未知错误"))\"}")
        }
        fflush(stdout)
    }

    exit(0)
}

// 校验命令行参数：daemon 模式无需图片路径，单次模式必须传入待识别图片的文件路径
let arguments = CommandLine.arguments
if arguments.count > 1 && arguments[1] == "--daemon" {
    runDaemon()
}

guard arguments.count > 1 else {
    fputs("用法: mac-vision-ocr <图片文件绝对路径>\n", stderr)
    fputs("      mac-vision-ocr --daemon   (从 stdin 逐行读取图片路径，输出单行 JSON)\n", stderr)
    exit(1)
}

let imagePath = arguments[1]
let (text, error) = recognize(imagePath)
if let text = text {
    print(text)
    exit(0)
}

fputs("错误: \(error ?? "未知错误")\n", stderr)
exit(1)
