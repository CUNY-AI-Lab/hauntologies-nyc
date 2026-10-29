# Contribution access

This guide picks up where the [README](../README.md) leaves off. It explains event registration, map accounts, the contribution form, review and publication. Maintainers can continue to [Running the site](running-the-site.md) for settings and release steps.

## Two sign-ups

Event registration records a name and email address and shows a receipt on the screen. It does not create a map account or send a confirmation email. A map account is the email-and-password login used to save and submit contributions. The two sign-ups are independent, and an event registration made on another device or browser will not appear in this browser's Account dialog.

The registration page at https://hauntologies-nyc.ailab-452.workers.dev/register links to account creation. Once signed in, the Account dialog has a collapsed Registration section with the receipt this browser remembers or a link to register for the event.

## Who can sign up

Both event registration and account creation accept an address at `cuny.edu` or a subdomain such as `gc.cuny.edu`. Other addresses need the shared guest access code from the organizers. The registration and initial account-creation forms reveal their code field after a non-CUNY address is entered. A valid admission is remembered by the service for the unfinished account, but the code itself is not stored with the account. Password-creation and password-reset forms contain only password fields. Signing up never grants a reviewer, publisher or admin role.

## Create a map account

1. Open the map, choose **Sign in**, then choose **Don't have an account? Register here.** The registration page has a link to the same form.
2. Enter your email address, add the guest code if needed, and choose **Send verification email**.
3. Open the message from `ailab@gc.cuny.edu` and follow its link. It returns to the map with **Create your password**. The setup proof stays usable until you create the password and can be used once.
4. Choose a password of 12 to 128 characters, enter it twice, and choose **Create password and sign in**. The remembered guest admission is checked by the service; the password form does not ask for the code again.

If the email does not arrive, check spam and wait before asking again because per-address and network limits apply. If the account already has a password, use **Reset password** instead. A verification proof does not expire on a calendar deadline; creating the password consumes it and removes the other setup proofs for that address.

## Sign in, reset and sign out

Signing in takes an email address and password. **Reset password** sends a separate-purpose link that lasts 30 minutes; saving the new password revokes earlier sessions. A map session lasts seven days and the account check may renew it at most once a day. **Sign out** ends the current session.

The contribution draft is saved on the device being used: an account draft lasts 14 days and a signed-out draft lasts one day. Signing out on purpose deletes that account's draft. Images are held only in the tab until the contribution is submitted, so a reload or crash can lose unuploaded files.

## Contribute

After signing in, choose **Edit** in the bottom-right corner, then **Contribute**. The form starts with **Place**. Type an address, street, building, existing map place, OpenStreetMap link or coordinates, choose a result, or choose **Pin** and click the map. Only points inside the five boroughs can be chosen. Choosing an existing place adds a note about it; it does not change the place itself. Use the editor on the place card for a place correction.

