# VESTIPHOBIA — analytics

What is measured, what is deliberately not, and where to read the answers.

There is **no third-party analytics**. No Google Analytics, no Meta pixel, no
ad network, no session-recording tool. Events go to this site's own
`/api/events` and to nowhere else, and nothing about a visitor is shared with
another company.

Set `analytics.firstParty: false` in `site.config.js` to ship the site with no
measurement at all. Everything below then simply does not run.

---

## The privacy contract

Enforced in three places, so forgetting one does not open a hole:

1. **The browser never reads the checkout form.** `assets/js/analytics.js`
   tracks navigation and interaction. It does not touch the name, phone,
   address or email fields — not even to count characters.
2. **The server whitelists every field.** `server/lib/analytics.js` holds the
   complete list of events and, per event, the props each may carry. A key that
   is not on the list is dropped at the boundary. Adding a field on the client
   cannot start collecting it; the server has to allow it first.
3. **Every value is scanned.** Anything phone-shaped (seven or more digits) or
   email-shaped is rejected even from an allowed field, so a whitelisted
   "title" cannot smuggle a phone number through.

Also true, and tested:

- **No IP address is stored in analytics.** Not raw, not hashed. (The audit log
  hashes IPs for admin actions; that is a different table, behind the login.)
- **No geolocation is performed.** The country column is filled only if the
  host in front of the app supplies a country header. Otherwise it stays null
  and the Locations screen says so.
- **No cookie is set for visitors.** The only cookie this site can issue is the
  admin session cookie.
- **No fingerprinting.** Identity is two random values the browser generates
  for itself. Nothing is derived from the device.
- **Do Not Track and Global Privacy Control are honoured**, and the privacy
  policy carries a working opt-out button that also discards anything queued.

`qa/server.test.mjs` and `qa/qa.mjs` both scan the analytics tables for the
names, phone numbers, addresses and cities used in their own test orders, and
fail if any of it appears.

---

## What is collected

| Field | Example | Why |
|---|---|---|
| event name | `add_to_cart` | the funnel |
| path | `/products/vestiphobia-001-fear-tee/` | which page |
| props (whitelisted) | `{slug, size, quantity}` | which product and size |
| visitor id | random UUID in `localStorage` | new vs returning |
| session id | random UUID in `sessionStorage` | groups a visit |
| source / medium | `instagram` / `social` | where visitors come from |
| UTM tags | `utm_campaign=drop-001` | which campaign |
| referrer host | `instagram.com` | same, when no tag is set |
| device / OS / browser | `mobile` / `iOS` / `Safari` | does the mobile checkout work |
| screen class | `small` | layout decisions |
| engaged ms | foreground time only | which pages hold attention |
| country | only from a proxy header | usually null; see above |

### The events

`page_view`, `product_view`, `product_list_view`, `product_select`,
`gallery_interaction`, `size_select`, `size_unavailable`, `add_to_cart`,
`remove_from_cart`, `view_cart`, `begin_checkout`, `checkout_progress`,
`checkout_error`, `promotion_view`, `promotion_select`, `whatsapp_click`,
`order_created`, `page_engagement`, `search`, `outbound_click`.

`order_status` is **server-only**. A browser posting it is refused: a client
that could write "DELIVERED" could invent deliveries that never happened.

`size_unavailable` fires when someone taps a sold-out size. That is demand for
stock that is not there, and it is otherwise invisible.

---

## How the numbers are kept honest

- **Events fire once.** Each carries a client-generated id and the insert
  ignores a duplicate, so a retried beacon cannot double-count. Milestones use
  a per-page `once` guard against re-renders.
- **Milestones are sent immediately**, not batched. Page views and engagement
  are batched (frequent, individually unimportant); a `begin_checkout` is rare
  and is the point of the measurement, so it gets its own request rather than
  waiting for an unload beacon that may never be sent.
- **A session's milestones only ever go from no to yes.** A later batch cannot
  erase what an earlier one recorded, and batches do arrive out of order.
- **Attribution is frozen at the first page** of the visit. An internal click
  cannot overwrite where the visitor came from, and an internal referrer is
  classified as internal rather than counted as a source.
- **Crawlers are excluded** before anything is written.
- **`unattributed` is a real answer.** An order that cannot be linked to a
  session (opted out, blocked, or ordered from another device) is labelled
  unattributed rather than assigned to a channel.
- **Engaged time is foreground time**, measured with the visibility API, and
  labelled as such. A tab left open in the background contributes nothing.
- **Analytics failure never breaks the shop.** Every entry point is wrapped,
  every send is fire-and-forget, and the QA suite runs the whole cart and
  checkout with every analytics request aborted to prove it.

---

## Reading the reports

**Admin → Analytics**, with Today / 7 / 30 / 90 days / custom range on every
screen:

| Screen | Answers |
|---|---|
| Overview | how many people, where from, how many ordered, how much |
| Traffic | source, medium, landing and exit pages, referrers, new vs returning |
| Funnel | visitor → product → size → cart → checkout → order, and where they stop |
| Products | views, size selections, adds, removals, and what actually sold |
| Customers | new vs returning, repeat distribution, lifetime value |
| Orders | status mix, revenue, discounts, bundles, time to accept/ship/deliver |
| Campaigns | UTM performance with conversion rates |
| Devices | device, OS, browser, screen class, each with its conversion rate |
| Locations | country (if available) and delivery cities from real orders |
| Conversion | cart / checkout / order rates by source, device and visitor type |
| Raw events | the unaggregated stream, filterable by event |

Raw events are kept, not just counters: an aggregate cannot answer a question
nobody thought to ask in advance. Retention defaults to 365 days
(`analytics.retentionDays`) and purging is an explicit action on
**Admin → Settings**, never a silent background job.

### Tagging a link

```
https://yourdomain/shop/?utm_source=instagram&utm_medium=story&utm_campaign=drop-001
```

Captured on the first page of the visit and carried through to the order.

---

## Rates over small numbers are noise

A source with four sessions and one order is not a 25% channel. The Conversion
screen says so on the page. Wait for counts in the hundreds before acting on a
rate.
