// evaBoard for the Mac: the clipboard list, kept the same as the phone's.
//
// The merge rules are the phone's (app/.../ime/eva/macsync/MacSyncProtocol.kt, MacSyncMerge):
// an item's id is a hash of its content, so the same text copied on both sides is one item; a
// deletion is kept as a "gone" mark with its time and beats every copy made before it.

import CryptoKit
import Foundation

struct SyncItem: Codable, Identifiable, Equatable {
    var id: String
    var kind: String = "text"
    var text: String
    // pictures: their type ("image/png"); the bytes travel separately ("need" -> "blob")
    var mime: String? = nil
    var ts: Int64
    var pinned: Bool = false
    var mod: Int64
}

/** One message on the wire; unknown fields are ignored on both sides. */
struct SyncMessage: Codable {
    var t: String
    var device: String? = nil
    var v: Int? = nil
    var items: [SyncItem]? = nil
    var item: SyncItem? = nil
    var fresh: Bool? = nil
    var gone: [String: Int64]? = nil
    var ids: [String]? = nil
    var id: String? = nil
    // base64 bytes of a picture
    var data: String? = nil
}

func nowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

/** A picture's id: the hash of its bytes, which travel unchanged. */
func imageId(_ data: Data) -> String {
    let digest = SHA256.hash(data: data)
    return "i" + String(digest.map { String(format: "%02x", $0) }.joined().prefix(32))
}

func textId(_ text: String) -> String {
    let digest = SHA256.hash(data: Data(text.utf8))
    return "t" + String(digest.map { String(format: "%02x", $0) }.joined().prefix(32))
}

final class Store: ObservableObject {
    @Published private(set) var items: [String: SyncItem] = [:]
    private(set) var gone: [String: Int64] = [:]

    private static let goneKeepMs: Int64 = 30 * 24 * 60 * 60 * 1000
    private let file: URL
    private let images: URL
    private var saveWork: DispatchWorkItem?

    init(folder: URL) {
        file = folder.appendingPathComponent("clipboard.json")
        images = folder.appendingPathComponent("images", isDirectory: true)
        try? FileManager.default.createDirectory(at: images, withIntermediateDirectories: true)
        load()
    }

    // MARK: pictures' bytes, one file per picture

    func blobURL(_ id: String) -> URL { images.appendingPathComponent(id) }

    func hasBlob(_ id: String) -> Bool { FileManager.default.fileExists(atPath: blobURL(id).path) }

    func blob(_ id: String) -> Data? { try? Data(contentsOf: blobURL(id)) }

    /** False when the bytes are not the picture this id names. */
    func saveBlob(_ id: String, _ data: Data) -> Bool {
        guard imageId(data) == id else { return false }
        try? data.write(to: blobURL(id), options: .atomic)
        objectWillChange.send()
        return true
    }

    private func dropBlob(_ id: String) {
        if id.hasPrefix("i") { try? FileManager.default.removeItem(at: blobURL(id)) }
    }

    /** Pinned first, then the newest. */
    var sorted: [SyncItem] {
        items.values.sorted { a, b in
            if a.pinned != b.pinned { return a.pinned }
            return a.ts > b.ts
        }
    }

    // MARK: changes made on the Mac - each returns what to tell the phone

    func copiedHere(_ text: String) -> SyncItem {
        let id = textId(text)
        let now = nowMs()
        var item = items[id] ?? SyncItem(id: id, text: text, ts: now, mod: now)
        item.ts = now
        item.mod = now
        items[id] = item
        gone[id] = nil
        save()
        return item
    }

    func copiedHere(image data: Data, mime: String) -> SyncItem {
        let id = imageId(data)
        if !hasBlob(id) { try? data.write(to: blobURL(id), options: .atomic) }
        let now = nowMs()
        var item = items[id] ?? SyncItem(id: id, kind: "image", text: "", mime: mime, ts: now, mod: now)
        item.ts = now
        item.mod = now
        items[id] = item
        gone[id] = nil
        save()
        return item
    }

    func togglePin(_ id: String) -> SyncItem? {
        guard var item = items[id] else { return nil }
        item.pinned.toggle()
        item.mod = max(nowMs(), item.mod + 1)
        items[id] = item
        save()
        return item
    }

    func delete(_ ids: [String]) -> [String: Int64] {
        let now = nowMs()
        var marks: [String: Int64] = [:]
        for id in ids where items[id] != nil {
            items[id] = nil
            dropBlob(id)
            gone[id] = now
            marks[id] = now
        }
        save()
        return marks
    }

    /** Clears everything but the pinned items, like the phone's own clear. */
    func clearUnpinned() -> [String: Int64] {
        delete(items.values.filter { !$0.pinned }.map(\.id))
    }

    // MARK: changes from the phone

    /** True when the list changed. */
    @discardableResult
    func apply(upsert incoming: SyncItem) -> Bool {
        guard incoming.kind == "text" || incoming.kind == "image" else { return false }
        if let at = gone[incoming.id], at >= incoming.ts { return false }
        if let local = items[incoming.id] {
            let newer = incoming.ts > local.ts || (incoming.ts == local.ts && incoming.mod > local.mod)
            if !newer { return false }
        }
        gone[incoming.id] = nil
        items[incoming.id] = incoming
        save()
        return true
    }

    func apply(gone marks: [String: Int64]) {
        for (id, at) in marks {
            gone[id] = max(gone[id] ?? Int64.min, at)
            if let local = items[id], local.ts <= at {
                items[id] = nil
                dropBlob(id)
            }
        }
        save()
    }

    // MARK: saving

    private struct Saved: Codable {
        var items: [SyncItem]
        var gone: [String: Int64]
    }

    private func load() {
        guard let data = try? Data(contentsOf: file),
              let saved = try? JSONDecoder().decode(Saved.self, from: data) else { return }
        items = Dictionary(saved.items.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        gone = saved.gone
    }

    private func save() {
        saveWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            let cutoff = nowMs() - Store.goneKeepMs
            self.gone = self.gone.filter { $0.value >= cutoff }
            let saved = Saved(items: Array(self.items.values), gone: self.gone)
            if let data = try? JSONEncoder().encode(saved) {
                try? data.write(to: self.file, options: .atomic)
            }
        }
        saveWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: work)
    }
}
