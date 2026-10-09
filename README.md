# buscapiso

> This is the last version of the desktop app (v0.3.0). buscapiso is moving to a website with a browser extension; the desktop app won't get more updates.

buscapiso looks for rooms and whole flats to rent in Barcelona, works out how long it takes to get from each one to the places you go often, and ranks the results so the best ones come first. Rooms come from Idealista, Fotocasa, Roomgo and De Piso en Piso, and whole flats from Fotocasa and Habitaclia. You mark the listings you like, write notes, track who you have contacted, and get a phone notification when a good new one appears.

Everything runs on your own computer. Your searches, notes and keys stay there.

## Install

Download the file for your system from the [latest release](https://github.com/feal-ca/buscapiso/releases/latest), unzip it and open `buscapiso`:

- **Windows:** unzip `buscapiso-windows.zip` and double-click `buscapiso.exe` inside the folder. If Windows SmartScreen warns about an unknown app, click "More info" and then "Run anyway".
- **macOS:** unzip `buscapiso-macos.zip` and move `buscapiso.app` to Applications. The first time, right-click it and choose "Open", because the app is not signed with an Apple developer account.
- **Linux:** extract `buscapiso-linux.tar.gz` and run `./buscapiso/buscapiso`.

buscapiso opens in your web browser at `http://127.0.0.1:8770`. Opening it again while it is already running just opens another tab. To stop it, go to Settings and press "Quit buscapiso".

## First steps

1. The first time, buscapiso asks to install its own copy of Chromium (about 400 MB). It needs it to read the portals.
2. In **Settings → Places & travel**, add the places you go often (work, university...). Search by address or click on the map. The travel time limit you set for each place decides which areas are searched.
3. In **Settings → What you're looking for**, set your budget and who you want to live with. You can also describe what you want in your own words and let the AI fill it in, if you set one up.
4. In **Rooms**, press **Search now**. A browser window opens and reads the portals for 10 to 15 minutes. Leave it visible: the portals block hidden browsers. If a captcha appears, solve it in that window.

## Using it

**Rooms** is where you spend your time. Your criteria appear as buttons ("Up to 650 €", "Women only"...). Press one to change it, then "Re-score now" to see the effect in seconds without searching again. The chips New, Liked, In progress, Ask first and Hidden filter the rooms, and List, Map and Board change how you see them. "Ask first" holds rooms that fit everything except that the listing doesn't say who lives there.

Each room has its own page with photos, the cost with bills, travel times with the metro lines, why it scored what it did, a map, a status, your notes and their history.

**Settings** has the rest: what you're looking for, places and travel times, neighbourhoods to prefer or avoid, automatic searches, phone access and notifications, and AI.

## Whole flats

To look for a whole flat instead of a room, press the first button in Rooms ("Rooms") and choose "A whole flat to rent". You can also change it in Settings → What you're looking for. A flat has its own rent limit, bedrooms, size, lift and furnished settings, so switching back and forth leaves your room settings as they were. The list shows only the kind you are looking for, and a line above it says how many of the other kind are hidden.

Flats are read with plain requests, so a flat search doesn't open the Chromium window. The settings about who you would live with don't apply to a whole flat and are ignored. When a listing doesn't say whether it has a lift or furniture, it stays in the list and its reasons say "ask". Idealista flats aren't searched yet, because Idealista answers flat searches with a captcha unless they come from a real browser.

## On your phone

In Settings → Phone & alerts, press "Allow access from my phone", then quit buscapiso and open it again. A QR code appears there: scan it with your phone while both are on the same Wi-Fi. Add it to your home screen to use it like an app. The link carries a private key; without it, other devices on your network see nothing. "Revoke phone access" changes the key.

Away from home, install [Tailscale](https://tailscale.com) on the computer and the phone and run `tailscale serve 8770` on the computer.

## Automatic searches and notifications

buscapiso can search on its own every few hours while it is open, within the hours you choose. To get the best new rooms on your phone, turn on notifications in Settings → Phone & alerts, install the free [ntfy](https://ntfy.sh) app, and subscribe to the topic shown there. The topic name is random because anyone who knows it can read it.

## Travel times

By default, travel times come from a built-in map of the metro, FGC and Rodalies lines. It is free and works offline, and is accurate to a few minutes. For real timetables with buses, choose one of these in Settings → Places & travel:

- **Transitous**, a free community service. It asks for an email or website so its operators can reach you, and is meant for open-source, non-commercial use.
- **Your own MOTIS server**, the open-source engine behind Transitous. `docs/README.es.md` explains how to set one up with the Barcelona timetables.
- **Google Maps**, with your own Routes API key. Google charges per route, with a monthly free allowance.

## AI (optional)

With your own key, the AI reads the descriptions of the best rooms of each search and adds who lives there, bills, house rules, short lets and things to check before paying. It also drafts your first message to the advertiser in the listing's language. Pick a provider in Settings → AI:

- **Gemini:** create a key at [aistudio.google.com](https://aistudio.google.com) (it has a free tier).
- **Claude:** create a key at [console.anthropic.com](https://console.anthropic.com). Haiku 5.5 costs well under a cent per search.
- **OpenAI** or **OpenRouter:** create a key on their website.
- **Ollama:** free and private, on your computer. No key needed.

Keys are stored in your system's keyring, never in buscapiso's database.

## Where your data lives

- **Windows:** `%APPDATA%\buscapiso`
- **macOS:** `~/Library/Application Support/buscapiso`
- **Linux:** `~/.local/share/buscapiso`

The folder holds the database with your rooms, statuses and notes, the downloaded pages, and the browser. Set `BUSCAPISO_HOME` to use another folder.

## Limitations

- Only Barcelona and its metropolitan area. Whole flats come from Fotocasa and Habitaclia, not Idealista yet.
- The portals change their pages from time to time, which can break a source until buscapiso is updated.
- buscapiso reads public listings for your personal use, at the pace of a person browsing. Please don't use it to copy listings in bulk.

## Building it yourself

You need Python 3.12 or newer and Node 22.

```bash
python -m venv .venv
.venv/bin/pip install -e '.[dev]'
npm --prefix web ci && npm --prefix web run build
.venv/bin/buscapiso serve
```

Run the tests with `.venv/bin/python -m pytest tests -q` and `npm --prefix web test`. `packaging/build.sh` builds the app for your system in `dist/buscapiso/`, and pushing a `v*` tag builds Windows, macOS and Linux on GitHub. Technical notes, in Spanish, are in `docs/README.es.md`.
