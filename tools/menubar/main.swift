// SyncMenuBar: shows the Sync plan in progress and the time left in the macOS menu bar
// ("● Meeting · 23m"), polling GET /api/now on the Sync server with the menu bar token
// (Settings → Mac menu bar → Copy menu bar token).
//
// Config: ~/Library/Application Support/SyncMenuBar/config.json  {"url": "...", "token": "..."}
// (SYNC_MENUBAR_CONFIG overrides the path). `SyncMenuBar --print` fetches once, prints the
// title and menu, and exits (smoke test without clicking).
import AppKit
import ServiceManagement

let defaultURL = "http://localhost:3000"
let pollInterval: TimeInterval = 30
let tickInterval: TimeInterval = 15

struct Config: Codable {
  var url: String
  var token: String
}

struct NowPlan: Decodable {
  let name: String
  let color: String
  let start: Double  // ms since epoch
  let end: Double
}

struct NowResponse: Decodable {
  let now: Double
  let current: NowPlan?
  let next: NowPlan?
}

let configURL: URL = {
  if let p = ProcessInfo.processInfo.environment["SYNC_MENUBAR_CONFIG"] { return URL(fileURLWithPath: p) }
  let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
  return support.appendingPathComponent("SyncMenuBar/config.json")
}()

func loadConfig() -> Config? {
  guard let data = try? Data(contentsOf: configURL), let c = try? JSONDecoder().decode(Config.self, from: data),
    !c.token.isEmpty, URL(string: c.url) != nil
  else { return nil }
  return c
}