Once a place is selected, add a title when needed and write the description. Sources, images and facts are optional. **Show my name with this contribution** is checked by default, but the name field and the account-wide **Show my name on the map** setting determine the effective public credit; see [Public credit](#public-credit). The form accepts up to three images and shows the current upload state.

Choose **Submit**. The site validates the contribution and, when the check succeeds, saves it in the same flow. If it cannot check or save it, the preview or status message explains what to fix or offers a retry. **Check review status** opens the saved contribution. A pending save whose outcome is unknown should be checked in the queue before it is retried.

## What happens to a contribution

The saved contribution shows **Saved**, **In review**, **Approved** and **On the map**, with a next-step message. A submitted contribution waits for a reviewer other than its author. The reviewer checks evidence and limits, location and uncertainty, rights and permitted reuse, duplicates, privacy and public-credit consent, then chooses **Approve review** or **Revise and resubmit** with a required explanation. Approval does not publish.

The **Review** panel opens on **Awaiting review**, with **Refresh** and a count of contributions from others. Rows are newest first and identify the kind of contribution and any credited name. The queue refreshes when the public Under review layer changes, with a bounded interval. If the public list cannot be read, the entry remains reachable and reports that the list is unavailable; after an earlier successful read it reports that the list is out of date and offers **Retry**. The Under review title card and map popup carry a visible **Under review** label.

After approval, an eligible publisher stages the change for verification. The publisher inspects the candidate map, list and source details in **Preview**, then records the map/list outcome and evidence in **Verify**. The five checks remain separate even when **Confirm all five checks** ticks them together. A passing verification activates exactly the staged bytes. Review-only contribution types never become map records automatically.

The contributor can revise a draft, submitted contribution or requested revision. A revision of an open proposal keeps its credit editor so a name can be added or removed; a typed revision edits its summary and keeps its original credit. The contributor can withdraw an unpublished contribution. Owners and explicitly listed moderators may permanently delete an unpublished contribution only when it has no release job; ordinary peers cannot delete another person's work. Published or staged release history is retained.

## Reviewers, publishers and admins

When `CONTRIBUTIONS_OPEN_REVIEW=true`, every verified map account may review and publish other people's submitted work, but not its own. Open peers do not receive other people's drafts, withheld work, private historical revisions, unpublished hosted targets or raw release snapshots. Explicitly configured roles retain their scoped privileged access. Every review and verification remains independent of the contributor, including for admins. Attendee-dashboard access remains blocked.

`CONTRIBUTIONS_REVIEWER_IDS` lists selected reviewers, who also publish. `CONTRIBUTIONS_PUBLISHER_IDS` can add publishers only when a valid nonempty reviewer list exists. `CONTRIBUTIONS_ADMIN_IDS` adds both roles. Each list is a JSON array of at most 20 canonical immutable actor IDs; invalid entries reject the whole list. These are operator settings, never client claims.

To request a role:

1. Create and verify a map account, then sign in.
2. While signed in, open https://hauntologies-nyc.ailab-452.workers.dev/api/auth/session in the same browser and copy the `map_` account ID.
3. Send that ID to a maintainer, who adds it to the appropriate list as described in [Running the site](running-the-site.md).

## Public credit

Public contributor names come only from the consented credit label on each contribution. The form offers **Show my name with this contribution** and a name field, checked by default. When the account email matches an event RSVP, the field may be prefilled with that person's registration name; the device remembers the last choice per account. The hint describes the effective result: if **Show my name on the map** is off, it says that the name stays hidden and offers that switch inline.

With consent and a nonblank label, the name appears with the contribution on the public Under review layer, in the Review queue and detail, and on the published record and Published edits after verification. Unchecking the box or leaving the name blank sends `consent:false` and keeps it unnamed everywhere. Account IDs, email addresses and RSVP names are never inferred as public credit. A roster opt-out withholds a label from every public projection, including pending places, published records, Published edits and contributor counts, while the release itself remains public.

The account-wide switch governs every public place where the person's name appears, including earlier contributions. Turning it back on restores those labels. The authenticated roster lists non-opted-out registrants with their public names and contribution and published counts, plus account status. It also returns the current viewer's own registration name for credit-field prefill. Email addresses never leave that roster query, and RSVP records do not create roles.

## What stays private

Raw contributions and images are visible only to the contributor, authorized reviewers and, once approved, publishers. A valid pointed new-place proposal can appear in the public Under review layer with its title, description and location, but not account identities, private images or source notes. A map account stores its email and a scrypt password hash, never the password itself. An unfinished account keeps its address so its setup proof can be used until password creation.

Private images are not public assets and are not published automatically. See [Private images](private-images.md). Areas, attachments and unsupported proposals remain review-only. Record edits use target version/hash guards, and rollback retains raw proposals, receipts and audit history.

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
| Save outcome unknown. Check the queue before retrying. | Choose **Check queue** or open **Review** and confirm whether the contribution exists before trying again. |
| Choose an image no larger than 5 MB. | Shrink or crop the original before choosing it. |
| This image could not be reduced below 1 MB. Choose a smaller image. | Choose a smaller or simpler picture. |
| Contribution saved. Image not saved | Choose **Resume upload** while the files remain in the tab; after a reload, choose them again. |

## Production release and verification

Target Worker: `hauntologies-nyc`, Cloudflare account `452c33847cf5cb1e46f391fca32fd1b5`. Existing D1 database: `hauntologies-nyc` / `df7f1e92-e339-4e25-ac30-989dd68d8dfc`. Public origin: `https://hauntologies-nyc.ailab-452.workers.dev`.

1. Record the current Worker version, a D1 Time Travel bookmark and counts for existing tables. Inspect the schema before applying additive migrations.
2. Preserve migration order and apply only missing, reviewed migrations. `0005_contribution_media.sql` stores images, `0006_map_accounts.sql` stores namespaced accounts, credentials, sessions, challenges and rates, and `0007_roster_opt_out.sql` stores roster opt-outs.
3. Build and run `node scripts/prepare-account-release.mjs`, then `node --test tests/*.test.mjs`. This prepares account and eligibility settings, open review and the restricted mail binding while preserving the public route and disabling preview URLs.
4. Store a cryptographically generated Hauntologies-only `MAP_AUTH_SECRET` through Worker secret storage without saving it in files, output or source. Release Admission's restricted mail service before activating the map binding.
5. Production release is currently blocked: this repository has no configured CI deployment path. A future approved path must deploy the prepared file, verify the serving version, account readiness, signed-out protection and delivered assets, then test verification and reset with an authorized mailbox and recheck table counts. The required build, deployment and readback evidence belongs in that CI path; a local command is not an approved production release method.

Any production verification, reset, contribution or image acceptance test needs its own authorization and a disposable test identity. Local synthetic checks do not authorize participant reads or production writes. Rollback uses the prior Worker version after checking that bindings are retained; leave additive tables in place to preserve account data and audit history.

The local suite covers verification-before-password, setup-proof retention, reset-purpose separation, concurrent credential creation, session expiry and renewal, origin and route rejection, durable rate enforcement, forged headers, cross-user proposal/image denial and private image readback. Browser checks cover registration, password creation, contribution save and account list, sign-out, reset, sign-in and the mobile dialog. Production verification results belong in the release record with the exact Worker version and observed responses.

## Guest admission across account setup

A valid guest access code is checked during event or account registration. The service records a normalized email hash and approval time in `hny_guest_admissions`; it stores neither the email address nor the code in that table. The emailed proof still verifies ownership before password creation. An admission decision survives code rotation and supports resumed password setup. It grants eligibility only; verified sessions continue to control contribution access and roles.

Read [Private images](private-images.md) next if your contribution includes photographs or scans, [Area proposals and record annotations](../server/EMBEDDED-CONTRIBUTIONS.md) for the two contribution types the form does not offer, and [Running the site](running-the-site.md) if you build or release the site.
