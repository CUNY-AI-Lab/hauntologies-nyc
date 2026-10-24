# Contribution access

This guide picks up where the [README](../README.md) leaves off and explains how to register for the event, how to create the map account that lets you save and submit contributions, what happens to a contribution after you submit it, and who is allowed to review and publish it. Organizers will also find how those roles are given, and people who build or release the site can continue to [Running the site](running-the-site.md), which covers the settings, the sign-in internals and the release steps.

## Two sign-ups

Event registration records your name and email address in the site's database and gives you a receipt on the screen, which your browser remembers, without creating an account or sending an email, while a map account is the email-and-password login that lets you propose places, corrections and sources from your own account. The two sign-ups do not depend on each other, so you can register for the event without ever creating a map account, and you need a map account only if you want to contribute.

The registration page at https://hauntologies-nyc.ailab-452.workers.dev/register links to account creation, and once you are signed in, the Account dialog on the map shows, in its collapsed Registration section, the event receipt your browser remembers or a link to register for the event, so a registration made on another device or in another browser does not appear there.

## Who can sign up

Both sign-ups accept any CUNY email address, meaning one whose domain is cuny.edu or a subdomain of it such as gc.cuny.edu, while anyone else needs the shared access code, which the organizers keep and give to guests. The registration forms show the access code field only after you type an address that is not a CUNY one, and the Create your password form always shows it, with a note that a CUNY address can leave it blank, because the site checks the code again when you create your first password without ever storing it on your account. Check a rejected code carefully before you enter another, since the site limits how many codes one network address can try.

Signing up never grants a role, so the first person to register and the person who organizes the event start with the same permissions as everyone else, and the Reviewers, publishers and admins section below explains how those roles are given.

## Create a map account

1. Open the map and choose Sign in, which sits with Edit in the bottom-right corner, then choose "Don't have an account? Register here." The "Create a map account" link on the registration page opens the same form.
2. Enter your email address, add the access code if your address is not a CUNY one, and choose Send verification email.
3. Open the message from ailab@gc.cuny.edu and follow its link, which brings you back to the map with a Create your password form and stays usable for 30 days after it was sent, so you can finish in a later sitting.
4. Choose a password of 12 to 128 characters, enter it twice, add the access code if your address is not a CUNY one, and choose Save password, after which you are signed in and the button in the bottom-right corner reads Account.

If the email does not arrive, look in your spam folder first and wait a while before asking for another, since the site limits how many messages it sends to one address in an hour. When a finished account already exists for the address, the site sends no message even though the page still tells you to check your email, so use Reset password if you registered before.

## Sign in, reset and sign out

Signing in takes your email address and password, and Reset password sends a link that works for 30 minutes if you have forgotten yours. Saving a new password signs out every session on the account, so you then sign in again with the new one, and you can end a session yourself at any time with the Sign out button in the Account dialog.

A session lasts one hour from the moment you sign in, whether or not you stay active, so during an afternoon event the site will ask you to sign in again more than once. The form you are filling in is saved on the device you are using, with a note that reads Draft saved on this device and the time, and when a session ends the note changes to say that your draft is saved and that you should sign in again to continue it. A draft saved while you are signed in lasts 14 days and one saved while you are signed out lasts a day, and signing out on purpose deletes the account's draft, while images are never kept in a draft, so any you have chosen but not yet uploaded are lost when the page reloads.

## Contribute

Account and Edit sit together in the bottom-right corner of the map, and choosing Edit while you are signed in opens a menu with Tasks, Contribute and Review. Choosing Edit while you are signed out sends you to the registration page, and the Sign in link there brings you back to the map with the menu reopened once you have signed in.

Tasks lists the shared tasks, each marked beginner, intermediate or advanced, such as documenting one reported haunting or tracing one vanished business, and it opens with a form that lets any signed-in account add a task of its own, although the contribution form has no way to attach a contribution to a task.

Contribute opens a form that starts with one Place field. Type an address, a street, a building or an intersection, the name of a place already on the map, an OpenStreetMap link or coordinates, and choose a match from the list or press Enter, or choose Pin and click the map, and the form names the point it chose and says where it is, although only points inside the five boroughs can be chosen. Choosing a place that is already on the map attaches your contribution to that place as context for the reviewer, which the form marks with Adding to this place and a Change button, and it never changes the place itself, since changes to a place go through the editor on its card. A new place can take a Title as well. The Description is the only required field, and Sources, Images and Facts are optional rows, where Facts records any other detail as a name and a value and Add fact adds another.

Choose Preview to read your description and the proposed coordinates before anything is saved, with your sources under Sources and your facts under Details, both folded until you open them, although the summary does not show images. Choose Contribute in that summary to save it, which stays disabled until the contribution passes the site's checks, after which a panel reads Sent for review, shows where the contribution stands and offers View status.

To correct a place that is already on the map, choose Edit on its card, change the fields that need correcting, write the short explanation the editor asks for, add up to ten new source references if you have them, and choose Contribute in the before-and-after preview to send the proposal. A contribution stays private to you, to reviewers and, once it is approved, to publishers, although you also see your own unpublished places on the map as colored pins that open the contribution.

## What happens to a contribution

Choosing View status in the Sent for review receipt, or opening a contribution from the Review panel's list, shows a track that runs Saved, In review, Approved and On the map, with a line beneath it that says what comes next, such as "Waiting for a reviewer.", "Sent back. Revise it and submit again.", "Approved. Waiting for a publisher to add it to the map." for a new place, "Approved. Waiting to be published." for a change to a place already on the map, or "On the public map." From there you can Revise a contribution that is saved, in review or sent back, and the button reads Revise and resubmit after a reviewer sends it back, or you can Withdraw one that has not reached the map, which asks you to confirm.

