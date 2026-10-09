# Search funnel, batched AI and route maps

Date: 2026-10-09. Approved in conversation; implemented directly at the user's request.

## Why

A search of the whole city read about 1600 listings and felt slow. The AI read only the
30 best, one per call, with a prompt that never explained the bills fields, so a listing
saying "420€ + gastos a parte (50-100€/mes)" was scored with the default bills estimate.
A regex also gave a "young people" bonus to a flat of two women aged 37 and 41 because it
matched "trabajadoras". The destination map snapped back after every click and could not
zoom with the wheel, and the listing map showed no route.

## A. Funnel and AI (engine)

Order of work inside `rescore`, cheapest first:

1. Offline travel estimate for every placed listing, then classify. No network.
2. AI candidates: every listing that is not hard-rejected. A listing is hard-rejected when
   it fails the filter even in its best case: unknown bills counted as 0 €, unknown gender
   counted as a match, and every estimated trip 15 minutes shorter. Type, rent over
   budget, excluded zone, discarded and far away cannot be changed by the AI; a hidden
   fact can.
3. AI facts are applied to a copy of each candidate and the listings are classified again.
4. Real travel times. Transitous public transport stays one request per destination for
   every placed listing; walking, cycling and Google stay limited to the best
   `real_travel_times`.
5. Final classification.

AI extraction:

- `extractBatch` sends up to 10 listings in one prompt, each in `<listing id="k">`, and
  expects `{"listings": [{"id": k, ...facts}]}`. Each item is validated alone. Items that
  are missing or invalid are retried once in a later batch and then skipped. Facts are
  cached per listing; `PROMPT_VERSION` goes to 2 so earlier answers are read again once.
- Four batches run at a time. A 429 waits 10, 20 and 40 seconds before giving up.
- The prompt explains every field. Bills become `bills_included` plus `bills_eur_min` and
  `bills_eur_max`; a range counts as its midpoint. Other fields: owner lives in, couples,
  guests, smoking, roommates (count, age range, occupation), minimum stay, move-in date,
  exterior room, seasonal let, summary, pros, cons and red flags.
- Score reasons say when a figure came from the description, for example
  "420 € + ~75 € bills (from the description) = 495 € a month".
- If a batch fails its listings keep the cheap score. If all fail, one warning.

Fixes without AI:

- Idealista URLs carry the profile's maximum total as `max_price` when
  `idealista.max_price` is empty.
- A bills regex reads "gastos a parte (50-100€" and similar ranges as the midpoint.
- The "young people" bonus no longer matches "trabajador", and it is skipped when the
  known roommates' ages start above 35.

## B. Live results while placing

- Right after the crawl and dedupe, an offline rescore is saved so listings with portal
  coordinates appear at once.
- While neighbourhoods are geocoded, the offline rescore is saved again at most every
  5 seconds, each time with a `results` event, so listings appear on the list and map as
  they are placed.
- These previews read AI facts from the cache only and never call the AI, so summaries
  from earlier searches do not disappear.

## C. Maps

- `MapView` zooms with the wheel and by pinching. It frames its content once, on the
  first data, and never refits after a pick or a drag. Destination pins are draggable
  when the map is used to pick.
- `TransitousProvider.route(from, destination)` calls `/api/v4/plan` arriving at the
  departure time and keeps the first itinerary's legs: mode, line name and colour, stop
  names, minutes and the decoded polyline (precision from the response). Routes are cached
  in IndexedDB for 7 days and fetched only when a listing is opened.
- The listing map draws each leg: transit in the line colour (or the known Barcelona
  colours), walking dashed and grey, with dots at the stops. Below the map one line per
  destination lists the legs and the total. Walking and cycling draw the direct path.
  Without Transitous the existing directions link stays.

## Testing

Unit tests: batch parsing with good, partial and malformed answers; hard-reject rules;
the bills regex on the listing text above; the age rule; AI facts changing the group
before travel; previews during placement keeping cached AI facts; polyline decoding;
route parsing; the leg summary on the listing page. Leaflet does not run in jsdom, so the
maps are checked by hand in the dev server.
