# Private images

This guide covers the Images control in the contribution form: what it accepts, what happens before a file is saved, who can open it afterward and how the limits are enforced.

## What the form accepts

A contribution can carry up to three images in JPEG, PNG or WebP format. A chosen file can be no larger than 5 MiB and no larger than 8,192 pixels on a side or 16,777,216 pixels in total. SVG files and animated images are rejected. The browser checks the file signature and dimensions before decoding it, then redraws it into a derivative and lowers quality or dimensions until it fits the 1 MiB stored limit; PNG may become a lossy WebP. Camera and location metadata are removed, and the original file never leaves the device.

Each image also carries contributor-authored Caption, Alt text, Credit, Source link and Rights metadata. Unknown rights do not become publication permission.

## Saving and retrying

The form saves text first and uploads images afterward. An image remains **Not uploaded yet** until the server confirms it, then shows **Uploading** and **Uploaded with your contribution**. If an image fails while its file is still held in the tab, **Resume upload** retries it against the same contribution and account. A server rejection for type, size or quota requires a replacement. Closing the tab with files waiting shows the browser's standard warning, but a crash or reload can still lose them.

A successful upload creates a new immutable revision and sets aside an earlier approval because the evidence changed. The contribution must be submitted for review again.

## Who can see an image

Only the contributor and authorized reviewers can open an image, with publishers included once a contribution is approved. Images are private downloads with a server-generated filename, `no-store`, `nosniff` and a sandbox policy. No public asset URL exists, and approval does not publish images.

## What the server checks

The browser's checks come first and the server repeats them independently, confirming the JPEG, PNG or WebP container, type and dimensions and stripping embedded metadata. These checks are not a full image-codec decode or malware scan.

Image bytes live in the same D1 database as the other contribution data, in `contribution_media`. Each retained image is capped at 1,048,576 bytes, each proposal at three images, each owner at 25,165,824 retained bytes and all retained images at 268,435,456 bytes. The multipart request is capped at 1,064,960 bytes, including an 8,192-byte metadata allowance, and a D1 value or row may not exceed 2,000,000 bytes. Image bytes live in their own row rather than being repeated in revision JSON. See [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) and [binary parameters](https://developers.cloudflare.com/d1/worker-api/).

`POST /api/contributions/attachment` accepts a saved proposal ID, expected revision, idempotency key, metadata JSON and image. Only that proposal's owner can upload. One transaction stores the derivative, creates the new revision, sets aside the earlier approval and records an audit event and receipt. Readback checks the retained byte count and SHA-256 before success. A retry with the same key and exact file/metadata gives the same result; a changed request conflicts, and concurrent writes must pass revision and quota checks in the same transaction.

`GET /api/contributions/attachment?id=<attachment ID>` checks access to the linked private contribution before it sends any bytes. The regular contribution gate verifies the server identity first; client identity headers grant no access. The migration `0005_contribution_media.sql` adds the table and index, prevents attachment updates and does not modify or delete original records.

The form stages sanitized files in memory. Files are not written to browser databases. With open review enabled, other verified map accounts can review currently submitted material and its referenced images, while unsubmitted drafts and removed references stay outside ordinary peer access. Explicitly configured privileged roles retain their broader review scope.

## Next

Anyone building a tool that sends contributions can read [Area proposals and record annotations](../server/EMBEDDED-CONTRIBUTIONS.md), and [Running the site](running-the-site.md) covers the settings and release steps behind this guide.
