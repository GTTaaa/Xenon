import Foundation
import CoreGraphics
import ImageIO
import Vision

// 校验命令行参数：必须传入待识别图片的文件路径
guard CommandLine.arguments.count > 1 else {
    fputs("用法: mac-vision-ocr <图片文件绝对路径>\n", stderr)
    exit(1)
}

let imagePath = CommandLine.arguments[1]
let fileURL = URL(fileURLWithPath: imagePath)

// 使用 ImageIO 底层接口稳定读取本地图片为 CGImage 格式
guard let imageSource = CGImageSourceCreateWithURL(fileURL as CFURL, nil),
      let cgImage = CGImageSourceCreateImageAtIndex(imageSource, 0, nil) else {
    fputs("错误: 无法加载目标图片文件: \(imagePath)\n", stderr)
    exit(1)
}

// 创建文字识别请求并配置高精度与语言纠错
let request = VNRecognizeTextRequest { request, error in
    if let error = error {
        fputs("识别错误: \(error.localizedDescription)\n", stderr)
        exit(1)
    }

    guard let observations = request.results as? [VNRecognizedTextObservation] else {
        exit(0)
    }

    // 提取每个识别文本块最高置信度的候选字符串
    let recognizedLines = observations.compactMap { observation in
        observation.topCandidates(1).first?.string
    }

    // 将多行文本按换行符拼装后输出至标准输出
    let outputText = recognizedLines.joined(separator: "\n")
    print(outputText)
}

// 设置精准模式
request.recognitionLevel = .accurate
// 开启智能语言纠错
request.usesLanguageCorrection = true
// 指定常见识别语言优先级（简体中文、英文、日语、韩语等）
request.recognitionLanguages = ["zh-Hans", "en-US", "ja-JP", "ko-KR"]

// 执行图片分析请求
let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
do {
    try handler.perform([request])
} catch {
    fputs("执行图片识别请求失败: \(error.localizedDescription)\n", stderr)
    exit(1)
}
