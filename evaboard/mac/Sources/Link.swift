// evaBoard for the Mac: the link with the phone.
//
// The Mac listens on the home Wi-Fi and announces itself over Bonjour as _evaboard._tcp; the phone
// finds it and connects. A frame is a 4-byte big-endian length, then a 12-byte nonce and the
// AES-256-GCM ciphertext with its tag (CryptoKit's "combined" form, which is the phone's layout too).
// The key is SHA-256 of "evaboard-sync-v1:" + the pairing code; a frame that does not open ends
// the connection. Everything here runs on the main queue.

import CryptoKit
import Foundation
import Network

enum PairingCode {
    private static let alphabet = Array("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")

    static func make() -> String {
        var generator = SystemRandomNumberGenerator()
        let chars = (0..<16).map { _ in alphabet.randomElement(using: &generator)! }
        return stride(from: 0, to: 16, by: 4).map { String(chars[$0..<$0 + 4]) }.joined(separator: "-")
    }

    static func key(for code: String) -> SymmetricKey {
        let clean = code.uppercased().filter { ("A"..."Z").contains($0) || ("0"..."9").contains($0) }
        return SymmetricKey(data: SHA256.hash(data: Data(("evaboard-sync-v1:" + clean).utf8)))
    }
}

final class Peer {
    let connection: NWConnection
    private let key: SymmetricKey
    private let onMessage: (Peer, SyncMessage) -> Void
    private let onClose: (Peer) -> Void
    private var closed = false
    var device: String?
    var lastHeard = Date()

    init(connection: NWConnection, key: SymmetricKey,
         onMessage: @escaping (Peer, SyncMessage) -> Void, onClose: @escaping (Peer) -> Void) {
        self.connection = connection
        self.key = key
        self.onMessage = onMessage
        self.onClose = onClose
    }

    func start() {
        connection.stateUpdateHandler = { [weak self] state in
            switch state {
            case .failed, .cancelled: self?.close()
            default: break
            }
        }
        connection.start(queue: .main)
        readLength()
    }

    /** [then] runs once the frame has gone out - file parts wait for it, so a big file is not read all at once. */
    func send(_ message: SyncMessage, then: (() -> Void)? = nil) {
        guard !closed, let plain = try? JSONEncoder().encode(message),
              let sealed = try? AES.GCM.seal(plain, using: key).combined else { return }
        var length = UInt32(sealed.count).bigEndian
        var frame = Data(bytes: &length, count: 4)
        frame.append(sealed)
        connection.send(content: frame, completion: .contentProcessed { [weak self] error in
            if error != nil { self?.close() } else { then?() }
        })
    }

    func close() {
        guard !closed else { return }
        closed = true
        connection.cancel()
        onClose(self)
    }

    private func readLength() {
        connection.receive(minimumIncompleteLength: 4, maximumLength: 4) { [weak self] data, _, done, error in
            guard let self, !self.closed else { return }
            guard let data, data.count == 4, error == nil else { self.close(); return }
            let size = data.withUnsafeBytes { $0.loadUnaligned(as: UInt32.self) }.bigEndian
            guard size > 0, size <= 32 * 1024 * 1024 else { self.close(); return }
            self.readBody(Int(size))
            if done { self.close() }
        }
    }

    private func readBody(_ size: Int) {
        connection.receive(minimumIncompleteLength: size, maximumLength: size) { [weak self] data, _, _, error in
            guard let self, !self.closed else { return }
            guard let data, data.count == size, error == nil,
                  let box = try? AES.GCM.SealedBox(combined: data),
                  let plain = try? AES.GCM.open(box, using: self.key),
                  let message = try? JSONDecoder().decode(SyncMessage.self, from: plain)
            else { self.close(); return }
            self.lastHeard = Date()
            self.onMessage(self, message)
            self.readLength()
        }
    }
}

final class Link: ObservableObject {
    @Published private(set) var phones: [String] = []
    @Published private(set) var problem: String?

    private var listener: NWListener?
    private var peers: [Peer] = []
    private var key: SymmetricKey
    private let onMessage: (SyncMessage, Peer) -> Void
    private let snapshot: () -> SyncMessage
    private var pinger: Timer?
    /** A phone went away: half-received files start again next time. */
    var onPeerGone: (() -> Void)?

    init(code: String, snapshot: @escaping () -> SyncMessage, onMessage: @escaping (SyncMessage, Peer) -> Void) {
        key = PairingCode.key(for: code)
        self.snapshot = snapshot
        self.onMessage = onMessage
    }

    func start() {
        do {
            let listener = try NWListener(using: .tcp)
            listener.service = NWListener.Service(name: Host.current().localizedName ?? "Mac", type: "_evaboard._tcp")
            listener.newConnectionHandler = { [weak self] connection in self?.accept(connection) }
            listener.stateUpdateHandler = { [weak self] state in
                switch state {
                case .ready: self?.problem = nil
                case .failed(let error):
                    self?.problem = "Мережа недоступна: \(error.localizedDescription)"
                    self?.listener?.cancel()
                    DispatchQueue.main.asyncAfter(deadline: .now() + 5) { self?.start() }
                default: break
                }
            }
            listener.start(queue: .main)
            self.listener = listener
        } catch {
            problem = "Не вдалося відкрити мережу: \(error.localizedDescription)"
        }
        pinger?.invalidate()
        pinger = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in
            guard let self else { return }
            for peer in self.peers {
                if Date().timeIntervalSince(peer.lastHeard) > 50 { peer.close() } else { peer.send(SyncMessage(t: "ping")) }
            }
        }
    }

    /** A new code: everyone connected with the old one is dropped. */
    func rekey(_ code: String) {
        key = PairingCode.key(for: code)
        for peer in peers { peer.close() }
    }

    func broadcast(_ message: SyncMessage, except sender: Peer? = nil) {
        for peer in peers where peer.device != nil && peer !== sender { peer.send(message) }
    }

    private func accept(_ connection: NWConnection) {
        let peer = Peer(connection: connection, key: key, onMessage: { [weak self] peer, message in
            guard let self else { return }
            if message.t == "hello" {
                let first = peer.device == nil
                peer.device = message.device ?? "Телефон"
                if first {
                    peer.send(self.snapshot())
                }
                self.refreshNames()
            }
            self.onMessage(message, peer)
        }, onClose: { [weak self] peer in
            self?.peers.removeAll { $0 === peer }
            self?.refreshNames()
            self?.onPeerGone?()
        })
        peers.append(peer)
        peer.start()
        peer.send(SyncMessage(t: "hello", device: Host.current().localizedName ?? "Mac", v: 1))
    }

    private func refreshNames() {
        phones = peers.compactMap(\.device)
    }
}
