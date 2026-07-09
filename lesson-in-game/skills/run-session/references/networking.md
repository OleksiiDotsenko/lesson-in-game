# Getting students connected (transport & first-run)

Two things are separate. The **game protocol** is always WebSocket (Socket.IO) —
never changes. What varies is the **network path** carrying it between the
teacher's laptop and student devices. Any device with a modern browser works —
phones, tablets, Chromebooks, laptops — no app install.

## Connection options, best to worst for a full class

| Option | How it works | Devices | Verdict |
|---|---|---|---|
| **Travel/portable router** *(recommended)* | Cheap router makes a private classroom Wi-Fi; laptop joins it (ideally by Ethernet cable); students join its Wi-Fi | 30+ | **Default for whole class.** Reliable, independent of school IT, no client isolation |
| **Laptop hotspot (SoftAP)** | The laptop broadcasts its own Wi-Fi; students join it | ~8–10 | Good for small classes; no hardware. Watch the OS device cap + battery |
| **Existing school Wi-Fi** | Everyone on the school SSID; students reach the laptop's IP | depends | Works only if IT allows client-to-client traffic. Often blocked by AP/client isolation or captive portals |
| **Wired Ethernet** | Cables | 1–2 | Not for tablets. Its real role is the stable laptop↔router link |
| **Internet / cloud host** | Public server, students join a URL | unlimited | Fallback for remote/hybrid only. Breaks local-first/privacy; needs internet + hosting |
| **Bluetooth** | Device-to-device radio | ~7 | **Not viable** for a class — pairing overhead, low cap, no server model |

Quick decision: whole class, want it to just work → **travel router** (laptop
wired to it). Small class, nothing to buy → **laptop hotspot**. Cooperative IT →
**school Wi-Fi**. Remote lesson → **internet host** (accepting the privacy
trade-off). Never rely on Bluetooth; never expect to cable student gadgets.

## First-run runbook (one-time, ~3 minutes) — as a teacher checklist

1. **Network** — power on the travel router (or start the laptop hotspot); the
   laptop joins it.
2. **Firewall** — the first time the runner starts, the OS may ask whether to
   allow incoming connections. Approve it once (it's the game server accepting
   student browsers). On macOS: System Settings → Network → Firewall, allow
   `node`. This is asked once per machine.
3. **Launch** — start the runner; it prints the join URL and a QR code.
4. **Verify** — open the URL on one phone to confirm students can reach it. Done
   once per room/device; never again.

## When students can't connect

Diagnose in this order (cheap → expensive):

- **Same network?** The single most common cause. The phone must be on the
  *classroom* Wi-Fi (router/hotspot), not school Wi-Fi or cellular. Check the
  phone's Wi-Fi name.
- **Right address?** The runner prints the laptop's LAN IP. If the laptop has
  several network interfaces, it also prints "Other addresses" — try one that
  matches the classroom subnet (usually `192.168.x.x`).
- **Firewall.** If one phone on the same Wi-Fi still can't load the page, the
  laptop firewall is likely blocking `node`. Allow it (step 2).
- **Client isolation.** On school Wi-Fi, devices often can't talk to each other
  by policy. Symptom: nobody can connect even on the same SSID. Fix: switch to a
  travel router or laptop hotspot — don't fight the school AP.
- **Captive portal.** If the phone opens a school login page instead of the game,
  the network intercepts traffic. Use the router/hotspot path instead.

A dropped student just rescans or reloads — their token rejoins them where they
left off, score intact. Packet loss is self-correcting (the server re-syncs every
second), so brief Wi-Fi hiccups don't break the game.
