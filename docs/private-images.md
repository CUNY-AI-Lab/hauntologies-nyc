# Private images

This guide covers the Images control in the contribution form, and it is the natural next read after [Contribution access](contribution-access.md) if your contribution includes photographs, scans or screenshots, since it explains what the form accepts, what happens to a file before it is saved, who can open an image afterward, and how the limits are enforced for the people who maintain the site.

## What the form accepts

A contribution can carry up to three images in JPEG, PNG or WebP format, each no larger than 5 MB when you choose it and no larger than 8,192 pixels on a side or 16,777,216 pixels in total, with SVG files and animated images rejected. The browser checks the file's signature and dimensions before decoding it and redraws the picture into a new copy, lowering the quality and then the dimensions, and turning a PNG into a lossy WebP if it has to, until the copy is under 1 MB, and it says so when it had to reduce the pixel dimensions, so the server receives only the reduced copy, with camera and location metadata removed, and your original file never leaves your device.

Each image also carries a Caption, Alt text, a Credit, a Source link and a Rights field that starts as unknown, which the site keeps as your own words alongside the picture.

## Saving and retrying

The form saves your text first and uploads images afterward, with each image showing Not uploaded yet, and a note that nothing leaves the device before you submit, and then Uploading and Uploaded with your contribution once the site confirms that it arrived, so an image that fails leaves the contribution saved, and while the files you chose are still held in the tab and the failure is one the server can recover from, the Contribute view shows Resume upload, which retries them against the same contribution with the account that saved it, whereas an image the server rejects for its type or size, or because a limit is reached, has to be replaced. Files you have chosen wait only in the browser's memory, so closing the tab with files waiting brings up the browser's standard warning, although a crash or a reload can still lose them.

A successful upload creates a new revision of the contribution and sets aside any earlier approval, because the evidence has changed, so a contribution that was already approved becomes a Draft that has to be submitted for review again.

## Who can see an image

Only the contributor and reviewers can open an image, along with publishers once the contribution is approved, and only as a private download with a server-generated filename, with caching and content sniffing switched off and a sandbox policy applied. No public address exists for an image, and approving a contribution does not publish its images, since images never alter public records automatically.

## What the server checks

The browser's checks come first and the server repeats them independently, confirming the JPEG, PNG or WebP container structure, the type and the dimensions, and stripping embedded metadata, although these checks are not a full image decode or a malware scan.

Image bytes live in the same D1 database as everything else, in the `contribution_media` table with no separate bucket or credential, and each retained image is capped at 1 MiB (1,048,576 bytes), each contribution at three images and the images of every contributor together at 33,554,432 bytes. The upload request is capped at 1,064,960 bytes, which is the largest image plus 16,384 bytes of room, and the metadata field may not exceed 8,192 bytes, while D1 refuses any row above 2,000,000 bytes, so image bytes sit in a row of their own and the revision JSON never repeats them, as Cloudflare's documentation of [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) and [binary parameters](https://developers.cloudflare.com/d1/worker-api/) describes.

`POST /api/contributions/attachment` accepts a saved contribution's ID, the expected revision, an idempotency key, the metadata as JSON and the image, and only that contribution's owner can use it. One transaction stores the copy, creates the new revision, sets the earlier approval aside and records an audit event and a receipt, after which the server reads the stored bytes back and checks the byte count and SHA-256 before it reports success. A retry with the same key and the same file and metadata gives back the same result, a changed request conflicts, and concurrent writes must pass the revision and quota checks inside the same transaction.

`GET /api/contributions/attachment?id=<attachment ID>` checks the caller's access to the linked private contribution before it sends any bytes, and the regular contribution gate must have verified the caller's identity first, since identity headers sent by a client grant nothing. The migration `0005_contribution_media.sql` adds a table and an index and blocks updates to stored attachments, and it does not modify or delete any original record.

## Next

Anyone building a tool that sends contributions can read [Area proposals and record annotations](../server/EMBEDDED-CONTRIBUTIONS.md) for the two types the form does not offer, and [Running the site](running-the-site.md) covers the settings and release steps behind everything in this guide.
