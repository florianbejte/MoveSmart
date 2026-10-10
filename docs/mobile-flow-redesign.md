# Mobile flow redesign

Reference review: 10 October 2026. Adapted interaction patterns, retaining MoveSmart branding and official transit colours; no proprietary assets copied.

## Mobbin references

- [Transit line detail](https://mobbin.com/flows/f2ea2463-4908-4586-b0bf-ef0add07c9c2): map and sheet, clear departure times and sequential trip details.
- [Waze reporting](https://mobbin.com/flows/e4575277-41aa-4d4d-9078-949aaa7a20b2): category grid, focused choice, explicit send action.
- [Google Maps saved lists](https://mobbin.com/screens/04f1886e-830e-4160-8f0c-57781364dea3): direct navigation and grouped shortcuts.
- [Google Maps layers](https://mobbin.com/screens/c59d13d5-42e6-42c1-a713-c584c0b61926): selected tiles with recognizable icons.
- [YNAB preference onboarding](https://mobbin.com/screens/9e95b6e9-60cf-4ed6-af9b-a0053a0adc83): short questions, choice rows, visible progress.

## Implemented flow changes

- Planning: compact route summaries, transport mode tabs, expandable itinerary, preferences behind Trip options.
- Nearby and stop details: shorter mobile headings, departure-first details, community information in an expandable section.
- Navigation: five mobile destinations including Saved; Map exits planning and restores map browsing.
- Saved: grouped stops/routes with counts, useful empty state and direct nearby-stop action; no unrelated search or alerts.
- Layers: two-column icon picker, clear enabled state, optional explanations; feed freshness and warnings remain visible.
- Stop reporting: category selection → review → send → confirmation; changes and cancellation remain possible before sending.
- Crowding reporting: shared sheet styling and reachable footer, retaining live vehicle selection and freshness validation.
- Welcome and preferences: guest-first exploration, meaningful step labels, compact choices and sticky actions.
- Authentication: consistent phone-sized forms, back-to-map link, password/email autofill semantics.

Server validation, report expiry, live timetable data and route colours remain intact. Authentication and actual report submission require configured services; UI checks do not publish fabricated observations.
