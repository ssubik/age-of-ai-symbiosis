import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

struct Job {
  let input: String
  let crop: CGRect
  let output: String
}

let jobs: [Job] = [
  Job(input: "client/public/art/age-of-ai-building-family-runtime-v3.png", crop: CGRect(x: 0, y: 0, width: 520, height: 500), output: "machine_command_core_v3.png"),
  Job(input: "client/public/art/age-of-ai-building-family-runtime-v3.png", crop: CGRect(x: 455, y: 470, width: 680, height: 535), output: "machine_unit_factory_v3.png"),
  Job(input: "client/public/art/age-of-ai-economy-weapons-runtime-v4.png", crop: CGRect(x: 0, y: 0, width: 512, height: 342), output: "machine_energy_generator_v3.png"),
  Job(input: "client/public/art/age-of-ai-economy-weapons-runtime-v4.png", crop: CGRect(x: 1024, y: 0, width: 512, height: 342), output: "machine_alloy_extractor_v3.png"),
  Job(input: "client/public/art/age-of-ai-economy-weapons-runtime-v4.png", crop: CGRect(x: 0, y: 330, width: 512, height: 352), output: "machine_alloy_depot_v3.png"),
  Job(input: "client/public/art/age-of-ai-economy-weapons-runtime-v4.png", crop: CGRect(x: 512, y: 330, width: 512, height: 352), output: "machine_compute_node_v3.png"),
  Job(input: "client/public/art/age-of-ai-economy-weapons-runtime-v4.png", crop: CGRect(x: 1024, y: 330, width: 512, height: 352), output: "machine_ledger_vault_v3.png"),
  Job(input: "client/public/art/age-of-ai-economy-weapons-runtime-v4.png", crop: CGRect(x: 0, y: 682, width: 512, height: 342), output: "machine_pulse_turret_v3.png"),
  Job(input: "client/public/art/age-of-ai-economy-weapons-runtime-v4.png", crop: CGRect(x: 512, y: 682, width: 512, height: 342), output: "machine_rail_turret_v3.png"),
  Job(input: "client/public/art/age-of-ai-economy-weapons-runtime-v4.png", crop: CGRect(x: 1024, y: 682, width: 512, height: 342), output: "machine_missile_turret_v3.png"),
  Job(input: "client/public/art/age-of-ai-unit-family-runtime-v3.png", crop: CGRect(x: 30, y: 0, width: 300, height: 410), output: "machine_human_engineer_v3.png"),
  Job(input: "client/public/art/age-of-ai-unit-family-runtime-v3.png", crop: CGRect(x: 300, y: 0, width: 520, height: 410), output: "machine_builder_robot_v3.png"),
  Job(input: "client/public/art/age-of-ai-unit-family-runtime-v3.png", crop: CGRect(x: 800, y: 20, width: 410, height: 370), output: "machine_scout_drone_v3.png"),
  Job(input: "client/public/art/age-of-ai-unit-family-runtime-v3.png", crop: CGRect(x: 1190, y: 0, width: 584, height: 420), output: "machine_assault_mech_v3.png"),
  Job(input: "client/public/art/age-of-ai-unit-family-runtime-v3.png", crop: CGRect(x: 0, y: 370, width: 530, height: 517), output: "machine_siege_walker_v3.png"),
  Job(input: "client/public/art/age-of-ai-unit-family-runtime-v3.png", crop: CGRect(x: 430, y: 370, width: 520, height: 410), output: "machine_fighter_v3.png"),
  Job(input: "client/public/art/age-of-ai-unit-family-runtime-v3.png", crop: CGRect(x: 870, y: 350, width: 550, height: 537), output: "machine_iron_guardian_v3.png"),
  Job(input: "client/public/art/age-of-ai-unit-family-runtime-v3.png", crop: CGRect(x: 1340, y: 340, width: 434, height: 547), output: "machine_aegis_valkyrie_v3.png"),
]

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let outputDir = root.appendingPathComponent("client/public/sprites/machine-v3", isDirectory: true)
try FileManager.default.createDirectory(at: outputDir, withIntermediateDirectories: true)

func load(_ path: String) throws -> CGImage {
  let url = root.appendingPathComponent(path) as CFURL
  guard let source = CGImageSourceCreateWithURL(url, nil), let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    throw NSError(domain: "atlas", code: 1, userInfo: [NSLocalizedDescriptionKey: "Cannot load \(path)"])
  }
  return image
}

func isolate(_ image: CGImage, crop: CGRect) throws -> CGImage {
  guard let cut = image.cropping(to: crop) else { throw NSError(domain: "atlas", code: 2) }
  let w = cut.width, h = cut.height, row = w * 4
  var rgba = [UInt8](repeating: 0, count: row * h)
  rgba.withUnsafeMutableBytes { raw in
    let context = CGContext(data: raw.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: row,
      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    context.draw(cut, in: CGRect(x: 0, y: 0, width: w, height: h))
  }

  var seen = [Bool](repeating: false, count: w * h)
  var best: [Int] = []
  let directions = [(-1, 0), (1, 0), (0, -1), (0, 1)]
  for start in 0..<(w * h) where !seen[start] && rgba[start * 4 + 3] > 8 {
    seen[start] = true
    var queue = [start], head = 0
    while head < queue.count {
      let p = queue[head]; head += 1
      let x = p % w, y = p / w
      for (dx, dy) in directions {
        let nx = x + dx, ny = y + dy
        if nx < 0 || ny < 0 || nx >= w || ny >= h { continue }
        let n = ny * w + nx
        if !seen[n] && rgba[n * 4 + 3] > 8 { seen[n] = true; queue.append(n) }
      }
    }
    if queue.count > best.count { best = queue }
  }
  guard !best.isEmpty else { throw NSError(domain: "atlas", code: 3) }

  var keep = [Bool](repeating: false, count: w * h)
  var minX = w, minY = h, maxX = 0, maxY = 0
  for p in best {
    keep[p] = true
    let x = p % w, y = p / w
    minX = min(minX, x); minY = min(minY, y); maxX = max(maxX, x); maxY = max(maxY, y)
  }
  let pad = 4
  minX = max(0, minX - pad); minY = max(0, minY - pad)
  maxX = min(w - 1, maxX + pad); maxY = min(h - 1, maxY + pad)
  let outW = maxX - minX + 1, outH = maxY - minY + 1, outRow = outW * 4
  var out = [UInt8](repeating: 0, count: outRow * outH)
  for y in minY...maxY { for x in minX...maxX {
    let source = y * w + x
    guard keep[source] else { continue }
    let destination = (y - minY) * outW + (x - minX)
    for channel in 0..<4 { out[destination * 4 + channel] = rgba[source * 4 + channel] }
  }}
  let data = Data(out) as CFData
  let provider = CGDataProvider(data: data)!
  return CGImage(width: outW, height: outH, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: outRow,
    space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
    provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent)!
}

for job in jobs {
  let result = try isolate(load(job.input), crop: job.crop)
  let destinationURL = outputDir.appendingPathComponent(job.output)
  guard let destination = CGImageDestinationCreateWithURL(destinationURL as CFURL, UTType.png.identifier as CFString, 1, nil) else {
    throw NSError(domain: "atlas", code: 4)
  }
  CGImageDestinationAddImage(destination, result, nil)
  guard CGImageDestinationFinalize(destination) else { throw NSError(domain: "atlas", code: 5) }
  print("\(job.output): \(result.width)x\(result.height)")
}
