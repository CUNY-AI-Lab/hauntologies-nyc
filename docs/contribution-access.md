# Contribution access

This guide picks up where the [README](../README.md) leaves off. It explains event registration, map accounts, the contribution form and direct publication. Maintainers can continue to [Running the site](running-the-site.md) for settings and release steps.

These instructions follow the source on `main`. The live map can trail `main` until the release owner deploys the latest revision, so a control described here may not appear on the live site yet.

## Two sign-ups

Event registration records a name and email address and shows a receipt on the screen. It does not create a map account or send a confirmation email. A map account is the email-and-password login used to save and submit contributions. The two sign-ups are independent, and an event registration made on another device or browser will not appear in this browser's Account dialog.

The registration page at https://hauntologies-nyc.ailab-452.workers.dev/register links to account creation. Once signed in, the Account dialog has a collapsed Registration section with the receipt this browser remembers or a link to register for the event.

## Who can sign up

Both event registration and account creation accept an address at `cuny.edu` or a subdomain such as `gc.cuny.edu`. The registration and initial account-creation forms show an optional access-code field from the start. Other addresses need the shared guest access code from the organizers unless admission has already been remembered. A valid admission is remembered by the service for the unfinished account, but the code itself is not stored with the account. Password-creation and password-reset forms contain only password fields. Signing up never grants a reviewer, publisher or admin role.

## Create a map account

1. Open the map, choose **Sign in**, then choose **Don't have an account? Register here.** The registration page has a link to the same form.
2. Enter your email address, add the guest code if needed, and choose **Send verification email**.
3. Open the message from `ailab@gc.cuny.edu` and follow its link. It returns to the map with **Create your password**. The setup proof stays usable until you create the password and can be used once.
4. Choose a password of 12 to 128 characters, enter it twice, and choose **Create password and sign in**. The remembered guest admission is checked by the service; the password form does not ask for the code again.

If the email does not arrive, check spam and wait before asking again because per-address and network limits apply. If the account already has a password, use **Reset password** instead. A verification proof does not expire on a calendar deadline; creating the password consumes it and removes the other setup proofs for that address.

## Sign in, reset and sign out

Signing in takes an email address and password. **Reset password** sends a separate-purpose link that lasts 30 minutes; saving the new password revokes earlier sessions. A map session lasts seven days and the account check may renew it at most once a day. **Sign out** ends the current session.

The contribution draft is saved on the device being used: an account draft lasts 14 days and a signed-out draft lasts one day. Signing out keeps that account's draft on the device within its retention period.

## Contribute

After you sign in, choose **Contribute** in the bottom-right corner, then **Edit**. The same menu opens **Tasks**, **Activity** and **Contributors**. The form starts with **Place**. Type an address, street, building, existing map place, OpenStreetMap link or coordinates, choose a result, or choose **Pin** and click the map. Only points inside the five boroughs can be chosen. Choosing an existing place adds a note about it; it does not change the place itself. Use **Edit** on the place card for a correction to the place's fields or sources.

For a new place, add a title and description. For an existing place, add a description, a source or a fact; its description can be blank. Sources and facts are optional when a description is supplied. Enter a **Public username** and use **Describe your change** to say briefly what you are adding or changing. Choose **Publish**. When the server accepts the contribution, it goes straight onto the map without a separate review step; otherwise the form lists what to fix.

To add images, open **Images** and choose up to three JPEG, PNG or WebP files. Each image needs a **Rights** entry naming the license or permission for public display, and the form holds publication until every image has one. Remove an image to publish without it. Write **Alt text** that describes what the image shows, and add a **Credit** and **Source link** when you have them. A published image appears on the place card with its credit and rights.

## Public credit and history

Choose a username or moniker, not an email address. The username appears publicly with your contribution, including in the place's History and Contributors. The form remembers the last username on this device for the signed-in account. It does not use your account email or event registration name as a default, and the direct-publication flow has no separate name opt-out. Do not put private information in the username, description, facts or sources you publish.

Open a place card and choose **History** to see its published changes, usernames, times and descriptions. Expand a change to compare its earlier and later values. Signed-in contributors can choose **Undo**, enter a public username and description, and publish an inverse change. Undo preserves unrelated later changes; if a later change overlaps, reload History and compare before deciding what to do.

## Your saved work and removal

Open **Account**, then **Edits** to find your own saved and published work. Existing submitted, changes-requested, approved or staged work does not become public automatically. Supported saved work has a **Publish** action; the owner must choose it and supply a public username and change description. The Publish form lists each saved image with a **Publish image** checkbox. Only images with known rights can be checked, and unchecked images stay private. Older unsupported formats, such as area proposals and multi-entry bundles, stay private. Their summary editor offers **Save privately**; their content can be used in a new place or note, or in an edit to an existing place.

