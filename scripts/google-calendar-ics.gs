/**
 * Google Apps Script: serve any Google calendar you can see (including ones shared with you) as a
 * private iCal feed for Sync — no OAuth client needed.
 *
 * Setup (once):
 *  1. script.google.com → New project → paste this file → set KEY below to a long random string.
 *  2. Deploy → New deployment → type "Web app" → Execute as: Me → Who has access: Anyone → Deploy
 *     (allow the calendar permission it asks for).
 *  3. Open  <web app URL>?key=KEY            → lists your calendars and their ids
 *     Feed: <web app URL>?key=KEY&cal=<id>   → paste into Sync → Add calendar by iCal link
 */
var KEY = "CHANGE-ME-to-a-long-random-string";
var DAYS_BACK = 60;
var DAYS_AHEAD = 365;

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (KEY.indexOf("CHANGE-ME") === 0 || p.key !== KEY) {
    return ContentService.createTextOutput("forbidden").setMimeType(ContentService.MimeType.TEXT);
  }
  if (!p.cal) {
    var lines = CalendarApp.getAllCalendars().map(function (c) {
      return c.getName() + "\n  cal=" + encodeURIComponent(c.getId());
    });
    return ContentService.createTextOutput("Your calendars:\n\n" + lines.join("\n\n")).setMimeType(ContentService.MimeType.TEXT);
  }
  var cal = CalendarApp.getCalendarById(p.cal);
  if (!cal) return ContentService.createTextOutput("calendar not found").setMimeType(ContentService.MimeType.TEXT);
  var now = new Date();
  var from = new Date(now.getTime() - DAYS_BACK * 86400000);
  var to = new Date(now.getTime() + DAYS_AHEAD * 86400000);
  var events = cal.getEvents(from, to).map(toPlain);
  return ContentService.createTextOutput(buildIcs(cal.getName(), cal.getColor(), events)).setMimeType(ContentService.MimeType.ICAL);
}

function toPlain(ev) {
  return {
    id: ev.getId(),
    title: ev.getTitle(),
    location: ev.getLocation(),
    description: ev.getDescription(),
    allDay: ev.isAllDayEvent(),
    start: ev.isAllDayEvent() ? ev.getAllDayStartDate() : ev.getStartTime(),
    end: ev.isAllDayEvent() ? ev.getAllDayEndDate() : ev.getEndTime(),
  };
}

/** Pure ICS builder (also exercised by Sync's tests). Recurring events arrive already expanded. */
function buildIcs(name, color, events) {
  function pad(n) {
    return (n < 10 ? "0" : "") + n;
  }
  function utc(d) {
    return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + "T" + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + "Z";
  }
  function day(d) {
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
  }
  function esc(s) {
    return String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  }
  var out = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Sync//Google Apps Script//EN", "CALSCALE:GREGORIAN", "X-WR-CALNAME:" + esc(name)];
  if (color && /^#[0-9a-f]{6}$/i.test(color)) out.push("X-APPLE-CALENDAR-COLOR:" + color);
  var stamp = utc(new Date());
  events.forEach(function (ev) {
    out.push("BEGIN:VEVENT");
    // one UID per occurrence (instances of a series share getId())
    out.push("UID:" + esc(ev.id) + "-" + (ev.allDay ? day(ev.start) : utc(ev.start)));
    out.push("DTSTAMP:" + stamp);
    if (ev.allDay) {
      out.push("DTSTART;VALUE=DATE:" + day(ev.start));
      out.push("DTEND;VALUE=DATE:" + day(ev.end));
    } else {
      out.push("DTSTART:" + utc(ev.start));
      out.push("DTEND:" + utc(ev.end));
    }
    out.push("SUMMARY:" + esc(ev.title));
    if (ev.location) out.push("LOCATION:" + esc(ev.location));
    if (ev.description) out.push("DESCRIPTION:" + esc(ev.description));
    out.push("END:VEVENT");
  });
  out.push("END:VCALENDAR");
  return out.join("\r\n");
}

// Node test hook (ignored by Apps Script)
if (typeof module !== "undefined") module.exports = { buildIcs: buildIcs };