A new contribution goes to In review when you save it, and a reviewer other than you opens it, ticks one box to say "I checked the sources, location, rights, duplicates and privacy", may add a note, and chooses Approve, or chooses Send back and says what to change, which marks the track Needs changes. The Review panel's list and the Edits dialog, which opens from the Account dialog, name the same states differently, so the table gives both.

| Review panel list | Edits dialog | What it means |
|---|---|---|
| Awaiting review | Pending review | Submitted and waiting for a reviewer. |
| Needs information | Changes requested | A reviewer sent it back for changes. |
| Approved | Approved | A reviewer other than the contributor approved this exact version. |
| Draft | Draft | Not waiting for a reviewer, which happens when an approved contribution is given late images or its publication is rolled back, and it has to be submitted for review again. |
| Withheld | Withheld | Taken out of review by the contributor or by a reviewer, and the line beneath the track then reads Withdrawn. |
| Merged | Published | Applied to the public map and verified. |

Approval does not change the public map, because publishing is a separate permission. A publisher is an account named in the site's configuration, and an approved contribution waits until one adds it. A correction made with the editor on a place's card goes live after an independent reviewer approves it and a publisher applies and then verifies it, at which point the edited place replaces the original on the map, and a rollback restores the original. A contribution from the Contribute form, whether it describes a new place or is attached to an existing one, is a proposal and not a map record, so a publisher first chooses Promote to entry, which opens a form prefilled from the proposal and asks for the category, the place and date as recorded, how the location was established, the sources the category requires and the license, and the resulting entry is a new record that goes through its own independent review before the publisher applies and verifies it.

Area proposals and record annotations, which [Area proposals and record annotations](../server/EMBEDDED-CONTRIBUTIONS.md) describes field by field, are review-only and never reach the map.

## Reviewers, publishers and admins

Reviewers, publishers and admins are three short lists of verified accounts named in the site's configuration, each holding at most twenty accounts, and nobody joins one by registering. A reviewer sees the 100 most recently updated contributions, can approve one that is awaiting review but never one they wrote themselves, and can send one back, return one to review or withhold one with a message saying why. A publisher can read approved contributions and can apply, verify and roll back changes that an independent reviewer approved, and the publisher list has no effect unless the reviewer list names at least one account, since nothing can be approved without an independent reviewer. An admin holds the reviewer and publisher roles and alone may approve their own work, and the approval is recorded as the admin's own in its audit event.

Giving someone a role takes three steps, and the person receiving it carries out the first two.

1. Create a map account, verify it and sign in.
2. While signed in, open https://hauntologies-nyc.ailab-452.workers.dev/api/auth/session in the same browser, which shows an account ID that begins with map_.
3. Send that ID to a maintainer, who adds it to the right list as described in [Running the site](running-the-site.md).

## What stays private

Your contributions and images are visible only to you, to reviewers and, once a contribution is approved, to publishers, and images open only as private downloads, while the Published edits list shows the title and publication date of the 20 most recent published edits. Event registration stores your name and email address, and nothing on the public site lists who has registered. A map account stores your email address and a scrypt hash of your password, so the site never keeps the password itself, although each session also records the network address and browser it came from, and a sign-up you never finish keeps your address so that its emailed link keeps working.

## When something goes wrong

| What you see | What to do |
|---|---|
| Please use your CUNY email address. Guests can enter an access code below. | Use a CUNY address, or enter the access code the organizers gave you in the field that appears under the email box. |
| Please wait before trying again, or Too many attempts. Please try again later | Wait and try again. Some limits count requests from your email address and some from your network address, and everyone on the same network shares the second kind, so a room of people can reach them together. |
| Check your email and password, then try again. | Retype both, or choose Reset password. An account whose password was never created has to be finished through its verification link first. |
| Use a password with 12 to 128 characters. | Choose a password that fits that length. |
| This verification link has already been used or is invalid. Request a new link. | Sign in if you already created your password, or request a new link with Register here, since a link also stops working 30 days after it was sent. |
| This link has expired or has already been used. Request a new link. | Reset links last 30 minutes and every link works once, so request a new one with Reset password. |
| Your password is already set. Sign in with it or request a reset. | The account is finished, so sign in. |
| Email delivery is temporarily unavailable. Please try again later. | Wait and try again, and tell Zach if it continues. |
| Account service is temporarily unavailable. Please try again. | Wait and try again, and tell Zach if it continues. |
| Sign in to continue, or Sign in to contribute | Your session has ended, so sign in again, and your draft will be waiting. |
| Save outcome unknown. Check the queue before retrying. | Choose Check queue in the Contribute view, which then offers Confirm save, because the first attempt may have gone through and Preview and Contribute will not save again until the outcome is settled. |
| Choose an image no larger than 5 MB. | The form accepts originals up to 5 MB, so shrink or crop a larger picture in a photo app before choosing it. |
| This image could not be reduced below 1 MB. Choose a smaller image. | The browser could not shrink the picture enough, so choose a smaller or simpler one. |
| Contribution saved. Image not saved | The text is safe. While the images are still held in the tab and the failure is one the server can recover from, the Contribute view shows Resume upload, which retries them with the account that saved the contribution. An image the server rejects, for its type or size or because a limit is reached, has to be replaced, and after a reload the files are gone and must be chosen again. |

## Next

Read [Private images](private-images.md) next if your contribution includes photographs or scans, [Area proposals and record annotations](../server/EMBEDDED-CONTRIBUTIONS.md) for the two contribution types the form does not offer, and [Running the site](running-the-site.md) if you build or release the site.
