import Foundation
import AppKit

// Validate input arguments
guard CommandLine.arguments.count > 1 else {
    exit(1)
}

let filePath = CommandLine.arguments[1]
let fileURL = URL(fileURLWithPath: filePath)

guard FileManager.default.fileExists(atPath: filePath) else {
    exit(2)
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

class ShareDelegate: NSObject, NSSharingServicePickerDelegate {
    func sharingServicePicker(_ picker: NSSharingServicePicker, didChoose service: NSSharingService?) {
        // Exit cleanly when user selects a service (e.g. WhatsApp, AirDrop, Mail, etc.)
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
            exit(0)
        }
    }
}

let delegate = ShareDelegate()

DispatchQueue.main.async {
    // Invisible anchor window positioned at center screen
    let window = NSWindow(
        contentRect: NSRect(x: 0, y: 0, width: 4, height: 4),
        styleMask: [.borderless],
        backing: .buffered,
        defer: false
    )
    window.center()
    window.isOpaque = false
    window.backgroundColor = .clear
    window.makeKeyAndOrderFront(nil)

    let picker = NSSharingServicePicker(items: [fileURL])
    picker.delegate = delegate

    if let view = window.contentView {
        picker.show(relativeTo: view.bounds, of: view, preferredEdge: .minY)
    }
}

// Timeout after 90 seconds if user dismisses or takes no action
DispatchQueue.main.asyncAfter(deadline: .now() + 90.0) {
    exit(0)
}

app.run()
