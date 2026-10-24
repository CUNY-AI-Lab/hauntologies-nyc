# Hauntologies of New York

A Halloween hackathon at the CUNY Graduate Center on Friday, October 30, 3–6:30 p.m., in Room 5307. Drop in anytime.

"The future is always experienced as a haunting," writes critical theorist Mark Fisher in his 2012 essay *What is Hauntology?*, "as a virtuality that already impinges on the present, conditioning expectations and motivating cultural production."

To welcome All Hallows' Eve, please join the GC's M.A. Program in Digital Humanities and M.S. Program in Data Analysis and Visualization for Hauntologies of New York, a Halloween hackathon on Friday, Oct. 30, from 3–6:30 p.m. in the programs' shared lounge, Room 5307.

Together, we'll develop a collaborative map of reported hauntings, spectral places, and archival silences using public datasets and digitized collections. You might trace businesses in the NYPL's Green Books, surface ghost stories from the Haunted Places dataset, or plot demolished buildings recorded in Wikipedia's list of demolished buildings and structures in New York City.

[Register here](https://hauntologies-nyc.ailab-452.workers.dev/register). No coding experience is required. We encourage you to bring your own laptop and come in costume if you'd like. Pizza, drinks, and Halloween candy will be aplenty.

Whether you're interested in archival research, digital mapping, or New York's forgotten histories, come on by and contribute to this very scary exploration of the people, places, and unrealized possibilities that haunt our city streets to this day.

With spooky regards,\
Zach Muhlbauer\
Advising Fellow, M.A. Program in Digital Humanities and M.S. Program in Data Analysis and Visualization

## Before you come

Registration asks for your name and an email address, and the page confirms with a receipt on the screen because the site sends no confirmation email. CUNY addresses are accepted as they are, while guests from outside CUNY need an access code from the organizers, which you can request from Zach at the address at the bottom of this page.

Registering does not create a map account, which you need only to save contributions of your own and which involves a verification email, so it is worth setting one up before Friday, and [Contribution access](docs/contribution-access.md) walks through the steps.

## The map

The map you will be adding to is live at https://hauntologies-nyc.ailab-452.workers.dev and opens on New York City, where anyone can search it for places and addresses, filter it by borough, type of place, period and certainty of location, and switch on aerial imagery of the city from 1924 forward to see what a place looked like then. Signing in lets you propose a new place with its sources and photographs, add to a place that is already on the map, or propose corrections to one, and a shared task list suggests where to start, with tasks such as documenting one reported haunting or clarifying one ambiguous date. Every proposal goes to a reviewer other than the contributor, and an approved proposal reaches the public map only when a publisher adds it.

## Where to go from here

This repository holds the source for the map, the registration page and the notes that explain how they work, and the guides below run from what a participant needs first to what a maintainer needs last, so read down the list until you reach the one that fits your part.

1. [Contribution access](docs/contribution-access.md) explains how to register for the event, how to create the map account that lets you save contributions, what happens to a contribution after you submit it, and who is allowed to review it, so read it next if you plan to contribute.
2. [Private images](docs/private-images.md) describes how photographs and scans attach to a contribution, what the form accepts, and who can open them afterward, and it matters if your contribution includes pictures.
3. [Area proposals and record annotations](server/EMBEDDED-CONTRIBUTIONS.md) lists every field in two contribution types that go beyond what the Contribute form sends, with the rules each field must meet, and anyone building a tool that sends these contributions will want it open.
4. [Running the site](docs/running-the-site.md) is for the people who build, configure and release the site, and it covers local setup, settings, how sign-in and email work underneath, and how to release and roll back.
5. [Model-assisted ingestion](server/README.md) describes a backend that would use a language model to help turn submitted text into map entries, although the feature is switched off, and its two companion files, the [tool contract](public/ingestion/TOOL-CONTRACT.md) and the [extraction skill](public/ingestion/SKILL.md), set out what a model may and may not do if anyone ever turns it on.

## Run it locally

You need Node.js 22.13 or newer, and these two commands install the dependencies and start the development server, while [Running the site](docs/running-the-site.md) covers tests, settings and releases.

```sh
npm run install:ci
npm run dev
```

The site is a Vinext app (Vite with a Next.js-compatible app router) deployed to Cloudflare Workers with a D1 database, and its pages and the map are plain HTML and JavaScript with Leaflet and MarkerCluster bundled.

## Questions

Write to Zach Muhlbauer at zmuhlbauer@gc.cuny.edu with questions about the event or to ask for a guest access code. Problems with the site itself can be opened as issues in this repository, and attendee names, email addresses and submission details should stay out of them.