func saveConfig(_ c: Config) throws {
  try FileManager.default.createDirectory(
    at: configURL.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
  let enc = JSONEncoder()
  enc.outputFormatting = [.prettyPrinted, .withoutEscapingSlashes]
  // the token reads the user's plans: keep the file private
  guard FileManager.default.createFile(atPath: configURL.path, contents: try enc.encode(c), attributes: [.posixPermissions: 0o600])
  else { throw NSError(domain: "SyncMenuBar", code: 1, userInfo: [NSLocalizedDescriptionKey: "Couldn't write \(configURL.path)"]) }
}

/** "23m" under an hour, "1h 20m" above; rounded up so the last minute shows "1m", not "0m". */
func formatLeft(_ seconds: TimeInterval) -> String {
  let mins = max(1, Int((seconds / 60).rounded(.up)))
  if mins < 60 { return "\(mins)m" }
  return mins % 60 == 0 ? "\(mins / 60)h" : "\(mins / 60)h \(mins % 60)m"
}

let clock: DateFormatter = {
  let f = DateFormatter()
  f.dateFormat = "HH:mm"
  return f
}()
func hhmm(_ ms: Double) -> String { clock.string(from: Date(timeIntervalSince1970: ms / 1000)) }

func color(hex: String) -> NSColor? {
  var s = hex.trimmingCharacters(in: .whitespaces)
  if s.hasPrefix("#") { s.removeFirst() }
  guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
  return NSColor(
    srgbRed: CGFloat((v >> 16) & 0xff) / 255, green: CGFloat((v >> 8) & 0xff) / 255, blue: CGFloat(v & 0xff) / 255, alpha: 1)
}

func truncated(_ s: String, _ n: Int) -> String { s.count <= n ? s : String(s.prefix(n - 1)) + "…" }

enum State {
  case needsSetup
  case loading
  case ok(NowResponse, offset: TimeInterval)  // offset = server clock − local clock (seconds)
  case error(String)
}

func fetchNow(_ c: Config, completion: @escaping (Result<NowResponse, Error>) -> Void) {
  let fail = { (msg: String) in
    completion(.failure(NSError(domain: "SyncMenuBar", code: 0, userInfo: [NSLocalizedDescriptionKey: msg])))
  }
  guard let url = URL(string: c.url.trimmingCharacters(in: CharacterSet(charactersIn: "/ ")) + "/api/now") else {
    return fail("Invalid URL")
  }
  var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
  req.setValue("Bearer \(c.token)", forHTTPHeaderField: "Authorization")
  URLSession.shared.dataTask(with: req) { data, resp, err in
    if let err = err { return fail(err.localizedDescription) }
    let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
    let data = data ?? Data()
    guard status == 200 else {
      // the server explains itself in JSON ({error}) or plain text (Tailscale gate)
      let detail =
        ((try? JSONSerialization.jsonObject(with: data)) as? [String: Any])?["error"] as? String
        ?? String(data: data.prefix(200), encoding: .utf8) ?? ""
      return fail(status == 401 ? "Token rejected — copy it again from Sync Settings" : "HTTP \(status) \(detail)")
    }
    do { completion(.success(try JSONDecoder().decode(NowResponse.self, from: data))) } catch {
      fail("Unexpected response from \(url.host ?? "server")")
    }
  }.resume()
}

final class App: NSObject, NSApplicationDelegate, NSMenuDelegate {
  let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
  var config = loadConfig()
  var state: State = .loading
  var lastPoll = Date.distantPast
  var timers: [Timer] = []

  func applicationDidFinishLaunching(_ note: Notification) {
    state = config == nil ? .needsSetup : .loading
    render()
    poll()
    timers = [
      Timer.scheduledTimer(withTimeInterval: pollInterval, repeats: true) { [weak self] _ in self?.poll() },
      Timer.scheduledTimer(withTimeInterval: tickInterval, repeats: true) { [weak self] _ in self?.tick() },
    ]
    // timers don't fire while asleep; refresh as soon as the Mac is back
    NSWorkspace.shared.notificationCenter.addObserver(
      forName: NSWorkspace.didWakeNotification, object: nil, queue: .main
    ) { [weak self] _ in self?.poll() }
  }

  func poll() {
    guard let c = config else { return }
    lastPoll = Date()
    fetchNow(c) { result in
      DispatchQueue.main.async {
        switch result {
        case .success(let r): self.state = .ok(r, offset: r.now / 1000 - Date().timeIntervalSince1970)
        case .failure(let e): self.state = .error(e.localizedDescription)
        }
        self.render()
      }
    }
  }

  /** Local countdown between polls; refetch early when the current plan ends or the next one starts. */
  func tick() {
    if case .ok(let r, let offset) = state {
      let now = (Date().timeIntervalSince1970 + offset) * 1000
      if let cur = r.current, now >= cur.end, Date().timeIntervalSince(lastPoll) > 5 { return poll() }
      if let nxt = r.next, now >= nxt.start, Date().timeIntervalSince(lastPoll) > 5 { return poll() }
    }
    render()
  }

  func render() {
    guard let button = item.button else { return }
    button.image = nil
    button.imagePosition = .imageLeading
    let font = NSFont.menuBarFont(ofSize: 0)
    switch state {
    case .ok(let r, let offset):
      let now = (Date().timeIntervalSince1970 + offset) * 1000
      if let cur = r.current, now < cur.end {
        let title = NSMutableAttributedString(
          string: "● ", attributes: [.foregroundColor: color(hex: cur.color) ?? NSColor.labelColor, .font: font])
        title.append(
          NSAttributedString(
            string: "\(truncated(cur.name, 24)) · \(formatLeft((cur.end - now) / 1000))", attributes: [.font: font]))
        button.attributedTitle = title
      } else {
        idle(button)
      }
    case .error:
      button.attributedTitle = NSAttributedString(string: "Sync ⚠︎", attributes: [.font: font])
    case .needsSetup, .loading:
      idle(button)
    }
    item.menu = buildMenu()
  }

  func idle(_ button: NSStatusBarButton) {
    button.attributedTitle = NSAttributedString(string: "")
    let img = NSImage(systemSymbolName: "calendar.day.timeline.left", accessibilityDescription: "Sync")
    img?.isTemplate = true
    button.image = img
  }

  func info(_ text: String) -> NSMenuItem {
    let m = NSMenuItem(title: text, action: nil, keyEquivalent: "")
    m.isEnabled = false
    return m
  }

  func buildMenu() -> NSMenu {
    let menu = NSMenu()
    switch state {
    case .needsSetup:
      menu.addItem(info("Not set up yet"))
    case .loading:
      menu.addItem(info("Loading…"))
    case .error(let msg):
      menu.addItem(info("Couldn't reach Sync"))
      menu.addItem(info(truncated(msg, 80)))
    case .ok(let r, let offset):
      let now = (Date().timeIntervalSince1970 + offset) * 1000
      if let cur = r.current, now < cur.end {
        menu.addItem(info("Now: \(cur.name)"))
        menu.addItem(info("\(hhmm(cur.start))–\(hhmm(cur.end)) · \(formatLeft((cur.end - now) / 1000)) left"))
      } else {
        menu.addItem(info("No plan right now"))
      }
      if let nxt = r.next, nxt.start > now {
        menu.addItem(info("Next \(hhmm(nxt.start)) \(nxt.name)"))
      } else {
        menu.addItem(info("Nothing else planned today"))
      }
    }
    menu.addItem(.separator())
    menu.addItem(withTitle: "Open Sync", action: #selector(openSync), keyEquivalent: "o").target = self
    menu.addItem(withTitle: config == nil ? "Set up…" : "Settings…", action: #selector(setup), keyEquivalent: ",").target = self
    if config != nil {
      menu.addItem(withTitle: "Refresh", action: #selector(refresh), keyEquivalent: "r").target = self
    }
    let login = menu.addItem(withTitle: "Launch at Login", action: #selector(toggleLogin), keyEquivalent: "")
    login.target = self
    login.state = SMAppService.mainApp.status == .enabled ? .on : .off
    menu.addItem(.separator())
    menu.addItem(withTitle: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    return menu
  }

  @objc func refresh() { poll() }

  @objc func openSync() {
    if let u = URL(string: config?.url ?? defaultURL) { NSWorkspace.shared.open(u) }
  }

  @objc func setup() {
    let alert = NSAlert()
    alert.messageText = "Sync menu bar"
    alert.informativeText = "Paste the token from Sync → Settings → Mac menu bar → Copy menu bar token."
    let url = NSTextField(string: config?.url ?? defaultURL)
    url.placeholderString = "Sync URL"
    let token = NSSecureTextField(string: config?.token ?? "")
    token.placeholderString = "Menu bar token"
    let stack = NSStackView(views: [url, token])
    stack.orientation = .vertical
    stack.spacing = 8
    stack.frame = NSRect(x: 0, y: 0, width: 320, height: 52)
    for f in [url, token] { f.widthAnchor.constraint(equalToConstant: 320).isActive = true }
    alert.accessoryView = stack
    alert.addButton(withTitle: "Save")
    alert.addButton(withTitle: "Cancel")
    alert.window.initialFirstResponder = config == nil ? token : url
    NSApp.activate(ignoringOtherApps: true)  // menu bar apps aren't frontmost; the alert would open behind
    guard alert.runModal() == .alertFirstButtonReturn else { return }
    let c = Config(
      url: url.stringValue.trimmingCharacters(in: .whitespacesAndNewlines),
      token: token.stringValue.trimmingCharacters(in: .whitespacesAndNewlines))
    guard !c.token.isEmpty, let u = URL(string: c.url), u.scheme == "https" || u.scheme == "http" else {
      return show("Enter the Sync URL (https://…) and the token.")
    }
    do { try saveConfig(c) } catch { return show(error.localizedDescription) }
    config = c
    state = .loading
    render()
    poll()
  }

  @objc func toggleLogin() {
    let svc = SMAppService.mainApp
    do {
      if svc.status == .enabled { try svc.unregister() } else { try svc.register() }
    } catch {
      show("Couldn't change Launch at Login: \(error.localizedDescription)\nMove SyncMenuBar.app to /Applications and try again.")
    }
    render()
  }

  func show(_ text: String) {
    let a = NSAlert()
    a.messageText = text
    NSApp.activate(ignoringOtherApps: true)
    a.runModal()
  }

  func menuTitles() -> [String] { buildMenu().items.map { $0.isSeparatorItem ? "---" : $0.title } }
}

if CommandLine.arguments.contains("--print") {
  guard let c = loadConfig() else {
    print("no config at \(configURL.path)")
    exit(1)
  }
  let app = App()
  fetchNow(c) { result in
    DispatchQueue.main.async {
      switch result {
      case .success(let r): app.state = .ok(r, offset: r.now / 1000 - Date().timeIntervalSince1970)
      case .failure(let e): app.state = .error(e.localizedDescription)
      }
      app.render()
      print("title: \(app.item.button?.attributedTitle.string ?? "")\(app.item.button?.image != nil ? "[idle icon]" : "")")
      for t in app.menuTitles() { print("menu: \(t)") }
      exit(0)
    }
  }
  _ = NSApplication.shared
  RunLoop.main.run()
}

let delegate = App()
NSApplication.shared.delegate = delegate
NSApplication.shared.run()
