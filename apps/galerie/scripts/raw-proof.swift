import CoreImage
import Foundation
import ImageIO

guard CommandLine.arguments.count == 3, let maxEdge = Double(CommandLine.arguments[2]) else {
  fatalError("usage: raw-proof <RAW path> <max edge; 0 = full size>")
}

let path = CommandLine.arguments[1]
let url = URL(fileURLWithPath: path)
guard let raw = CIRAWFilter(imageURL: url) else { fatalError("Core Image rejected \(path)") }
let native = raw.nativeSize
if maxEdge > 0 {
  raw.scaleFactor = Float(min(1, maxEdge / max(native.width, native.height)))
}
raw.isDraftModeEnabled = false
raw.exposure = 0
raw.baselineExposure = 0
raw.shadowBias = 0
raw.boostAmount = 0
raw.boostShadowAmount = 0
raw.isGamutMappingEnabled = false
raw.isLensCorrectionEnabled = false
raw.luminanceNoiseReductionAmount = 0
raw.colorNoiseReductionAmount = 0
raw.sharpnessAmount = 0
raw.contrastAmount = 0
raw.detailAmount = 0
raw.moireReductionAmount = 0
raw.localToneMapAmount = 0
raw.extendedDynamicRangeAmount = 0

guard let image = raw.outputImage,
      let colorSpace = CGColorSpace(name: CGColorSpace.extendedLinearSRGB) else {
  fatalError("Core Image produced no linear output")
}
let context = CIContext()
let started = ContinuousClock.now
guard let tiff = context.tiffRepresentation(
  of: image,
  format: .RGBA16,
  colorSpace: colorSpace,
  options: [:]
), let source = CGImageSourceCreateWithData(tiff as CFData, nil),
   let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] else {
  fatalError("16-bit TIFF render failed")
}
let elapsed = started.duration(to: .now)
let seconds = Double(elapsed.components.seconds) + Double(elapsed.components.attoseconds) / 1e18
let depth = properties[kCGImagePropertyDepth] as? Int ?? 0
let profile = properties[kCGImagePropertyProfileName] as? String ?? ""
let width = Int(image.extent.width.rounded())
let height = Int(image.extent.height.rounded())
let result: [String: Any] = [
  "decoderVersion": String(describing: raw.decoderVersion),
  "nativeWidth": Int(native.width.rounded()),
  "nativeHeight": Int(native.height.rounded()),
  "width": width,
  "height": height,
  "pixels": width * height,
  "orientation": Int(raw.orientation.rawValue),
  "seconds": seconds,
  "tiffBytes": tiff.count,
  "tiffDepth": depth,
  "iccProfile": profile,
  "estimatedRgba16Bytes": width * height * 8
]
let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
print(String(decoding: data, as: UTF8.self))
