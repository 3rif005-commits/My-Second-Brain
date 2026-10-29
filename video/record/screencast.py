"""Record the screen (GNOME Shell screencast) until SIGINT/SIGTERM.

    python3 video/record/screencast.py <out, no extension> [x y w h]  → <out>.mp4

GNOME stops a screencast when the caller disconnects, so this process
holds the D-Bus connection for the whole recording.
"""
import signal
import sys

from gi.repository import Gio, GLib

out = sys.argv[1]
bus = Gio.bus_get_sync(Gio.BusType.SESSION)
proxy = Gio.DBusProxy.new_sync(bus, 0, None, "org.gnome.Shell.Screencast",
                               "/org/gnome/Shell/Screencast", "org.gnome.Shell.Screencast")
opts = {"framerate": GLib.Variant("i", 30), "draw-cursor": GLib.Variant("b", False)}
if len(sys.argv) == 6:
    x, y, w, h = map(int, sys.argv[2:])
    ok, path = proxy.call_sync("ScreencastArea", GLib.Variant("(iiiisa{sv})", (x, y, w, h, out, opts)),
                               0, -1, None).unpack()
else:
    ok, path = proxy.call_sync("Screencast", GLib.Variant("(sa{sv})", (out, opts)), 0, -1, None).unpack()
print("recording" if ok else "failed", path, flush=True)
loop = GLib.MainLoop()


def stop(*_):
    proxy.call_sync("StopScreencast", None, 0, -1, None)
    loop.quit()


GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGINT, stop)
GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGTERM, stop)
loop.run()
print("saved", path, flush=True)
