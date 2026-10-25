// Draws evaBoard's Mac icon (a soft light tile with a clipboard) as a 1024 px PNG.
//   swift mac/make-icon.swift <out.png>
import AppKit

let size: CGFloat = 1024
let image = NSImage(size: NSSize(width: size, height: size))
image.lockFocus()
// macOS icon grid: the tile leaves a margin around it
let tile = NSRect(x: 100, y: 100, width: 824, height: 824)
let path = NSBezierPath(roundedRect: tile, xRadius: 185, yRadius: 185)
NSGradient(colors: [NSColor(calibratedWhite: 0.99, alpha: 1), NSColor(calibratedRed: 0.90, green: 0.92, blue: 0.96, alpha: 1)])!
    .draw(in: path, angle: -90)
NSColor(calibratedWhite: 0, alpha: 0.08).setStroke()
path.lineWidth = 4
path.stroke()
let config = NSImage.SymbolConfiguration(pointSize: 470, weight: .regular)
    .applying(.init(paletteColors: [NSColor(calibratedRed: 0.22, green: 0.27, blue: 0.40, alpha: 1)]))
if let symbol = NSImage(systemSymbolName: "list.clipboard", accessibilityDescription: nil)?.withSymbolConfiguration(config) {
    let s = symbol.size
    symbol.draw(in: NSRect(x: (size - s.width) / 2, y: (size - s.height) / 2 - 10, width: s.width, height: s.height))
}
image.unlockFocus()
let rep = NSBitmapImageRep(data: image.tiffRepresentation!)!
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