To remove your own published contribution, choose **Revoke** in Edits and confirm. Its effects and history are removed from the public map, while your private copy remains. Other contributors' changes and shared place IDs are preserved. To remove that private copy, choose **Delete** after revoking it. Deletion keeps minimal receipts and version markers and cannot erase copies already downloaded elsewhere. A legacy published contribution may be blocked from revocation or deletion when another release depends on it; the site reports that conflict instead of overwriting the later work.

## What stays private

Through the map, your raw contribution is accessible only to you, even after its text is published. A saved image becomes public only when you select it for publication and it names its rights; every other saved image stays visible to you alone. Revoking the contribution, or an Undo of its publication, closes public access to its images. The published text, sources, facts, selected images with their metadata, change description and chosen username are public. A map account stores its email and a scrypt password hash, never the password itself. An unfinished account keeps its address so its setup proof can be used until password creation. See [Private images](private-images.md) for the earlier image workflow and its limits.

## When something goes wrong

| What you see | What to do |
|---|---|
| Please use your CUNY email address. Guests can enter an access code below. | Use a CUNY address or enter the code the organizers gave you. |
| Please wait before trying again, or Too many attempts. Please try again later | Wait and try again. Some limits count requests from your address and others from your network, which a room can share. |
| Check your email and password, then try again. | Retype both, or choose **Reset password**. An account without a password must be completed through its setup proof. |
| This verification link has already been used or is invalid. Request a new link. | Sign in if you already created the password, or request another setup message. A setup proof remains usable until password creation and works once. |
| This link has expired or has already been used. Request a new link. | Reset links last 30 minutes and each works once; request another with **Reset password**. |
| Your password is already set. Sign in with it or request a reset. | The account is finished, so sign in or reset it. |
| Email delivery is temporarily unavailable. Please try again later. | Wait and try again, and tell the event contact if it continues. |
| Account service is temporarily unavailable. Please try again. | Wait and try again, and tell the event contact if it continues. |
| Sign in to continue. | Your session ended; sign in again. Your draft remains on this device within its retention period. |
| Save outcome unknown. Check My edits before retrying. | Check **Account** → **Edits** and use the offered confirmation action to resolve the pending save before starting another. |
| Image 1: add the license or permission that allows public display. | Fill in **Rights** for that image or remove it, then choose **Publish** again. |
| This place changed in an overlapping field. | Reload **History**, compare the changes and decide whether an edit is still needed. |
| Another release depends on this contribution. | Revocation is blocked to protect that work; contact a maintainer rather than assuming it was removed. |

## Production release and verification

Target Worker: `hauntologies-nyc`, Cloudflare account `452c33847cf5cb1e46f391fca32fd1b5`. Existing D1 database: `hauntologies-nyc` / `df7f1e92-e339-4e25-ac30-989dd68d8dfc`. Public origin: `https://hauntologies-nyc.ailab-452.workers.dev`.

Before a release, record the serving Worker version, a D1 Time Travel bookmark and counts for existing tables. Compare the actual schema with the migration ledger before considering a migration: a table may exist even when a corresponding migration is absent from the ledger. Apply only separately reviewed and authorized migrations, in order.

Build with `npm run build`, prepare with `node scripts/prepare-account-release.mjs`, and run `node --test tests/*.test.mjs`. Preparation configures account eligibility and the restricted mail binding, preserves the public route and disables preview URLs. Keep `MAP_AUTH_SECRET` in Worker secret storage and release Admission's restricted mail service before activating the map binding.

GitHub Actions validates every pull request and every push to `main`. [PR 39](https://github.com/CUNY-AI-Lab/hauntologies-nyc/pull/39) merged the guarded `Release Hauntologies` workflow, which runs only on a manual dispatch of the exact current `main` commit and stops before checkout when the `CLOUDFLARE_API_TOKEN` repository secret is absent. An approved release path must deploy the prepared configuration and verify the serving version, account readiness, signed-out protection, delivered assets and table counts. An authorized human must separately perform verification and reset with an authorized mailbox and record rollout acceptance; CI must not receive mailbox credentials. Local deployment is not an approved production release method.

Any production verification, reset, contribution or image acceptance test needs its own authorization and a disposable test identity. Local synthetic checks do not authorize participant reads or production writes. Rollback uses the prior Worker version after checking that bindings are retained; leave additive tables in place to preserve account data and audit history.

The local suite covers account and session safeguards, private access and direct publication, including history, revocation and deletion. Browser checks use local synthetic accounts. Production verification results belong in the release record with the exact Worker version and observed responses.

## Guest admission across account setup

A valid guest access code is checked during event or account registration. The service records a normalized email hash and approval time in `hny_guest_admissions`; it stores neither the email address nor the code in that table. The emailed proof still verifies ownership before password creation. An admission decision survives code rotation and supports resumed password setup. It grants eligibility only; verified sessions continue to control contribution access and roles.

Read [Private images](private-images.md) for saved photographs or scans, [Direct publication and revision history](direct-publication.md) for the publication and ownership rules, and [Running the site](running-the-site.md) if you build or release the site.
