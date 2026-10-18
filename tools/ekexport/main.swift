// OteCalendar: reads this Mac's calendars (everything Apple Calendar shows — iCloud, Google,
// Exchange, subscriptions) via EventKit and writes JSON for the Ote server. It also creates,
// updates and deletes the events that Ote itself put on a calendar (plans saved "to a calendar").
//
// usage: OteCalendar calendars <outfile>
//        OteCalendar events <startMs> <endMs> <outfile>
//        OteCalendar create '{"calendarId","title","start","end","allDay","location"}' <outfile>
//        OteCalendar update '{"eventId","calendarId"?,"title","start","end","allDay","location"}' <outfile>
//        OteCalendar delete '{"eventId"}' <outfile>
import EventKit
import Foundation

func write(_ obj: Any, to path: String) {
  let data = (try? JSONSerialization.data(withJSONObject: obj, options: [])) ?? Data("{}".utf8)
  FileManager.default.createFile(atPath: path, contents: data, attributes: [.posixPermissions: 0o600])
}

let args = CommandLine.arguments
guard args.count >= 3 else {
  FileHandle.standardError.write(Data("usage: OteCalendar calendars <out> | events <startMs> <endMs> <out>\n".utf8))
  exit(2)
}
let out = args[args.count - 1]
let store = EKEventStore()
let sem = DispatchSemaphore(value: 0)
var granted = false
var accessError: String?
store.requestFullAccessToEvents { ok, err in
  granted = ok
  accessError = err?.localizedDescription
  sem.signal()
}
sem.wait()
guard granted else {
  write(["error": "calendar access denied", "detail": accessError ?? "", "status": EKEventStore.authorizationStatus(for: .event).rawValue], to: out)
  exit(3)
}

func hex(_ c: CGColor?) -> String {
  guard let c = c, let comps = c.converted(to: CGColorSpace(name: CGColorSpace.sRGB)!, intent: .defaultIntent, options: nil)?.components, comps.count >= 3 else { return "#8e8e93" }
  return String(format: "#%02x%02x%02x", Int(comps[0] * 255), Int(comps[1] * 255), Int(comps[2] * 255))
}

let calendars = store.calendars(for: .event)
switch args[1] {
case "calendars":
  write(["calendars": calendars.map { c in
    ["id": c.calendarIdentifier, "title": c.title, "source": c.source?.title ?? "", "sourceType": c.source?.sourceType.rawValue ?? -1, "color": hex(c.cgColor), "writable": c.allowsContentModifications] as [String: Any]
  }], to: out)
case "events":
  guard args.count >= 5, let s = Double(args[2]), let e = Double(args[3]) else { exit(2) }
  let pred = store.predicateForEvents(withStart: Date(timeIntervalSince1970: s / 1000), end: Date(timeIntervalSince1970: e / 1000), calendars: nil)
  let events = store.events(matching: pred).map { ev -> [String: Any] in
    var o: [String: Any] = [
      "calendarId": ev.calendar.calendarIdentifier,
      "id": (ev.calendarItemExternalIdentifier ?? ev.eventIdentifier ?? UUID().uuidString) + ":" + String(Int(ev.startDate.timeIntervalSince1970 * 1000)),
      "title": ev.title ?? "",
      "start": Int(ev.startDate.timeIntervalSince1970 * 1000),
      "end": Int(ev.endDate.timeIntervalSince1970 * 1000),
      "allDay": ev.isAllDay,
      "color": hex(ev.calendar.cgColor),
      "ekId": ev.eventIdentifier ?? "",
    ]
    if let l = ev.location, !l.isEmpty { o["location"] = l }
    return o
  }
  write(["events": events], to: out)
case "create", "update", "delete":
  guard let raw = args[2].data(using: .utf8), let o = (try? JSONSerialization.jsonObject(with: raw)) as? [String: Any] else {
    write(["error": "bad request"], to: out)
    exit(2)
  }
  do {
    let ev: EKEvent
    if args[1] == "create" {
      guard let calId = o["calendarId"] as? String, let cal = store.calendar(withIdentifier: calId) else {
        write(["error": "calendar not found"], to: out)
        exit(4)
      }
      ev = EKEvent(eventStore: store)
      ev.calendar = cal
    } else {
      guard let id = o["eventId"] as? String, let found = store.event(withIdentifier: id) else {
        // already gone (deleted in Calendar): nothing to update / delete
        write(["gone": true], to: out)
        exit(0)
      }
      ev = found
      if args[1] == "delete" {
        try store.remove(ev, span: .thisEvent, commit: true)
        write(["deleted": true], to: out)
        exit(0)
      }
      if let calId = o["calendarId"] as? String, calId != ev.calendar.calendarIdentifier, let cal = store.calendar(withIdentifier: calId) {
        ev.calendar = cal
      }
    }
    ev.title = o["title"] as? String ?? ""
    if let s = o["start"] as? Double { ev.startDate = Date(timeIntervalSince1970: s / 1000) }
    if let e = o["end"] as? Double { ev.endDate = Date(timeIntervalSince1970: e / 1000) }
    ev.isAllDay = o["allDay"] as? Bool ?? false
    let loc = o["location"] as? String ?? ""
    ev.location = loc.isEmpty ? nil : loc
    try store.save(ev, span: .thisEvent, commit: true)
    write(["eventId": ev.eventIdentifier ?? "", "calendarId": ev.calendar.calendarIdentifier], to: out)
  } catch {
    write(["error": error.localizedDescription], to: out)
    exit(5)
  }
default:
  exit(2)
}
