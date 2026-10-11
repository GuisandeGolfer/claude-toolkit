// wkwebview-probe.swift: open a URL in WKWebView (Safari's engine, the same one Tauri uses on macOS)
// and print a JS expression's value every N seconds. Answers "does this web app work in WebKit?"
// before you build a Tauri/WKWebView wrapper.
//
//   swift wkwebview-probe.swift <url> [seconds=60] [js-expression]
//   swift wkwebview-probe.swift https://vel.gg/bo1z/kino 40 \
//     'JSON.stringify({coi: crossOriginIsolated, gpu: !!navigator.gpu, text: document.body.innerText.slice(0,120)})'
//
// The default expression reports cross-origin isolation, WebGPU, SharedArrayBuffer, JSPI and page text.
// Compile for repeated runs: swiftc -O wkwebview-probe.swift -o /tmp/wkprobe
import AppKit
import WebKit

let argv = CommandLine.arguments
guard argv.count > 1, let url = URL(string: argv[1]) else {
  print("usage: swift wkwebview-probe.swift <url> [seconds] [js]"); exit(2)
}
let seconds = Double(argv.count > 2 ? argv[2] : "") ?? 60
let expression = argv.count > 3 ? argv[3] : """
  JSON.stringify({ coi: self.crossOriginIsolated, sab: typeof SharedArrayBuffer, gpu: !!navigator.gpu,
    jspi: typeof WebAssembly.Suspending, text: document.body ? document.body.innerText.slice(0, 160) : null })
  """

final class Probe: NSObject, NSApplicationDelegate {
  let url: URL, seconds: Double, expression: String
  init(url: URL, seconds: Double, expression: String) { self.url = url; self.seconds = seconds; self.expression = expression }
  var window: NSWindow!
  var web: WKWebView!
  let start = Date()

  func applicationDidFinishLaunching(_ note: Notification) {
    let config = WKWebViewConfiguration()
    config.preferences.setValue(true, forKey: "developerExtrasEnabled")  // right-click > Inspect Element
    web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1280, height: 800), configuration: config)
    window = NSWindow(contentRect: web.frame, styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
    window.contentView = web
    window.title = "wkwebview-probe"
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
    web.load(URLRequest(url: url))
    Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in self?.sample() }
    DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { self.sample(); NSApp.terminate(nil) }
  }

  func sample() {
    web.evaluateJavaScript(expression) { result, error in
      print("t=\(Int(Date().timeIntervalSince(self.start)))s", result.map { "\($0)" } ?? "error: \(String(describing: error))")
      fflush(stdout)
    }
  }
}

let app = NSApplication.shared
let probe = Probe(url: url, seconds: seconds, expression: expression)
app.delegate = probe
app.setActivationPolicy(.regular)
app.run()
