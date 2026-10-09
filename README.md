# buscapiso

buscapiso looks for rooms and whole flats to rent in Barcelona, works out how long it takes to get from each one to the places you go often, and ranks the results so the best ones come first. Rooms come from Idealista, Fotocasa, Roomgo and De Piso en Piso, and whole flats from Idealista, Fotocasa and Habitaclia. You mark the listings you like, write notes, track who you have contacted, and get a phone notification when a good new one appears.

It is a website: open **https://buscapiso.github.io/buscapiso/**. There is nothing to install apart from a small browser extension on the computer you search from. Your listings, notes and keys stay in your browser; buscapiso has no server.

## The browser extension

A website can't read other websites, so buscapiso uses a small extension to read the rental portals from your own browser, the same way you would browse them. It only reads Idealista, Fotocasa, Habitaclia, Roomgo and De Piso en Piso, and only when you press Search. It isn't in the browser stores; you install it from this repository.

**Chrome, Edge, Brave, Vivaldi or Opera**

1. Download [buscapiso-chrome.zip](https://github.com/buscapiso/buscapiso/releases/latest/download/buscapiso-chrome.zip) and unzip it into a folder you will keep (the browser loads it from there).
2. Open `chrome://extensions` (in Edge, `edge://extensions`) and turn on **Developer mode**.
3. Press **Load unpacked** and choose the unzipped folder.
4. Go back to the buscapiso tab and press "I've installed it".

The browser may sometimes warn about extensions in developer mode; you can dismiss it.

**Firefox, on a computer or on Android**

Open [buscapiso-firefox.xpi](https://github.com/buscapiso/buscapiso/releases/latest/download/buscapiso-firefox.xpi) in Firefox and accept: it is signed by Mozilla. Firefox only installs extensions signed by Mozilla, so the plain zip works only as a temporary add-on (`about:debugging` → This Firefox → Load Temporary Add-on) until you restart.

**iPad, iPhone and Chrome on Android** can't run it. Everything else works there: ask someone to send you an export, or make one yourself on a computer, and import it (see below).

## First steps

1. In **Settings → Places & travel**, add the places you go often (work, university...). The travel time limit you set for each one decides which areas are searched.
2. In **Settings → What you're looking for**, set your budget and who you want to live with, or choose "A whole flat to rent".
3. In **Rooms**, press **Search now**. buscapiso reads the portals for a few minutes. Idealista sometimes asks you to confirm you're human: a tab opens, you solve it there, and the search carries on.

## Using it

**Rooms** is where you spend your time. Your criteria appear as buttons ("Up to 650 €", "Women only"...). Press one to change it, then "Re-score now" to see the effect in seconds without searching again. The chips New, Liked, In progress, Ask first and Hidden filter the list, and List, Map and Board change how you see it. "Ask first" holds rooms that fit everything except that the listing doesn't say who lives there.

Each listing has its own page with photos, the cost with bills, travel times, why it scored what it did, a map, a status, your notes and their history.

## Sharing a search, and iPad or iPhone

In **Settings → Your data**:

- **Export to share** saves the listings to a file you can send by AirDrop, WhatsApp or email. Whoever imports it gets the listings scored with *their* criteria and *their* places; their notes are never touched.
- **Back up everything** also saves your statuses, notes, profiles and settings, to move to another browser. API keys are never exported.
- **Import** shows what the file holds before anything is merged.

On iPad and iPhone, add buscapiso to the Home Screen (Share → Add to Home Screen) so Safari keeps your data.

## Travel times

Travel times come from [Transitous](https://transitous.org), a free community service with real timetables, buses included, and need no setup. In Settings → Places & travel you can instead use your own [MOTIS](https://github.com/motis-project/motis) server, or Google Maps with your own Routes API key (Google charges per route, with a monthly free allowance). If the service doesn't answer, buscapiso estimates from the straight-line distance and says so.

## AI (optional)

With your own key, the AI reads the descriptions of the best listings of each search and adds who lives there, bills, house rules, short lets and things to check before paying. It also drafts your first message to the advertiser in the listing's language. Pick a provider in Settings → AI: Gemini (free tier at [aistudio.google.com](https://aistudio.google.com)), Claude ([console.anthropic.com](https://console.anthropic.com)), OpenAI, OpenRouter, or Ollama on your own computer (start it with `OLLAMA_ORIGINS` set to the site's address). Keys are stored in this browser only and sent only to that provider.

## Automatic searches and notifications

While a buscapiso tab is open, it can search on its own every few hours, within the hours you choose. To get the best new listings on your phone, turn on notifications in Settings → Alerts, install the free [ntfy](https://ntfy.sh) app and subscribe to the topic shown there. The topic name is random because anyone who knows it can read it.

## Limitations

- Only Barcelona and its metropolitan area for now.
- Searching needs a computer (or Firefox on Android) with the extension.
- The portals change their pages from time to time, which can break a source until buscapiso is updated. Fixes reach everyone as soon as the website is updated.
- buscapiso reads public listings for your personal use, at the pace of a person browsing. Please don't use it to copy listings in bulk.

## Building it yourself

You need Node 22.

```bash
npm --prefix web ci
npm --prefix web run dev          # http://localhost:5173/buscapiso/
node extension/build.mjs --dev    # extension/dist/chrome-dev and firefox-dev also allow localhost
```

Run the tests with `npm --prefix web test` and the end-to-end tests with `npm --prefix web run e2e`. Pushing to `main` publishes the site on GitHub Pages; pushing an `ext-v*` tag packages the extension. Technical notes, in Spanish, are in `docs/README.es.md`.

The desktop app (v0.3.0 and earlier) is retired. Its code is in the git history.
